const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbDir = path.join(__dirname, '..', 'db_data');
const sessionsDir = path.join(dbDir, 'sessions');
const sitesFile = path.join(dbDir, 'sites.json');
const usersFile = path.join(dbDir, 'users.json');
const projectsFile = path.join(dbDir, 'projects.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function initDataFile(file, defaultContent = '[]') {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, defaultContent, 'utf8');
  }
}

ensureDir(dbDir);
ensureDir(sessionsDir);
initDataFile(sitesFile);
initDataFile(usersFile);
initDataFile(projectsFile);

function readJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[DB] Failed to read ${file}:`, err.message);
  }
  return [];
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[DB] Failed to write ${file}:`, err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function genId(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('hex');
}

function genKey(prefix = '') {
  return prefix + crypto.randomBytes(16).toString('hex');
}

function readSites() { return readJSON(sitesFile); }
function writeSites(sites) { writeJSON(sitesFile, sites); }
function readUsers() { return readJSON(usersFile); }
function writeUsers(users) { writeJSON(usersFile, users); }
function readProjects() { return readJSON(projectsFile); }
function writeProjects(projects) { writeJSON(projectsFile, projects); }

function readSession(sessionId) {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[DB] Failed to read session ${sessionId}:`, err.message);
  }
  return null;
}

function writeSession(sessionId, data) {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[DB] Failed to write session ${sessionId}:`, err.message);
  }
}

function getAllSessionMeta() {
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const list = [];
  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      list.push({
        sessionId: content.sessionId,
        origin: content.origin,
        projectId: content.projectId || null,
        sourceType: content.sourceType || 'browser',
        startedAt: content.startedAt,
        lastSeen: content.lastSeen,
        eventCount: content.eventCount
      });
    } catch (err) {}
  }
  return list;
}

// ─── User Operations ──────────────────────────────────────────────────

function registerUser({ name, email, passwordHash, role = 'admin' }) {
  const users = readUsers();
  const existing = users.find(u => u.email === email);
  if (existing) return null;
  const user = {
    userId: genId('usr_'),
    name,
    email,
    passwordHash,
    role,
    projectAccess: [],
    createdAt: Date.now()
  };
  users.push(user);
  writeUsers(users);
  const { passwordHash: _, ...safe } = user;
  return safe;
}

function getUserByEmail(email) {
  const users = readUsers();
  return users.find(u => u.email === email) || null;
}

function getUserById(userId) {
  const users = readUsers();
  const user = users.find(u => u.userId === userId);
  if (!user) return null;
  const { passwordHash: _, ...safe } = user;
  return safe;
}

function listUsers() {
  const users = readUsers();
  return users.map(({ passwordHash: _, ...safe }) => safe);
}

// ─── Project Operations ───────────────────────────────────────────────

function createProject({ name, company, monitoringTypes, retentionDays, aiAnalysis, createdBy }) {
  const projects = readProjects();
  const projectId = 'PROJ-' + (projects.length + 1001);
  const monitoringKey = 'BM_' + genKey();
  const project = {
    id: projectId,
    name,
    company: company || '',
    monitoringTypes: monitoringTypes || ['browser'],
    monitoringKey,
    retentionDays: retentionDays || 7,
    liveMonitoring: true,
    aiAnalysis: aiAnalysis !== undefined ? aiAnalysis : true,
    status: 'active',
    createdBy,
    createdAt: Date.now()
  };
  projects.push(project);
  writeProjects(projects);
  return project;
}

function getProject(projectId) {
  const projects = readProjects();
  return projects.find(p => p.id === projectId) || null;
}

function getProjectByKey(key) {
  const projects = readProjects();
  return projects.find(p => p.monitoringKey === key) || null;
}

function listProjects(filter = {}) {
  let projects = readProjects();
  if (filter.status) projects = projects.filter(p => p.status === filter.status);
  if (filter.monitoringType) projects = projects.filter(p => p.monitoringTypes.includes(filter.monitoringType));
  return projects.sort((a, b) => b.createdAt - a.createdAt);
}

function updateProject(projectId, updates) {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return null;
  Object.assign(projects[idx], updates);
  writeProjects(projects);
  return projects[idx];
}

function deleteProject(projectId) {
  const projects = readProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  if (filtered.length === projects.length) return false;
  writeProjects(filtered);
  return true;
}

function regenerateProjectKey(projectId) {
  const projects = readProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return null;
  project.monitoringKey = 'BM_' + genKey();
  writeProjects(projects);
  return project.monitoringKey;
}

// ─── Site Operations (kept for browser extension compatibility) ────────

function registerSite(origin, name) {
  const sites = readSites();
  const apiKey = 'bm_' + crypto.randomBytes(12).toString('hex');
  const existingIdx = sites.findIndex(s => s.origin === origin);
  const newSite = {
    origin,
    name,
    apiKey: existingIdx >= 0 ? sites[existingIdx].apiKey : apiKey,
    projectId: null,
    sourceType: 'browser',
    createdAt: existingIdx >= 0 ? sites[existingIdx].createdAt : Date.now()
  };
  if (existingIdx >= 0) sites[existingIdx] = newSite;
  else sites.push(newSite);
  writeSites(sites);
  return newSite;
}

function getSites() {
  return readSites().sort((a, b) => b.createdAt - a.createdAt);
}

function deleteSite(origin) {
  const sites = readSites();
  const filtered = sites.filter(s => s.origin !== origin);
  writeSites(filtered);
  let sessionsRemoved = 0;
  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (content && content.origin === origin) {
          fs.unlinkSync(filePath);
          sessionsRemoved++;
        }
      } catch (err) {}
    }
  } catch (err) {
    console.error('[DB] Failed while removing sessions for deleted site:', err.message);
  }
  return { changes: sites.length - filtered.length, sessionsRemoved };
}

// ─── Event/Session Storage ────────────────────────────────────────────

function saveEventsBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return;

  const grouped = {};
  for (const e of events) {
    const sId = e.sessionId || 'anonymous';
    if (!grouped[sId]) grouped[sId] = [];
    grouped[sId].push(e);
  }

  for (const [sessionId, eventList] of Object.entries(grouped)) {
    let sessionData = readSession(sessionId);
    const firstEvent = eventList[0] || {};
    const sourceType = firstEvent.sourceType || 'browser';

    if (!sessionData) {
      sessionData = {
        sessionId,
        origin: firstEvent.origin || 'unknown',
        projectId: firstEvent.projectId || null,
        sourceType,
        startedAt: firstEvent.ts || Date.now(),
        lastSeen: firstEvent.ts || Date.now(),
        eventCount: 0,
        events: []
      };
    }

    for (const e of eventList) {
      const cleanEvent = { ...e };
      delete cleanEvent.__bugMonitor;
      sessionData.events.push(cleanEvent);
      sessionData.startedAt = Math.min(sessionData.startedAt, e.ts || Date.now());
      sessionData.lastSeen = Math.max(sessionData.lastSeen, e.ts || Date.now());
      sessionData.eventCount++;
      if (e.sourceType && !sessionData.sourceType) sessionData.sourceType = e.sourceType;
      if (e.projectId) sessionData.projectId = e.projectId;
    }

    writeSession(sessionId, sessionData);
  }
}

// ─── Stats & Queries ─────────────────────────────────────────────────

function getGlobalStats(originFilter = null, activeWindowMs = 30 * 60 * 1000, projectId = null, sourceType = null) {
  const sessions = getAllSessionMeta();
  const sites = readSites();

  let totalEvents = 0;
  let totalErrors = 0;
  let activeSessions = 0;
  const now = Date.now();
  const activeThreshold = now - (typeof activeWindowMs === 'number' ? activeWindowMs : 30 * 60 * 1000);
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  let lastUpload = 0;
  const rawHourly = {};

  for (const meta of sessions) {
    if (originFilter && meta.origin !== originFilter) continue;
    if (projectId && meta.projectId !== projectId) continue;
    if (sourceType && meta.sourceType !== sourceType) continue;

    totalEvents += meta.eventCount;
    if (meta.lastSeen > activeThreshold) activeSessions++;
    if (meta.lastSeen && meta.lastSeen > lastUpload) lastUpload = meta.lastSeen;

    const fullSession = readSession(meta.sessionId);
    if (fullSession && Array.isArray(fullSession.events)) {
      for (const e of fullSession.events) {
        if (e.type === 'error' || (e.type === 'network' && e.subtype?.includes('error'))) {
          totalErrors++;
        }
        if (e.ts > oneDayAgo) {
          const hourTs = Math.floor(e.ts / 3600000) * 3600000;
          rawHourly[hourTs] = (rawHourly[hourTs] || 0) + 1;
        }
      }
    }
  }

  const hourlyData = [];
  for (let i = 23; i >= 0; i--) {
    const targetHour = Math.floor((now - i * 60 * 60 * 1000) / 3600000) * 3600000;
    hourlyData.push({
      time: new Date(targetHour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      count: rawHourly[targetHour] || 0
    });
  }

  return {
    totalEvents,
    totalSessions: sessions.length,
    totalErrors,
    totalSites: sites.length,
    activeSessions,
    hourlyData,
    lastUpload: lastUpload || null,
    activeWindowMs
  };
}

function getSessionsList({ limit = 50, offset = 0, origin = null, projectId = null, sourceType = null }) {
  let list = getAllSessionMeta();

  if (origin) {
    const term = origin.toLowerCase();
    list = list.filter(s => s.origin && s.origin.toLowerCase().includes(term));
  }
  if (projectId) list = list.filter(s => s.projectId === projectId);
  if (sourceType) list = list.filter(s => s.sourceType === sourceType);

  list.sort((a, b) => b.lastSeen - a.lastSeen);
  const total = list.length;
  const paginated = list.slice(offset, offset + limit);
  return { list: paginated, total };
}

function getSessionDetail(sessionId) {
  const session = readSession(sessionId);
  if (!session) return null;

  const breakdown = {};
  if (Array.isArray(session.events)) {
    for (const e of session.events) {
      breakdown[e.type] = (breakdown[e.type] || 0) + 1;
    }
  }

  return {
    sessionId: session.sessionId,
    origin: session.origin,
    projectId: session.projectId || null,
    sourceType: session.sourceType || 'browser',
    startedAt: session.startedAt,
    lastSeen: session.lastSeen,
    eventCount: session.eventCount,
    breakdown
  };
}

function getSessionEvents(sessionId, typeFilter = null) {
  const session = readSession(sessionId);
  if (!session || !Array.isArray(session.events)) return [];

  let list = [...session.events];

  if (typeFilter && typeFilter !== 'all' && typeFilter !== '') {
    if (typeFilter === 'error') {
      list = list.filter(e => e.type === 'error' || e.type === 'sw_error');
    } else {
      list = list.filter(e => e.type === typeFilter);
    }
  }

  return list.sort((a, b) => a.ts - b.ts);
}

function queryAllEvents({ type, origin, search, since, until, limit = 100, offset = 0, projectId, sourceType }) {
  const sessions = getAllSessionMeta();
  let allEvents = [];

  for (const meta of sessions) {
    if (projectId && meta.projectId !== projectId) continue;
    if (sourceType && meta.sourceType !== sourceType) continue;
    const s = readSession(meta.sessionId);
    if (s && Array.isArray(s.events)) {
      allEvents.push(...s.events);
    }
  }

  if (type && type !== 'all') {
    if (type === 'error') allEvents = allEvents.filter(e => e.type === 'error' || e.type === 'sw_error');
    else allEvents = allEvents.filter(e => e.type === type);
  }
  if (origin) {
    const term = origin.toLowerCase();
    allEvents = allEvents.filter(e => e.origin && e.origin.toLowerCase().includes(term));
  }
  if (since) {
    const parsedSince = parseInt(since, 10);
    allEvents = allEvents.filter(e => e.ts >= parsedSince);
  }
  if (until) {
    const parsedUntil = parseInt(until, 10);
    allEvents = allEvents.filter(e => e.ts <= parsedUntil);
  }
  if (search) {
    const term = search.toLowerCase();
    allEvents = allEvents.filter(e => {
      return (
        (e.message && e.message.toLowerCase().includes(term)) ||
        (e.subtype && e.subtype.toLowerCase().includes(term)) ||
        (e.url && e.url.toLowerCase().includes(term)) ||
        JSON.stringify(e).toLowerCase().includes(term)
      );
    });
  }

  allEvents.sort((a, b) => b.ts - a.ts);
  const total = allEvents.length;
  const paginated = allEvents.slice(offset, offset + limit);
  return { list: paginated, total };
}

function getErrorsSummary(originFilter = null, projectId = null, sourceType = null) {
  const sessions = getAllSessionMeta();
  const errors = {};

  for (const meta of sessions) {
    if (originFilter && meta.origin !== originFilter) continue;
    if (projectId && meta.projectId !== projectId) continue;
    if (sourceType && meta.sourceType !== sourceType) continue;

    const s = readSession(meta.sessionId);
    if (s && Array.isArray(s.events)) {
      for (const e of s.events) {
        if (e.type === 'error' || e.type === 'sw_error' || e.subtype === 'webRequest_error') {
          let key = '';
          let message = '';
          let stack = '';
          let file = '';

          if (e.type === 'error') {
            message = e.message || e.subtype || 'Unknown exception';
            stack = e.stack || '';
            file = e.filename ? `${e.filename}:${e.lineno || 0}` : '';
            key = message + '|' + file;
          } else if (e.type === 'sw_error') {
            message = `[SW Error] ${e.context}: ${e.message || 'Unknown SW error'}`;
            stack = e.stack || '';
            key = message;
          } else {
            message = `Network failed: ${e.method || 'GET'} ${e.url} (${e.error || 'unknown error'})`;
            key = message;
          }

          if (!errors[key]) {
            errors[key] = {
              message,
              stack,
              file,
              origin: e.origin || meta.origin,
              sourceType: e.sourceType || meta.sourceType || 'browser',
              count: 0,
              firstSeen: e.ts,
              lastSeen: e.ts,
              sessions: new Set()
            };
          }

          errors[key].count++;
          errors[key].firstSeen = Math.min(errors[key].firstSeen, e.ts);
          errors[key].lastSeen = Math.max(errors[key].lastSeen, e.ts);
          errors[key].sessions.add(meta.sessionId);
        }
      }
    }
  }

  return Object.values(errors).map(err => ({
    ...err,
    sessionCount: err.sessions.size,
    sessions: Array.from(err.sessions).slice(0, 5)
  })).sort((a, b) => b.count - a.count);
}

module.exports = {
  registerSite, getSites, deleteSite,
  saveEventsBatch,
  getGlobalStats, getSessionsList, getSessionDetail,
  getSessionEvents, queryAllEvents, getErrorsSummary,
  registerUser, getUserByEmail, getUserById, listUsers,
  createProject, getProject, getProjectByKey, listProjects,
  updateProject, deleteProject, regenerateProjectKey
};
