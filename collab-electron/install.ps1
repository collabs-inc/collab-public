#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Collaborator Electron App - Windows Installation Script

.DESCRIPTION
    Downloads and installs Collaborator desktop application on Windows.
    Supports both x64 and ARM64 architectures.
    Includes SHA256 hash verification for security.

.PARAMETER Version
    Specific version to install (e.g., "0.3.1"). Defaults to latest release.

.PARAMETER Architecture
    Target architecture: "x64", "arm64", or "auto" (default: auto).

.PARAMETER InstallDir
    Custom installation directory. Defaults to Program Files.

.PARAMETER SkipShortcuts
    Skip creating desktop and start menu shortcuts.

.PARAMETER AddToPath
    Add Collaborator to system PATH (for CLI access).

.PARAMETER ExpectedHash
    Expected SHA256 hash for installer verification. If not provided, uses known hash for version.

.PARAMETER SkipHashVerification
    Skip SHA256 hash verification (not recommended for production).

.EXAMPLE
    .\install.ps1
    Install the latest version with default settings.

.EXAMPLE
    .\install.ps1 -Version "0.3.1" -Architecture "x64"
    Install a specific version for x64 architecture.

.EXAMPLE
    .\install.ps1 -AddToPath
    Install and add to system PATH for CLI access.
#>

# ============================================================================
# TLS 1.2 Enforcement (P2 Fix)
# Must be set before any web requests
# ============================================================================
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Version = "latest",

    [Parameter(Mandatory = $false)]
    [ValidateSet("x64", "arm64", "auto")]
    [string]$Architecture = "auto",

    [Parameter(Mandatory = $false)]
    [string]$InstallDir = "",

    [Parameter(Mandatory = $false)]
    [switch]$SkipShortcuts,

    [Parameter(Mandatory = $false)]
    [switch]$AddToPath,

    [Parameter(Mandatory = $false)]
    [string]$ExpectedHash,

    [Parameter(Mandatory = $false)]
    [switch]$SkipHashVerification
)

# Configuration
$RepoOwner = "collaborator-ai"
$RepoName = "collab-public"
$AppName = "Collaborator"
$AppExecutable = "Collaborator.exe"

# Colors for output
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-Warning { Write-Host "[WARNING] $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "[ERROR] $args" -ForegroundColor Red }

# ============================================================================
# SHA256 Hash Verification (P1 Fix - Critical Security)
# ============================================================================

# Known SHA256 hashes for verified releases (update with actual hashes when releasing)
$KnownHashes = @{
    "0.3.1" = @{
        "x64" = ""  # Populate with actual hash: (Get-FileHash installer.exe -Algorithm SHA256).Hash
        "arm64" = ""
    }
    # Add more versions as needed
}

function Get-FileHash256 {
    param([string]$FilePath)

    try {
        $hash = Get-FileHash -Path $FilePath -Algorithm SHA256
        return $hash.Hash.ToLower()
    } catch {
        throw "Failed to compute SHA256 hash: $_"
    }
}

function Test-InstallerHash {
    param(
        [string]$FilePath,
        [string]$ExpectedHash,
        [string]$Version,
        [string]$Architecture
    )

    if ($SkipHashVerification) {
        Write-Warning "Hash verification skipped (not recommended for production)"
        return $true
    }

    Write-Info "Verifying installer integrity (SHA256)..."

    # Use provided hash or look up known hash
    if ([string]::IsNullOrEmpty($ExpectedHash)) {
        if ($KnownHashes.ContainsKey($Version) -and
            $KnownHashes[$Version].ContainsKey($Architecture) -and
            $KnownHashes[$Version][$Architecture]) {
            $ExpectedHash = $KnownHashes[$Version][$Architecture]
            Write-Info "Using known hash for version $Version ($Architecture)"
        } else {
            Write-Warning "No known hash found for version $Version ($Architecture). Skipping verification."
            Write-Warning "For production, provide -ExpectedHash parameter or update KnownHashes table."
            return $true
        }
    }

    try {
        $actualHash = Get-FileHash256 -FilePath $FilePath
        Write-Info "Expected hash: $ExpectedHash"
        Write-Info "Actual hash:   $actualHash"

        if ($actualHash -eq $ExpectedHash.ToLower()) {
            Write-Success "Hash verification passed - installer integrity confirmed"
            return $true
        } else {
            Write-Error "HASH VERIFICATION FAILED!"
            Write-Error "The installer may have been tampered with or corrupted."
            Write-Error "Expected: $ExpectedHash"
            Write-Error "Got:      $actualHash"
            return $false
        }
    } catch {
        Write-Error "Hash verification failed: $_"
        return $false
    }
}

# Get system architecture
function Get-SystemArchitecture {
    $arch = $env:PROCESSOR_ARCHITECTURE.ToLower()
    if ($arch -eq "amd64") {
        return "x64"
    } elseif ($arch -eq "arm64" -or $arch -eq "aarch64") {
        return "arm64"
    }
    return "x64"  # Default fallback
}

# Get latest release from GitHub API
function Get-LatestRelease {
    Write-Info "Fetching latest release information..."
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases" -UseBasicParsing
        if ($releases -and $releases.Count -gt 0) {
            # Filter for releases with Windows assets
            foreach ($release in $releases) {
                if ($release.assets.name -like "*-win-*.exe") {
                    return $release
                }
            }
        }
        throw "No Windows release found"
    } catch {
        Write-Error "Failed to fetch releases: $_"
        exit 1
    }
}

# Get specific release from GitHub API
function Get-ReleaseByTag {
    param([string]$Tag)
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/v$Tag" -UseBasicParsing
        return $release
    } catch {
        # Try without 'v' prefix
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/$Tag" -UseBasicParsing
        return $release
    }
}

# Download file with progress
function Download-File {
    param(
        [string]$Url,
        [string]$OutputPath
    )

    Write-Info "Downloading from: $Url"

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
        $ProgressPreference = 'Continue'
        Write-Success "Download completed: $(Get-Item $OutputPath).Length bytes"
    } catch {
        $ProgressPreference = 'Continue'
        Write-Error "Download failed: $_"
        exit 1
    }
}

# Create shortcuts
function Create-Shortcuts {
    param(
        [string]$TargetPath,
        [string]$ShortcutDir
    )

    if ($SkipShortcuts) {
        Write-Info "Skipping shortcut creation"
        return
    }

    Write-Info "Creating shortcuts..."

    # Desktop shortcut
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $desktopShortcut = Join-Path $desktopPath "$AppName.lnk"

    $WScriptObj = New-Object -ComObject WScript.Shell
    $shortcut = $WScriptObj.CreateShortcut($desktopShortcut)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $ShortcutDir
    $shortcut.Description = "$AppName Desktop Application"
    $shortcut.Save()
    Write-Info "Created desktop shortcut: $desktopShortcut"

    # Start Menu shortcut
    $startMenuPath = [Environment]::GetFolderPath("StartMenu")
    $startMenuShortcut = Join-Path $startMenuPath "$AppName.lnk"

    $shortcut = $WScriptObj.CreateShortcut($startMenuShortcut)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $ShortcutDir
    $shortcut.Description = "$AppName Start Menu"
    $shortcut.Save()
    Write-Info "Created Start Menu shortcut: $startMenuShortcut"
}

# Add to PATH
function Add-ToPath {
    param([string]$PathToAdd)

    if (-not $AddToPath) {
        return
    }

    Write-Info "Adding to system PATH..."

    try {
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")

        if ($currentPath -notlike "*$PathToAdd*") {
            $newPath = "$PathToAdd;$currentPath"
            [Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
            Write-Success "Added to system PATH"

            # Notify user about PATH update
            Write-Info "PATH updated. You may need to restart your terminal to use CLI commands."
        } else {
            Write-Info "Path already exists in PATH"
        }
    } catch {
        Write-Warning "Failed to add to PATH: $_"
    }
}

# Main installation function
function Install-Collaborator {
    Write-Info "========================================"
    Write-Info "  $AppName Installation Script"
    Write-Info "========================================"
    Write-Host ""

    # Determine architecture
    if ($Architecture -eq "auto") {
        $targetArch = Get-SystemArchitecture
        Write-Info "Detected architecture: $targetArch"
    } else {
        $targetArch = $Architecture
    }

    # Get release information
    if ($Version -eq "latest") {
        $release = Get-LatestRelease
        $Version = $release.tag_name.TrimStart('v')
    } else {
        $release = Get-ReleaseByTag -Tag $Version
    }

    Write-Info "Installing version: $Version"
    Write-Info "Target architecture: $targetArch"

    # Find appropriate installer
    $installerAsset = $null
    $searchPattern = "*-$Version-win-$targetArch-setup.exe"
    $altPattern = "*-win-$targetArch*-setup.exe"

    foreach ($asset in $release.assets) {
        if ($asset.name -like $searchPattern -or $asset.name -like $altPattern) {
            $installerAsset = $asset
            break
        }
    }

    if (-not $installerAsset) {
        # Fallback: try any Windows installer
        foreach ($asset in $release.assets) {
            if ($asset.name -like "*-win-*.exe" -and $asset.name -like "*setup*") {
                $installerAsset = $asset
                Write-Warning "Using fallback installer: $($asset.name)"
                break
            }
        }
    }

    if (-not $installerAsset) {
        Write-Error "No Windows installer found for version $Version"
        Write-Info "Available assets:"
        $release.assets | ForEach-Object { Write-Host "  - $($_.name)" }
        exit 1
    }

    Write-Info "Found installer: $($installerAsset.name)"

    # Create temporary directory with GUID for uniqueness (P3 Fix)
    $uniqueId = [System.Guid]::NewGuid().ToString("N")
    $tempDir = Join-Path $env:TEMP "collaborator-install-$uniqueId"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $installerPath = Join-Path $tempDir "Collaborator-Setup.exe"

    try {
        # Download installer
        Download-File -Url $installerAsset.browser_download_url -OutputPath $installerPath

        # P1 Fix: Verify SHA256 hash
        if (!(Test-InstallerHash -FilePath $installerPath -ExpectedHash $ExpectedHash -Version $Version -Architecture $targetArch)) {
            throw "Installer hash verification failed. Aborting installation."
        }

        # Determine installation directory
        if ($InstallDir -eq "") {
            $InstallDir = "$env:ProgramFiles\$AppName"
        }

        Write-Info "Installation directory: $InstallDir"

        # Create installation directory
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        }

        # Run installer silently
        Write-Info "Running installer..."
        $installProcess = Start-Process -FilePath $installerPath -ArgumentList "/SILENT", "/DIR=$InstallDir", "/NORESTART" -Wait -PassThru

        if ($installProcess.ExitCode -ne 0) {
            throw "Installer exited with code $($installProcess.ExitCode)"
        }

        # Verify installation
        $exePath = Join-Path $InstallDir $AppExecutable
        if (Test-Path $exePath) {
            Write-Success "$AppName installed successfully!"
            Write-Info "Executable: $exePath"

            # Create shortcuts
            Create-Shortcuts -TargetPath $exePath -ShortcutDir $InstallDir

            # Add to PATH
            Add-ToPath -PathToAdd $InstallDir

            Write-Host ""
            Write-Success "========================================"
            Write-Success "  Installation Complete!"
            Write-Success "========================================"
            Write-Host ""
            Write-Info "You can now launch $AppName from:"
            Write-Info "  - Desktop shortcut"
            Write-Info "  - Start Menu"
            Write-Info "  - Command line: '$AppName'"

        } else {
            Write-Warning "Installation may have failed. Executable not found at: $exePath"
        }

    } catch {
        Write-Error "Installation failed: $_"
        Write-Error "Exception Type: $($_.Exception.GetType().FullName)"
        Write-Error "Stack Trace: $($_.ScriptStackTrace)"
        if ($_.Exception.InnerException) {
            Write-Error "Inner Exception: $($_.Exception.InnerException.Message)"
        }
        throw
    } finally {
        # Cleanup
        if (Test-Path $installerPath) {
            Remove-Item -Force $installerPath
        }
        if (Test-Path $tempDir) {
            Remove-Item -Force -Recurse $tempDir
        }
    }
}

# Run installation
try {
    Install-Collaborator
} catch {
    Write-Error "Installation script failed: $_"
    Write-Error "Exception Type: $($_.Exception.GetType().FullName)"
    Write-Error "Stack Trace: $($_.ScriptStackTrace)"
    if ($_.Exception.InnerException) {
        Write-Error "Inner Exception: $($_.Exception.InnerException.Message)"
    }
    exit 1
}
