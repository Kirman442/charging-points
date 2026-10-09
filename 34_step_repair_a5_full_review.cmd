@echo off
setlocal
cd /d "%~dp0"
set "TASK_DATA=M:\projekte\Ladesaeulenregister\data"
set "TASK_TEMP=%TASK_DATA%\34_step_python_temp"
if not exist "%TASK_TEMP%" mkdir "%TASK_TEMP%"
if errorlevel 1 goto failed
set "TMP=%TASK_TEMP%"
set "TEMP=%TASK_TEMP%"
set "PYTHONPYCACHEPREFIX=%TASK_TEMP%\pycache"
.venv-pbf\Scripts\python.exe scripts\repair_a5_full_review.py --project "." --previous "%TASK_DATA%\33_step_a5_full_entry_review" --output "%TASK_DATA%\34_step_a5_full_entry_review"
if errorlevel 1 goto failed
echo Send: %TASK_DATA%\34_step_a5_full_entry_review\34-a5-full-entry-review-results.zip
pause
exit /b 0
:failed
echo Repair stopped. Keep the step 33 network and results.
pause
exit /b 1
