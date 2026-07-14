const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);

const QUEUE_PATH = path.join(__dirname, 'queue');
const CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

async function sendBatch(events, endpoint, monitoringKey) {
  if (events.length === 0) return { ok: true, uploaded: 0 };

  const batch = events.map(e => ({
    __bugMonitor: true,
    sourceType: 'sap_desktop',
    ts: Date.now(),
    origin: os.hostname(),
    monitoringKey,
    ...e,
  }));

  const ndjson = batch.map(e => JSON.stringify(e)).join('\n');
  const compressed = await gzipAsync(Buffer.from(ndjson, 'utf8'));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Encoding': 'gzip',
      'X-BugMonitor-Source': 'sap_desktop',
      'X-BugMonitor-Events': String(batch.length),
    },
    body: compressed,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return { ok: true, uploaded: batch.length };
}

async function flushQueue(endpoint, monitoringKey) {
  if (!fs.existsSync(QUEUE_PATH)) return;
  const files = fs.readdirSync(QUEUE_PATH).filter(f => f.endsWith('.json')).sort();
  for (const file of files) {
    const filePath = path.join(QUEUE_PATH, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      await sendBatch(Array.isArray(data) ? data : [data], endpoint, monitoringKey);
      fs.unlinkSync(filePath);
      console.log(`[SAP Desktop Sender] Flushed queued file: ${file}`);
    } catch (err) {
      console.error(`[SAP Desktop Sender] Failed to flush ${file}:`, err.message);
    }
  }
}

function queueEvents(events) {
  if (!fs.existsSync(QUEUE_PATH)) {
    fs.mkdirSync(QUEUE_PATH, { recursive: true });
  }
  const filename = `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
  fs.writeFileSync(path.join(QUEUE_PATH, filename), JSON.stringify(events), 'utf8');
}

async function send(events, opts = {}) {
  const cfg = readConfig();
  const endpoint = opts.endpoint || cfg.uploadEndpoint || 'http://localhost:4000/v1/telemetry/upload';
  const monitoringKey = opts.monitoringKey || cfg.monitoringKey;

  try {
    await flushQueue(endpoint, monitoringKey);
    const result = await sendBatch(events, endpoint, monitoringKey);
    return result;
  } catch (err) {
    console.error('[SAP Desktop Sender] Upload failed, queuing events locally:', err.message);
    queueEvents(events);
    return { ok: false, error: err.message, queued: events.length };
  }
}

module.exports = { send, sendBatch, flushQueue, queueEvents };
