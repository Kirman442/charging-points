@echo off
setlocal
cd /d "%~dp0"
set "TASK_DATA=M:\projekte\Ladesaeulenregister\data"
set "TASK_PBF=%TASK_DATA%\germany-latest.osm.pbf"
set "TASK_OUTPUT=%TASK_DATA%\33_step_a5_full_entry_review"
set "TASK_TEMP=%TASK_DATA%\33_step_python_temp"
if not exist "%TASK_TEMP%" mkdir "%TASK_TEMP%"
if errorlevel 1 goto failed
set "TMP=%TASK_TEMP%"
set "TEMP=%TASK_TEMP%"
set "PYTHONPYCACHEPREFIX=%TASK_TEMP%\pycache"
if not exist ".venv-pbf\Scripts\python.exe" (
  echo Missing .venv-pbf\Scripts\python.exe. Unpack into the project root.
  goto failed
)
if not exist "%TASK_PBF%" (
  echo PBF not found: %TASK_PBF%
  goto failed
)
if not exist "data_sources\a5\routes.json" (
  echo Missing data_sources\a5\routes.json from the A5 pilot.
  goto failed
)
.venv-pbf\Scripts\python.exe -c "import osmium, pyarrow, shapely, pyproj, numpy"
if errorlevel 1 (
  .venv-pbf\Scripts\python.exe -m pip install --no-cache-dir -r scripts\requirements-a5-full-review.txt
  if errorlevel 1 goto failed
)
.venv-pbf\Scripts\python.exe scripts\a5_full_entry_review.py --project "." --pbf "%TASK_PBF%" --output "%TASK_OUTPUT%"
if errorlevel 1 goto failed
echo.
echo Send: %TASK_OUTPUT%\33-a5-full-entry-review-results.zip
echo Priority list: %TASK_OUTPUT%\priority-review.csv
pause
exit /b 0
:failed
echo.
echo Processing stopped. Keep the output and checkpoints, and send the last log lines.
pause
exit /b 1
