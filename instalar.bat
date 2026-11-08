@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo === Instalando Mercado WoW Forever ===
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Python. Instala Python 3.12 o superior desde python.org
  echo         y marca la casilla "Add python.exe to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual en .venv ...
  python -m venv .venv
  if errorlevel 1 ( echo [ERROR] No se pudo crear el entorno virtual. & pause & exit /b 1 )
)

echo Instalando dependencias ...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements-dev.txt
if errorlevel 1 ( echo [ERROR] Fallo la instalacion de dependencias. & pause & exit /b 1 )

where npm >nul 2>nul
if errorlevel 1 (
  echo [AVISO] No se encontro Node.js. Hace falta para desplegar en Supabase: instalalo desde nodejs.org
) else (
  echo Instalando herramientas de prueba de Node ...
  call npm install --no-fund --no-audit --silent
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Creado .env a partir de .env.example
)

echo.
echo Listo. Siguiente paso: rellena .env con los datos de Supabase (guia: docs\SUPABASE.md)
echo y luego haz doble clic en configurar.bat
echo.
pause
