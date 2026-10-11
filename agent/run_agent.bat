@echo off
rem Keeps the Weekly Shop agent running. The scheduled task starts this when you log in.
cd /d "%~dp0"
call .venv\Scripts\activate.bat
title Weekly Shop agent
python agent.py watch
