const os = require('os');

const SAP_WINDOW_TITLE_PATTERNS = [
  /SAP\s+(Easy Access|Menu|User)\s*-\s*(.+?)\s*-\s*(.+)/i,
  /SAP\s+(.+?)\s*-\s*(.+?)\s*-\s*(.+)/i,
  /(.+?)\s*-\s*(GUI|SAP GUI|SAP)\s*-\s*(.+)/i,
];

const TRANSACTION_PATTERNS = [
  /Transaction\s*([A-Z0-9_\/]{3,20})/i,
  /TCode:\s*([A-Z0-9_\/]{3,20})/i,
  /-\s*([A-Z0-9_\/]{3,20})\s*-/,
];

let lastTransaction = null;
let lastSystemInfo = null;

function parseWindowTitle(title) {
  if (!title) return null;
  const result = { raw: title };

  for (const pattern of SAP_WINDOW_TITLE_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      result.context = match[1]?.trim();
      result.system = match[2]?.trim();
      result.detail = match[3]?.trim();

      const sysMatch = result.system?.match(/^([A-Z0-9]{2,3})\s*\((\d{3})\)$/i);
      if (sysMatch) {
        result.systemId = sysMatch[1].toUpperCase();
        result.client = sysMatch[2];
      }
      break;
    }
  }

  for (const pattern of TRANSACTION_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      result.transaction = match[1].toUpperCase();
      break;
    }
  }

  return result;
}

function getActiveWindowTitle() {
  try {
    const activeWin = require('active-win');
    return activeWin().then(win => {
      if (!win || !win.title) return null;
      return {
        title: win.title,
        owner: win.owner?.name || '',
        pid: win.owner?.processId || 0,
        id: win.id || 0,
      };
    }).catch(() => null);
  } catch (err) {
    return Promise.resolve(null);
  }
}

function isSAPWindow(win) {
  if (!win || !win.title) return false;
  const lower = win.title.toLowerCase();
  if (lower.includes('sap')) return true;
  if (lower.includes('gui')) return true;
  if (lower.includes('easy access')) return true;
  if (win.owner && win.owner.toLowerCase().includes('sap')) return true;
  return false;
}

function create(config, { postEvent }) {
  const pollIntervalMs = config.windowMonitor?.pollIntervalMs || 2000;

  let pollTimer = null;
  let lastWindowTitle = null;
  let lastWindowInfo = null;

  async function poll() {
    try {
      const win = await getActiveWindowTitle();
      if (!win) return;
      if (!isSAPWindow(win)) return;

      if (win.title === lastWindowTitle) return;
      lastWindowTitle = win.title;

      const parsed = parseWindowTitle(win.title);

      if (parsed.transaction && parsed.transaction !== lastTransaction) {
        postEvent({
          type: 'sap_gui_window',
          action: 'transaction_change',
          transaction: parsed.transaction,
          systemId: parsed.systemId || null,
          client: parsed.client || null,
          system: parsed.system || null,
          windowTitle: win.title,
        });
        lastTransaction = parsed.transaction;
      }

      if (parsed.systemId && parsed.systemId !== lastSystemInfo) {
        postEvent({
          type: 'sap_gui_window',
          action: 'system_connect',
          systemId: parsed.systemId,
          client: parsed.client || null,
          system: parsed.system || null,
          windowTitle: win.title,
        });
        lastSystemInfo = parsed.systemId;
      }

      const systemChanged = JSON.stringify({ systemId: parsed.systemId, client: parsed.client }) !==
        JSON.stringify(lastWindowInfo);
      if (systemChanged && lastWindowInfo !== null) {
        postEvent({
          type: 'sap_gui_window',
          action: 'system_change',
          previousSystemId: lastWindowInfo?.systemId || null,
          systemId: parsed.systemId || null,
          client: parsed.client || null,
          windowTitle: win.title,
        });
      }
      lastWindowInfo = { systemId: parsed.systemId, client: parsed.client };

      postEvent({
        type: 'sap_gui_window',
        action: 'window_focus',
        transaction: parsed.transaction || null,
        systemId: parsed.systemId || null,
        system: parsed.system || null,
        windowTitle: win.title,
      });
    } catch (err) {
      console.error('[SAP GUI Window] Poll error:', err.message);
    }
  }

  function start() {
    poll();
    pollTimer = setInterval(poll, pollIntervalMs);
    console.log(`[SAP GUI Window] Started (poll: ${pollIntervalMs}ms)`);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
  }

  return { start, stop };
}

module.exports = { create, parseWindowTitle };
