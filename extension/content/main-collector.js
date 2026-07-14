/**
 * main-collector.js — Runs in MAIN world (full page JS access)
 * 
 * Intercepts and captures:
 *   1. Console (log, warn, error, debug, info, trace, table, group, time, count)
 *   2. Network (fetch + XMLHttpRequest)
 *   3. JavaScript errors & unhandled promise rejections
 *   4. User interactions (click, input, change, submit, scroll, keydown)
 *   5. Performance (navigation, resources, paint, LCP, FID, CLS, long tasks)
 *   6. Memory (heap usage polling)
 *   7. Storage (localStorage, sessionStorage mutations)
 *   8. Source / Resources (scripts, stylesheets, images, fonts loaded)
 *   9. WebSocket traffic
 *  10. DOM Mutations (significant structural changes)
 *  11. Business Events (via window.__BugMonitor SDK)
 *  12. Page Visibility / Navigation changes
 */

(function () {
  'use strict';

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const SESSION_KEY = '__bm_session';
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  let eventSequence = 0;

  function ts() {
    return Date.now();
  }

  function seq() {
    return ++eventSequence;
  }

  /** Post an event to the bridge (ISOLATED world) via postMessage */
  function postEvent(event) {
    try {
      window.postMessage(
        {
          __bugMonitor: true,
          sourceType: 'browser',
          sessionId,
          seq: seq(),
          ts: ts(),
          origin: location.origin,
          url: location.href,
          ...event,
        },
        '*'
      );
    } catch (_) {
      // Never let the collector crash the page
    }
  }

  /** Safely serialize a value to a JSON-compatible form */
  function serialize(val, maxLen = 2000) {
    try {
      if (val === null) return 'null';
      if (val === undefined) return 'undefined';
      if (typeof val === 'string') return val.length > maxLen ? val.slice(0, maxLen) + '…' : val;
      if (typeof val === 'number' || typeof val === 'boolean') return val;
      if (val instanceof Error) return { name: val.name, message: val.message, stack: (val.stack || '').slice(0, 1500) };
      if (val instanceof Element) return serializeElement(val);
      const str = JSON.stringify(val, null, 0);
      return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
    } catch (_) {
      return '[unserializable]';
    }
  }

  function serializeArgs(args) {
    return Array.from(args).map((a) => serialize(a));
  }

  /** Serialize a DOM element into a readable descriptor */
  function serializeElement(el) {
    if (!el || !(el instanceof Element)) return null;
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : 'unknown',
      id: el.id || null,
      classes: (el.getAttribute('class') || '').split(' ').filter(Boolean).slice(0, 5),
      text: (el.textContent || '').trim().slice(0, 100),
      name: el.getAttribute('name') || null,
      type: el.getAttribute('type') || null,
      href: el.getAttribute('href') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      dataTestId: el.getAttribute('data-testid') || null,
      xpath: getXPath(el),
    };
  }

  function getXPath(el) {
    try {
      if (!el || el.nodeType !== 1) return '';
      if (el === document.body) return '/html/body';
      const idx = Array.from(el.parentNode?.children || [])
        .filter((c) => c.tagName === el.tagName)
        .indexOf(el) + 1;
      return getXPath(el.parentNode) + '/' + el.tagName.toLowerCase() + (idx > 1 ? `[${idx}]` : '');
    } catch (_) {
      return '';
    }
  }

  /** Sanitize headers — remove auth tokens & cookies before capturing */
  function sanitizeHeaders(headers) {
    if (!headers) return {};
    const sensitive = /authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token/i;
    const out = {};
    try {
      const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
      for (const [k, v] of entries) {
        out[k] = sensitive.test(k) ? '[REDACTED]' : v;
      }
    } catch (_) {}
    return out;
  }

  // ─── 1. CONSOLE COLLECTOR ───────────────────────────────────────────────────

  const CONSOLE_METHODS = ['log', 'warn', 'error', 'debug', 'info', 'trace', 'table', 'group', 'groupEnd', 'count', 'time', 'timeEnd', 'assert'];
  const _origConsole = {};

  CONSOLE_METHODS.forEach((method) => {
    _origConsole[method] = console[method] ? console[method].bind(console) : null;
    console[method] = function (...args) {
      postEvent({
        type: 'console',
        level: method,
        args: serializeArgs(args),
        stack: method === 'error' ? new Error().stack?.split('\n').slice(2, 6).join(' | ') : null,
      });
      if (_origConsole[method]) _origConsole[method].apply(console, args);
    };
  });

  // ─── 2. NETWORK COLLECTOR — fetch ──────────────────────────────────────────

  const _origFetch = window.fetch;

  window.fetch = async function (input, init = {}) {
    const startTime = performance.now();
    const url = input instanceof Request ? input.url : String(input);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const reqHeaders = sanitizeHeaders(init.headers || (input instanceof Request ? input.headers : {}));
    let reqBody = null;
    try {
      reqBody = init.body ? serialize(init.body, 500) : null;
    } catch (_) {}

    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    postEvent({
      type: 'network',
      subtype: 'fetch_request',
      requestId,
      method,
      url,
      headers: reqHeaders,
      body: reqBody,
    });

    try {
      const response = await _origFetch.apply(this, arguments);
      const duration = Math.round(performance.now() - startTime);

      // Clone to read body without consuming original
      let resBody = null;
      try {
        const clone = response.clone();
        const text = await clone.text();
        resBody = text.length > 1000 ? text.slice(0, 1000) + '…' : text;
      } catch (_) {}

      postEvent({
        type: 'network',
        subtype: 'fetch_response',
        requestId,
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        headers: sanitizeHeaders(response.headers),
        body: resBody,
        duration,
        ok: response.ok,
      });

      return response;
    } catch (error) {
      const duration = Math.round(performance.now() - startTime);
      postEvent({
        type: 'network',
        subtype: 'fetch_error',
        requestId,
        method,
        url,
        error: error.message,
        duration,
      });
      throw error;
    }
  };

  // ─── 2b. NETWORK COLLECTOR — XMLHttpRequest ─────────────────────────────────

  const _OrigXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function () {
    const xhr = new _OrigXHR();
    const requestId = 'xhr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    let method = 'GET';
    let url = '';
    let startTime = 0;
    const reqHeaders = {};

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (m, u, ...rest) {
      method = m;
      url = u;
      return origOpen(m, u, ...rest);
    };

    const origSetHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function (k, v) {
      const sensitive = /authorization|cookie|x-api-key|x-auth-token/i;
      reqHeaders[k] = sensitive.test(k) ? '[REDACTED]' : v;
      return origSetHeader(k, v);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
      startTime = performance.now();
      postEvent({
        type: 'network',
        subtype: 'xhr_request',
        requestId,
        method: method.toUpperCase(),
        url,
        headers: reqHeaders,
        body: body ? serialize(body, 500) : null,
      });

      xhr.addEventListener('load', () => {
        const duration = Math.round(performance.now() - startTime);
        let resBody = null;
        try {
          resBody = xhr.responseText.length > 1000 ? xhr.responseText.slice(0, 1000) + '…' : xhr.responseText;
        } catch (_) {}

        postEvent({
          type: 'network',
          subtype: 'xhr_response',
          requestId,
          method: method.toUpperCase(),
          url,
          status: xhr.status,
          statusText: xhr.statusText,
          body: resBody,
          duration,
          ok: xhr.status >= 200 && xhr.status < 300,
        });
      });

      xhr.addEventListener('error', () => {
        postEvent({
          type: 'network',
          subtype: 'xhr_error',
          requestId,
          method: method.toUpperCase(),
          url,
          error: 'Network error',
          duration: Math.round(performance.now() - startTime),
        });
      });

      xhr.addEventListener('abort', () => {
        postEvent({
          type: 'network',
          subtype: 'xhr_abort',
          requestId,
          method: method.toUpperCase(),
          url,
          duration: Math.round(performance.now() - startTime),
        });
      });

      return origSend(body);
    };

    return xhr;
  };

  // ─── 2c. WEBSOCKET COLLECTOR ────────────────────────────────────────────────

  const _OrigWS = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new _OrigWS(url, protocols) : new _OrigWS(url);
    const wsId = 'ws_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    postEvent({ type: 'network', subtype: 'ws_open', wsId, url });

    ws.addEventListener('message', (e) => {
      postEvent({
        type: 'network',
        subtype: 'ws_message',
        wsId,
        url,
        data: serialize(e.data, 500),
        direction: 'incoming',
      });
    });

    ws.addEventListener('close', (e) => {
      postEvent({ type: 'network', subtype: 'ws_close', wsId, url, code: e.code, reason: e.reason });
    });

    ws.addEventListener('error', () => {
      postEvent({ type: 'network', subtype: 'ws_error', wsId, url });
    });

    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      postEvent({
        type: 'network',
        subtype: 'ws_message',
        wsId,
        url,
        data: serialize(data, 500),
        direction: 'outgoing',
      });
      return origSend(data);
    };

    return ws;
  };

  // ─── 3. ERROR COLLECTOR ──────────────────────────────────────────────────────

  window.addEventListener(
    'error',
    (e) => {
      // → Resource load error (img, script, link, audio, video failed to load)
      if (e.target && e.target !== window && e.target.tagName) {
        const src = e.target.src || e.target.href || e.target.currentSrc || '';
        postEvent({
          type: 'error',
          subtype: 'resource_load_error',
          tag: e.target.tagName.toLowerCase(),
          src,
          message: `Failed to load ${e.target.tagName.toLowerCase()}: ${src}`,
          errorType: 'ResourceError',
        });
      } else {
        // → JavaScript runtime error
        postEvent({
          type: 'error',
          subtype: 'runtime',
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          stack: e.error ? (e.error.stack || '').slice(0, 2000) : null,
          errorType: e.error ? e.error.constructor?.name : 'Unknown',
        });
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    postEvent({
      type: 'error',
      subtype: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack || '').slice(0, 2000) : null,
      errorType: reason instanceof Error ? reason.constructor?.name : typeof reason,
    });
  });

  // Capture CSP violations — appear in DevTools but bypass console.* hooks
  document.addEventListener('securitypolicyviolation', (e) => {
    postEvent({
      type: 'error',
      subtype: 'csp_violation',
      message: `CSP violation: ${e.violatedDirective} — blocked '${e.blockedURI}'`,
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
      documentURI: e.documentURI,
      originalPolicy: (e.originalPolicy || '').slice(0, 500),
      errorType: 'CSPViolation',
    });
  });

  // ─── 4. USER INTERACTION COLLECTOR ──────────────────────────────────────────

  // Throttle scroll events
  let _lastScroll = 0;

  document.addEventListener(
    'click',
    (e) => {
      postEvent({
        type: 'interaction',
        action: 'click',
        target: serializeElement(e.target),
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        button: e.button,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
      });
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'dblclick',
    (e) => {
      postEvent({ type: 'interaction', action: 'dblclick', target: serializeElement(e.target) });
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      let value = null;
      // Don't capture passwords
      if (el.type !== 'password') {
        value = el.type === 'checkbox' || el.type === 'radio' ? el.checked : serialize(el.value, 200);
      }
      postEvent({ type: 'interaction', action: 'change', target: serializeElement(el), value });
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      const fields = [];
      try {
        const fd = new FormData(form);
        for (const [k] of fd.entries()) {
          fields.push(k); // only field names, not values (privacy)
        }
      } catch (_) {}
      postEvent({ type: 'interaction', action: 'form_submit', target: serializeElement(form), fields });
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'scroll',
    () => {
      const now = Date.now();
      if (now - _lastScroll < 2000) return; // max once per 2s
      _lastScroll = now;
      postEvent({
        type: 'interaction',
        action: 'scroll',
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        pageHeight: document.documentElement.scrollHeight,
      });
    },
    { capture: true, passive: true }
  );

  // Key combinations (Ctrl+Z, Ctrl+S, etc.) but NOT individual keys (privacy)
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        postEvent({
          type: 'interaction',
          action: 'hotkey',
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        });
      }
    },
    { capture: true, passive: true }
  );

  // Copy/Paste/Cut
  ['copy', 'paste', 'cut'].forEach((evName) => {
    document.addEventListener(
      evName,
      (e) => {
        postEvent({ type: 'interaction', action: evName, target: serializeElement(e.target) });
      },
      { capture: true, passive: true }
    );
  });

  // ─── 5. PERFORMANCE COLLECTOR ────────────────────────────────────────────────

  function observePerf(types) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const base = {
            type: 'performance',
            entryType: entry.entryType,
            name: entry.name,
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration || 0),
          };

          if (entry.entryType === 'resource') {
            postEvent({
              ...base,
              initiatorType: entry.initiatorType,
              transferSize: entry.transferSize,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize,
              protocol: entry.nextHopProtocol,
              serverTiming: entry.serverTiming?.map((s) => ({ name: s.name, duration: s.duration })),
            });
          } else if (entry.entryType === 'navigation') {
            postEvent({
              ...base,
              type: 'performance',
              domInteractive: Math.round(entry.domInteractive),
              domComplete: Math.round(entry.domComplete),
              loadEventEnd: Math.round(entry.loadEventEnd),
              redirectCount: entry.redirectCount,
              transferSize: entry.transferSize,
            });
          } else if (entry.entryType === 'largest-contentful-paint') {
            postEvent({ ...base, element: serializeElement(entry.element), size: entry.size });
          } else if (entry.entryType === 'first-input') {
            postEvent({ ...base, processingStart: Math.round(entry.processingStart), delay: Math.round(entry.processingStart - entry.startTime) });
          } else if (entry.entryType === 'layout-shift') {
            postEvent({ ...base, value: entry.value, hadRecentInput: entry.hadRecentInput });
          } else if (entry.entryType === 'longtask') {
            postEvent({ ...base, attribution: entry.attribution?.map((a) => ({ name: a.name, containerType: a.containerType })) });
          } else if (entry.entryType === 'paint') {
            postEvent(base);
          } else if (entry.entryType === 'mark' || entry.entryType === 'measure') {
            postEvent({ ...base, detail: entry.detail });
          } else {
            postEvent(base);
          }
        }
      });

      observer.observe({ entryTypes: types, buffered: true });
    } catch (_) {
      // Some entry types may not be supported
    }
  }

  observePerf(['navigation', 'resource', 'paint']);
  observePerf(['largest-contentful-paint']);
  observePerf(['first-input']);
  observePerf(['layout-shift']);
  observePerf(['longtask']);
  observePerf(['mark', 'measure']);

  // ─── 6. MEMORY COLLECTOR ─────────────────────────────────────────────────────

  function captureMemory() {
    if (performance.memory) {
      postEvent({
        type: 'memory',
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        usedPercent: Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100),
      });
    }
  }

  // Capture memory on load and every 30 seconds
  window.addEventListener('load', captureMemory, { once: true });
  setInterval(captureMemory, 30000);

  // ─── 7. STORAGE COLLECTOR ────────────────────────────────────────────────────

  ['setItem', 'removeItem', 'clear'].forEach((method) => {
    const orig = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
      const payload = { type: 'storage', storageType, action: method };
      if (method === 'setItem') {
        payload.key = args[0];
        payload.valuePreview = String(args[1] || '').slice(0, 300);
        payload.valueSize = String(args[1] || '').length;
      } else if (method === 'removeItem') {
        payload.key = args[0];
      }
      postEvent(payload);
      return orig.apply(this, args);
    };
  });

  // ─── 8. SOURCE / RESOURCE COLLECTOR ─────────────────────────────────────────

  // Monitor dynamically injected scripts, stylesheets, iframes
  const _origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName, ...rest) {
    const el = _origCreateElement(tagName, ...rest);
    const tag = tagName.toLowerCase();

    if (tag === 'script' || tag === 'link' || tag === 'img' || tag === 'iframe') {
      const srcProp = tag === 'link' ? 'href' : 'src';
      let _src = '';

      Object.defineProperty(el, srcProp, {
        set(val) {
          _src = val;
          postEvent({
            type: 'source',
            action: 'dynamic_inject',
            tag,
            [srcProp]: val,
            async: el.async,
            defer: el.defer,
            type: el.type,
            rel: el.rel,
          });
          el.setAttribute(srcProp, val);
        },
        get() {
          return _src || el.getAttribute(srcProp) || '';
        },
        configurable: true,
      });
    }

    return el;
  };

  // Service Worker registrations
  if (navigator.serviceWorker) {
    const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (scriptURL, options) {
      postEvent({ type: 'source', action: 'service_worker_register', scriptURL, scope: options?.scope });
      return origRegister(scriptURL, options);
    };
  }

  // ─── 9. PAGE LIFECYCLE COLLECTOR ────────────────────────────────────────────

  postEvent({ type: 'lifecycle', action: 'page_start', referrer: document.referrer, title: document.title });

  document.addEventListener('visibilitychange', () => {
    postEvent({ type: 'lifecycle', action: 'visibility_change', state: document.visibilityState });
  });

  window.addEventListener('pagehide', (e) => {
    postEvent({ type: 'lifecycle', action: 'page_hide', persisted: e.persisted });
  });

  window.addEventListener('pageshow', (e) => {
    postEvent({ type: 'lifecycle', action: 'page_show', persisted: e.persisted });
  });

  window.addEventListener('beforeunload', () => {
    postEvent({ type: 'lifecycle', action: 'before_unload' });
  });

  window.addEventListener('load', () => {
    postEvent({ type: 'lifecycle', action: 'page_load', readyState: document.readyState, title: document.title });
  });

  // History API navigation (SPA routing)
  const _origPushState = history.pushState;
  const _origReplaceState = history.replaceState;

  history.pushState = function (state, title, url) {
    postEvent({ type: 'lifecycle', action: 'navigation', navType: 'pushState', url: url || location.href, title });
    return _origPushState.apply(this, arguments);
  };

  history.replaceState = function (state, title, url) {
    postEvent({ type: 'lifecycle', action: 'navigation', navType: 'replaceState', url: url || location.href, title });
    return _origReplaceState.apply(this, arguments);
  };

  window.addEventListener('popstate', (e) => {
    postEvent({ type: 'lifecycle', action: 'navigation', navType: 'popstate', url: location.href });
  });

  // ─── 10. DOM MUTATION OBSERVER ───────────────────────────────────────────────

  let _mutationBuffer = [];
  let _mutationFlushTimer = null;

  const _mutationObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        _mutationBuffer.push({
          target: serializeElement(m.target),
          added: m.addedNodes.length,
          removed: m.removedNodes.length,
        });
      }
    }

    if (!_mutationFlushTimer) {
      _mutationFlushTimer = setTimeout(() => {
        if (_mutationBuffer.length > 0) {
          postEvent({ type: 'dom', action: 'mutations', count: _mutationBuffer.length, samples: _mutationBuffer.slice(0, 5) });
          _mutationBuffer = [];
        }
        _mutationFlushTimer = null;
      }, 1000);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    _mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  });

  // ─── 11. BUSINESS EVENTS SDK ─────────────────────────────────────────────────

  window.__BugMonitor = {
    /**
     * Track a business-critical event
     * @param {string} eventName - e.g. 'invoice_saved', 'payment_processed'
     * @param {object} payload - arbitrary metadata
     * @param {object} options - { severity: 'info'|'warn'|'error'|'critical', workflowId: string }
     */
    track(eventName, payload = {}, options = {}) {
      postEvent({
        type: 'business',
        eventName,
        payload: serialize(payload, 1000),
        severity: options.severity || 'info',
        workflowId: options.workflowId || null,
      });
    },

    /** Start a workflow to track multi-step business operations */
    startWorkflow(workflowId, name, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_start', workflowId, workflowName: name, payload: serialize(metadata, 500), severity: 'info' });
      return workflowId;
    },

    /** Complete a workflow step */
    stepWorkflow(workflowId, step, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_step', workflowId, step, payload: serialize(metadata, 500), severity: 'info' });
    },

    /** Mark a workflow as complete */
    completeWorkflow(workflowId, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_complete', workflowId, payload: serialize(metadata, 500), severity: 'info' });
    },

    /** Mark a workflow as failed */
    failWorkflow(workflowId, reason, metadata = {}) {
      postEvent({ type: 'business', eventName: 'workflow_fail', workflowId, reason, payload: serialize(metadata, 500), severity: 'error' });
    },
  };

  postEvent({ type: 'lifecycle', action: 'collector_ready', version: '1.0.0' });
})();
