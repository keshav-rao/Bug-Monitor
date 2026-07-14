const fs = require('fs');
const path = require('path');

function create(config, { postEvent }) {
  const watchDirs = config.watchDirs || [];
  const excludedDirs = config.excludedDirs || ['node_modules', '.git'];
  let watchers = [];
  let diskSpaceTimer = null;

  function isExcluded(dir) {
    return excludedDirs.some(ex => dir.includes(ex));
  }

  function start() {
    for (const dir of watchDirs) {
      if (!fs.existsSync(dir)) {
        console.warn(`[FS Collector] Directory does not exist: ${dir}`);
        continue;
      }
      try {
        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const fullPath = path.join(dir, filename);
          if (isExcluded(fullPath)) return;
          postEvent({
            type: 'desktop_fs',
            action: eventType === 'change' ? 'modify' : eventType,
            path: fullPath,
            directory: dir,
          });
        });
        watchers.push(watcher);
        console.log(`[FS Collector] Watching: ${dir}`);
      } catch (err) {
        console.error(`[FS Collector] Failed to watch ${dir}:`, err.message);
        postEvent({
          type: 'desktop_fs',
          action: 'watch_error',
          path: dir,
          error: err.message,
        });
      }
    }

    diskSpaceTimer = setInterval(() => {
      try {
        for (const dir of watchDirs) {
          if (!fs.existsSync(dir)) continue;
          const stats = fs.statfsSync(dir);
          const freeGB = (stats.bfree * stats.bsize) / (1024 * 1024 * 1024);
          if (freeGB < 1) {
            postEvent({
              type: 'desktop_fs',
              action: 'disk_low',
              path: dir,
              freeGB: Math.round(freeGB * 10) / 10,
            });
          }
        }
      } catch (err) {
        console.error('[FS Collector] Disk space check failed:', err.message);
      }
    }, 300000);
  }

  function stop() {
    for (const w of watchers) {
      try { w.close(); } catch (e) {}
    }
    watchers = [];
    if (diskSpaceTimer) clearInterval(diskSpaceTimer);
  }

  return { start, stop };
}

module.exports = { create };
