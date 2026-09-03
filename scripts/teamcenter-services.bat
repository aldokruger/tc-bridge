@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Teamcenter service controller for Windows.
rem Run from an elevated Command Prompt or PowerShell.
rem Usage: teamcenter-services.bat status ^| stop ^| start ^| restart

set "WEBTIER_SERVICE=Teamcenter WebTier"
set "PROCESS_MANAGER_SERVICE=Teamcenter Process Manager"

rem Optional: add service names separated by semicolons, for example:
rem set "TC_EXTRA_SERVICES=Teamcenter FTS Indexer;My Teamcenter Extension"
if not defined TC_EXTRA_SERVICES set "TC_EXTRA_SERVICES="

if "%~1"=="" goto :usage
set "ACTION=%~1"

if /I "%ACTION%"=="status" goto :status
if /I "%ACTION%"=="stop" goto :stop
if /I "%ACTION%"=="start" goto :start
if /I "%ACTION%"=="restart" goto :restart
goto :usage

:restart
call :requireAdmin || exit /b 1
call :stop
if errorlevel 1 exit /b 1
call :start
exit /b %errorlevel%

:stop
call :requireAdmin || exit /b 1
echo.
echo Stopping Teamcenter services...
call :stopService "%WEBTIER_SERVICE%"
call :forOtherTeamcenterServices stop
call :forServerManagers stop
call :forExtraServices stop
call :stopService "%PROCESS_MANAGER_SERVICE%"
echo.
call :status
exit /b 0

:start
call :requireAdmin || exit /b 1
echo.
echo Starting Teamcenter services...
call :startService "%PROCESS_MANAGER_SERVICE%"
call :forServerManagers start
call :forOtherTeamcenterServices start
call :forExtraServices start
call :startService "%WEBTIER_SERVICE%"
echo.
call :status
exit /b 0

:status
echo.
echo === Managed Teamcenter services ===
call :showService "%PROCESS_MANAGER_SERVICE%"
call :forServerManagers status
call :forOtherTeamcenterServices status
call :forExtraServices status
call :showService "%WEBTIER_SERVICE%"
exit /b 0

:forServerManagers
for /f "tokens=2 delims==" %%S in ('wmic.exe service where "Name like 'Teamcenter Server Manager%%'" get Name /value') do (
  call :applyAction "%~1" "%%S"
)
exit /b 0

:forOtherTeamcenterServices
rem Includes Teamcenter Global Search Indexing Service (the Active Workspace indexer),
rem FSC, Dispatcher, VisServlet, Action Manager and the remaining Teamcenter services.
rem The WebTier, Process Manager and Server Manager pools are handled separately for ordering.
for /f "tokens=2 delims==" %%S in ('wmic.exe service where "(Name like '%%Teamcenter%%' or DisplayName like '%%Teamcenter%%') and Name ^<^> 'Teamcenter WebTier' and Name ^<^> 'Teamcenter Process Manager' and Name not like 'Teamcenter Server Manager%%'" get Name /value') do (
  call :applyAction "%~1" "%%S"
)
exit /b 0

:forExtraServices
if "%TC_EXTRA_SERVICES%"=="" exit /b 0
set "EXTRA_REMAINING=%TC_EXTRA_SERVICES%"
:nextExtraService
for /f "tokens=1,* delims=;" %%A in ("%EXTRA_REMAINING%") do (
  call :applyAction "%~1" "%%~A"
  set "EXTRA_REMAINING=%%~B"
)
if defined EXTRA_REMAINING goto :nextExtraService
exit /b 0

:applyAction
if /I "%~1"=="status" (
  call :showService "%~2"
) else (
  call :%~1Service "%~2"
)
exit /b %errorlevel%

:stopService
call :serviceExists "%~1" || (
  echo [SKIP] "%~1" not installed.
  exit /b 0
)
sc.exe query "%~1" | findstr /I /C:"STOPPED" >nul
if not errorlevel 1 (
  echo [OK] "%~1" is already stopped.
  exit /b 0
)
echo [STOP] "%~1"
sc.exe stop "%~1" >nul
call :waitForState "%~1" STOPPED 60
exit /b %errorlevel%

:startService
call :serviceExists "%~1" || (
  echo [SKIP] "%~1" not installed.
  exit /b 0
)
sc.exe query "%~1" | findstr /I /C:"RUNNING" >nul
if not errorlevel 1 (
  echo [OK] "%~1" is already running.
  exit /b 0
)
echo [START] "%~1"
sc.exe start "%~1" >nul
call :waitForState "%~1" RUNNING 90
exit /b %errorlevel%

:showService
call :serviceExists "%~1" || (
  echo [SKIP] "%~1" not installed.
  exit /b 0
)
for /f "tokens=3,4" %%A in ('sc.exe query "%~1" ^| findstr /R /C:"STATE"') do echo [STATE] "%~1" %%B
exit /b 0

:waitForState
set "WAIT_SERVICE=%~1"
set "WAIT_STATE=%~2"
set /a "WAIT_SECONDS=%~3"
:waitLoop
sc.exe query "%WAIT_SERVICE%" | findstr /I /C:"%WAIT_STATE%" >nul
if not errorlevel 1 (
  echo [OK] "%WAIT_SERVICE%" is %WAIT_STATE%.
  exit /b 0
)
set /a WAIT_SECONDS-=1
if !WAIT_SECONDS! LEQ 0 (
  echo [ERROR] Timeout waiting for "%WAIT_SERVICE%" to become %WAIT_STATE%.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto :waitLoop

:serviceExists
sc.exe query "%~1" >nul 2>nul
exit /b %errorlevel%

:requireAdmin
fltmc.exe >nul 2>nul
if not errorlevel 1 exit /b 0
echo [ERROR] Run this script from an elevated Command Prompt or PowerShell.
exit /b 1

:usage
echo Usage: %~nx0 status ^| stop ^| start ^| restart
echo.
echo Optional environment variable:
echo   TC_EXTRA_SERVICES=Service Name 1;Service Name 2
exit /b 2
