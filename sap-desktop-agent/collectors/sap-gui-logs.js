const fs = require('fs');
const path = require('path');
const os = require('os');

function getDefaultLogDirs() {
  const dirs = [];
  try {
    if (os.platform() === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      dirs.push(path.join(appData, 'SAP', 'Common'));
      dirs.push(path.join(appData, 'SAP', 'SAP GUI'));
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      dirs.push(path.join(localAppData, 'SAP', 'SAP GUI'));
      const temp = process.env.TEMP || path.join(os.homedir(), 'AppData', 'Local', 'Temp');
      dirs.push(path.join(temp, 'SAP'));
      if (process.env.SAPWORK) dirs.push(process.env.SAPWORK);
    } else {
      dirs.push(path.join(os.homedir(), '.sap'));
      dirs.push('/tmp/sap');
    }
  } catch (e) {}
  return dirs.filter(d => fs.existsSync(d));
}

function getLogFiles(logDir) {
  try {
    return fs.readdirSync(logDir)
      .filter(f => {
        const lower = f.toLowerCase();
        return lower.endsWith('.log') || lower.endsWith('.trc') || lower.endsWith('.txt') || lower.includes('sap');
      })
      .map(f => ({
        name: f,
        fullPath: path.join(logDir, f),
        size: fs.statSync(path.join(logDir, f)).size,
        mtime: fs.statSync(path.join(logDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    return [];
  }
}

function readTail(filePath, maxBytes = 4096) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return '';
    const readSize = Math.min(stats.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (e) {
    return '';
  }
}

const ERROR_PATTERNS = [
  /error/i, /exception/i, /abort/i, /dump/i, /timeout/i,
  /failed/i, /denied/i, /invalid/i, /cannot/i, /unable/i,
  /sapgui.*error/i, /gui.*crash/i, /access violation/i,
  /out of memory/i, /stack overflow/i,
];

function containsError(text) {
  if (!text) return null;
  for (const pattern of ERROR_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { pattern: match[0], context: text.slice(Math.max(0, match.index - 60), match.index + 120).trim() };
  }
  return null;
}

function create(config, { postEvent }) {
  const watchDirs = (config.logMonitor?.watchDirs || []).filter(Boolean).length > 0
    ? config.logMonitor.watchDirs.filter(Boolean)
    : getDefaultLogDirs();
  const pollIntervalMs = config.logMonitor?.pollIntervalMs || 30000;

  let pollTimer = null;
  let knownFiles = {};

  async function poll() {
    for (const logDir of watchDirs) {
      try {
        const files = getLogFiles(logDir);
        const currentFiles = {};

        for (const file of files) {
          currentFiles[file.name] = file;
          const known = knownFiles[file.name];

          if (!known) {
            postEvent({
              type: 'sap_gui_log',
              action: 'new_file',
              logFile: file.name,
              path: file.fullPath,
              size: file.size,
            });
          } else if (file.size !== known.size || file.mtime > known.mtime) {
            const tail = readTail(file.fullPath);
            const errorMatch = containsError(tail);
            postEvent({
              type: 'sap_gui_log',
              action: 'file_modified',
              logFile: file.name,
              path: file.fullPath,
              size: file.size,
              sizeDelta: file.size - known.size,
              errorDetected: !!errorMatch,
              errorPattern: errorMatch?.pattern || null,
              errorContext: errorMatch?.context || null,
            });
          }
        }

        for (const name of Object.keys(knownFiles)) {
          if (!currentFiles[name]) {
            postEvent({
              type: 'sap_gui_log',
              action: 'file_removed',
              logFile: name,
              path: knownFiles[name].fullPath,
            });
          }
        }

        knownFiles = currentFiles;
      } catch (err) {
        console.error(`[SAP GUI Logs] Poll error for ${logDir}:`, err.message);
      }
    }
  }

  function start() {
    poll();
    pollTimer = setInterval(poll, pollIntervalMs);
    console.log(`[SAP GUI Logs] Started (poll: ${pollIntervalMs}ms, dirs: ${watchDirs.join(', ')})`);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
  }

  return { start, stop };
}

module.exports = { create };
