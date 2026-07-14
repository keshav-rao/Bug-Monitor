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
  sapGuiProcesses: ['saplogon.exe', 'sapgui.exe', 'SAP Business Client.exe', 'saplgpad.exe'],
  processMonitor: {
    enabled: true,
    pollIntervalMs: 10000,
    cpuThreshold: 80,
    memThresholdMB: 500,
  },
  windowMonitor: {
    enabled: true,
    pollIntervalMs: 2000,
  },
  scripting: {
    enabled: true,
    pollIntervalMs: 3000,
  },
  logMonitor: {
    enabled: true,
    watchDirs: [],
    pollIntervalMs: 30000,
  },
  errorCapture: {
    enabled: true,
    pollIntervalMs: 2000,
    captureScreenshot: true,
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
      if (userConfig.processMonitor) config.processMonitor = { ...DEFAULT_CONFIG.processMonitor, ...userConfig.processMonitor };
      if (userConfig.windowMonitor) config.windowMonitor = { ...DEFAULT_CONFIG.windowMonitor, ...userConfig.windowMonitor };
      if (userConfig.scripting) config.scripting = { ...DEFAULT_CONFIG.scripting, ...userConfig.scripting };
      if (userConfig.logMonitor) config.logMonitor = { ...DEFAULT_CONFIG.logMonitor, ...userConfig.logMonitor };
      if (userConfig.errorCapture) config.errorCapture = { ...DEFAULT_CONFIG.errorCapture, ...userConfig.errorCapture };
    }
  } catch (err) {
    console.error('[SAP Desktop Agent] Failed to load config:', err.message);
  }
}

function saveConfig(updates) {
  config = { ...config, ...updates };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('[SAP Desktop Agent] Failed to save config:', err.message);
  }
}

function ts() { return Date.now(); }

function postEvent(event) {
  if (!config.enabled) return;
  eventBuffer.push({
    __bugMonitor: true,
    sourceType: 'sap_desktop',
    sessionId: config.sessionId,
    ts: ts(),
    origin: os.hostname(),
    platform: os.platform(),
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
    const { gzip } = require('zlib');
    const { promisify } = require('util');
    const gzipAsync = promisify(gzip);
    const compressed = await gzipAsync(Buffer.from(ndjson, 'utf8'));
    const response = await fetch(config.uploadEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Encoding': 'gzip',
        'X-BugMonitor-Source': 'sap_desktop',
        'X-BugMonitor-Events': String(batch.length),
      },
      body: compressed,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    console.error('[SAP Desktop Agent] Upload failed:', err.message);
    eventBuffer.unshift(...batch);
  }
}

function loadCollector(name) {
  try {
    const mod = require(path.join(__dirname, 'collectors', name));
    const instance = mod.create(config, { postEvent, config, getConfig: () => config });
    if (instance && instance.start) {
      collectorInstances.push(instance);
      console.log(`[SAP Desktop Agent] Started collector: ${name}`);
    }
    return instance;
  } catch (err) {
    console.error(`[SAP Desktop Agent] Failed to load collector ${name}:`, err.message);
    return null;
  }
}

function shutdown() {
  console.log('[SAP Desktop Agent] Shutting down...');
  for (const inst of collectorInstances) {
    if (inst.stop) inst.stop();
  }
  flushNow();
  process.exit(0);
}

function init() {
  loadConfig();

  if (!config.sessionId) {
    config.sessionId = 'sap_desk_' + ts() + '_' + require('crypto').randomBytes(8).toString('hex');
    saveConfig({ sessionId: config.sessionId });
  }

  console.log(`[SAP Desktop Agent] Starting — Session: ${config.sessionId}`);
  console.log(`[SAP Desktop Agent] Upload endpoint: ${config.uploadEndpoint}`);

  if (config.processMonitor?.enabled) loadCollector('sap-gui-process.js');
  if (config.windowMonitor?.enabled) loadCollector('sap-gui-window.js');
  if (config.scripting?.enabled) loadCollector('sap-gui-scripting.js');
  if (config.logMonitor?.enabled) loadCollector('sap-gui-logs.js');
  if (config.errorCapture?.enabled) loadCollector('sap-gui-errors.js');

  postEvent({ type: 'sap_desktop_agent', action: 'start', hostname: os.hostname(), platform: os.platform() });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    console.error('[SAP Desktop Agent] Uncaught exception:', err.message);
    postEvent({ type: 'sap_desktop_agent', action: 'uncaught_exception', error: err.message });
  });
}

init();
