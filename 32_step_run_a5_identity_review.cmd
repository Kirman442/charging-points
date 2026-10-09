@echo off
setlocal
cd /d "%~dp0"
set "TASK_DATA=M:\projekte\Ladesaeulenregister\data"
set "TASK_PREVIOUS=%TASK_DATA%\31_step_a5_entry_audit"
set "TASK_OUTPUT=%TASK_DATA%\32_step_a5_identity_review"
set "TASK_TEMP=%TASK_DATA%\32_step_python_temp"
if not exist "%TASK_TEMP%" mkdir "%TASK_TEMP%"
if errorlevel 1 goto failed
set "TMP=%TASK_TEMP%"
set "TEMP=%TASK_TEMP%"
set "PYTHONPYCACHEPREFIX=%TASK_TEMP%\pycache"
if not exist ".venv-pbf\Scripts\python.exe" (
  echo Missing .venv-pbf\Scripts\python.exe in the project directory.
  goto failed
)
if not exist "%TASK_PREVIOUS%\audit.json" (
  echo Step 31 audit not found: %TASK_PREVIOUS%\audit.json
  echo Edit TASK_PREVIOUS in this launcher if your previous results are elsewhere.
  goto failed
)
if not exist "%TASK_PREVIOUS%\network\a5\access-network.json" (
  echo Saved local network not found. Keep the network folder from step 31.
  echo Do not run the PBF extraction again; locate the saved network first.
  goto failed
)
.venv-pbf\Scripts\python.exe -c "import pyarrow, shapely, pyproj"
if errorlevel 1 (
  .venv-pbf\Scripts\python.exe -m pip install --no-cache-dir -r scripts\requirements-a5-identity.txt
  if errorlevel 1 goto failed
)
.venv-pbf\Scripts\python.exe scripts\a5_identity_review.py --project "." --previous "%TASK_PREVIOUS%" --output "%TASK_OUTPUT%"
if errorlevel 1 goto failed
echo.
echo Open: %TASK_OUTPUT%\review.html
echo Send: %TASK_OUTPUT%\32-a5-identity-review-results.zip
pause
exit /b 0
:failed
echo.
echo Processing stopped. Source files were not modified.
pause
exit /b 1
