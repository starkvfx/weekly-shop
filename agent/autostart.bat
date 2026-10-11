@echo off
rem Makes the Weekly Shop agent start (minimised) every time you log in to Windows.
rem It adds a small file to your Startup folder; no admin rights needed.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo @echo off
  echo start "Weekly Shop agent" /min "%~dp0run_agent.bat"
) > "%STARTUP%\Weekly Shop agent.bat"
echo.
echo Done. The agent will start each time you log in. To start it now, run run_agent.bat.
echo To stop it starting: delete "Weekly Shop agent.bat" from %STARTUP%
pause
