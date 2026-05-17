/**
 * bridge.js — Runs in ISOLATED world (has access to chrome.* APIs)
 *
 * Listens for postMessage events from the MAIN world (main-collector.js)
 * and forwards them to the background service worker via chrome.runtime.sendMessage.
 *
 * KEY PROBLEM: Chrome MV3 service workers go INACTIVE (sleep) after ~30s.
 * When the SW is asleep, sendMessage fails. We buffer events locally and
 * retry with exponential backoff until the SW wakes up.
 */

(function () {
  'use strict';

  let _batch = [];                    // Events waiting to be sent
  let _retryQueue = [];               // Events that failed (SW was asleep)
  let _flushTimer = null;
  let _retryTimer = null;
  let _retryDelay = 500;              // Start at 500ms, max 8s
  const BATCH_MAX = 20;
  const BATCH_INTERVAL_MS = 400;
  const MAX_RETRY_DELAY = 8000;
  const MAX_QUEUE_SIZE = 500;         // Don't buffer more than 500 events

  // ─── Send to Service Worker with retry ────────────────────────────────────

  async function sendToSW(events) {
    if (events.length === 0) return;
    try {
      await chrome.runtime.sendMessage({ type: 'TELEMETRY_EVENTS', events });
      // Success — reset retry delay
      _retryDelay = 500;
      // Try to flush any previously failed events
      if (_retryQueue.length > 0) {
        const queued = _retryQueue.splice(0);
        await sendToSW(queued);
      }
    } catch (err) {
      // SW is likely inactive — buffer for retry
      _retryQueue.push(...events);
      // Cap queue size to avoid memory bloat
      if (_retryQueue.length > MAX_QUEUE_SIZE) {
        _retryQueue.splice(0, _retryQueue.length - MAX_QUEUE_SIZE);
      }
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (_retryTimer) return;
    _retryTimer = setTimeout(async () => {
      _retryTimer = null;
      if (_retryQueue.length === 0) return;
      const toRetry = _retryQueue.splice(0);
      // Try waking SW by sending a ping first
      try {
        await chrome.runtime.sendMessage({ type: 'PING' });
        await sendToSW(toRetry);
        _retryDelay = 500;  // Reset on success
      } catch (_) {
        // Still sleeping — put events back and increase delay
        _retryQueue.unshift(...toRetry);
        _retryDelay = Math.min(_retryDelay * 2, MAX_RETRY_DELAY);
        scheduleRetry();
      }
    }, _retryDelay);
  }

  // ─── Batch flush ───────────────────────────────────────────────────────────

  function flushBatch() {
    if (_batch.length === 0) return;
    const toSend = _batch.splice(0);
    sendToSW(toSend);
    _flushTimer = null;
  }

  function scheduledFlush() {
    if (!_flushTimer) {
      _flushTimer = setTimeout(flushBatch, BATCH_INTERVAL_MS);
    }
  }

  // ─── Listen from MAIN world ────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    if (!event.data || !event.data.__bugMonitor) return;
    if (event.source !== window) return;

    _batch.push(event.data);

    // Flush immediately for critical events
    const isCritical =
      event.data.type === 'error' ||
      (event.data.type === 'network' && event.data.ok === false);

    if (isCritical || _batch.length >= BATCH_MAX) {
      if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
      flushBatch();
    } else {
      scheduledFlush();
    }
  });

  // ─── Listen for config updates from SW ────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONFIG_UPDATE') {
      window.postMessage({ __bugMonitorConfig: true, config: message.config }, '*');
    }
  });

  // ─── Notify SW this tab is active (wakes it up) ───────────────────────────

  function pingServiceWorker() {
    chrome.runtime.sendMessage({ type: 'TAB_ACTIVE', url: location.href, origin: location.origin })
      .catch(() => {
        // SW was asleep — it'll wake on next message, schedule retry
        setTimeout(pingServiceWorker, 2000);
      });
  }

  pingServiceWorker();

  // ─── Keep SW alive by pinging when page is visible ────────────────────────
  // MV3 SWs sleep after 30s. We ping every 25s to keep it alive while the
  // user is actively on the page.

  let _keepAliveTimer = null;

  function startKeepAlive() {
    if (_keepAliveTimer) return;
    _keepAliveTimer = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {
          clearInterval(_keepAliveTimer);
          _keepAliveTimer = null;
        });
      } catch (err) {
        // Context invalidated on extension reload
        clearInterval(_keepAliveTimer);
        _keepAliveTimer = null;
      }
    }, 25000);
  }

  function stopKeepAlive() {
    if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startKeepAlive();
    else stopKeepAlive();
  });

  startKeepAlive();

})();

