# GIJO Security ERP Desktop Shortcut Creator (Robust Path Detection)
$WshShell = New-Object -comObject WScript.Shell

$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
if (-not (Test-Path $DesktopPath)) {
    # Check OneDrive Desktop
    $OneDriveDesktop = Join-Path $env:USERPROFILE "OneDrive\Desktop"
    if (Test-Path $OneDriveDesktop) {
        $DesktopPath = $OneDriveDesktop
    } else {
        $DesktopPath = $env:USERPROFILE + "\Desktop"
    }
}

if (-not (Test-Path $DesktopPath)) {
    New-Item -ItemType Directory -Path $DesktopPath -Force | Out-Null
}

$ShortcutPath = Join-Path $DesktopPath "GIJO_Security_ERP.lnk"
$TargetFile = Join-Path $PSScriptRoot "Launch_GIJO_Security_ERP.bat"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetFile
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "GIJO TECHNOLOGY Security Solution ERP Suite v4.0"
$Shortcut.WindowStyle = 7
$Shortcut.Save()

Write-Host "Desktop Shortcut successfully created at: $ShortcutPath" -ForegroundColor Green
