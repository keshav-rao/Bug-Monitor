const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);

const QUEUE_PATH = path.join(__dirname, 'queue');
const CONFIG_PATH = path.join(__dirname, 'config.json');

let eventBuffer = [];
let flushTimer = null;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function getEndpoint() {
  const cfg = readConfig();
  return cfg.uploadEndpoint || 'http://localhost:4000/v1/telemetry/upload';
}

function getMonitoringKey() {
  const cfg = readConfig();
  return cfg.monitoringKey || process.env.BUG_MONITOR_KEY || null;
}

function scheduleFlush() {
  if (flushTimer) return;
  if (eventBuffer.length >= BATCH_SIZE) {
    flushNow();
    return;
  }
  flushTimer = setTimeout(flushNow, FLUSH_INTERVAL_MS);
}

async function flushNow() {
  flushTimer = null;
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0);
  await sendBatch(batch);
}

async function sendBatch(events) {
  if (events.length === 0) return;

  const batch = events.map(e => ({
    __bugMonitor: true,
    sourceType: 'api',
    ts: Date.now(),
    origin: os.hostname(),
    monitoringKey: getMonitoringKey(),
    ...e,
  }));

  const ndjson = batch.map(e => JSON.stringify(e)).join('\n');
  const endpoint = getEndpoint();

  try {
    const compressed = await gzipAsync(Buffer.from(ndjson, 'utf8'));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Encoding': 'gzip',
        'X-BugMonitor-Source': 'api',
        'X-BugMonitor-Events': String(batch.length),
      },
      body: compressed,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    console.log(`[API Sender] Uploaded ${batch.length} events`);
  } catch (err) {
    console.error('[API Sender] Upload failed:', err.message);
    queueEvents(batch);
  }
}

function queueEvents(events) {
  try {
    if (!fs.existsSync(QUEUE_PATH)) {
      fs.mkdirSync(QUEUE_PATH, { recursive: true });
    }
    const filename = `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    fs.writeFileSync(path.join(QUEUE_PATH, filename), JSON.stringify(events), 'utf8');
  } catch (err) {
    console.error('[API Sender] Failed to queue events:', err.message);
  }
}

async function flushQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return;
  const files = fs.readdirSync(QUEUE_PATH).filter(f => f.endsWith('.json')).sort();
  const endpoint = getEndpoint();
  for (const file of files) {
    const filePath = path.join(QUEUE_PATH, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      await sendBatch(Array.isArray(data) ? data : [data]);
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`[API Sender] Failed to flush ${file}:`, err.message);
    }
  }
}

function send(events) {
  eventBuffer.push(...events);
  if (!flushTimer) {
    flushQueue();
  }
  scheduleFlush();
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushNow();
}

module.exports = { send, flush, flushQueue, sendBatch };
