@echo off
rem Dry run: reports in the app what the agent WOULD add for weeks marked ready. Adds nothing.
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python agent.py fill
echo.
echo Done. Open the app to read the Agent report.
pause
