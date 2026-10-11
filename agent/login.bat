@echo off
rem Sign the agent in to Waitrose again (you type your Waitrose details yourself in the browser).
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python agent.py login
pause
