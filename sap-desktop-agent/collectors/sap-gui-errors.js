const os = require('os');

let lastErrorState = null;
let consecutiveErrors = 0;

function detectErrorWindows() {
  if (os.platform() !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
    const { writeFileSync, unlinkSync } = require('fs');
    const script = `
      Dim objShell, objWMI, colItems, objItem
      Set objShell = CreateObject("WScript.Shell")
      Set objWMI = GetObject("winmgmts:\\\\.\\root\\CIMV2")
      Set colItems = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'sapgui.exe' OR Name = 'saplogon.exe'", "WQL", 48)
      Dim found
      found = False
      For Each objItem In colItems
        found = True
      Next
      If Not found Then WScript.Quit
      Set colItems = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'sapgui.exe' AND CommandLine LIKE '%/SHOW_DUMP%'", "WQL", 48)
      For Each objItem In colItems
        WScript.Echo "SHORT_DUMP:" & objItem.ProcessId
      Next
    `;
    const tempFile = require('path').join(require('os').tmpdir(), 'bm_sap_err_' + Date.now() + '.vbs');
    writeFileSync(tempFile, script, 'utf8');
    const output = execSync(`cscript.exe //Nologo "${tempFile}"`, { timeout: 5000, encoding: 'utf8' });
    unlinkSync(tempFile);
    const lines = output.trim().split('\n').filter(Boolean);
    const errors = [];
    for (const line of lines) {
      if (line.startsWith('SHORT_DUMP:')) {
        errors.push({ type: 'short_dump', pid: parseInt(line.replace('SHORT_DUMP:', ''), 10) });
      }
    }
    return errors.length > 0 ? errors : null;
  } catch (err) {
    return null;
  }
}

function detectSAPErrorPopups() {
  if (os.platform() !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
    const { writeFileSync, unlinkSync } = require('fs');
    const script = `
      Dim objShell, objWMI, colItems, objItem
      Set objShell = CreateObject("WScript.Shell")
      Set objWMI = GetObject("winmgmts:\\\\.\\root\\CIMV2")
      Set colItems = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'sapgui.exe'", "WQL", 48)
      Dim sapRunning
      sapRunning = False
      For Each objItem In colItems
        sapRunning = True
      Next
      If Not sapRunning Then WScript.Quit
      Set objShell = CreateObject("WScript.Shell")
      On Error Resume Next
      Dim hwnd
      For Each strWindow In Array("SAP System Alert", "SAP GUI Error", "Runtime Errors", "Short Dump", "ABAP Error", "System Error")
        hwnd = objShell.AppActivate(strWindow)
        If hwnd <> 0 Then
          WScript.Echo "POPUP:" & strWindow
        End If
      Next
    `;
    const tempFile = require('path').join(require('os').tmpdir(), 'bm_sap_popup_' + Date.now() + '.vbs');
    writeFileSync(tempFile, script, 'utf8');
    const output = execSync(`cscript.exe //Nologo "${tempFile}"`, { timeout: 5000, encoding: 'utf8' });
    unlinkSync(tempFile);
    const lines = output.trim().split('\n').filter(Boolean);
    const popups = [];
    for (const line of lines) {
      if (line.startsWith('POPUP:')) {
        popups.push({ type: 'error_popup', title: line.replace('POPUP:', '').trim() });
      }
    }
    return popups.length > 0 ? popups : null;
  } catch (err) {
    return null;
  }
}

function detectSAPGUICrashes() {
  try {
    const { execSync } = require('child_process');
    if (os.platform() === 'win32') {
      const output = execSync('wevtutil qe Application /c:5 /f:text /rd:true /q:"*[System[Provider[@Name=\'Application Error\']]]" 2>nul', { timeout: 3000, encoding: 'utf8' });
      if (!output) return null;
      const lines = output.split('\n');
      const crashes = [];
      let currentCrash = {};
      let inCrash = false;
      for (const line of lines) {
        if (line.includes('Application Error')) { inCrash = true; currentCrash = {}; }
        if (inCrash && line.includes('Faulting application name:')) {
          const name = line.split(':').slice(1).join(':').trim();
          if (name.toLowerCase().includes('sapgui') || name.toLowerCase().includes('saplogon')) {
            currentCrash.faultingApp = name;
          }
        }
        if (inCrash && line.includes('Faulting module name:')) currentCrash.faultingModule = line.split(':').slice(1).join(':').trim();
        if (inCrash && line.includes('Exception code:')) currentCrash.exceptionCode = line.split(':').slice(1).join(':').trim();
        if (inCrash && line.includes('Faulting process id:')) currentCrash.faultingPid = line.split(':').slice(1).join(':').trim();
        if (inCrash && line.trim() === '') {
          if (currentCrash.faultingApp) crashes.push({ type: 'crash', ...currentCrash });
          inCrash = false;
          currentCrash = {};
        }
      }
      return crashes.length > 0 ? crashes : null;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function create(config, { postEvent }) {
  const pollIntervalMs = config.errorCapture?.pollIntervalMs || 2000;
  const captureScreenshot = config.errorCapture?.captureScreenshot !== false;

  let pollTimer = null;
  let errorActive = false;
  let screenshotModule = null;

  function getScreenshotModule() {
    if (!captureScreenshot) return null;
    try {
      return require('../screen-capture');
    } catch (e) {
      return null;
    }
  }

  async function poll() {
    try {
      const errorWindows = detectErrorWindows();
      const popups = detectSAPErrorPopups();
      const crashes = detectSAPGUICrashes();
      const allErrors = [...(errorWindows || []), ...(popups || []), ...(crashes || [])];

      if (allErrors.length > 0) {
        if (!errorActive) {
          errorActive = true;
          consecutiveErrors = 1;

          if (captureScreenshot) {
            if (!screenshotModule) screenshotModule = getScreenshotModule();
            if (screenshotModule) {
              const screenshot = await screenshotModule.capture();
              allErrors[0].screenshot = screenshot?.filename || null;
            }
          }

          postEvent({
            type: 'sap_gui_error',
            action: 'error_detected',
            errors: allErrors,
            count: allErrors.length,
          });
        } else {
          consecutiveErrors++;
          if (consecutiveErrors <= 3) {
            postEvent({
              type: 'sap_gui_error',
              action: 'error_persistent',
              errors: allErrors,
              consecutiveCount: consecutiveErrors,
            });
          }
        }
      } else {
        if (errorActive) {
          errorActive = false;
          consecutiveErrors = 0;
          postEvent({ type: 'sap_gui_error', action: 'error_cleared' });
        }
      }

      if (screenshotModule) {
        screenshotModule.cleanup();
      }
    } catch (err) {
      console.error('[SAP GUI Errors] Poll error:', err.message);
    }
  }

  function start() {
    poll();
    pollTimer = setInterval(poll, pollIntervalMs);
    console.log(`[SAP GUI Errors] Started (poll: ${pollIntervalMs}ms)`);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
  }

  return { start, stop };
}

module.exports = { create };
