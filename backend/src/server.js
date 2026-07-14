const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

// ─── Middleware ──────────────────────────────────────────────────────────

app.use(cors());

function authenticateJWT(req, res, next) {
  const authHeader = req.headers['x-bug-monitor-auth'] || req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Authentication required' });

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ─── Auth Routes (Public) ─────────────────────────────────────────────

app.post('/v1/auth/register', express.json(), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password required' });
    }
    const existing = db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = db.registerUser({ name, email, passwordHash, role: 'admin' });
    if (!user) return res.status(409).json({ error: 'Registration failed' });

    const token = jwt.sign(
      { userId: user.userId, email: user.email, role: user.role, projectAccess: user.projectAccess },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/auth/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.userId, email: user.email, role: user.role, projectAccess: user.projectAccess || [] },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    const { passwordHash: _, ...safe } = user;
    res.json({ user: safe, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Developer login with project ID + monitoring key
app.post('/v1/auth/project-login', express.json(), (req, res) => {
  try {
    const { projectId, monitoringKey } = req.body;
    if (!projectId || !monitoringKey) {
      return res.status(400).json({ error: 'projectId and monitoringKey required' });
    }

    const project = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.monitoringKey !== monitoringKey) {
      return res.status(401).json({ error: 'Invalid monitoring key' });
    }

    const token = jwt.sign(
      { projectId: project.id, role: 'developer', projectAccess: [project.id] },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    res.json({ project, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user info
app.get('/v1/auth/me', authenticateJWT, (req, res) => {
  try {
    if (req.user.role === 'developer') {
      const project = db.getProject(req.user.projectId);
      return res.json({ user: { role: 'developer', projectId: req.user.projectId }, project });
    }
    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const projects = db.listProjects().filter(p => p.createdBy === req.user.userId);
    res.json({ user, projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Project Routes (Admin only) ──────────────────────────────────────

app.get('/v1/projects', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.monitoringType) filter.monitoringType = req.query.monitoringType;
    let projects = db.listProjects(filter);
    if (req.user.role !== 'superadmin') {
      projects = projects.filter(p => p.createdBy === req.user.userId);
    }
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/projects', authenticateJWT, requireRole('admin'), express.json(), (req, res) => {
  try {
    const { name, company, monitoringTypes, retentionDays, aiAnalysis } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const project = db.createProject({
      name, company, monitoringTypes, retentionDays, aiAnalysis,
      createdBy: req.user.userId
    });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/projects/:id', authenticateJWT, (req, res) => {
  try {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (req.user.role === 'developer' && !req.user.projectAccess.includes(project.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'admin' && project.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/v1/projects/:id', authenticateJWT, requireRole('admin'), express.json(), (req, res) => {
  try {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.createdBy !== req.user.userId) return res.status(403).json({ error: 'Access denied' });

    const allowed = ['name', 'company', 'monitoringTypes', 'retentionDays', 'liveMonitoring', 'aiAnalysis', 'status'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = db.updateProject(req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/projects/:id', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.createdBy !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
    db.deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/projects/:id/regenerate-key', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.createdBy !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
    const newKey = db.regenerateProjectKey(req.params.id);
    res.json({ monitoringKey: newKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Management (Admin) ─────────────────────────────────────────

app.get('/v1/users', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const users = db.listUsers();
    if (req.user.role !== 'superadmin') {
      return res.json(users.filter(u => u.userId === req.user.userId));
    }
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Telemetry Upload Route (Public - accepts monitoring key in body or header) ──

app.post('/v1/telemetry/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const contentEncoding = req.headers['content-encoding'];
  let bodyBuffer = req.body;

  if (!bodyBuffer || bodyBuffer.length === 0) {
    return res.status(400).json({ error: 'Empty payload' });
  }

  const processNDJSON = (buffer) => {
    try {
      const text = buffer.toString('utf8');
      const lines = text.split('\n').filter(Boolean);
      const events = lines.map((line, idx) => {
        try { return JSON.parse(line); } catch (e) {
          throw new Error(`Failed to parse line ${idx}: ${e.message}`);
        }
      });

      // If events have a monitoring key in the first event, resolve projectId
      const firstEvent = events[0] || {};
      if (firstEvent.monitoringKey) {
        const project = db.getProjectByKey(firstEvent.monitoringKey);
        if (project) {
          for (const e of events) {
            e.projectId = project.id;
            e.sourceType = e.sourceType || firstEvent.sourceType || 'browser';
          }
        }
      }

      db.saveEventsBatch(events);
      res.json({ ok: true, uploaded: events.length });
    } catch (err) {
      res.status(400).json({ error: 'Parsing failed: ' + err.message });
    }
  };

  if (contentEncoding === 'gzip') {
    zlib.gunzip(bodyBuffer, (err, decompressed) => {
      if (err) processNDJSON(bodyBuffer);
      else processNDJSON(decompressed);
    });
  } else {
    processNDJSON(bodyBuffer);
  }
});

// ─── Dashboard Stats & Queries (Auth Protected) ──────────────────────

app.get('/v1/stats', authenticateJWT, (req, res) => {
  try {
    const origin = req.query.origin || null;
    const projectId = req.query.projectId || null;
    const sourceType = req.query.sourceType || null;
    const activeWindowSec = parseInt(req.query.activeWindowSec, 10);
    const activeWindowMs = !isNaN(activeWindowSec) ? activeWindowSec * 1000 : undefined;

    // Scope developers to their project
    const scopeProjectId = req.user.role === 'developer' ? req.user.projectAccess?.[0] : projectId;

    const stats = db.getGlobalStats(origin, activeWindowMs, scopeProjectId, sourceType);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/sessions', authenticateJWT, (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const origin = req.query.origin || null;
    const projectId = req.query.projectId || null;
    const sourceType = req.query.sourceType || null;

    const scopeProjectId = req.user.role === 'developer' ? req.user.projectAccess?.[0] : projectId;

    const data = db.getSessionsList({ limit, offset, origin, projectId: scopeProjectId, sourceType });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/sessions/:id', authenticateJWT, (req, res) => {
  try {
    const session = db.getSessionDetail(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/sessions/:id/events', authenticateJWT, (req, res) => {
  try {
    const type = req.query.type || null;
    const events = db.getSessionEvents(req.params.id, type);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/events', authenticateJWT, (req, res) => {
  try {
    const type = req.query.type || null;
    const origin = req.query.origin || null;
    const search = req.query.search || null;
    const since = req.query.since || null;
    const until = req.query.until || null;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const projectId = req.query.projectId || null;
    const sourceType = req.query.sourceType || null;

    const scopeProjectId = req.user.role === 'developer' ? req.user.projectAccess?.[0] : projectId;

    const data = db.queryAllEvents({ type, origin, search, since, until, limit, offset, projectId: scopeProjectId, sourceType });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/errors', authenticateJWT, (req, res) => {
  try {
    const origin = req.query.origin || null;
    const projectId = req.query.projectId || null;
    const sourceType = req.query.sourceType || null;

    const scopeProjectId = req.user.role === 'developer' ? req.user.projectAccess?.[0] : projectId;

    const summary = db.getErrorsSummary(origin, scopeProjectId, sourceType);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Legacy Sites Routes (kept for backward compatibility) ───────────

app.get('/v1/sites', authenticateJWT, (req, res) => {
  try {
    const sites = db.getSites();
    res.json(sites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/sites/verify', express.json(), (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys)) return res.status(400).json({ error: 'keys array required' });
    const sites = db.getSites();
    const validOrigins = sites.filter(s => keys.includes(s.apiKey)).map(s => s.origin);
    res.json({ origins: validOrigins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/sites', authenticateJWT, requireRole('admin'), express.json(), (req, res) => {
  try {
    const { origin, name } = req.body;
    if (!origin || !name) return res.status(400).json({ error: 'origin and name required' });

    let normalized = origin.trim();
    try { normalized = new URL(normalized).origin; } catch (_) {
      if (normalized.includes('/')) return res.status(400).json({ error: 'Invalid origin format' });
    }

    const site = db.registerSite(normalized, name.trim());
    res.json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/sites', authenticateJWT, requireRole('admin'), express.json(), (req, res) => {
  try {
    const { origin } = req.body;
    if (!origin) return res.status(400).json({ error: 'origin required' });
    const result = db.deleteSite(origin);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Server Start ─────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[BugMonitor API] Server running on http://localhost:${PORT}`);
  console.log(`[BugMonitor API] Auth: JWT-based with user accounts`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[BugMonitor API] Port ${PORT} is already in use.`);
    process.exit(1);
  }
  console.error('[BugMonitor API] Server failed to start:', err);
  process.exit(1);
});
