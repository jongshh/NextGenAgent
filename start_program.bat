@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_program.ps1" %*
set "TEST_EXIT=%errorlevel%"
if not "%TEST_EXIT%"=="0" (
  echo.
  echo Voice and Hue test environment did not start. Review the Korean message above.
  pause
)
exit /b %TEST_EXIT%
