@echo off
rem ============================================================
rem  EMMA for Windows - double-click to start.
rem  First start: if Node.js is missing it downloads a private
rem  copy into the .runtime folder (no admin rights needed) and
rem  installs the libraries. Then EMMA opens in the browser.
rem  Keep this window open while you use EMMA: closing it stops EMMA.
rem  Your data stay in the "data" folder next to this file.
rem ============================================================
setlocal EnableExtensions
cd /d "%~dp0app" || (echo The "app" folder is missing next to this file. & pause & exit /b 1)
title EMMA
set "URL=http://127.0.0.1:4317"
set "NODE_VERSION=24.11.0"

rem --- Node.js: private copy first, then the one installed on the PC (22.13 or newer, with its built-in database)
if exist "%CD%\.runtime\node.exe" set "PATH=%CD%\.runtime;%PATH%"
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 call :getnode || goto :fail_node

rem --- Already running? Same version: just open it. Older version: stop it.
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "WANTED=%%v"
set "RUNNING="
for /f "delims=" %%r in ('node -e "fetch('%URL%/api/status').then(r=>r.json()).then(j=>console.log(j.version||'')).catch(()=>{})" 2^>nul') do set "RUNNING=%%r"
if defined RUNNING if "%RUNNING%"=="%WANTED%" (
  start "" "%URL%"
  exit /b 0
)
if not "%RUNNING%"=="" call :stopold

rem --- Libraries: installed the first time (or when missing)
node -e "require.resolve('express');require.resolve('docx');require.resolve('kokoro-js')" >nul 2>nul
if errorlevel 1 call :libraries || goto :fail_libs

echo.
echo  EMMA %WANTED% is starting: it opens in the browser in a few seconds.
echo  Keep this window open while you use EMMA. Close it to stop EMMA.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process '%URL%'"
node src\server.js
echo.
echo  EMMA has stopped. If this was not expected, send the messages above to the author.
pause
exit /b 0

:getnode
echo.
echo  First start: downloading Node.js %NODE_VERSION% for EMMA (about 35 MB, only once)...
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $zip=Join-Path $env:TEMP 'emma-node.zip'; $tmp=Join-Path $env:TEMP 'emma-node'; Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-%ARCH%.zip' -OutFile $zip; if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }; Expand-Archive -Path $zip -DestinationPath $tmp -Force; if (Test-Path '.runtime') { Remove-Item '.runtime' -Recurse -Force }; Move-Item -Path (Get-ChildItem $tmp | Select-Object -First 1).FullName -Destination '.runtime'; Remove-Item $zip -Force"
if errorlevel 1 exit /b 1
if not exist "%CD%\.runtime\node.exe" exit /b 1
set "PATH=%CD%\.runtime;%PATH%"
exit /b 0

:libraries
echo.
echo  Installing the EMMA libraries (about a minute, only the first time)...
if exist "node_modules" rmdir /s /q "node_modules"
call npm install --omit=dev --no-audit --no-fund --loglevel=error
if errorlevel 1 exit /b 1
node -e "require.resolve('express');require.resolve('docx');require.resolve('kokoro-js')" >nul 2>nul
exit /b %errorlevel%

:stopold
echo  EMMA %RUNNING% is running: closing it and starting version %WANTED%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":4317 .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
timeout /t 2 /nobreak >nul
exit /b 0

:fail_node
echo.
echo  Node.js could not be downloaded. Check the internet connection (turn off any VPN or proxy)
echo  or install Node.js 22 or newer from https://nodejs.org and start EMMA again.
pause
exit /b 1

:fail_libs
echo.
echo  The libraries could not be installed. Check the internet connection and start EMMA again.
echo  If it keeps failing, send the messages above to the author.
pause
exit /b 1
