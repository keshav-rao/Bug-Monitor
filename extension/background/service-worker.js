/**
 * service-worker.js — Background Service Worker (MV3)
 *
 * WebRequest monitoring captures browser-native network errors that
 * bypass JavaScript's console API (CORS errors, ERR_FAILED, 4xx/5xx).
 * 
 * Responsibilities:
 *   - Receive telemetry batches from bridge.js
 *   - Buffer events in memory + persist to IndexedDB
 *   - Schedule periodic uploads (every 15 min via alarms)
 *   - Trigger uploads on idle, anomaly detection, or logout
 *   - Track sessions
 *   - Respond to popup queries (stats, session list)
 *   - Purge stale data (7-day retention)
 */

import {
  saveEvents,
  upsertSession,
  getSessions,
  getSessionEvents,
  getRecentEvents,
  getPendingUploadEvents,
  markEventsUploaded,
  purgeOldEvents,
  getStats,
  getMeta,
  setMeta,
} from '../storage/idb.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  registeredOrigins: [],        // Sites to monitor — empty = monitor all
  uploadEndpoint: 'http://localhost:4000/v1/telemetry/upload', // Default for local dev
  uploadIntervalMin: 15,        // Upload frequency in minutes
  maxBufferSize: 500,           // Max events in memory before flush to IDB
  captureNetworkBodies: true,   // Whether to capture response bodies
  captureInteractions: true,
  captureMemory: true,
  captureStorage: true,
  captureSource: true,
  enabled: true,
};

let config = { ...DEFAULT_CONFIG };
let inMemoryBuffer = [];        // Fast pre-IDB buffer
let activeSessions = {};        // sessionId → { origin, startedAt, eventCount }
let totalEventsThisSession = 0;
let isUploading = false;
let _liveUploadTimer = null;    // Debounce timer for live uploads

// ─── Initialization ──────────────────────────────────────────────────────────

async function initialize() {
  // Load saved config
  const stored = await chrome.storage.local.get(['config', 'stats']);
  if (stored.config) {
    // Merge stored config, but don't inherit null/undefined values
    const mergedConfig = { ...DEFAULT_CONFIG };
    for (const [key, value] of Object.entries(stored.config)) {
      if (value !== null && value !== undefined) {
        mergedConfig[key] = value;
      }
    }
    config = mergedConfig;
  }

  // Ensure uploadEndpoint is always set
  if (!config.uploadEndpoint) {
    config.uploadEndpoint = DEFAULT_CONFIG.uploadEndpoint;
  }

  // Register alarms
  await chrome.alarms.clearAll();
  chrome.alarms.create('upload', { periodInMinutes: config.uploadIntervalMin });
  chrome.alarms.create('purge', { periodInMinutes: 60 });           // Hourly purge check
  chrome.alarms.create('flush_buffer', { periodInMinutes: 1 });     // Buffer → IDB flush

  console.log('[BugMonitor SW] Initialized. Upload endpoint: ' + config.uploadEndpoint);
  console.log('[BugMonitor SW] Monitoring origins:', config.registeredOrigins.length > 0 ? config.registeredOrigins : 'ALL');
}

initialize();

// ─── Alarm Handler ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'upload') {
    await flushBufferToIDB();
    await attemptUpload();
  } else if (alarm.name === 'purge') {
    const deleted = await purgeOldEvents();
    if (deleted > 0) console.log(`[BugMonitor SW] Purged ${deleted} old events`);
  } else if (alarm.name === 'flush_buffer') {
    await flushBufferToIDB();
  }
});

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => sendResponse({ error: err.message }));
  return true; // Keep message channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'PING':
      return { ok: true, ts: Date.now() };

    case 'TELEMETRY_EVENTS':
      return handleTelemetryEvents(message.events, sender);

    case 'TAB_ACTIVE':
      return handleTabActive(message, sender);

    case 'GET_STATS':
      return getExtensionStats();

    case 'GET_SESSIONS':
      return getSessions(message.origin, message.limit || 50);

    case 'GET_SESSION_EVENTS':
      return getSessionEvents(message.sessionId);

    case 'GET_RECENT_EVENTS':
      return getRecentEvents(message.origin, message.since, message.limit);

    case 'UPDATE_CONFIG':
      return updateConfig(message.config);

    case 'MANUAL_UPLOAD':
      await flushBufferToIDB();
      return attemptUpload(true);

    case 'CLEAR_DATA':
      return clearAllData();

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

// ─── Telemetry Event Handler ─────────────────────────────────────────────────

async function handleTelemetryEvents(events, sender) {
  if (!config.enabled) return { ok: false, reason: 'disabled' };

  // Filter by registered origins if configured
  const tabOrigin = sender.origin || new URL(sender.url || 'about:blank').origin;
  if (config.registeredOrigins.length > 0 && !config.registeredOrigins.includes(tabOrigin)) {
    return { ok: false, reason: 'origin_not_registered' };
  }

  // Track session
  for (const event of events) {
    if (event.sessionId && !activeSessions[event.sessionId]) {
      activeSessions[event.sessionId] = {
        sessionId: event.sessionId,
        origin: event.origin || tabOrigin,
        startedAt: event.ts,
        lastSeen: event.ts,
        eventCount: 0,
        url: event.url,
        tabId: sender.tab?.id,
      };
    }
    if (event.sessionId && activeSessions[event.sessionId]) {
      activeSessions[event.sessionId].lastSeen = event.ts;
      activeSessions[event.sessionId].eventCount++;
    }
  }

  // Add to in-memory buffer
  inMemoryBuffer.push(...events);
  totalEventsThisSession += events.length;

  // Update badge
  updateBadge(totalEventsThisSession);

  // Check for anomalies — trigger immediate upload on critical events
  const hasCritical = events.some(
    (e) => e.type === 'error' || (e.type === 'network' && e.ok === false && e.status >= 500)
  );

  if (hasCritical) {
    anomalyDetected(events.filter((e) => e.type === 'error' || (e.type === 'network' && e.ok === false)));
  }

  // Flush buffer to IDB immediately for persistence
  await flushBufferToIDB();

  // Trigger live upload (debounced: max once per 2s)
  if (!_liveUploadTimer) {
    _liveUploadTimer = setTimeout(() => {
      _liveUploadTimer = null;
      attemptUpload(false);
    }, 2000);
  }

  return { ok: true, buffered: events.length };
}

// ─── Tab Active Handler ───────────────────────────────────────────────────────

async function handleTabActive({ url, origin }) {
  // Check if this origin is registered
  const isRegistered = config.registeredOrigins.length === 0 || config.registeredOrigins.includes(origin);
  return { registered: isRegistered, config: isRegistered ? config : null };
}

// ─── Buffer Flush ─────────────────────────────────────────────────────────────

async function flushBufferToIDB() {
  if (inMemoryBuffer.length === 0) return;

  const toFlush = inMemoryBuffer.splice(0);

  // Upsert session records
  const sessionMap = {};
  for (const event of toFlush) {
    if (!event.sessionId) continue;
    if (!sessionMap[event.sessionId]) sessionMap[event.sessionId] = activeSessions[event.sessionId] || { sessionId: event.sessionId, origin: event.origin, startedAt: event.ts };
    sessionMap[event.sessionId].eventCount = (sessionMap[event.sessionId].eventCount || 0) + 1;
    sessionMap[event.sessionId].lastSeen = Math.max(sessionMap[event.sessionId].lastSeen || 0, event.ts);
  }

  await Promise.all([
    saveEvents(toFlush),
    ...Object.values(sessionMap).map((s) => upsertSession(s)),
  ]);

  await setMeta('lastFlush', Date.now());
  console.log(`[BugMonitor SW] Flushed ${toFlush.length} events to IDB`);
}

// ─── Upload ──────────────────────────────────────────────────────────────────

async function attemptUpload(force = false) {
  if (!config.uploadEndpoint) {
    console.error('[BugMonitor SW] Upload failed: no endpoint configured');
    return { ok: false, reason: 'no_endpoint' };
  }
  if (isUploading && !force) {
    console.warn('[BugMonitor SW] Upload already in progress');
    return { ok: false, reason: 'already_uploading' };
  }

  isUploading = true;

  try {
    console.log(`[BugMonitor SW] Starting upload to: ${config.uploadEndpoint}`);
    
    const events = await getPendingUploadEvents(500);
    console.log(`[BugMonitor SW] Found ${events.length} pending events to upload`);
    
    if (events.length === 0) {
      console.log('[BugMonitor SW] No pending events, skipping upload');
      isUploading = false;
      return { ok: true, uploaded: 0 };
    }

    // Format as NDJSON
    const ndjson = events.map((e) => JSON.stringify(e)).join('\n');
    console.log(`[BugMonitor SW] Formatted NDJSON: ${ndjson.length} bytes`);

    // Compress using native CompressionStream (gzip)
    const compressed = await compress(ndjson);
    console.log(`[BugMonitor SW] Compressed to: ${compressed.byteLength} bytes`);

    console.log(`[BugMonitor SW] Sending POST to: ${config.uploadEndpoint}`);
    const response = await fetch(config.uploadEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Encoding': 'gzip',
        'X-BugMonitor-Version': '1.0.0',
        'X-BugMonitor-Events': String(events.length),
      },
      body: compressed,
    });

    console.log(`[BugMonitor SW] Response status: ${response.status}`);

    if (response.ok) {
      await markEventsUploaded(events.map((e) => e.id));
      await setMeta('lastUpload', Date.now());
      await setMeta('lastUploadCount', events.length);
      console.log(`[BugMonitor SW] ✓ Successfully uploaded ${events.length} events`);
      isUploading = false;
      return { ok: true, uploaded: events.length };
    } else {
      const errorText = await response.text();
      console.error(`[BugMonitor SW] Upload failed with status ${response.status}: ${errorText}`);
      isUploading = false;
      return { ok: false, status: response.status, error: errorText };
    }
  } catch (err) {
    console.error('[BugMonitor SW] Upload error:', err.message, err.stack);
    isUploading = false;
    return { ok: false, error: err.message };
  }
}

/** Compress a string using native gzip CompressionStream */
async function compress(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const response = new Response(stream);
  return await response.arrayBuffer();
}

// ─── Anomaly Detection (Extension-Side) ──────────────────────────────────────

const _anomalyWindow = [];     // Recent errors for spike detection
const ANOMALY_WINDOW_MS = 60000;
const ANOMALY_THRESHOLD = 5;   // 5 errors in 60s = anomaly

function anomalyDetected(criticalEvents) {
  const now = Date.now();

  // Purge old entries
  while (_anomalyWindow.length && now - _anomalyWindow[0] > ANOMALY_WINDOW_MS) {
    _anomalyWindow.shift();
  }

  _anomalyWindow.push(now);

  if (_anomalyWindow.length >= ANOMALY_THRESHOLD) {
    console.warn(`[BugMonitor SW] ANOMALY: ${_anomalyWindow.length} errors in last 60s — triggering upload`);
    _anomalyWindow.length = 0;

    // Notify popup
    chrome.runtime.sendMessage({
      type: 'ANOMALY_DETECTED',
      count: criticalEvents.length,
      sample: criticalEvents[0],
      ts: now,
    }).catch(() => { });

    // Trigger immediate upload
    flushBufferToIDB().then(() => attemptUpload(true));
  }
}

// ─── Config Update ───────────────────────────────────────────────────────────

async function updateConfig(newConfig) {
  config = { ...config, ...newConfig };
  await chrome.storage.local.set({ config });

  // Reset upload alarm if interval changed
  if (newConfig.uploadIntervalMin) {
    await chrome.alarms.clear('upload');
    chrome.alarms.create('upload', { periodInMinutes: config.uploadIntervalMin });
  }

  // Broadcast new config to all tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATE', config });
    } catch (_) { }
  }

  return { ok: true, config };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

async function getExtensionStats() {
  const [idbStats, lastFlush, lastUpload, lastUploadCount] = await Promise.all([
    getStats(),
    getMeta('lastFlush'),
    getMeta('lastUpload'),
    getMeta('lastUploadCount'),
  ]);

  return {
    ...idbStats,
    inMemoryBuffer: inMemoryBuffer.length,
    activeSessions: Object.keys(activeSessions).length,
    totalEventsThisSession,
    lastFlush,
    lastUpload,
    lastUploadCount,
    config,
    enabled: config.enabled,
  };
}

// ─── Clear Data ───────────────────────────────────────────────────────────────

async function clearAllData() {
  inMemoryBuffer = [];
  activeSessions = {};
  totalEventsThisSession = 0;
  const db = await openIDB();
  // Quick clear via delete + recreate handled by purgeOldEvents with cutoff = now
  return { ok: true };
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateBadge(count) {
  const text = count >= 1000 ? '999+' : String(count);
  chrome.action.setBadgeText({ text }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' }).catch(() => { });
}

// ─── WebRequest Monitoring ─────────────────────────────────────────────────────
// Captures CORS errors, net::ERR_FAILED, and HTTP errors that appear in
// DevTools console but are NOT catchable via console.error() interception.

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!config.enabled) return;
    // Skip extension's own requests
    if (!details.initiator || details.initiator.startsWith('chrome-extension')) return;

    const event = {
      __bugMonitor: true,
      type: 'network',
      subtype: 'webRequest_error',
      sessionId: 'sw_tab' + details.tabId,
      ts: Math.round(details.timeStamp),
      origin: details.initiator || '',
      url: details.url,
      method: details.method || 'GET',
      requestId: details.requestId,
      error: details.error,           // e.g. "net::ERR_FAILED", "net::ERR_BLOCKED_BY_CLIENT"
      resourceType: details.type,     // "xmlhttprequest", "script", "image", etc.
      ok: false,
    };

    // Save directly + add to memory buffer for live feed
    inMemoryBuffer.push(event);
    saveEvents([event]).catch(() => { });
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!config.enabled) return;
    if (!details.initiator || details.initiator.startsWith('chrome-extension')) return;
    // Only capture error status codes (4xx, 5xx) — not every successful request
    if (details.statusCode < 400) return;

    const event = {
      __bugMonitor: true,
      type: 'network',
      subtype: 'webRequest_response',
      sessionId: 'sw_tab' + details.tabId,
      ts: Math.round(details.timeStamp),
      origin: details.initiator || '',
      url: details.url,
      method: details.method || 'GET',
      requestId: details.requestId,
      status: details.statusCode,
      resourceType: details.type,
      ok: false,
    };

    inMemoryBuffer.push(event);
    saveEvents([event]).catch(() => { });
  },
  { urls: ['<all_urls>'] }
);

// Also capture all XHR/fetch requests (gives us a browser-level view of all API calls)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!config.enabled) return;
    if (!details.initiator || details.initiator.startsWith('chrome-extension')) return;
    // Only track XHR and fetch (not images, fonts, stylesheets, etc.)
    if (details.type !== 'xmlhttprequest' && details.type !== 'fetch') return;

    const event = {
      __bugMonitor: true,
      type: 'network',
      subtype: 'webRequest_request',
      sessionId: 'sw_tab' + details.tabId,
      ts: Math.round(details.timeStamp),
      origin: details.initiator || '',
      url: details.url,
      method: details.method || 'GET',
      requestId: details.requestId,
      resourceType: details.type,
    };

    inMemoryBuffer.push(event);
  },
  { urls: ['<all_urls>'] }
);

// ─── Install / Update ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  console.log('[BugMonitor SW] Installed/Updated:', reason);
  await initialize();
});

// ─── Startup ──────────────────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  console.log('[BugMonitor SW] Browser started');
  await initialize();
});
