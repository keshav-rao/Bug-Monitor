const fs = require('fs');
const path = require('path');

const dbDir = path.join(__dirname, '..', 'db_data');
const sessionsDir = path.join(dbDir, 'sessions');
const sitesFile = path.join(dbDir, 'sites.json');

// Ensure database directories exist
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}
if (!fs.existsSync(sitesFile)) {
  fs.writeFileSync(sitesFile, JSON.stringify([]), 'utf8');
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function readSites() {
  try {
    if (fs.existsSync(sitesFile)) {
      return JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
    }
  } catch (err) {
    console.error('[DB] Failed to read sites:', err.message);
  }
  return [];
}

function writeSites(sites) {
  try {
    fs.writeFileSync(sitesFile, JSON.stringify(sites, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Failed to write sites:', err.message);
  }
}

function readSession(sessionId) {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`[DB] Failed to read session ${sessionId}:`, err.message);
  }
  return null;
}

function writeSession(sessionId, data) {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  try {
    console.log(`[DB] Writing session to: ${filePath}`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[DB] Successfully wrote session: ${sessionId} with ${data.eventCount} events`);
  } catch (err) {
    console.error(`[DB] Failed to write session ${sessionId}: ${err.message} (Path: ${filePath})`);
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
        startedAt: content.startedAt,
        lastSeen: content.lastSeen,
        eventCount: content.eventCount
      });
    } catch (err) {
      // Ignore corrupted files
    }
  }
  return list;
}

// ─── Exported Database APIs ──────────────────────────────────────────────────

/**
 * Register or update a site
 */
function registerSite(origin, name) {
  const sites = readSites();
  const apiKey = 'bm_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  const existingIdx = sites.findIndex(s => s.origin === origin);
  const newSite = {
    origin,
    name,
    apiKey: existingIdx >= 0 ? sites[existingIdx].apiKey : apiKey,
    createdAt: existingIdx >= 0 ? sites[existingIdx].createdAt : Date.now()
  };

  if (existingIdx >= 0) {
    sites[existingIdx] = newSite;
  } else {
    sites.push(newSite);
  }

  writeSites(sites);
  return newSite;
}

/**
 * Get all registered sites
 */
function getSites() {
  return readSites().sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Delete a registered site
 */
function deleteSite(origin) {
  const sites = readSites();
  const filtered = sites.filter(s => s.origin !== origin);
  writeSites(filtered);
  return { changes: sites.length - filtered.length };
}

/**
 * Bulk save events and update sessions (No SQLite native locks!)
 */
function saveEventsBatch(events) {
  if (!Array.isArray(events) || events.length === 0) {
    console.log('[DB] saveEventsBatch called with empty/invalid events');
    return;
  }

  console.log(`[DB] Processing ${events.length} events for batch save`);

  // Group events by sessionId
  const grouped = {};
  for (const e of events) {
    const sId = e.sessionId || 'anonymous';
    if (!grouped[sId]) grouped[sId] = [];
    grouped[sId].push(e);
  }

  console.log(`[DB] Events grouped into ${Object.keys(grouped).length} sessions:`, Object.keys(grouped));

  // Save each group atomically
  for (const [sessionId, eventList] of Object.entries(grouped)) {
    console.log(`[DB] Saving ${eventList.length} events to session: ${sessionId}`);
    
    let sessionData = readSession(sessionId);
    
    if (!sessionData) {
      const firstEvent = eventList[0] || {};
      sessionData = {
        sessionId,
        origin: firstEvent.origin || 'unknown',
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
    }

    writeSession(sessionId, sessionData);
  }
}

/**
 * Get global stats for Overview Dashboard
 */
function getGlobalStats(originFilter = null) {
  const sessions = getAllSessionMeta();
  const sites = readSites();

  let totalEvents = 0;
  let totalErrors = 0;
  let activeSessions = 0;
  const now = Date.now();
  const activeThreshold = now - 30 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const rawHourly = {};

  for (const meta of sessions) {
    if (originFilter && meta.origin !== originFilter) continue;

    totalEvents += meta.eventCount;
    if (meta.lastSeen > activeThreshold) {
      activeSessions++;
    }

    // Read full events lists to calculate errors and hourly graphs
    const fullSession = readSession(meta.sessionId);
    if (fullSession && Array.isArray(fullSession.events)) {
      for (const e of fullSession.events) {
        // Count errors
        if (e.type === 'error' || (e.type === 'network' && e.subtype?.includes('error'))) {
          totalErrors++;
        }

        // Group hourly for chart
        if (e.ts > oneDayAgo) {
          const hourTs = Math.floor(e.ts / 3600000) * 3600000;
          rawHourly[hourTs] = (rawHourly[hourTs] || 0) + 1;
        }
      }
    }
  }

  // Build last 24h hourly stats array
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
    hourlyData
  };
}

/**
 * Get sessions list with search/filtering
 */
function getSessionsList({ limit = 50, offset = 0, origin = null }) {
  let list = getAllSessionMeta();

  if (origin) {
    const term = origin.toLowerCase();
    list = list.filter(s => s.origin.toLowerCase().includes(term));
  }

  // Sort by lastSeen descending
  list.sort((a, b) => b.lastSeen - a.lastSeen);

  const total = list.length;
  const paginated = list.slice(offset, offset + limit);

  return { list: paginated, total };
}

/**
 * Get specific session details and its events breakdown
 */
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
    startedAt: session.startedAt,
    lastSeen: session.lastSeen,
    eventCount: session.eventCount,
    breakdown
  };
}

/**
 * Get events for a session (in chronological order)
 */
function getSessionEvents(sessionId, typeFilter = null) {
  const session = readSession(sessionId);
  if (!session || !Array.isArray(session.events)) return [];

  let list = [...session.events];

  if (typeFilter && typeFilter !== 'all') {
    list = list.filter(e => e.type === typeFilter);
  }

  return list.sort((a, b) => a.ts - b.ts);
}

/**
 * Get overall event log with filters across all sessions
 */
function queryAllEvents({ type, origin, search, since, until, limit = 100, offset = 0 }) {
  const sessions = getAllSessionMeta();
  let allEvents = [];

  for (const meta of sessions) {
    const s = readSession(meta.sessionId);
    if (s && Array.isArray(s.events)) {
      allEvents.push(...s.events);
    }
  }

  // Apply filters
  if (type && type !== 'all') {
    allEvents = allEvents.filter(e => e.type === type);
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

  // Sort by ts descending
  allEvents.sort((a, b) => b.ts - a.ts);

  const total = allEvents.length;
  const paginated = allEvents.slice(offset, offset + limit);

  return { list: paginated, total };
}

/**
 * Deduplicated error analysis
 */
function getErrorsSummary(originFilter = null) {
  const sessions = getAllSessionMeta();
  const errors = {};

  for (const meta of sessions) {
    if (originFilter && meta.origin !== originFilter) continue;
    
    const s = readSession(meta.sessionId);
    if (s && Array.isArray(s.events)) {
      for (const e of s.events) {
        if (e.type === 'error' || e.subtype === 'webRequest_error') {
          let key = '';
          let message = '';
          let stack = '';
          let file = '';

          if (e.type === 'error') {
            message = e.message || e.subtype || 'Unknown exception';
            stack = e.stack || '';
            file = e.filename ? `${e.filename}:${e.lineno || 0}` : '';
            key = message + '|' + file;
          } else {
            // webRequest_error
            message = `Network failed: ${e.method || 'GET'} ${e.url} (${e.error || 'unknown error'})`;
            key = message;
          }

          if (!errors[key]) {
            errors[key] = {
              message,
              stack,
              file,
              origin: e.origin || meta.origin,
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
    sessions: Array.from(err.sessions).slice(0, 5) // Return max 5 session examples
  })).sort((a, b) => b.count - a.count);
}

module.exports = {
  registerSite,
  getSites,
  deleteSite,
  saveEventsBatch,
  getGlobalStats,
  getSessionsList,
  getSessionDetail,
  getSessionEvents,
  queryAllEvents,
  getErrorsSummary
};
