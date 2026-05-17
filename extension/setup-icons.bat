@echo off
set SRC=C:\Users\Keshav\.gemini\antigravity\brain\778dc4b5-4601-4d6e-a9da-511a09f17e4a\bug_monitor_icon_1779026541422.png
set ICON_DIR=C:\Users\Keshav\Bug Monitor\extension\icons
if not exist "%ICON_DIR%" mkdir "%ICON_DIR%"
copy /Y "%SRC%" "%ICON_DIR%\icon128.png"
copy /Y "%SRC%" "%ICON_DIR%\icon48.png"
copy /Y "%SRC%" "%ICON_DIR%\icon16.png"
echo Icons copied successfully!
pause
