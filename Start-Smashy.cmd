@echo off
setlocal
cd /d "%~dp0"
set "SMASHY_NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined SMASHY_NODE set "SMASHY_NODE=%%N"
if not defined SMASHY_NODE (
  echo An existing Node.js 24 runtime is needed to run the source.
  echo No software has been installed by this launcher.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo The local build is missing. See README.md for the build command.
  pause
  exit /b 1
)
echo.
echo Smashy runs on this computer and your local network.
echo On this PC, open the Local URL below in Chrome or Edge.
echo On another device on the same network, open the LAN URL below.
echo Keep this window open while playing. Press Ctrl+C to stop.
echo.
"%SMASHY_NODE%" "scripts\serve.mjs" --port 5173 --host 0.0.0.0
endlocal
