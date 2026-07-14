let activeWindows = {};
let menuActionCount = 0;

function create(config, { postEvent }) {
  let isElectron = false;

  try {
    isElectron = typeof process !== 'undefined' && process.versions && !!process.versions.electron;
  } catch (e) {}

  function hookElectronEvents() {
    if (!isElectron) return;
    try {
      const { app, BrowserWindow, Menu } = require('electron');

      app.on('browser-window-focus', (event, win) => {
        const winInfo = {
          id: win.id,
          title: win.getTitle(),
          url: win.webContents?.getURL(),
        };
        activeWindows[win.id] = winInfo;
        postEvent({
          type: 'desktop_ui',
          action: 'window_focus',
          windowTitle: win.getTitle(),
          windowId: win.id,
        });
      });

      app.on('browser-window-blur', (event, win) => {
        postEvent({
          type: 'desktop_ui',
          action: 'window_blur',
          windowTitle: win.getTitle(),
          windowId: win.id,
        });
      });

      app.on('window-all-closed', () => {
        postEvent({ type: 'desktop_ui', action: 'all_windows_closed' });
      });

      const origMenuPopup = Menu.prototype.popup;
      if (origMenuPopup) {
        Menu.prototype.popup = function (...args) {
          const clickedItem = findClickedItem(this);
          if (clickedItem) {
            postEvent({
              type: 'desktop_ui',
              action: 'menu_click',
              menuLabel: clickedItem.label || 'unnamed',
              menuId: clickedItem.id,
            });
          }
          return origMenuPopup.apply(this, args);
        };
      }
    } catch (e) {
      console.error('[UI Collector] Electron hook failed:', e.message);
    }
  }

  function findClickedItem(menu) {
    try {
      for (const item of menu.items || []) {
        if (item.click) return item;
        if (item.submenu) {
          const found = findClickedItem(item.submenu);
          if (found) return found;
        }
      }
    } catch (e) {}
    return null;
  }

  function hookConsoleUI() {
    if (isElectron) return;
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;

    console.log = function (...args) {
      postEvent({
        type: 'desktop_ui',
        action: 'console_output',
        level: 'log',
        message: args.map(a => String(a).slice(0, 200)).join(' ').slice(0, 500),
      });
      return origLog.apply(this, args);
    };

    console.error = function (...args) {
      postEvent({
        type: 'desktop_ui',
        action: 'console_output',
        level: 'error',
        message: args.map(a => String(a).slice(0, 200)).join(' ').slice(0, 500),
      });
      return origError.apply(this, args);
    };

    console.warn = function (...args) {
      postEvent({
        type: 'desktop_ui',
        action: 'console_output',
        level: 'warn',
        message: args.map(a => String(a).slice(0, 200)).join(' ').slice(0, 500),
      });
      return origWarn.apply(this, args);
    };
  }

  function start() {
    hookElectronEvents();
    hookConsoleUI();
    postEvent({ type: 'desktop_ui', action: 'monitor_started', electron: isElectron });
    console.log('[UI Collector] Started' + (isElectron ? ' (Electron mode)' : ''));
  }

  function stop() {}

  return { start, stop };
}

module.exports = { create };
