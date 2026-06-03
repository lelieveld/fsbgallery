@echo off
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\tiole\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "PORT=3001"

if not exist "%NODE_EXE%" (
  echo Node is niet gevonden op:
  echo %NODE_EXE%
  pause
  exit /b 1
)

echo.
echo Fotogalerij wordt gestart op poort 3001...
echo Laat dit venster open staan zolang je de site gebruikt.
echo.
echo Open daarna:
echo http://localhost:3001
echo.
echo Wachtwoord:
echo veranderdit
echo.
echo Beheer password:
echo beheerdit
echo.
"%NODE_EXE%" server.js
echo.
echo De server is gestopt.
pause
