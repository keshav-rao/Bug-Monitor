const childProcess = require('child_process');
const os = require('os');

const SAP_GUI_PROCESS_NAMES = [
  'saplogon.exe',
  'sapgui.exe',
  'SAP Business Client.exe',
  'SAPGUI.exe',
  'saplgpad.exe',
  'sapshcut.exe',
  'saprouter.exe',
];

function create(config, { postEvent }) {
  const monitoredProcs = config.sapGuiProcesses || SAP_GUI_PROCESS_NAMES;
  const pollIntervalMs = config.processMonitor?.pollIntervalMs || 10000;
  const cpuThreshold = config.processMonitor?.cpuThreshold || 80;
  const memThresholdMB = config.processMonitor?.memThresholdMB || 500;

  let pollTimer = null;
  let knownPids = new Set();

  function getProcessList() {
    return new Promise((resolve) => {
      const cmd = os.platform() === 'win32'
        ? 'tasklist /fo csv /nh'
        : 'ps aux --no-headers | grep -i sap';
      childProcess.exec(cmd, { timeout: 5000 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const lines = stdout.trim().split('\n').filter(Boolean);
          const processes = [];
          for (const line of lines) {
            if (os.platform() === 'win32') {
              const parts = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
              if (parts.length < 2) continue;
              const name = parts[0] || '';
              const pid = parseInt(parts[1], 10);
              if (!pid) continue;
              processes.push({
                name,
                pid,
                sessionName: parts[2] || '',
                memKB: parseInt(parts[4]?.replace(/,/g, ''), 10) || 0,
              });
            } else {
              const cols = line.split(/\s+/);
              if (cols.length < 11) continue;
              processes.push({
                name: cols[10] || '',
                pid: parseInt(cols[1], 10) || 0,
                cpu: parseFloat(cols[2]) || 0,
                memKB: Math.round((parseFloat(cols[5]) || 0) * 1024),
              });
            }
          }
          resolve(processes.filter(p => monitoredProcs.some(m => p.name.toLowerCase().includes(m.toLowerCase().replace('.exe', '')))));
        } catch (e) { resolve([]); }
      });
    });
  }

  async function poll() {
    try {
      const processes = await getProcessList();
      const currentPids = new Set(processes.map(p => p.pid));

      for (const pid of currentPids) {
        if (!knownPids.has(pid)) {
          const proc = processes.find(p => p.pid === pid);
          if (proc) {
            postEvent({
              type: 'sap_gui_process',
              action: 'start',
              processName: proc.name,
              pid: proc.pid,
              memKB: proc.memKB,
            });
          }
        }
      }

      for (const pid of knownPids) {
        if (!currentPids.has(pid)) {
          postEvent({ type: 'sap_gui_process', action: 'stop', pid });
        }
      }

      knownPids = currentPids;

      for (const proc of processes) {
        const memMB = Math.round(proc.memKB / 1024);
        if (memMB > memThresholdMB) {
          postEvent({
            type: 'sap_gui_process',
            action: 'high_memory',
            processName: proc.name,
            pid: proc.pid,
            memMB,
          });
        }
      }
    } catch (err) {
      console.error('[SAP GUI Process] Poll error:', err.message);
    }
  }

  function start() {
    poll();
    pollTimer = setInterval(poll, pollIntervalMs);
    console.log(`[SAP GUI Process] Started (poll: ${pollIntervalMs}ms)`);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
  }

  return { start, stop };
}

module.exports = { create };
