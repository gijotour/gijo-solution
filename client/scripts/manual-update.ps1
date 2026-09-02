# client/scripts/manual-update.ps1
# GIJO AS 클라이언트를 GUI 없이 PowerShell로 수동 업데이트한다 — 서버(배포처)에 로그인해
# 최신 버전을 확인하고, 있으면 설치파일을 내려받아 실행한다(NSIS 빌드는 oneClick:false라
# **설치 마법사 창이 뜬다** — 조용히 깔리지 않는다. 마침을 누르면 앱이 자동으로 다시 켜진다).
#   ※ 「oneClick이라 조용히 설치된다」는 옛 설명이었다 — package.json의 nsis.oneClick은
#     false다(2026-09-02 바로잡음).
#
# ★ 이 스크립트는 **이 PC에 설치된 GIJO AS**를 갱신한다. 현재 버전도 설치 실물에서 읽는다
#   (클라 소스의 package.json이 아니다 — 2026-09-02, 여정 점검 F1-07).
#
# 사용:
#   .\scripts\manual-update.ps1 -User jyh -Password changeme
#   .\scripts\manual-update.ps1 -User jyh -Password changeme -ServerUrl http://10.8.0.1:4000
#   .\scripts\manual-update.ps1 -User jyh -Password changeme -Edition lite  # 프로·라이트가 같이 깔려 있으면 필수
#   .\scripts\manual-update.ps1 -User jyh -Password changeme -CheckOnly   # 확인만, 설치 안 함
#   .\scripts\manual-update.ps1 -User jyh -Password changeme -ForceLogin  # 이미 다른 곳(앱 등)에 로그인 중이면 필요
#     — 이 계정은 중복 로그인 방지가 걸려 있어(계정당 세션 1개), Electron 앱이 이미 로그인된
#       상태에서 이 스크립트를 돌리면 409(already_logged_in)가 난다. -ForceLogin으로 강제 전환하면
#       그 세션은 끊긴다(앱을 쓰던 사람이 있다면 미리 알릴 것).

param(
  [Parameter(Mandatory = $true)][string]$User,
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$ServerUrl = "http://localhost:4000",
  # 갱신할 에디션. 비우면 이 PC에 깔린 것을 보고 스스로 정한다(둘 다 깔려 있으면 지정해야 한다).
  # ⚠ 서버는 edition을 안 보내면 pro로 본다(clientrelease.ts) — 라이트 PC가 프로 설치본을 받는다.
  [string]$Edition = "",
  [switch]$CheckOnly,
  [switch]$ForceLogin
)

$ErrorActionPreference = "Stop"
$ServerUrl = $ServerUrl.TrimEnd("/")

# 설치된 버전은 package.json에서 읽는다(빌드된 앱이 실행 중이 아니어도 동작).
$pkgPath = Join-Path $PSScriptRoot "..\package.json"
$currentVersion = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
Write-Host "현재 버전: $currentVersion"

Write-Host "로그인 중... ($ServerUrl)"
$loginPayload = @{ username = $User; password = $Password }
if ($ForceLogin) { $loginPayload.force = $true }
$loginBody = $loginPayload | ConvertTo-Json
try {
  $login = Invoke-RestMethod -Uri "$ServerUrl/api/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
} catch {
  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) {
    throw "이미 다른 곳에 로그인돼 있습니다(중복 로그인 방지). -ForceLogin을 추가해 강제 전환하세요 — 단 그 세션은 끊깁니다."
  }
  throw "로그인 실패: $($_.Exception.Message)"
}
if (-not $login.accessToken) { throw "로그인 실패: 토큰을 받지 못했습니다." }
$headers = @{ Authorization = "Bearer $($login.accessToken)" }

Write-Host "최신 버전 확인 중..."
# ★ 에디션을 반드시 실어 보낸다(2026-09-02 F1-07) — 안 보내면 서버가 pro로 보고,
#   라이트 PC에 프로 설치본을 내려 준다(clientrelease.ts의 「옛 클라는 pro로 본다」 주석 참고).
$check = Invoke-RestMethod -Uri "$ServerUrl/api/client/latest-release?current=$currentVersion&edition=$Edition" -Headers $headers

if (-not $check.latest) {
  Write-Host "서버에 게시된 배포판이 없습니다."
  exit 0
}
Write-Host "서버 최신 버전: $($check.latest.version) (게시일 $($check.latest.publishedAt))"
if ($check.latest.notes) { Write-Host "릴리스 노트: $($check.latest.notes)" }

if (-not $check.updateAvailable) {
  Write-Host "이미 최신 버전입니다 — 업데이트가 필요 없습니다."
  exit 0
}

if ($CheckOnly) {
  Write-Host "-CheckOnly 지정됨 — 다운로드·설치는 하지 않습니다."
  exit 0
}

$destDir = Join-Path $env:TEMP "gijo-as-update"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir "GIJO-AS-Setup-$($check.latest.version).exe"

Write-Host "다운로드 중... ($([math]::Round($check.latest.size / 1MB, 1)) MB) -> $dest"
Invoke-WebRequest -Uri "$ServerUrl/api/client/download/$($check.latest.version)" -Headers $headers -OutFile $dest

# 무결성 확인(서버가 게시 시 계산해 둔 sha256과 대조).
$actualHash = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower()
if ($actualHash -ne $check.latest.sha256) {
  throw "다운로드 파일의 sha256이 서버 값과 다릅니다 — 손상됐을 수 있어 실행하지 않습니다.`n서버: $($check.latest.sha256)`n받은 파일: $actualHash"
}
Write-Host "sha256 확인 완료 — 무결성 정상."

Write-Host "설치 프로그램을 실행합니다. 실행 중인 GIJO AS는 지금 종료해 주세요(설치가 파일을 덮어씁니다)."
Start-Process -FilePath $dest
Write-Host "설치 마법사 창이 뜹니다 — 안내를 따라 진행해 주세요. 마침을 누르면 새 버전이 자동으로 실행됩니다."
