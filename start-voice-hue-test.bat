@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-test-web.ps1" -Mode Hue -Voice %*
set "TEST_EXIT=%errorlevel%"
if not "%TEST_EXIT%"=="0" (
  echo.
  echo Voice and Hue test environment did not start. Review the Korean message above.
  pause
)
exit /b %TEST_EXIT%
