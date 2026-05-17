/**
 * business-events.js — Bug Monitor Business Events SDK
 * 
 * Include this script in your web app to track business-critical events
 * that the extension can correlate with technical telemetry.
 * 
 * Usage:
 *   <script src="chrome-extension://<ID>/sdk/business-events.js"></script>
 * 
 *   window.__BugMonitor.track('invoice_saved', { invoiceId: '123', amount: 500 });
 *   window.__BugMonitor.startWorkflow('wf_checkout_1', 'Checkout');
 *   window.__BugMonitor.stepWorkflow('wf_checkout_1', 'payment_submitted');
 *   window.__BugMonitor.completeWorkflow('wf_checkout_1', { orderId: 'ord_456' });
 */

(function () {
  'use strict';

  // If the main-collector already injected __BugMonitor, use it directly
  if (window.__BugMonitor) return;

  // Fallback SDK that posts directly via window messaging
  // (used when extension isn't active but SDK is still loaded)
  const SESSION_KEY = '__bm_session';
  let sessionId = sessionStorage.getItem(SESSION_KEY) || 'sdk_' + Date.now();

  function postEvent(event) {
    window.postMessage({ __bugMonitor: true, sessionId, ts: Date.now(), origin: location.origin, url: location.href, ...event }, '*');
  }

  window.__BugMonitor = {
    track(eventName, payload = {}, options = {}) {
      postEvent({ type: 'business', eventName, payload, severity: options.severity || 'info', workflowId: options.workflowId || null });
    },
    startWorkflow(workflowId, name, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_start', workflowId, workflowName: name, payload: metadata, severity: 'info' });
      return workflowId;
    },
    stepWorkflow(workflowId, step, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_step', workflowId, step, payload: metadata, severity: 'info' });
    },
    completeWorkflow(workflowId, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_complete', workflowId, payload: metadata, severity: 'info' });
    },
    failWorkflow(workflowId, reason, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_fail', workflowId, reason, payload: metadata, severity: 'error' });
    },
  };

  console.debug('[BugMonitor SDK] Loaded. Session:', sessionId);
})();
