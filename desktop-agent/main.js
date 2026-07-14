const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  uploadEndpoint: 'http://localhost:4000/v1/telemetry/upload',
  monitoringKey: null,
  sessionId: null,
  enabled: true,
  flushIntervalMs: 3000,
  batchSize: 100,
  fileSystem: {
    enabled: true,
    watchDirs: [],
    excludedDirs: ['node_modules', '.git', '.next', 'build', 'dist'],
  },
  processMonitor: {
    enabled: true,
    pollIntervalMs: 10000,
    monitoredProcesses: [],
    cpuThreshold: 80,
    memThresholdMB: 500,
  },
  uiEvents: {
    enabled: true,
  },
};

let config = { ...DEFAULT_CONFIG };
let eventBuffer = [];
let flushTimer = null;
let collectorInstances = [];

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = { ...DEFAULT_CONFIG, ...userConfig };
    }
  } catch (err) {
    console.error('[DesktopAgent] Failed to load config:', err.message);
  }
}

function saveConfig(updates) {
  config = { ...config, ...updates };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('[DesktopAgent] Failed to save config:', err.message);
  }
}

function ts() { return Date.now(); }

function postEvent(event) {
  if (!config.enabled) return;
  eventBuffer.push({
    __bugMonitor: true,
    sourceType: 'desktop',
    sessionId: config.sessionId,
    ts: ts(),
    origin: os.hostname(),
    url: process.cwd(),
    monitoringKey: config.monitoringKey,
    ...event,
  });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  if (eventBuffer.length >= config.batchSize) {
    flushNow();
    return;
  }
  flushTimer = setTimeout(flushNow, config.flushIntervalMs);
}

async function flushNow() {
  flushTimer = null;
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0);
  const ndjson = batch.map(e => JSON.stringify(e)).join('\n');
  try {
    const compressed = await compress(ndjson);
    const response = await fetch(config.uploadEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Encoding': 'gzip',
        'X-BugMonitor-Source': 'desktop',
        'X-BugMonitor-Events': String(batch.length),
      },
      body: compressed,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    console.log(`[DesktopAgent] Uploaded ${batch.length} events`);
  } catch (err) {
    console.error('[DesktopAgent] Upload failed:', err.message);
    eventBuffer.unshift(...batch);
  }
}

async function compress(text) {
  const { gzip } = require('zlib');
  const { promisify } = require('util');
  const gzipAsync = promisify(gzip);
  return gzipAsync(Buffer.from(text, 'utf8'));
}

function loadCollector(name) {
  try {
    const mod = require(path.join(__dirname, 'collectors', name));
    const instance = mod.create(config[name.replace('.js', '')] || {}, { postEvent, config });
    if (instance && instance.start) {
      collectorInstances.push(instance);
      console.log(`[DesktopAgent] Started collector: ${name}`);
    }
    return instance;
  } catch (err) {
    console.error(`[DesktopAgent] Failed to load collector ${name}:`, err.message);
    return null;
  }
}

function shutdown() {
  console.log('[DesktopAgent] Shutting down...');
  for (const inst of collectorInstances) {
    if (inst.stop) inst.stop();
  }
  flushNow();
  process.exit(0);
}

function init() {
  loadConfig();

  if (!config.sessionId) {
    config.sessionId = 'desk_' + ts() + '_' + require('crypto').randomBytes(8).toString('hex');
    saveConfig({ sessionId: config.sessionId });
  }

  console.log(`[DesktopAgent] Starting — Session: ${config.sessionId}`);
  console.log(`[DesktopAgent] Upload endpoint: ${config.uploadEndpoint}`);

  if (config.fileSystem?.enabled) loadCollector('file-system.js');
  if (config.processMonitor?.enabled) loadCollector('process-monitor.js');
  if (config.uiEvents?.enabled) loadCollector('ui-events.js');

  postEvent({ type: 'desktop_agent', action: 'start', hostname: os.hostname(), platform: os.platform() });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    console.error('[DesktopAgent] Uncaught exception:', err.message);
    postEvent({ type: 'desktop_agent', action: 'uncaught_exception', error: err.message });
  });
}

init();
