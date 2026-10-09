@echo off
setlocal
cd /d "%~dp0"
set "TASK_DATA=M:\projekte\Ladesaeulenregister\data"
set "TASK_OUTPUT=%TASK_DATA%\35_step_motorway_review"
set "TASK_TEMP=%TASK_DATA%\35_step_python_temp"
if not exist "%TASK_TEMP%" mkdir "%TASK_TEMP%"
if not exist "%TASK_OUTPUT%" mkdir "%TASK_OUTPUT%"
set "TMP=%TASK_TEMP%"
set "TEMP=%TASK_TEMP%"
set "PIP_CACHE_DIR=%TASK_TEMP%\pip"
set "PYTHONPYCACHEPREFIX=%TASK_TEMP%\pycache"
set "PYTHONUNBUFFERED=1"
if not exist ".venv-pbf\Scripts\python.exe" goto missing
.venv-pbf\Scripts\python.exe -c "import osmium, pyarrow, shapely, pyproj, numpy"
if errorlevel 1 (
  .venv-pbf\Scripts\python.exe -m pip install --no-cache-dir -r scripts\requirements-step35.txt
  if errorlevel 1 goto failed
)
echo Desktop run: A5, then A1 and A9. Keep this window open. Disable system sleep.
echo Log: %TASK_OUTPUT%\35-desktop-review.log
.venv-pbf\Scripts\python.exe scripts\step35_launch.py --project "." --data "%TASK_DATA%" --output "%TASK_OUTPUT%"
if errorlevel 1 goto failed
echo Send: %TASK_OUTPUT%\35-all-review-results.zip
pause
exit /b 0
:missing
echo Missing .venv-pbf\Scripts\python.exe. Unpack into the project root.
:failed
echo FINISHED WITH ERRORS. Keep files and send the log or resulting archive.
pause
exit /b 1
