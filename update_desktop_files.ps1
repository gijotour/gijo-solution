$desktopPath = [Environment]::GetFolderPath("Desktop")
$distPath = "d:\Connect AI\gijo-security-erp-app\dist"

Write-Host "=== GIJO WIKI 바탕화면 배포 동기화 ===" -ForegroundColor Cyan

# 1. Copy Installer if exists
$installer = Get-ChildItem -LiteralPath $distPath -Filter "GIJO-WIKI-Setup*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($installer) {
    $targetName = "GIJO_WIKI_설치파일_v5.0.0.exe"
    $dest = Join-Path $desktopPath $targetName
    Copy-Item -LiteralPath $installer.FullName -Destination $dest -Force
    Write-Host "✅ 인스톨러 복사 완료: $dest" -ForegroundColor Green
} else {
    Write-Host "⚠️ 신규 인스톨러를 찾을 수 없습니다." -ForegroundColor Yellow
}

# 2. Copy Web App Link
$webApp = "d:\Connect AI\GIJO_Security_ERP_Suite.html"
$destWeb = Join-Path $desktopPath "GIJO_WIKI_실행.html"
Copy-Item -LiteralPath $webApp -Destination $destWeb -Force
Write-Host "✅ 웹 앱 복사 완료: $destWeb" -ForegroundColor Green

# 3. Copy Batch Launcher
$batFile = "d:\Connect AI\Launch_GIJO_WIKI.bat"
$destBat = Join-Path $desktopPath "GIJO_WIKI_실행.bat"
Copy-Item -LiteralPath $batFile -Destination $destBat -Force
Write-Host "✅ 런처 복사 완료: $destBat" -ForegroundColor Green
