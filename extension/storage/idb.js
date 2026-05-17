/**
 * idb.js — IndexedDB wrapper for the service worker
 * 
 * Stores telemetry events locally for up to 7 days.
 * Provides chunked reads for upload batching.
 */

const DB_NAME = 'BugMonitorDB';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const SESSIONS_STORE = 'sessions';
const META_STORE = 'meta';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_session', 'sessionId', { unique: false });
        store.createIndex('by_ts', 'ts', { unique: false });
        store.createIndex('by_origin', 'origin', { unique: false });
        store.createIndex('by_type', 'type', { unique: false });
      }

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' });
        sessStore.createIndex('by_origin', 'origin', { unique: false });
        sessStore.createIndex('by_start', 'startedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

/** Save a batch of events to IndexedDB */
export async function saveEvents(events) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(EVENTS_STORE);
    let count = 0;
    for (const event of events) {
      store.add(event);
      count++;
    }
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

/** Upsert a session record */
export async function upsertSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const req = store.get(session.sessionId);
    req.onsuccess = () => {
      const existing = req.result;
      if (existing) {
        store.put({ ...existing, ...session, eventCount: (existing.eventCount || 0) + (session.eventCount || 0) });
      } else {
        store.put({ eventCount: 0, ...session });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all sessions, optionally filtered by origin */
export async function getSessions(origin = null, limit = 100) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      let results = req.result || [];
      if (origin) results = results.filter((s) => s.origin === origin);
      results.sort((a, b) => b.startedAt - a.startedAt);
      resolve(results.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

/** Get events for a session */
export async function getSessionEvents(sessionId, limit = 5000) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const idx = store.index('by_session');
    const req = idx.getAll(sessionId, limit);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.ts - b.ts));
    req.onerror = () => reject(req.error);
  });
}

/** Get recent events across all sessions for a given origin */
export async function getRecentEvents(origin, since = Date.now() - 3600000, limit = 1000) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const idx = store.index('by_ts');
    const range = IDBKeyRange.lowerBound(since);
    const req = idx.getAll(range, limit * 2);
    req.onsuccess = () => {
      const results = (req.result || []).filter((e) => !origin || e.origin === origin).slice(0, limit);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Get events not yet uploaded (no uploadedAt timestamp) */
export async function getPendingUploadEvents(limit = 500) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readonly');
    const store = tx.objectStore(EVENTS_STORE);
    const req = store.openCursor();
    const pending = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && pending.length < limit) {
        if (!cursor.value.uploadedAt) {
          pending.push(cursor.value);
        }
        cursor.continue();
      } else {
        resolve(pending);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** Mark events as uploaded */
export async function markEventsUploaded(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(EVENTS_STORE);
    const now = Date.now();
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) store.put({ ...req.result, uploadedAt: now });
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Delete events older than retention period */
export async function purgeOldEvents() {
  const db = await openDB();
  const cutoff = Date.now() - RETENTION_MS;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(EVENTS_STORE);
    const idx = store.index('by_ts');
    const range = IDBKeyRange.upperBound(cutoff);
    const req = idx.openCursor(range);
    let deleted = 0;
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
  });
}

/** Get/Set meta values (stats, last upload time, etc.) */
export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get total event count and storage stats */
export async function getStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([EVENTS_STORE, SESSIONS_STORE], 'readonly');
    const eventsCount = tx.objectStore(EVENTS_STORE).count();
    const sessionsCount = tx.objectStore(SESSIONS_STORE).count();
    let ec = 0, sc = 0;
    eventsCount.onsuccess = () => { ec = eventsCount.result; };
    sessionsCount.onsuccess = () => { sc = sessionsCount.result; };
    tx.oncomplete = () => resolve({ totalEvents: ec, totalSessions: sc });
    tx.onerror = () => reject(tx.error);
  });
}
