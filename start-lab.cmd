@echo off
rem AI Learning Lab - one click start (production mode, opens browser)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 pause
