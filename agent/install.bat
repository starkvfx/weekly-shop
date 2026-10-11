@echo off
rem One-off install for the Weekly Shop agent. Needs Python 3.11+ from python.org.
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install chromium
echo.
echo Installed. Next: run_setup.bat
pause
