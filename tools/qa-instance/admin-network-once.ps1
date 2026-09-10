# admin-network-once.ps1 — 고객 QA 인스턴스(4100) 네트워크 개통을 **관리자 PowerShell 한 번**으로 끝낸다.
#
# ■ 무엇을 하나 (2026-09-10 사장님 「방화벽 직접 설정하고 추천 진행」)
#   ① 방화벽 겹침 해소(README 관리자 단계 ① ⓐ안):
#      · 운영 4000 규칙 「GIJO AS - 서버(VPN 전용)」의 RemoteAddress를 10.8.0.0/24 전체에서
#        **우리 피어만**(담당자1 .2 · 담당자2 .3 · 예비 .4 · mac .11 · gb10 .12)으로 좁힌다.
#        ⚠ 지금 그대로 두면 고객 피어(ext-tester1~6 = 10.8.0.5~10)가 운영 4000(사내 실데이터)에 닿는다 —
#          형태 ⓑ「운영은 고객에게 안 보인다」의 전제가 방화벽 한 줄에서 무너진다(검토관 [상]).
#      · 고객 QA 4100 규칙을 새로 만든다 — 고객 피어 .5~.10 + 관찰용 우리 피어(.2 .3 .4 .11).
#        ⚠ RemoteAddress를 비우면 인터넷에 열린다(이 PC는 공인 IP 직결). 반드시 목록으로만.
#   ② 포트 포워딩 4000·4100을 지금 WSL IP로 다시 맨다(refresh-portproxy.ps1).
#   ③ 재부팅 때마다 ②가 다시 돌도록 작업 스케줄러에 등록한다(SYSTEM · RunLevel Highest · AtStartup).
#   ④ 결과를 그대로 찍어 눈으로 확인하게 한다(규칙 2개의 포트·원격 주소, portproxy 표, 예약 작업).
#
# ■ 쓰는 법 — 관리자 PowerShell(우클릭 → 관리자 권한으로 실행)에서:
#   powershell -ExecutionPolicy Bypass -File "D:\Connect AI\tools\qa-instance\admin-network-once.ps1"
#   점검만(아무것도 안 바꿈):  … -File …\admin-network-once.ps1 -WhatIf
#
# ■ 되돌리기
#   4000 규칙 원복:  Set-NetFirewallRule -DisplayName "GIJO AS - 서버(VPN 전용)" -RemoteAddress 10.8.0.0/24
#   4100 규칙 제거:  Remove-NetFirewallRule -DisplayName "GIJO AS - 고객 QA(4100·VPN 전용)"
#   포워딩 제거:     netsh interface portproxy delete v4tov4 listenport=4100 listenaddress=10.8.0.1
#   예약 제거:       Unregister-ScheduledTask -TaskName "GIJO AS - portproxy 재설정" -Confirm:$false
#
# ⚠ 피어 주소의 단일 출처는 D:\GIJO-AS-vpn\wg0-server.conf 의 [Peer] AllowedIPs 다(2026-09-10 실측:
#   .2 담당자1 · .3 담당자2 · .4 예비 · .5~.10 ext-tester1~6(고객) · .11 mac · .12 gb10).
#   피어를 더하거나 고객 대역을 바꾸면 아래 두 목록도 함께 고친다.

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]]$OurPeers = @("10.8.0.2", "10.8.0.3", "10.8.0.4", "10.8.0.11", "10.8.0.12"),
  [string[]]$CustomerPeers = @("10.8.0.5", "10.8.0.6", "10.8.0.7", "10.8.0.8", "10.8.0.9", "10.8.0.10"),
  [string[]]$ObserverPeers = @("10.8.0.2", "10.8.0.3", "10.8.0.4", "10.8.0.11"),
  [string]$ProdRuleName = "GIJO AS - 서버(VPN 전용)",
  [string]$QaRuleName = "GIJO AS - 고객 QA(4100·VPN 전용)",
  [string]$TaskName = "GIJO AS - portproxy 재설정"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "관리자 PowerShell에서 실행하세요 (방화벽·portproxy·작업 스케줄러 전부 승격이 필요합니다)."
  exit 2
}

# ── ① 방화벽 ─────────────────────────────────────────────────────────────
$prod = Get-NetFirewallRule -DisplayName $ProdRuleName -ErrorAction SilentlyContinue
if (-not $prod) {
  Write-Error "운영 4000 규칙 「$ProdRuleName」이 없습니다 — 이름이 바뀌었는지 Get-NetFirewallRule -DisplayName 'GIJO AS*' 로 확인하세요. 아무것도 바꾸지 않았습니다."
  exit 3
}
if ($PSCmdlet.ShouldProcess($ProdRuleName, "RemoteAddress를 우리 피어 5개로 좁힘")) {
  Set-NetFirewallRule -DisplayName $ProdRuleName -RemoteAddress $OurPeers
  Write-Host "① 운영 4000 규칙 좁힘: $($OurPeers -join ', ')"
}

$qaRemote = @($CustomerPeers + $ObserverPeers | Select-Object -Unique)
$qa = Get-NetFirewallRule -DisplayName $QaRuleName -ErrorAction SilentlyContinue
if ($qa) {
  if ($PSCmdlet.ShouldProcess($QaRuleName, "이미 있음 — RemoteAddress만 갱신")) {
    Set-NetFirewallRule -DisplayName $QaRuleName -RemoteAddress $qaRemote
    Write-Host "① 고객 QA 4100 규칙 갱신: $($qaRemote -join ', ')"
  }
} else {
  if ($PSCmdlet.ShouldProcess($QaRuleName, "TCP 4100 인바운드 허용(고객+관찰 피어만)")) {
    New-NetFirewallRule -DisplayName $QaRuleName -Direction Inbound -Protocol TCP -LocalPort 4100 `
      -RemoteAddress $qaRemote -Action Allow -Profile Any | Out-Null
    Write-Host "① 고객 QA 4100 규칙 생성: $($qaRemote -join ', ')"
  }
}

# ── ② 포워딩 4000·4100 ───────────────────────────────────────────────────
$refresh = Join-Path $here "refresh-portproxy.ps1"
if (-not (Test-Path $refresh)) { Write-Error "refresh-portproxy.ps1 이 옆에 없습니다: $refresh"; exit 4 }
if ($PSCmdlet.ShouldProcess("portproxy 4000·4100", "지금 WSL IP로 다시 맴")) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $refresh
  if ($LASTEXITCODE -ne 0) { Write-Error "refresh-portproxy.ps1 종료코드 $LASTEXITCODE — 포워딩이 안 맺혔습니다."; exit 5 }
}

# ── ③ 재부팅마다 ② ──────────────────────────────────────────────────────
if ($PSCmdlet.ShouldProcess($TaskName, "작업 스케줄러 등록(SYSTEM · AtStartup)")) {
  $a = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NonInteractive -ExecutionPolicy Bypass -File "' + $refresh + '"')
  $t = New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -User "SYSTEM" -RunLevel Highest `
    -Description "재부팅으로 바뀐 WSL IP에 4000·4100 포워딩을 다시 맨다" -Force | Out-Null
  Write-Host "③ 예약 등록: $TaskName"
}

# ── ④ 눈으로 확인 ───────────────────────────────────────────────────────
Write-Host "`n=== 방화벽 ==="
foreach ($n in @($ProdRuleName, $QaRuleName)) {
  $r = Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue
  if (-not $r) { Write-Host "$n : 없음"; continue }
  $pf = $r | Get-NetFirewallPortFilter; $af = $r | Get-NetFirewallAddressFilter
  Write-Host ("{0} | 포트 {1} | 원격 {2} | {3}" -f $n, ($pf.LocalPort -join ','), ($af.RemoteAddress -join ','), $r.Action)
}
Write-Host "`n=== portproxy ==="
netsh interface portproxy show v4tov4
Write-Host "`n=== 예약 작업 ==="
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "`n다음: WSL에서 sudo 로 gijo-qa.service 등록(README 관리자 단계 ③) → 고객 conf로 10.8.0.1:4100 접속 확인"
