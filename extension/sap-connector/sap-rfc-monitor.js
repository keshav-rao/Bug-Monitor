(function () {
  'use strict';

  if (typeof sap === 'undefined' || !sap.ui) return;

  const CONFIG = {
    enabled: true,
    captureParams: true,
    paramMaxLength: 500,
  };

  function getConnector() {
    return window.__BugMonitorSAP || null;
  }

  function postEvent(event) {
    const conn = getConnector();
    if (conn) conn.postEvent(event);
  }

  function serializeParams(params) {
    if (!params) return null;
    if (!CONFIG.captureParams) return '[REDACTED]';
    try {
      const str = JSON.stringify(params);
      return str.length > CONFIG.paramMaxLength ? str.slice(0, CONFIG.paramMaxLength) + '...' : str;
    } catch (e) {
      return '[unserializable]';
    }
  }

  function hookJCoLikeCalls() {
    try {
      const jco = window['sap_jco'] || window['jco'] || null;
      if (!jco) return;

      const origExecute = jco.RfcFunction?.prototype?.execute || jco.execute;
      if (origExecute) {
        jco.execute = function (functionName, params, cb) {
          const startTime = performance.now();
          const postCb = function (error, result) {
            postEvent({
              type: 'sap_rfc',
              functionName: functionName || 'unknown',
              params: serializeParams(params),
              result: error ? 'error' : 'success',
              errorMessage: error ? (error.message || String(error)) : null,
              duration: Math.round(performance.now() - startTime),
            });
            if (cb) cb(error, result);
          };
          if (arguments.length >= 3) {
            arguments[2] = postCb;
          }
          return origExecute.call(this, ...arguments);
        };
      }
    } catch (e) {}
  }

  function hookSAPGatewayCalls() {
    try {
      const origAjax = $.ajax || jQuery?.ajax;
      if (!origAjax) return;

      $.ajax = function (settings) {
        const url = settings?.url || '';
        if (!url.includes('/sap/') && !url.includes('~sap')) {
          return origAjax.apply(this, arguments);
        }

        const startTime = performance.now();
        const origSuccess = settings?.success;
        const origError = settings?.error;

        settings.success = function (data, textStatus, jqXHR) {
          postEvent({
            type: 'sap_rfc',
            subtype: 'gateway_call',
            functionName: settings.url || 'unknown',
            method: settings.type || 'GET',
            duration: Math.round(performance.now() - startTime),
            status: jqXHR?.status,
            result: 'success',
          });
          if (origSuccess) origSuccess(data, textStatus, jqXHR);
        };

        settings.error = function (jqXHR, textStatus, errorThrown) {
          postEvent({
            type: 'sap_rfc',
            subtype: 'gateway_call',
            functionName: settings.url || 'unknown',
            method: settings.type || 'GET',
            duration: Math.round(performance.now() - startTime),
            status: jqXHR?.status,
            result: 'error',
            errorMessage: errorThrown || textStatus,
          });
          if (origError) origError(jqXHR, textStatus, errorThrown);
        };

        return origAjax.call(this, settings);
      };
    } catch (e) {}
  }

  sap.ui.getCore().attachInit(function () {
    if (!CONFIG.enabled) return;
    hookJCoLikeCalls();
    hookSAPGatewayCalls();
    postEvent({ type: 'sap_rfc', subtype: 'monitor_ready' });
  });
})();
