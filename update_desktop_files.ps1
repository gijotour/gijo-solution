$desktopPath = [Environment]::GetFolderPath("Desktop")

Copy-Item -LiteralPath "D:\Connect AI\Launch_GIJO_Security_ERP.bat" -Destination "$desktopPath\GIJO_Security_ERP_Launch.bat" -Force
Copy-Item -LiteralPath "D:\Connect AI\GIJO_Security_ERP_Suite.html" -Destination "$desktopPath\GIJO_Security_ERP_Suite.html" -Force

$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$desktopPath\GIJO_Security_ERP.lnk")
$Shortcut.TargetPath = "D:\Connect AI\Launch_GIJO_Security_ERP.bat"
$Shortcut.WorkingDirectory = "D:\Connect AI"
$Shortcut.Description = "GIJO TECHNOLOGY Security Solution ERP Suite v4.5"
$Shortcut.Save()

Write-Host "All Desktop files and shortcuts successfully updated!" -ForegroundColor Green


