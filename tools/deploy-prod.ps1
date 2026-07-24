# tools/deploy-prod.ps1 — 운영(WSL) 원클릭 배포. Mac에서 SSH로 원격 실행하는 용도.
#   ssh user@10.8.0.1 "powershell -NoProfile -ExecutionPolicy Bypass -File 'd:/Connect AI/tools/deploy-prod.ps1'"
#
# 절차: hub pull(ff-only) → 서버 테스트 전체(실패 시 배포 중단) → WSL 동기화+빌드 → kill 재시작
#       (systemd Restart=always가 되살림) → health 확인. 어느 단계든 실패하면 즉시 중단한다.
# 주의: 서버만 배포한다. 클라이언트(.exe) 게시는 별도(npm run dist + publish-release, Windows에서).
#       의존성(package.json) 변경이 있으면 WSL에서 npm ci를 수동으로 한 번 돌려야 한다(아래 경고 출력).

$ErrorActionPreference = "Stop"
$repo = "D:\Connect AI"
$distro = "Ubuntu-24.04"
$wslServer = "/home/gijo/gijo-as/server"

function Step($name) { Write-Output ""; Write-Output "━━ $name ━━" }

Step "1/5 hub에서 최신 코드 pull (fast-forward만)"
Set-Location $repo
git fetch hub
$before = git rev-parse HEAD
git merge --ff-only hub/main
if ($LASTEXITCODE -ne 0) { throw "ff-only merge 실패 — 로컬에 hub와 갈라진 커밋이 있음. 수동 확인 필요." }
$after = git rev-parse HEAD
Write-Output "HEAD: $($before.Substring(0,7)) → $($after.Substring(0,7))"
if ($before -eq $after) { Write-Output "(새 커밋 없음 — 현재 상태 그대로 배포 절차 계속)" }

# 의존성 변경 감지 — 있으면 경고(자동 npm ci는 위험해서 안 함)
$depsChanged = git diff --name-only $before $after -- server/package.json server/package-lock.json
if ($depsChanged) { Write-Warning "server 의존성 변경 감지! 배포 후 WSL에서 'npm ci' 필요: $depsChanged" }

Step "2/5 서버 테스트 (실패 시 배포 중단)"
Set-Location "$repo\server"
npm test 2>&1 | Select-Object -Last 6
if ($LASTEXITCODE -ne 0) { throw "테스트 실패 — 배포 중단" }

Step "3/5 WSL 운영 서버로 소스 동기화 + 빌드"
wsl -d $distro -- bash -c "rsync -a --delete '/mnt/d/Connect AI/server/src/' '$wslServer/src/' && cd '$wslServer' && npx tsc -p tsconfig.json && echo BUILD_OK"
if ($LASTEXITCODE -ne 0) { throw "WSL 동기화/빌드 실패 — 배포 중단 (운영은 아직 이전 코드로 구동 중)" }

Step "4/5 운영 프로세스 재시작 (systemd Restart=always)"
wsl -d $distro -- bash -c "pid=`$(ps -eo pid,cmd | grep 'dist/index.js' | grep -v grep | awk '{print `$1}' | head -1); if [ -n \"`$pid\" ]; then kill `$pid; echo killed `$pid; else echo 'no running pid (systemd가 새로 띄움)'; fi"

Step "5/5 health 확인 (최대 60초 대기)"
$ok = $false
foreach ($i in 1..12) {
  Start-Sleep -Seconds 5
  try {
    $h = Invoke-RestMethod -Uri "http://localhost:4000/api/health" -TimeoutSec 4
    if ($h.ok) { $ok = $true; Write-Output "HEALTH OK — schema $($h.schema.count) · latest $($h.schema.latest)"; break }
  } catch {}
}
if (-not $ok) { throw "health 실패 — 운영 서버가 60초 내에 응답하지 않음. WSL 로그 확인 필요." }

Write-Output ""
Write-Output "✅ 배포 완료: $($after.Substring(0,7)) ($(git -C $repo log -1 --format=%s))"
Write-Output "⚠ 참고: 재시작으로 접속 중이던 사용자 세션은 끊겼을 수 있음(재로그인)."
