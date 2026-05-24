/**
 * popup.js — Extension popup controller
 * 
 * Manages:
 *   - Real-time event feed (polls service worker)
 *   - Session list
 *   - Config save/load
 *   - Stats display
 *   - Tab switching + filter buttons
 *   - Anomaly alerts
 */

'use strict';

// ─── State ──────────────────────────────────────────────────────────────────

let currentFilter = 'all';
let currentTab = 'live';
let eventFeedItems = [];
const MAX_FEED_ITEMS = 150;
let pollTimer = null;
let isEnabled = true;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const ui = {
  statusDot:     $('statusDot'),
  toggleBtn:     $('toggleBtn'),
  siteBanner:    $('siteBanner'),
  siteOrigin:    $('siteOrigin'),
  siteIndicator: $('siteIndicator'),
  siteLabel:     $('siteLabel'),
  anomalyAlert:  $('anomalyAlert'),
  anomalyMsg:    $('anomalyMsg'),

  statEvents:    $('statEvents'),
  statSessions:  $('statSessions'),
  statBuffer:    $('statBuffer'),
  statUpload:    $('statUpload'),

  eventFeed:     $('eventFeed'),
  sessionsList:  $('sessionsList'),

  cfgEndpoint:      $('cfgEndpoint'),
  cfgApiKeys:       $('cfgApiKeys'),
  cfgInterval:      $('cfgInterval'),
  cfgNetworkBodies: $('cfgNetworkBodies'),
  cfgInteractions:  $('cfgInteractions'),
  cfgMemory:        $('cfgMemory'),
  cfgStorage:       $('cfgStorage'),

  saveConfigBtn:  $('saveConfigBtn'),
  clearDataBtn:   $('clearDataBtn'),
  configFeedback: $('configFeedback'),
  uploadNowBtn:   $('uploadNowBtn'),
  downloadBtn:    $('downloadBtn'),
  footerInfo:     $('footerInfo'),
};

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  setupTabs();
  setupFilters();
  setupButtons();
  await detectCurrentSite();
  await loadStats();
  await loadConfig();
  startPolling();

  // Listen for anomaly alerts from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ANOMALY_DETECTED') {
      showAnomalyAlert(`${msg.count} error(s) detected — auto-uploading`);
    }
  });
}

// ─── Current site detection ───────────────────────────────────────────────────

async function detectCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      ui.siteOrigin.textContent = 'No active tab';
      ui.siteLabel.textContent = '—';
      return;
    }

    const url = new URL(tab.url);
    ui.siteOrigin.textContent = url.hostname;

    // Wake the SW with a ping first, then query stats
    // Chrome takes 1-3 seconds to restart a killed service worker
    const statsPromise = (async () => {
      try { await sendToSW('PING'); } catch (_) {}  // Wake it up
      return sendToSW('GET_STATS');
    })();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 6000)
    );

    let stats;
    try {
      stats = await Promise.race([statsPromise, timeoutPromise]);
    } catch (_) {
      // SW inactive or slow — show helpful message
      ui.siteIndicator.className = 'site-indicator unregistered';
      ui.siteLabel.textContent = 'SW loading — reload page to activate';
      return;
    }

    const registeredOrigins = stats?.config?.registeredOrigins || [];

    if (registeredOrigins.length === 0) {
      ui.siteIndicator.className = 'site-indicator registered';
      ui.siteLabel.textContent = 'Monitoring all sites ✓';
    } else if (registeredOrigins.includes(url.origin)) {
      ui.siteIndicator.className = 'site-indicator registered';
      ui.siteLabel.textContent = 'Registered ✓';
    } else {
      ui.siteIndicator.className = 'site-indicator unregistered';
      ui.siteLabel.textContent = 'Not registered — add in Config tab';
    }
  } catch (_) {
    ui.siteOrigin.textContent = 'Unknown';
    ui.siteLabel.textContent = 'Open Config tab to register a site';
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const stats = await sendToSW('GET_STATS');
    if (!stats) return;

    isEnabled = stats.enabled !== false;
    updateToggleUI(isEnabled);

    ui.statEvents.textContent  = formatNum(stats.totalEvents || 0);
    ui.statSessions.textContent = formatNum(stats.totalSessions || 0);
    ui.statBuffer.textContent  = formatNum(stats.inMemoryBuffer || 0);
    ui.statUpload.textContent  = stats.lastUpload ? timeAgo(stats.lastUpload) : 'Never';

    ui.footerInfo.textContent = stats.lastUpload
      ? `Last upload: ${timeAgo(stats.lastUpload)} · ${stats.lastUploadCount || 0} events`
      : 'Never uploaded';
  } catch (_) {}
}

// ─── Live Feed ────────────────────────────────────────────────────────────────

async function loadRecentEvents() {
  try {
    // Query ALL recent events (no origin filter — avoids webRequest origin mismatch)
    const events = await sendToSW('GET_RECENT_EVENTS', {
      origin: null,          // null = return all origins
      since: Date.now() - 600000,  // last 10 min
      limit: 300,
    });
    if (!events || !events.length) return;

    // Deduplicate by id (IDB autoincrement) or by seq+sessionId
    const seen = new Set(eventFeedItems.map((e) => e.id || `${e.sessionId}_${e.seq}`));
    const newEvents = events.filter((e) => !seen.has(e.id || `${e.sessionId}_${e.seq}`));
    if (newEvents.length === 0) return;

    // Merge and sort by timestamp descending (newest first)
    eventFeedItems = [...newEvents, ...eventFeedItems]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_FEED_ITEMS);
    renderFeed();
  } catch (_) {}
}

function filterEvents(events, filter) {
  switch (filter) {
    case 'all':         return events;
    case 'console':     return events.filter((e) => e.type === 'console');
    case 'error':       return events.filter((e) => e.type === 'error');
    case 'interaction': return events.filter((e) => e.type === 'interaction');
    case 'memory':      return events.filter((e) => e.type === 'memory');
    case 'storage':     return events.filter((e) => e.type === 'storage');
    // Network = JS-level fetch/XHR/WS + webRequest + browser resource loads
    case 'network':     return events.filter((e) =>
      e.type === 'network' ||
      (e.type === 'performance' && e.entryType === 'resource')
    );
    // Performance = navigation timing, paint, LCP, FID, CLS, long tasks
    case 'performance': return events.filter((e) =>
      e.type === 'performance' && e.entryType !== 'resource'
    );
    // Security = CSP violations + webRequest errors (CORS, ERR_FAILED)
    case 'security':    return events.filter((e) =>
      (e.type === 'error' && e.subtype === 'csp_violation') ||
      (e.type === 'network' && (e.subtype === 'webRequest_error' || e.error)) ||
      (e.type === 'error' && e.subtype === 'resource_load_error')
    );
    // Application = storage changes + script/source injection + SPA navigation
    case 'application': return events.filter((e) =>
      e.type === 'storage' ||
      e.type === 'source' ||
      e.type === 'lifecycle' ||
      e.type === 'dom'
    );
    default: return events.filter((e) => e.type === filter);
  }
}

function renderFeed() {
  const filtered = filterEvents(eventFeedItems, currentFilter);
  const emptyLabels = {
    network: 'No network events — visit a page with API calls',
    error: 'No errors captured yet',
    interaction: 'No user actions captured yet',
    security: 'No CSP violations or network errors',
    performance: 'No performance metrics yet',
    application: 'No storage or navigation events yet',
    memory: 'No memory snapshots yet (captured every 30s)',
    storage: 'No localStorage/sessionStorage changes yet',
    console: 'No console events yet',
    all: 'No events captured yet — visit a website',
  };

  if (filtered.length === 0) {
    const msg = emptyLabels[currentFilter] || `No ${currentFilter} events yet`;
    ui.eventFeed.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-text">${msg}</div></div>`;
    return;
  }

  ui.eventFeed.innerHTML = filtered
    .slice(0, 60)
    .map(renderEventItem)
    .join('');
}

function renderEventItem(e) {
  const time = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dot  = `<div class="event-dot ${e.type || 'lifecycle'}"></div>`;
  const badge = getEventBadge(e);
  const msg   = getEventMessage(e);
  const isErr = e.type === 'error' || (e.type === 'network' && e.ok === false);
  const isWarn = e.type === 'console' && e.level === 'warn';

  return `<div class="event-item ${isErr ? 'is-error' : ''} ${isWarn ? 'is-warn' : ''}">
    ${dot}
    <div class="event-content">
      <div class="event-header">
        <span class="event-type">${e.type || 'event'}</span>
        ${badge}
        <span class="event-time">${time}</span>
      </div>
      <div class="event-msg">${escapeHtml(msg)}</div>
    </div>
  </div>`;
}

function getEventBadge(e) {
  if (e.type === 'console') {
    const cls = e.level === 'error' ? 'badge-error' : e.level === 'warn' ? 'badge-warn' : 'badge-log';
    return `<span class="event-badge ${cls}">${e.level}</span>`;
  }
  if (e.type === 'network') {
    const sub = e.subtype || '';
    if (sub === 'webRequest_error')    return `<span class="event-badge badge-error">NET ERR</span><span class="event-badge" style="background:rgba(251,191,36,.1);color:var(--yellow)">${e.error?.split('::')[1] || e.error || 'FAIL'}</span>`;
    if (sub === 'webRequest_response') return `<span class="event-badge badge-fetch">BROWSER</span><span class="event-badge ${e.status >= 500 ? 'badge-5xx' : 'badge-4xx'}">${e.status}</span>`;
    if (sub === 'webRequest_request')  return `<span class="event-badge badge-fetch">BROWSER</span>`;
    const proto = sub.includes('xhr') ? 'XHR' : sub.includes('ws') ? 'WS' : 'FETCH';
    const statusCls = !e.status ? '' : e.status >= 500 ? 'badge-5xx' : e.status >= 400 ? 'badge-4xx' : 'badge-200';
    const badge1 = `<span class="event-badge badge-fetch">${proto}</span>`;
    const badge2 = e.status ? `<span class="event-badge ${statusCls}">${e.status}</span>` : '';
    return badge1 + badge2;
  }
  if (e.type === 'performance' && e.entryType === 'resource') {
    return `<span class="event-badge badge-fetch">${e.initiatorType || 'res'}</span>`;
  }
  if (e.type === 'error') {
    if (e.subtype === 'csp_violation') return `<span class="event-badge badge-error">CSP</span>`;
    if (e.subtype === 'resource_load_error') return `<span class="event-badge badge-error">RES ERR</span>`;
    return `<span class="event-badge badge-error">${e.subtype || 'error'}</span>`;
  }
  if (e.type === 'storage')     return `<span class="event-badge" style="background:rgba(251,191,36,.12);color:var(--yellow)">${e.storageType?.replace('Storage', '') || 'store'}</span>`;
  if (e.type === 'source')      return `<span class="event-badge" style="background:rgba(167,139,250,.12);color:#a78bfa">${e.action || 'src'}</span>`;
  if (e.type === 'lifecycle')   return `<span class="event-badge" style="background:rgba(156,163,175,.1);color:var(--text-muted)">${e.action || 'lifecycle'}</span>`;
  if (e.type === 'memory')      return `<span class="event-badge" style="background:rgba(251,146,60,.12);color:var(--orange)">${e.usedPercent || 0}%</span>`;
  if (e.type === 'business')    return `<span class="event-badge" style="background:rgba(129,140,248,.12);color:var(--indigo)">${e.severity || 'info'}</span>`;
  return '';
}

function getEventMessage(e) {
  switch (e.type) {
    case 'console': {
      const args = Array.isArray(e.args) ? e.args.join(' ') : '';
      return `[${e.level}] ${args}`.slice(0, 120);
    }
    case 'network': {
      const sub = e.subtype || '';
      if (sub === 'webRequest_error')    return `✗ ${e.method || 'GET'} ${shortenUrl(e.url)} — ${e.error} [${e.resourceType || ''}]`;
      if (sub === 'webRequest_response') return `← ${e.status} ${shortenUrl(e.url)} [${e.resourceType || ''}]`;
      if (sub === 'webRequest_request')  return `→ ${e.method || 'GET'} ${shortenUrl(e.url)} [${e.resourceType || ''}]`;
      if (sub.includes('fetch_request')) return `→ ${e.method} ${shortenUrl(e.url)}`;
      if (sub.includes('fetch_response')) return `← ${e.status} ${shortenUrl(e.url)} (${e.duration}ms)`;
      if (sub.includes('fetch_error'))   return `✗ ${e.method} ${shortenUrl(e.url)} — ${e.error}`;
      if (sub.includes('xhr_request'))   return `→ XHR ${e.method} ${shortenUrl(e.url)}`;
      if (sub.includes('xhr_response'))  return `← XHR ${e.status} ${shortenUrl(e.url)} (${e.duration}ms)`;
      if (sub.includes('xhr_error'))     return `✗ XHR ${e.method} ${shortenUrl(e.url)}`;
      if (sub.includes('xhr_abort'))     return `⊘ XHR aborted ${shortenUrl(e.url)}`;
      if (sub.includes('ws_open'))       return `WS connected ${shortenUrl(e.url)}`;
      if (sub.includes('ws_close'))      return `WS closed ${shortenUrl(e.url)} code:${e.code}`;
      if (sub.includes('ws_error'))      return `WS error ${shortenUrl(e.url)}`;
      if (sub.includes('ws_message'))    return `WS ${e.direction === 'outgoing' ? '↑' : '↓'} ${shortenUrl(e.url)}`;
      return `${e.method || ''} ${shortenUrl(e.url)}`;
    }
    case 'performance': {
      // Resource entries shown in Network filter
      if (e.entryType === 'resource') return `${e.initiatorType || 'resource'} ${shortenUrl(e.name)} ${e.duration ? `(${e.duration}ms)` : ''}`;
      return `${e.entryType} · ${e.name}`.slice(0, 120) + (e.duration ? ` · ${e.duration}ms` : '');
    }
    case 'error': {
      if (e.subtype === 'csp_violation') return `CSP: ${e.violatedDirective} blocked '${e.blockedURI}'`;
      if (e.subtype === 'resource_load_error') return `Failed to load <${e.tag}>: ${shortenUrl(e.src)}`;
      return `${e.message || e.subtype}`.slice(0, 120);
    }
    case 'interaction':
      return `${e.action} ${e.target?.tag || ''} ${e.target?.text || ''}`.trim().slice(0, 120);
    case 'memory':
      return `Heap: ${formatBytes(e.usedJSHeapSize)} / ${formatBytes(e.totalJSHeapSize)} (${e.usedPercent}%)`;
    case 'storage':
      return `${e.storageType}.${e.action}(${e.key || ''})`;
    case 'source':
      return `${e.action}: ${shortenUrl(e.src || e.href || e.scriptURL || '')}`;
    case 'lifecycle':
      return `${e.action}${e.url ? ' → ' + shortenUrl(e.url) : ''}`;
    case 'business':
      return `[${e.severity?.toUpperCase()}] ${e.eventName}${e.workflowId ? ' (wf:' + e.workflowId + ')' : ''}`;
    case 'dom':
      return `${e.count} DOM mutation(s) on ${e.samples?.[0]?.target?.tag || 'element'}`;
    default:
      return JSON.stringify(e).slice(0, 120);
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = tab?.url ? new URL(tab.url).origin : null;
    const sessions = await sendToSW('GET_SESSIONS', { origin, limit: 30 });
    renderSessions(sessions || []);
  } catch (_) {}
}

function renderSessions(sessions) {
  if (sessions.length === 0) {
    ui.sessionsList.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No sessions captured yet</div></div>`;
    return;
  }
  ui.sessionsList.innerHTML = sessions.map((s) => `
    <div class="session-item" data-id="${s.sessionId}">
      <div class="session-origin">${s.origin || 'Unknown origin'}</div>
      <div class="session-meta">
        <span class="session-stat">Events: <strong>${s.eventCount || 0}</strong></span>
        <span class="session-stat">Started: <strong>${timeAgo(s.startedAt)}</strong></span>
        <span class="session-stat">Last: <strong>${timeAgo(s.lastSeen || s.startedAt)}</strong></span>
      </div>
    </div>
  `).join('');
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  const stats = await sendToSW('GET_STATS');
  const cfg = stats?.config || {};
  
  // Show the endpoint with default fallback
  const endpoint = cfg.uploadEndpoint || 'http://localhost:4000/v1/telemetry/upload';
  ui.cfgEndpoint.value = endpoint;
  
  ui.cfgApiKeys.value       = (cfg.apiKeys || []).join('\n');
  ui.cfgInterval.value      = cfg.uploadIntervalMin || 15;
  ui.cfgNetworkBodies.checked = cfg.captureNetworkBodies !== false;
  ui.cfgInteractions.checked  = cfg.captureInteractions !== false;
  ui.cfgMemory.checked        = cfg.captureMemory !== false;
  ui.cfgStorage.checked       = cfg.captureStorage !== false;
}

async function saveConfig() {
  ui.configFeedback.textContent = 'Verifying Keys...';
  
  const apiKeys = ui.cfgApiKeys.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Use default endpoint if none provided
  const endpoint = ui.cfgEndpoint.value.trim() || 'http://localhost:4000/v1/telemetry/upload';
  const verifyUrl = endpoint.replace('/telemetry/upload', '/sites/verify');
  
  let validOrigins = [];
  try {
    if (apiKeys.length > 0) {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: apiKeys })
      });
      if (res.ok) {
        const data = await res.json();
        validOrigins = data.origins || [];
      } else {
        const errText = await res.text();
        ui.configFeedback.textContent = `Verify Failed: HTTP ${res.status} ${errText}`;
        setTimeout(() => { ui.configFeedback.textContent = ''; }, 5000);
        return;
      }
    }
  } catch (err) {
    console.warn('Verify error:', err);
    ui.configFeedback.textContent = `Network Error: ${err.message}`;
    setTimeout(() => { ui.configFeedback.textContent = ''; }, 5000);
    return;
  }

  const newConfig = {
    uploadEndpoint:      endpoint,
    apiKeys:             apiKeys,
    registeredOrigins:   validOrigins,
    uploadIntervalMin:   parseInt(ui.cfgInterval.value, 10) || 15,
    captureNetworkBodies: ui.cfgNetworkBodies.checked,
    captureInteractions:  ui.cfgInteractions.checked,
    captureMemory:        ui.cfgMemory.checked,
    captureStorage:       ui.cfgStorage.checked,
  };

  await sendToSW('UPDATE_CONFIG', { config: newConfig });
  ui.configFeedback.textContent = '✓ Saved successfully';
  setTimeout(() => { ui.configFeedback.textContent = ''; }, 2500);

  await detectCurrentSite();
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      $('panel' + capitalize(currentTab)).classList.add('active');

      if (currentTab === 'sessions') await loadSessions();
      if (currentTab === 'live') renderFeed();
    });
  });
}

function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderFeed();
    });
  });
}

function setupButtons() {
  ui.toggleBtn.addEventListener('click', async () => {
    isEnabled = !isEnabled;
    await sendToSW('UPDATE_CONFIG', { config: { enabled: isEnabled } });
    updateToggleUI(isEnabled);
  });

  ui.saveConfigBtn.addEventListener('click', saveConfig);

  ui.clearDataBtn.addEventListener('click', async () => {
    if (!confirm('Delete all captured telemetry data?')) return;
    await sendToSW('CLEAR_DATA');
    eventFeedItems = [];
    renderFeed();
    ui.configFeedback.textContent = '✓ Data cleared';
    setTimeout(() => { ui.configFeedback.textContent = ''; }, 2500);
  });

  ui.uploadNowBtn.addEventListener('click', async () => {
    ui.uploadNowBtn.textContent = 'Uploading…';
    const result = await sendToSW('MANUAL_UPLOAD');
    ui.uploadNowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="17 8 12 3 7 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Upload Now`;
    if (result?.ok) {
      ui.footerInfo.textContent = `Uploaded ${result.uploaded} events just now`;
    } else {
      ui.footerInfo.textContent = result?.reason || result?.error || 'Upload failed';
    }
  });

  ui.downloadBtn.addEventListener('click', async () => {
    ui.downloadBtn.textContent = 'Preparing…';
    try {
      await downloadReport();
      ui.downloadBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Download`;
      ui.footerInfo.textContent = 'Report downloaded!';
    } catch (e) {
      ui.downloadBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Download`;
      ui.footerInfo.textContent = 'Download failed: ' + e.message;
    }
  });
}

// ─── Download Report ─────────────────────────────────────────────────────────

async function downloadReport() {
  const now     = new Date();
  const lines   = [];
  const hr      = (char = '─', len = 70) => char.repeat(len);
  const section = (title) => [
    '', hr(), `  ${title.toUpperCase()}`, hr(), ''
  ];

  // ─── HEADER
  lines.push(hr('='));
  lines.push('  BUG MONITOR — FAILURE FORENSICS REPORT');
  lines.push('  Generated: ' + now.toLocaleString());
  lines.push('  Extension: Bug Monitor v1.0.0');
  lines.push(hr('='));

  // ─── CONFIG & STATS
  const stats = await sendToSW('GET_STATS').catch(() => null);
  const cfg   = stats?.config || {};

  lines.push(...section('Configuration'));
  lines.push('  Upload Endpoint   : ' + (cfg.uploadEndpoint || 'Not configured'));
  lines.push('  Monitored Origins : ' + (cfg.registeredOrigins?.length ? cfg.registeredOrigins.join(', ') : 'All sites'));
  lines.push('  Upload Interval   : ' + (cfg.uploadIntervalMin || 15) + ' minutes');
  lines.push('  Capture Network   : ' + (cfg.captureNetworkBodies !== false));
  lines.push('  Capture Interact  : ' + (cfg.captureInteractions !== false));
  lines.push('  Capture Memory    : ' + (cfg.captureMemory !== false));
  lines.push('  Capture Storage   : ' + (cfg.captureStorage !== false));
  lines.push('  Enabled           : ' + (cfg.enabled !== false));

  lines.push(...section('Statistics'));
  lines.push('  Total Events    : ' + (stats?.totalEvents || 0));
  lines.push('  Total Sessions  : ' + (stats?.totalSessions || 0));
  lines.push('  In Memory Buffer: ' + (stats?.inMemoryBuffer || 0));
  lines.push('  Last Upload     : ' + (stats?.lastUpload ? new Date(stats.lastUpload).toLocaleString() : 'Never'));
  lines.push('  Last Upload Cnt : ' + (stats?.lastUploadCount || 0));

  // ─── SESSIONS
  const sessions = await sendToSW('GET_SESSIONS', { limit: 100 }).catch(() => []);
  lines.push(...section('Sessions (' + (sessions?.length || 0) + ')'));

  if (!sessions || sessions.length === 0) {
    lines.push('  No sessions recorded.');
  } else {
    sessions.forEach((s, i) => {
      lines.push(`  [${i + 1}] Session ID  : ${s.sessionId}`);
      lines.push(`      Origin     : ${s.origin || 'Unknown'}`);
      lines.push(`      Started    : ${s.startedAt ? new Date(s.startedAt).toLocaleString() : '?'}`);
      lines.push(`      Last Seen  : ${s.lastSeen   ? new Date(s.lastSeen).toLocaleString()  : '?'}`);
      lines.push(`      Events     : ${s.eventCount || 0}`);
      lines.push('');
    });
  }

  // ─── LIVE FEED EVENTS (all recent, grouped by type)
  const allEvents = await sendToSW('GET_RECENT_EVENTS', {
    origin: null,
    since:  Date.now() - 24 * 60 * 60 * 1000,  // last 24 hours
    limit:  5000,
  }).catch(() => []);

  const eventsArr = (allEvents || []).sort((a, b) => a.ts - b.ts);

  lines.push(...section('Full Event Log (' + eventsArr.length + ' events, last 24 hours)'));

  if (eventsArr.length === 0) {
    lines.push('  No events captured in the last 24 hours.');
  } else {
    eventsArr.forEach((e) => {
      const time    = e.ts ? new Date(e.ts).toLocaleTimeString() : '?';
      const date    = e.ts ? new Date(e.ts).toLocaleDateString() : '';
      const type    = (e.type    || 'unknown').padEnd(12);
      const subtype = (e.subtype || '').padEnd(20);
      const msg     = getEventMessage(e);
      lines.push(`  ${date} ${time}  [${type}] [${subtype}]  ${msg}`);

      // Extra detail for important event types
      if (e.type === 'error') {
        if (e.stack)    lines.push(`                              Stack: ${e.stack.split('\n')[0]}`);
        if (e.filename) lines.push(`                              File : ${e.filename}:${e.lineno}`);
      }
      if (e.type === 'network' && (e.url || e.name)) {
        const fullUrl = e.url || e.name || '';
        if (fullUrl.length > 60) lines.push(`                              URL  : ${fullUrl}`);
        if (e.status)   lines.push(`                              Status: ${e.status} ${e.ok ? 'OK' : 'FAIL'}`);
        if (e.duration) lines.push(`                              Time : ${e.duration}ms`);
      }
      if (e.type === 'storage') {
        lines.push(`                              Key  : ${e.key || ''}`);
        if (e.valuePreview) lines.push(`                              Value: ${e.valuePreview}`);
      }
      if (e.type === 'console' && e.stack) {
        lines.push(`                              Stack: ${e.stack.split('|')[0].trim()}`);
      }
    });
  }

  // ─── EVENT SUMMARY BY TYPE
  lines.push(...section('Event Summary By Type'));
  const typeCounts = {};
  eventsArr.forEach((e) => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      lines.push(`  ${type.padEnd(20)} : ${count}`);
    });

  // ─── ERROR SUMMARY
  const errors = eventsArr.filter((e) => e.type === 'error');
  if (errors.length > 0) {
    lines.push(...section('Error Summary (' + errors.length + ' errors)'));
    errors.forEach((e, i) => {
      lines.push(`  [${i + 1}] ${new Date(e.ts).toLocaleString()}`);
      lines.push(`      Type    : ${e.subtype || 'error'}`);
      lines.push(`      Message : ${e.message || '(no message)'}`);
      if (e.filename) lines.push(`      File    : ${e.filename}:${e.lineno}:${e.colno}`);
      if (e.stack)    lines.push(`      Stack   : ${e.stack.slice(0, 300)}`);
      lines.push('');
    });
  }

  // ─── NETWORK FAILURES
  const netFails = eventsArr.filter((e) =>
    e.type === 'network' && (e.ok === false || e.error)
  );
  if (netFails.length > 0) {
    lines.push(...section('Network Failures (' + netFails.length + ')'));
    netFails.forEach((e, i) => {
      lines.push(`  [${i + 1}] ${new Date(e.ts).toLocaleString()}`);
      lines.push(`      Method  : ${e.method || 'GET'}`);
      lines.push(`      URL     : ${e.url || e.name || ''}`);
      lines.push(`      Status  : ${e.status || e.error || 'FAILED'}`);
      if (e.duration) lines.push(`      Dur     : ${e.duration}ms`);
      lines.push('');
    });
  }

  // ─── FOOTER
  lines.push(hr('='));
  lines.push(`  END OF REPORT — ${eventsArr.length} events, ${sessions?.length || 0} sessions`);
  lines.push('  Bug Monitor v1.0.0 — https://github.com/bugmonitor');
  lines.push(hr('='));

  // ─── TRIGGER DOWNLOAD
  const content  = lines.join('\n');
  const blob     = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url      = URL.createObjectURL(blob);
  const filename = `bugmonitor-report-${now.toISOString().slice(0, 19).replace(/[T:]/g, '-')}.txt`;

  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ─── Toggle UI ─────────────────────────────────────────────────────────────────

function updateToggleUI(enabled) {
  ui.statusDot.className = 'status-dot' + (enabled ? ' active' : '');
  ui.toggleBtn.title = enabled ? 'Disable Monitoring' : 'Enable Monitoring';
}

// ─── Anomaly Alert ────────────────────────────────────────────────────────────

function showAnomalyAlert(msg) {
  ui.anomalyMsg.textContent = msg;
  ui.anomalyAlert.style.display = 'flex';
  setTimeout(() => { ui.anomalyAlert.style.display = 'none'; }, 8000);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

function startPolling() {
  // Initial load
  loadRecentEvents();
  loadStats();

  // Poll every 2 seconds
  pollTimer = setInterval(async () => {
    await loadRecentEvents();
    await loadStats();
  }, 2000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendToSW(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortenUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.pathname + (u.search || '');
  } catch (_) {
    return url.slice(0, 60);
  }
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatBytes(b) {
  if (!b) return '0 B';
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('unload', () => { if (pollTimer) clearInterval(pollTimer); });
