@echo off
rem The first real run, with you watching. It adds the ready week to your booked order (never checks out).
rem If it cannot find the Amend button it asks you here to open the order in amend mode yourself.
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python agent.py fill --commit --interactive
echo.
echo Done. Check and confirm the order in the Waitrose app.
pause
