@echo off
rem AI Learning Lab - stop the server started by start-lab.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local.ps1"
if errorlevel 1 pause
timeout /t 2 >nul
