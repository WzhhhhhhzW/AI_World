@echo off
setlocal
cd /d "%~dp0"
set "VILLAGE_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%VILLAGE_PY%" goto bundled
where py >nul 2>&1
if not errorlevel 1 goto pylauncher
where python >nul 2>&1
if not errorlevel 1 goto systempython
echo Python 3.10 or newer is required.
pause
exit /b 1
:bundled
"%VILLAGE_PY%" server.py --open-browser
goto finished
:pylauncher
py -3 server.py --open-browser
goto finished
:systempython
python server.py --open-browser
:finished
set "VILLAGE_EXIT=%ERRORLEVEL%"
if not "%VILLAGE_EXIT%"=="0" pause
exit /b %VILLAGE_EXIT%
