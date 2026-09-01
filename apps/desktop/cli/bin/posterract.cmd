@echo off
set POSTERRACT_APP_PATH=%~dp0..\..\..\..
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\..\..\Posterract.exe" "%~dp0..\posterract.cjs" %*
