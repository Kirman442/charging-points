@echo off
setlocal
cd /d "%~dp0"
set "A5_DATA=M:\projekte\Ladesaeulenregister\data"
set "A5_OUTPUT=%A5_DATA%\31_step_a5_entry_audit"
set "A5_TEMP=%A5_DATA%\31_step_python_temp"
if not exist "%A5_TEMP%" mkdir "%A5_TEMP%"
if not exist "%A5_TEMP%" goto :temp_error
set "TMP=%A5_TEMP%"
set "TEMP=%A5_TEMP%"
set "PYTHONPYCACHEPREFIX=%A5_TEMP%\pycache"
set "PYTHONIOENCODING=utf-8"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
if not exist ".venv-pbf\Scripts\python.exe" goto :python_error
if not exist "%A5_DATA%\germany-latest.osm.pbf" goto :pbf_error
echo Checking Python dependencies; temporary files stay on M:.
".venv-pbf\Scripts\python.exe" -m pip install --no-cache-dir -r scripts\requirements-entry-audit.txt
if errorlevel 1 goto :failed
".venv-pbf\Scripts\python.exe" -u scripts\a5_entry_audit.py --pbf "%A5_DATA%\germany-latest.osm.pbf" --output "%A5_OUTPUT%"
if errorlevel 1 goto :failed
echo.
echo DONE. Send this small ZIP:
echo %A5_OUTPUT%\a5-entry-audit-results.zip
pause
exit /b 0
:temp_error
echo Cannot create temporary directory on M:.
goto :failed
:python_error
echo Missing .venv-pbf\Scripts\python.exe. Run this CMD from the project folder after merging the archive.
goto :failed
:pbf_error
echo Missing %A5_DATA%\germany-latest.osm.pbf
goto :failed
:failed
echo.
echo FAILED. Existing source files and saved checkpoints are preserved.
pause
exit /b 1
