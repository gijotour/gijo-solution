# Find all valid Desktop paths and create shortcut
$WshShell = New-Object -comObject WScript.Shell
$TargetFile = "D:\Connect AI\Launch_GIJO_Security_ERP.bat"

# Registry check for true User Shell Folders Desktop
$RegDesktop = (Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders").Desktop
$ExpandedRegDesktop = [System.Environment]::ExpandEnvironmentVariables($RegDesktop)

$candidatePaths = @(
    $ExpandedRegDesktop,
    [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop),
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\바탕 화면",
    "$env:USERPROFILE\OneDrive\Desktop",
    "$env:USERPROFILE\OneDrive\바탕 화면",
    "$env:USERPROFILE\OneDrive - Personal\Desktop",
    "$env:USERPROFILE\OneDrive - Personal\바탕 화면",
    "$env:PUBLIC\Desktop"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

Write-Host "Found Desktop Locations:" -ForegroundColor Cyan
$candidatePaths | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }

foreach ($dir in $candidatePaths) {
    try {
        $shortcutNames = @("GIJO_Security_ERP.lnk", "GIJO 보안 ERP 및 스마트스튜디오.lnk")
        foreach ($name in $shortcutNames) {
            $shortcutFile = Join-Path $dir $name
            $Shortcut = $WshShell.CreateShortcut($shortcutFile)
            $Shortcut.TargetPath = $TargetFile
            $Shortcut.WorkingDirectory = "D:\Connect AI"
            $Shortcut.Description = "GIJO TECHNOLOGY Security Solution ERP Suite v4.0"
            $Shortcut.WindowStyle = 7
            $Shortcut.Save()
            Write-Host "✅ Created: $shortcutFile" -ForegroundColor Green
        }
    } catch {
        Write-Host "⚠️ Failed for $dir : $_" -ForegroundColor Red
    }
}
