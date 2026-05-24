import zlib from 'node:zlib';

const BACKEND_URL = 'http://localhost:4000/v1';
const DASHBOARD_PASSWORD = 'bugmonitor123'; // adjust if needed


async function uploadEvents(numEvents = 5) {
  const events = [];
  const now = Date.now();
  for (let i = 0; i < numEvents; i++) {
    events.push({
      sessionId: 'test-session',
      ts: now + i,
      type: 'console',
      level: 'log',
      message: `Test event ${i}`,
      origin: 'http://localhost:3000',
      url: 'http://localhost:3000/test'
    });
  }
  const ndjson = events.map(e => JSON.stringify(e)).join('\n');
  const gzipped = zlib.gzipSync(ndjson);

  const res = await fetch(`${BACKEND_URL}/telemetry/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Encoding': 'gzip',
      'X-BugMonitor-Events': String(events.length)
    },
    body: gzipped
  });
  if (!res.ok) throw new Error('Upload failed: ' + (await res.text()));
  console.log('Uploaded', numEvents, 'events');
}

async function getEventCount() {
  const res = await fetch(`${BACKEND_URL}/stats`, {
    headers: { 'x-bug-monitor-auth': DASHBOARD_PASSWORD }
  });
  if (!res.ok) throw new Error('Stats fetch failed: ' + (await res.text()));
  const stats = await res.json();
  return stats.totalEvents || 0;
}

(async () => {
  const before = await getEventCount();
  await uploadEvents(5);
  let after = before;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    after = await getEventCount();
    if (after > before) break;
  }
  if (after > before) {
    console.log('✅ Live feed updated! Event count:', before, '→', after);
    process.exit(0);
  } else {
    console.error('❌ Live feed did NOT update. Event count:', before, '→', after);
    process.exit(1);
  }
})();