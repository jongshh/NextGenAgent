@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_program.ps1" -Mode Web %*
set "TEST_EXIT=%errorlevel%"
if not "%TEST_EXIT%"=="0" (
  echo.
  echo Test environment did not start. Review the message above.
  pause
)
exit /b %TEST_EXIT%
