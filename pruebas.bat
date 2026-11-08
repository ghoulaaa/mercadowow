@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Pruebas del servidor (Python) ===
".venv\Scripts\python.exe" -m pytest -q
echo.
echo === Pruebas de la actualizacion y del SQL (Node + Postgres simulado) ===
call npm test
pause
