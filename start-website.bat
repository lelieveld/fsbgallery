@echo off
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\tiole\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  echo Node is niet gevonden op:
  echo %NODE_EXE%
  echo.
  echo Installeer Node.js of vraag Codex om de startinstelling aan te passen.
  pause
  exit /b 1
)

echo.
echo Fotogalerij wordt gestart...
echo Laat dit venster open staan zolang je de site gebruikt.
echo.
echo Open daarna:
echo http://localhost:3000
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
