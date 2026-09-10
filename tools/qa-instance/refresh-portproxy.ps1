# refresh-portproxy.ps1 — WSL로 가는 포워딩(4000 운영 · 4100 고객 QA)을 지금 WSL IP로 다시 맨다.
#
# ■ 왜 있나 (2026-09-10 검토관 [중])
#   계획서 §13.5.1이 「refresh-portproxy.ps1에 4100을 추가·예약」이라 적었는데 저장소에 그
#   파일이 **없었다.** 없는 절차에 항목을 얹으면, WSL IP가 바뀌는 재부팅 뒤에 4100 포워딩이
#   끊기고 — 사내가 매일 쓰는 4000과 달리 4100은 고객만 쓰므로 — **며칠 뒤에야** 드러난다.
#   그래서 실제로 도는 스크립트를 만들어 두고, 관리자 단계는 「이 파일을 작업 스케줄러에 등록」이 된다.
#
# ■ 쓰는 법 (관리자 PowerShell)
#   powershell -ExecutionPolicy Bypass -File "D:\Connect AI\tools\qa-instance\refresh-portproxy.ps1"
#   점검만:  … -File …\refresh-portproxy.ps1 -WhatIf
#
# ■ 작업 스케줄러 등록(관리자, 부팅 때마다)
#   $a = New-ScheduledTaskAction -Execute "powershell.exe" `
#        -Argument '-NonInteractive -ExecutionPolicy Bypass -File "D:\Connect AI\tools\qa-instance\refresh-portproxy.ps1"'
#   $t = New-ScheduledTaskTrigger -AtStartup
#   Register-ScheduledTask -TaskName "GIJO AS - portproxy 재설정" -Action $a -Trigger $t `
#        -User "SYSTEM" -RunLevel Highest -Description "재부팅으로 바뀐 WSL IP에 4000·4100 포워딩을 다시 맨다"
#   ⚠ WSL은 부팅 직후 안 떠 있을 수 있다 — 이 스크립트가 wsl을 한 번 깨우고 IP를 받는다.
#
# ⚠ 방화벽은 이 스크립트가 만지지 않는다(README 「방화벽 겹침」 결정이 먼저다).

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Distro = "Ubuntu-24.04",
  [string]$ListenAddress = "10.8.0.1",
  [int[]]$Ports = @(4000, 4100)
)

$ErrorActionPreference = "Stop"

# 관리자인지 — netsh portproxy는 승격이 필요하다.
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "관리자 PowerShell에서 실행하세요 (netsh portproxy는 승격이 필요합니다)."
  exit 2
}

# WSL IP — 여러 개가 나오면 첫 IPv4를 쓴다.
$raw = (& wsl.exe -d $Distro -- hostname -I) -join " "
$wslIp = ($raw -split "\s+" | Where-Object { $_ -match "^\d+\.\d+\.\d+\.\d+$" } | Select-Object -First 1)
if (-not $wslIp) {
  Write-Error "WSL IP를 못 읽었습니다 (배포판: $Distro). WSL이 떠 있는지 확인하세요."
  exit 3
}
Write-Host "· WSL IP: $wslIp"

foreach ($p in $Ports) {
  $cur = (& netsh interface portproxy show v4tov4) -join "`n"
  $already = $cur -match ("(?m)^\s*" + [regex]::Escape($ListenAddress) + "\s+" + $p + "\s+" + [regex]::Escape($wslIp) + "\s+" + $p + "\s*$")
  if ($already) {
    Write-Host "  ✓ $ListenAddress`:$p → $wslIp`:$p (이미 맞음)"
    continue
  }
  if ($PSCmdlet.ShouldProcess("$ListenAddress`:$p", "portproxy를 $wslIp`:$p 로 다시 맴")) {
    & netsh interface portproxy delete v4tov4 listenaddress=$ListenAddress listenport=$p | Out-Null
    & netsh interface portproxy add v4tov4 listenaddress=$ListenAddress listenport=$p connectaddress=$wslIp connectport=$p
    Write-Host "  ↻ $ListenAddress`:$p → $wslIp`:$p 다시 맴"
  }
}

Write-Host ""
Write-Host "── 지금 포워딩 ──"
& netsh interface portproxy show v4tov4

Write-Host ""
Write-Host "── 방화벽(읽기만) ──"
Get-NetFirewallRule -Enabled True -Direction Inbound |
  Where-Object { $_.DisplayName -like "*GIJO*" } |
  ForEach-Object {
    $pf = $_ | Get-NetFirewallPortFilter
    $af = $_ | Get-NetFirewallAddressFilter
    if ($pf.LocalPort -ne "Any") {
      "  {0} | 포트 {1} | 원격 {2}" -f $_.DisplayName, ($pf.LocalPort -join ","), ($af.RemoteAddress -join ",")
    }
  }
Write-Host "  ⚠ 4000과 4100의 원격 대역이 같으면 고객 피어가 운영 4000에도 닿습니다 — README 「방화벽 겹침」 참고."
