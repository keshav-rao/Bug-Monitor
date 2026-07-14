(function () {
  'use strict';

  const CONFIG = {
    uploadEndpoint: 'http://localhost:4000/v1/telemetry/upload',
    batchSize: 50,
    flushIntervalMs: 2000,
    monitoringKey: null,
  };

  let eventBuffer = [];
  let flushTimer = null;
  let isSAPSystem = false;

  function detectSAPSystem() {
    if (typeof sap !== 'undefined' && sap.ui) return true;
    if (document.querySelector('[data-sap-ui-css^="sap"]')) return true;
    if (document.documentElement.getAttribute('data-sap-ui') !== null) return true;
    try {
      if (window['sap-ui-config']) return true;
    } catch (e) {}
    return false;
  }

  function ts() { return Date.now(); }

  function postEvent(event) {
    eventBuffer.push({
      __bugMonitor: true,
      sourceType: 'sap',
      sessionId: CONFIG.sessionId || ('sap_' + ts() + '_' + Math.random().toString(36).slice(2, 9)),
      ts: ts(),
      origin: location.origin,
      url: location.href,
      monitoringKey: CONFIG.monitoringKey,
      ...event,
    });
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    if (eventBuffer.length >= CONFIG.batchSize) {
      flushNow();
      return;
    }
    flushTimer = setTimeout(flushNow, CONFIG.flushIntervalMs);
  }

  async function flushNow() {
    flushTimer = null;
    if (eventBuffer.length === 0) return;
    const batch = eventBuffer.splice(0);
    const ndjson = batch.map(e => JSON.stringify(e)).join('\n');
    try {
      const compressed = await compress(ndjson);
      await fetch(CONFIG.uploadEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Encoding': 'gzip',
          'X-BugMonitor-Source': 'sap',
          'X-BugMonitor-Events': String(batch.length),
        },
        body: compressed,
      });
    } catch (err) {
      console.warn('[SAP Connector] Upload failed:', err.message);
      eventBuffer.unshift(...batch);
    }
  }

  async function compress(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  function init(config) {
    if (config) Object.assign(CONFIG, config);
    if (!detectSAPSystem()) {
      console.warn('[SAP Connector] No SAP UI5 system detected — aborting');
      return;
    }
    isSAPSystem = true;
    CONFIG.sessionId = 'sap_' + ts() + '_' + Math.random().toString(36).slice(2, 9);
    CONFIG.monitoringKey = config?.monitoringKey || localStorage.getItem('bug_monitor_monitoring_key');

    postEvent({ type: 'sap_connector', action: 'init', version: '1.0.0' });

    if (window.sap && window.sap.ui) {
      require(['sap/ui/core/Core'], function (Core) {
        Core.attachInit(function () {
          postEvent({ type: 'sap_connector', action: 'core_ready' });
        });
      });
    }
  }

  init();

  window.__BugMonitorSAP = {
    init,
    postEvent,
    flushNow,
    CONFIG,
  };
})();
