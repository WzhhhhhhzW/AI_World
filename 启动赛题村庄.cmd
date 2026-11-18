@echo off
setlocal
pushd "%~dp0"
wsl.exe -d Ubuntu -- bash platform/start.sh
set "village_result=%errorlevel%"
popd
if not "%village_result%"=="0" pause
exit /b %village_result%
