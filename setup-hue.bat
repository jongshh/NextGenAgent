@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-hue.ps1" %*
set "SETUP_EXIT=%errorlevel%"
if not "%SETUP_EXIT%"=="0" (
  echo.
  echo Setup did not complete. Review the message above.
  pause
)
exit /b %SETUP_EXIT%
