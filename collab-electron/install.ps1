#Requires -Version 5.1
<#
.SYNOPSIS
    Install Collaborator for Windows.

.DESCRIPTION
    Downloads the latest Collaborator release from GitHub and
    installs it to %LOCALAPPDATA%\Programs\Collaborator.

.EXAMPLE
    irm https://raw.githubusercontent.com/collaborator-ai/collab-public/main/collab-electron/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"

$repo = "collaborator-ai/collab-public"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Collaborator"

Write-Host "Fetching latest release..." -ForegroundColor Cyan

$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match "win.*x64.*\.exe$|Setup.*\.exe$" } | Select-Object -First 1

if (-not $asset) {
    # Fall back to zip if no installer
    $asset = $release.assets | Where-Object { $_.name -match "win.*x64.*\.zip$" } | Select-Object -First 1
}

if (-not $asset) {
    Write-Host "Error: Could not find a Windows x64 release asset." -ForegroundColor Red
    Write-Host "Available assets:" -ForegroundColor Yellow
    $release.assets | ForEach-Object { Write-Host "  - $($_.name)" }
    exit 1
}

$downloadUrl = $asset.browser_download_url
$fileName = $asset.name
$tempDir = Join-Path $env:TEMP "collaborator-install"
$tempFile = Join-Path $tempDir $fileName

Write-Host "Downloading $fileName..." -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing

if ($fileName -match "\.exe$") {
    Write-Host "Running installer..." -ForegroundColor Cyan
    Start-Process -FilePath $tempFile -Wait
} elseif ($fileName -match "\.zip$") {
    Write-Host "Extracting to $installDir..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Expand-Archive -Path $tempFile -DestinationPath $installDir -Force

    # Create desktop shortcut
    $exePath = Get-ChildItem -Path $installDir -Filter "Collaborator.exe" -Recurse | Select-Object -First 1
    if ($exePath) {
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $shortcutPath = Join-Path $desktopPath "Collaborator.lnk"
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath.FullName
        $shortcut.WorkingDirectory = $exePath.DirectoryName
        $shortcut.Save()
        Write-Host "Desktop shortcut created." -ForegroundColor Green
    }
}

# Cleanup
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Collaborator installed successfully!" -ForegroundColor Green
Write-Host "You can launch it from the Start Menu or Desktop." -ForegroundColor Cyan
