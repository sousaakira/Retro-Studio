@echo off
rem Instala o Retro Studio (clique duas vezes). Opções: Instalar.cmd -Reparar | -Verificar | -Desinstalar
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
echo.
pause
