const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'bugmonitor123';

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());

// Custom auth middleware for API routes (excludes telemetry upload)
function requireAuth(req, res, next) {
  const authHeader = req.headers['x-bug-monitor-auth'] || req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Support both "Bearer <pass>" and direct "<pass>"
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (token !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  next();
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

app.post('/v1/auth/verify', express.json(), (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (password === DASHBOARD_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid password' });
});

// ─── Telemetry Upload Route (No Auth Required) ────────────────────────────────

app.post('/v1/telemetry/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const contentEncoding = req.headers['content-encoding'];
  const eventCountHeader = req.headers['x-bugmonitor-events'];
  let bodyBuffer = req.body;

  console.log(`[Backend API] Upload received - Encoding: ${contentEncoding}, Size: ${bodyBuffer?.length || 0} bytes, Header Events: ${eventCountHeader}`);

  if (!bodyBuffer || bodyBuffer.length === 0) {
    console.error('[Backend API] Empty payload received');
    return res.status(400).json({ error: 'Empty payload' });
  }

  const processNDJSON = (buffer) => {
    try {
      const text = buffer.toString('utf8');
      console.log(`[Backend API] Decompressed/Raw text length: ${text.length} characters`);
      console.log(`[Backend API] First 500 chars of payload: ${text.substring(0, 500)}`);
      
      const lines = text.split('\n').filter(Boolean);
      console.log(`[Backend API] Found ${lines.length} NDJSON lines`);
      
      const events = lines.map((line, idx) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error(`[Backend API] Failed to parse line ${idx}: ${e.message}`);
          throw e;
        }
      });
      
      console.log(`[Backend API] Successfully parsed ${events.length} events`);
      
      db.saveEventsBatch(events);
      
      console.log(`[Backend API] Upload success: Saved ${events.length} events`);
      res.json({ ok: true, uploaded: events.length });
    } catch (err) {
      console.error('[Backend API] Failed to parse NDJSON payload:', err.message);
      res.status(400).json({ error: 'Parsing failed: ' + err.message });
    }
  };

  if (contentEncoding === 'gzip') {
    zlib.gunzip(bodyBuffer, (err, decompressed) => {
      if (err) {
        // Body may already be decompressed by Node.js HTTP layer; try raw
        console.log('[Backend API] Gzip decompression failed, trying raw body');
        processNDJSON(bodyBuffer);
      } else {
        console.log(`[Backend API] Decompressed: ${decompressed.length} bytes -> ${decompressed.toString('utf8').length} characters`);
        processNDJSON(decompressed);
      }
    });
  } else {
    console.log('[Backend API] No compression, processing raw buffer');
    processNDJSON(bodyBuffer);
  }
});

// ─── Dashboard Stats & telemetry query (Auth Protected) ──────────────────────

app.get('/v1/stats', requireAuth, (req, res) => {
  try {
    const origin = req.query.origin || null;
    const stats = db.getGlobalStats(origin);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/sessions', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const origin = req.query.origin || null;

    const data = db.getSessionsList({ limit, offset, origin });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/sessions/:id', requireAuth, (req, res) => {
  try {
    const session = db.getSessionDetail(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/sessions/:id/events', requireAuth, (req, res) => {
  try {
    const type = req.query.type || null;
    const events = db.getSessionEvents(req.params.id, type);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/events', requireAuth, (req, res) => {
  try {
    const type = req.query.type || null;
    const origin = req.query.origin || null;
    const search = req.query.search || null;
    const since = req.query.since || null;
    const until = req.query.until || null;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const data = db.queryAllEvents({ type, origin, search, since, until, limit, offset });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/errors', requireAuth, (req, res) => {
  try {
    const origin = req.query.origin || null;
    const summary = db.getErrorsSummary(origin);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Registered Sites Configuration (Auth Protected) ─────────────────────────

app.get('/v1/sites', requireAuth, (req, res) => {
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
    if (!keys || !Array.isArray(keys)) {
      return res.status(400).json({ error: 'keys array required' });
    }
    const sites = db.getSites();
    const validOrigins = sites
      .filter(s => keys.includes(s.apiKey))
      .map(s => s.origin);
      
    res.json({ origins: validOrigins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/sites', requireAuth, express.json(), (req, res) => {
  try {
    const { origin, name } = req.body;
    if (!origin || !name) {
      return res.status(400).json({ error: 'origin and name required' });
    }
    // Simple URL normalizer
    let normalized = origin.trim();
    try {
      normalized = new URL(normalized).origin;
    } catch (_) {
      // Allow raw string if no protocol, but make sure it contains no slashes
      if (normalized.includes('/')) {
        return res.status(400).json({ error: 'Invalid origin format. Should be like https://example.com' });
      }
    }

    const site = db.registerSite(normalized, name.trim());
    res.json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/sites', requireAuth, express.json(), (req, res) => {
  try {
    const { origin } = req.body;
    if (!origin) {
      return res.status(400).json({ error: 'origin required' });
    }
    db.deleteSite(origin);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Server Start ─────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[BugMonitor API] Server running on http://localhost:${PORT}`);
  console.log(`[BugMonitor API] Secure mode: Password login protected`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[BugMonitor API] Port ${PORT} is already in use.`);
    console.error(`[BugMonitor API] Use a different port by setting the PORT environment variable, e.g. PORT=4001 npm run dev`);
    process.exit(1);
  }

  console.error('[BugMonitor API] Server failed to start:', err);
  process.exit(1);
});
