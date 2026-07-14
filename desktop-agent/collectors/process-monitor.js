const os = require('os');
const childProcess = require('child_process');

function create(config, { postEvent }) {
  const pollIntervalMs = config.pollIntervalMs || 10000;
  const monitoredProcesses = config.monitoredProcesses || [];
  const cpuThreshold = config.cpuThreshold || 80;
  const memThresholdMB = config.memThresholdMB || 500;
  let pollTimer = null;
  let crashWatcherTimer = null;

  function getProcessList() {
    return new Promise((resolve) => {
      const cmd = os.platform() === 'win32'
        ? 'tasklist /fo csv /nh'
        : 'ps aux --no-headers';
      childProcess.exec(cmd, { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const lines = stdout.trim().split('\n');
          const processes = [];
          for (const line of lines) {
            const parts = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
            if (parts.length < 2) continue;
            if (os.platform() === 'win32') {
              processes.push({
                name: parts[0] || 'unknown',
                pid: parseInt(parts[1], 10) || 0,
                memMB: parseInt(parts[4], 10) || 0,
                cpu: 0,
              });
            } else {
              const cols = line.split(/\s+/);
              if (cols.length < 11) continue;
              processes.push({
                name: cols[10] || 'unknown',
                pid: parseInt(cols[1], 10) || 0,
                cpu: parseFloat(cols[2]) || 0,
                memMB: Math.round((parseFloat(cols[5]) || 0) / 1024),
              });
            }
          }
          resolve(processes);
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  function isMonitored(procName) {
    if (monitoredProcesses.length === 0) return true;
    return monitoredProcesses.some(m => procName.toLowerCase().includes(m.toLowerCase()));
  }

  async function pollProcesses() {
    try {
      const processes = await getProcessList();
      for (const proc of processes) {
        if (!isMonitored(proc.name)) continue;
        if (proc.cpu > cpuThreshold) {
          postEvent({
            type: 'desktop_process',
            action: 'high_cpu',
            processName: proc.name,
            pid: proc.pid,
            cpuPercent: proc.cpu,
          });
        }
        if (proc.memMB > memThresholdMB) {
          postEvent({
            type: 'desktop_process',
            action: 'high_mem',
            processName: proc.name,
            pid: proc.pid,
            memMB: proc.memMB,
          });
        }
      }
    } catch (err) {
      console.error('[Process Collector] Poll failed:', err.message);
    }
  }

  function watchCrashLogs() {
    const logPaths = os.platform() === 'win32'
      ? ['C:\\Windows\\System32\\winevt\\Logs\\Application.evtx']
      : ['/var/log/syslog', '/var/log/messages'];

    for (const logPath of logPaths) {
      try {
        if (!fs.existsSync(logPath)) continue;
        fs.watchFile(logPath, { interval: 5000 }, (curr, prev) => {
          if (curr.mtime > prev.mtime) {
            postEvent({
              type: 'desktop_process',
              action: 'system_log_change',
              logPath,
              mtime: curr.mtime.getTime(),
            });
          }
        });
      } catch (err) {
        console.error(`[Process Collector] Failed to watch ${logPath}:`, err.message);
      }
    }
  }

  function start() {
    pollProcesses();
    pollTimer = setInterval(pollProcesses, pollIntervalMs);
    if (os.platform() !== 'win32') {
      try {
        const fs = require('fs');
        watchCrashLogs();
      } catch (e) {}
    }
    console.log(`[Process Collector] Started (poll: ${pollIntervalMs}ms)`);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    try {
      const fs = require('fs');
      for (const logPath of [
        '/var/log/syslog', '/var/log/messages',
      ]) {
        try { fs.unwatchFile(logPath); } catch (e) {}
      }
    } catch (e) {}
  }

  return { start, stop };
}

module.exports = { create };
