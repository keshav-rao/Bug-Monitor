const os = require('os');

let lastTransaction = null;
let lastScreenId = null;

function getScriptingEngine() {
  if (os.platform() !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
    const script = `
      Dim SapGuiAuto As Object
      Dim SAPGUI As Object
      Dim Connection As Object
      Dim Session As Object
      On Error Resume Next
      Set SapGuiAuto = GetObject("SAPGUI")
      If SapGuiAuto Is Nothing Then
        WScript.Echo "ERR:NoSAPGUI"
        WScript.Quit
      End If
      Set SAPGUI = SapGuiAuto.GetScriptingEngine
      If SAPGUI Is Nothing Then
        WScript.Echo "ERR:NoScriptingEngine"
        WScript.Quit
      End If
      Dim count
      count = SAPGUI.Connections.Count
      WScript.Echo "CONNECTIONS:" & count
      Dim i
      For i = 0 To count - 1
        Set Connection = SAPGUI.Connections(i)
        WScript.Echo "CONN:" & Connection.Description & "|" & Connection.ConnectionId
        Dim j
        For j = 0 To Connection.Sessions.Count - 1
          Set Session = Connection.Sessions(j)
          On Error Resume Next
          WScript.Echo "SESSION:" & Connection.Description & "|" & Session.Id & "|" & Session.Info.Transaction & "|" & Session.Info.Program & "|" & Session.Info.ScreenId
          On Error GoTo 0
        Next
      Next
    `;
    const tempFile = require('path').join(require('os').tmpdir(), 'bm_sap_script_' + Date.now() + '.vbs');
    require('fs').writeFileSync(tempFile, script, 'utf8');
    const output = execSync(`cscript.exe //Nologo "${tempFile}"`, { timeout: 5000, encoding: 'utf8' });
    require('fs').unlinkSync(tempFile);
    return output;
  } catch (err) {
    console.error('[SAP GUI Scripting] Engine query failed:', err.message);

    try {
      const { execSync } = require('child_process');
      const detectScript = `
        On Error Resume Next
        Dim SapGuiAuto
        Set SapGuiAuto = GetObject("SAPGUI")
        If SapGuiAuto Is Nothing Then
          WScript.Echo "UNAVAILABLE"
        Else
          WScript.Echo "AVAILABLE"
        End If
      `;
      const tempFile = require('path').join(require('os').tmpdir(), 'bm_sap_detect_' + Date.now() + '.vbs');
      require('fs').writeFileSync(tempFile, detectScript, 'utf8');
      const output = execSync(`cscript.exe //Nologo "${tempFile}"`, { timeout: 3000, encoding: 'utf8' });
      require('fs').unlinkSync(tempFile);
      return output.trim();
    } catch (e2) {
      return null;
    }
  }
}

function parseSessions(output) {
  if (!output) return [];
  const sessions = [];
  const lines = output.split('\n').filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('SESSION:')) {
      const parts = line.replace('SESSION:', '').split('|');
      if (parts.length >= 3) {
        sessions.push({
          connectionDescription: parts[0] || '',
          sessionId: parts[1] || '',
          transaction: parts[2] || '',
          program: parts[3] || '',
          screenId: parts[4] || '',
        });
      }
    }
  }
  return sessions;
}

function getStatusBarMessage() {
  try {
    const { execSync } = require('child_process');
    const script = `
      Dim SapGuiAuto, SAPGUI, Connection, Session
      On Error Resume Next
      Set SapGuiAuto = GetObject("SAPGUI")
      If SapGuiAuto Is Nothing Then WScript.Quit
      Set SAPGUI = SapGuiAuto.GetScriptingEngine
      If SAPGUI.Connections.Count = 0 Then WScript.Quit
      Set Connection = SAPGUI.Connections(0)
      If Connection.Sessions.Count = 0 Then WScript.Quit
      Set Session = Connection.Sessions(0)
      Dim msgType, msgText
      msgType = Session.Info.MessageType
      msgText = Session.Info.Message
      If msgType <> "" Then
        WScript.Echo msgType & "|" & msgText
      End If
    `;
    const tempFile = require('path').join(require('os').tmpdir(), 'bm_sap_status_' + Date.now() + '.vbs');
    require('fs').writeFileSync(tempFile, script, 'utf8');
    const output = execSync(`cscript.exe //Nologo "${tempFile}"`, { timeout: 3000, encoding: 'utf8' });
    require('fs').unlinkSync(tempFile);
    const trimmed = output.trim();
    if (!trimmed) return null;
    const parts = trimmed.split('|');
    return { type: parts[0] || '', message: parts.slice(1).join('|') || '' };
  } catch (err) {
    return null;
  }
}

function create(config, { postEvent }) {
  const pollIntervalMs = config.scripting?.pollIntervalMs || 3000;
  let pollTimer = null;
  let scriptingAvailable = null;
  let detectAttempts = 0;

  async function poll() {
    try {
      if (scriptingAvailable === false) {
        detectAttempts++;
        if (detectAttempts > 20) return;
      }

      const output = getScriptingEngine();
      if (!output) {
        if (scriptingAvailable !== false) {
          scriptingAvailable = false;
          postEvent({ type: 'sap_gui_scripting', action: 'unavailable' });
        }
        return;
      }

      if (scriptingAvailable !== true) {
        scriptingAvailable = true;
        postEvent({ type: 'sap_gui_scripting', action: 'available' });
      }

      const sessions = parseSessions(output);
      if (sessions.length === 0) return;

      for (const session of sessions) {
        if (session.transaction && session.transaction !== lastTransaction) {
          postEvent({
            type: 'sap_gui_scripting',
            action: 'transaction',
            transaction: session.transaction,
            sessionId: session.sessionId,
            program: session.program,
            screenId: session.screenId,
            connection: session.connectionDescription,
          });
          lastTransaction = session.transaction;
        }

        if (session.screenId && session.screenId !== lastScreenId) {
          postEvent({
            type: 'sap_gui_scripting',
            action: 'screen_change',
            screenId: session.screenId,
            transaction: session.transaction,
            sessionId: session.sessionId,
            connection: session.connectionDescription,
          });
          lastScreenId = session.screenId;
        }
      }

      const status = getStatusBarMessage();
      if (status && status.message) {
        const isError = status.type === 'E' || status.type === 'A' || status.type === 'X';
        if (isError) {
          postEvent({
            type: 'sap_gui_scripting',
            action: 'status_error',
            messageType: status.type,
            message: status.message,
            transaction: lastTransaction,
          });
        }
      }
    } catch (err) {
      console.error('[SAP GUI Scripting] Poll error:', err.message);
    }
  }

  function start() {
    poll();
    pollTimer = setInterval(poll, pollIntervalMs);
    console.log('[SAP GUI Scripting] Started' + (os.platform() !== 'win32' ? ' (Windows only — disabled)' : ''));
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
  }

  return { start, stop };
}

module.exports = { create };
