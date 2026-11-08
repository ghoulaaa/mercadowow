@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Falta instalar. Ejecuta primero instalar.bat
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -m app
if errorlevel 1 pause
