@echo off
REM Collaborator CLI - Windows
REM This script launches the Collaborator Electron app with optional CLI commands

setlocal enabledelayedexpansion

REM Get the directory of this script
set "SCRIPT_DIR=%~dp0"
set "ELECTRON_APP_DIR=%SCRIPT_DIR%"

REM Remove trailing backslash from SCRIPT_DIR
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM Go up one directory to get to the app root
for %%I in ("%SCRIPT_DIR%") do set "ELECTRON_APP_DIR=%%~dpI"

REM Check if running from installed location
if exist "%LOCALAPPDATA%\Programs\Collaborator\app\electron.exe" (
    set "ELECTRON_APP_DIR=%LOCALAPPDATA%\Programs\Collaborator\app"
)

REM Get the first argument (command)
set "COMMAND=%~1"

REM Default action: launch the app
if "%COMMAND%"=="" goto :launch_app
if /i "%COMMAND%"=="start" goto :launch_app
if /i "%COMMAND%"=="launch" goto :launch_app
if /i "%COMMAND%"=="--version" goto :show_version
if /i "%COMMAND%"=="-v" goto :show_version
if /i "%COMMAND%"=="--help" goto :show_help
if "%COMMAND:~0,1%"=="-" goto :pass_through

REM Check if command is a file path (launch with file)
if exist "%COMMAND%" goto :launch_app

REM Unknown command - show help
echo Collaborator CLI - Unknown command: %COMMAND%
echo Use 'collab --help' for usage information.
exit /b 1

:launch_app
REM Try to find electron or npm
where electron >nul 2>&1
if %errorlevel%==0 (
    electron "%ELECTRON_APP_DIR%" %*
    goto :end
)

where npm >nul 2>&1
if %errorlevel%==0 (
    pushd "%ELECTRON_APP_DIR%"
    call npm run dev %*
    popd
    goto :end
)

echo Error: Neither 'electron' nor 'npm' found in PATH
echo Please install Node.js and npm to run Collaborator
exit /b 1

:show_version
echo Collaborator CLI v0.3.1
goto :end

:show_help
echo Collaborator CLI
echo.
echo Usage: collab [command]
echo.
echo Commands:
echo   start, launch    Launch the Collaborator app ^(default^)
echo   --version, -v    Show version information
echo   --help, -h       Show this help message
echo.
echo If no command is specified, launches the app.
goto :end

:pass_through
REM Pass through arguments to Electron app
call :launch_app %*
goto :end

:end
endlocal
