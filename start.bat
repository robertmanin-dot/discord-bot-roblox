@echo off
setlocal
cd /d "%~dp0"
title Creator Launch Kit

where node >nul 2>nul
if errorlevel 1 goto nonode

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto oldnode

if exist "node_modules\" goto run
echo Installiere benoetigte Pakete (einmalig, dauert 1-2 Minuten) ...
call npm install --no-fund --no-audit
if errorlevel 1 goto installfail

:run
set OPEN_BROWSER=1
echo.
echo Creator Launch Kit startet ... Das Dashboard oeffnet sich gleich im Browser: http://localhost:3000
echo Dieses Fenster offen lassen. Beenden mit Strg+C.
echo.
call npm start
if errorlevel 1 goto crashed
goto end

:nonode
echo.
echo [FEHLER] Node.js ist nicht installiert.
echo Bitte die LTS-Version von https://nodejs.org installieren und diese Datei danach erneut starten.
echo.
pause
exit /b 1

:oldnode
echo.
echo [FEHLER] Deine Node.js-Version ist zu alt:
node -v
echo Benoetigt wird mindestens Version 22.13. Bitte die LTS-Version von https://nodejs.org installieren.
echo.
pause
exit /b 1

:installfail
echo.
echo [FEHLER] Die Pakete konnten nicht installiert werden. Internetverbindung pruefen und erneut starten.
echo.
pause
exit /b 1

:crashed
echo.
echo Das Programm wurde mit einem Fehler beendet. Die Meldung steht oben.
echo.
pause
exit /b 1

:end
endlocal
