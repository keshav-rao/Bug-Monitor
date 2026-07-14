(function () {
  'use strict';

  if (typeof sap === 'undefined' || !sap.ui) return;

  const CONFIG = {
    enabled: true,
    capturePayload: true,
    payloadMaxLength: 1000,
    captureBatchDetails: true,
  };

  function getConnector() {
    return window.__BugMonitorSAP || null;
  }

  function postEvent(event) {
    const conn = getConnector();
    if (conn) conn.postEvent(event);
  }

  function serializePayload(payload) {
    if (!payload) return null;
    if (!CONFIG.capturePayload) return '[REDACTED]';
    try {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return str.length > CONFIG.payloadMaxLength ? str.slice(0, CONFIG.payloadMaxLength) + '...' : str;
    } catch (e) {
      return '[unserializable]';
    }
  }

  function extractEntitySet(url) {
    if (!url) return 'unknown';
    try {
      const parts = url.split('/');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'sap' || parts[i] === 'odata') continue;
        const candidate = parts[i];
        if (candidate.includes('(') || candidate === '') continue;
        if (candidate.startsWith("$")) continue;
        return candidate;
      }
    } catch (e) {}
    return 'unknown';
  }

  function hookODataModel() {
    try {
      const ODataModel = sap.ui.model.odata.v2?.ODataModel || sap.ui.model.odata.ODataModel;
      if (!ODataModel) return;

      const methods = ['read', 'create', 'update', 'remove'];
      for (const method of methods) {
        const orig = ODataModel.prototype[method];
        if (!orig) continue;
        ODataModel.prototype[method] = function (sPath, oParameters, ...rest) {
          const event = {
            type: 'sap_odata',
            operation: method.toUpperCase(),
            entitySet: extractEntitySet(sPath),
            path: sPath,
          };

          if (['create', 'update'].includes(method) && oParameters) {
            event.payload = serializePayload(oParameters);
          }

          const startTime = performance.now();
          let result;

          try {
            const mParameters = typeof oParameters === 'object' && oParameters !== null ? oParameters : {};
            const origSuccess = mParameters.success;
            const origError = mParameters.error;

            mParameters.success = function (oData, oResponse) {
              if (CONFIG.enabled) {
                postEvent({
                  ...event,
                  result: 'success',
                  duration: Math.round(performance.now() - startTime),
                  status: oResponse?.statusCode,
                });
              }
              if (origSuccess) origSuccess(oData, oResponse);
            };

            mParameters.error = function (oError) {
              if (CONFIG.enabled) {
                postEvent({
                  ...event,
                  result: 'error',
                  duration: Math.round(performance.now() - startTime),
                  errorMessage: oError?.message || oError?.statusText || 'Unknown',
                  status: oError?.statusCode,
                });
              }
              if (origError) origError(oError);
            };

            if (typeof oParameters === 'object' && oParameters !== null) {
              Object.assign(oParameters, mParameters);
            }

            result = orig.call(this, sPath, oParameters, ...rest);
          } catch (e) {
            if (CONFIG.enabled) {
              postEvent({ ...event, result: 'exception', errorMessage: e.message });
            }
            throw e;
          }

          return result;
        };
      }
    } catch (e) {}
  }

  function hookBatchCalls() {
    if (!CONFIG.captureBatchDetails) return;
    try {
      const ODataModel = sap.ui.model.odata.v2?.ODataModel || sap.ui.model.odata.ODataModel;
      if (!ODataModel || !ODataModel.prototype.submitBatch) return;
      const origSubmit = ODataModel.prototype.submitBatch;
      ODataModel.prototype.submitBatch = function (aRequests, ...rest) {
        const requestSummaries = (aRequests || []).map(r => ({
          operation: r.method || 'GET',
          entitySet: extractEntitySet(r.requestUri),
        }));
        const event = {
          type: 'sap_odata',
          subtype: 'batch',
          operation: 'BATCH',
          requestCount: requestSummaries.length,
          requests: requestSummaries.slice(0, 10),
        };
        const startTime = performance.now();
        try {
          const result = origSubmit.call(this, aRequests, ...rest);
          if (result && typeof result.then === 'function') {
            return result.then(
              function (res) {
                if (CONFIG.enabled) postEvent({ ...event, result: 'success', duration: Math.round(performance.now() - startTime) });
                return res;
              },
              function (err) {
                if (CONFIG.enabled) postEvent({ ...event, result: 'error', duration: Math.round(performance.now() - startTime) });
                throw err;
              }
            );
          }
          if (CONFIG.enabled) postEvent({ ...event, result: 'submitted' });
          return result;
        } catch (e) {
          if (CONFIG.enabled) postEvent({ ...event, result: 'exception', errorMessage: e.message });
          throw e;
        }
      };
    } catch (e) {}
  }

  sap.ui.getCore().attachInit(function () {
    if (!CONFIG.enabled) return;
    hookODataModel();
    hookBatchCalls();
    postEvent({ type: 'sap_odata', subtype: 'monitor_ready' });
  });
})();
