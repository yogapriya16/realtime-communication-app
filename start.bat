@echo off
title CollabSync - Real-Time Communication App
set "PATH=C:\Users\balaj\nodejs;%PATH%"

echo =======================================================
echo   CollabSync - Real-Time Video & Collaboration Suite
echo =======================================================
echo.
echo Starting backend server on http://localhost:3000 ...
echo Press Ctrl+C at any time to stop the server.
echo.

start "" "http://localhost:3000"
node server/server.js
pause
