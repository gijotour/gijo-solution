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
# ⚠ src/뿐 아니라 **scripts/·requirements**도 옮긴다(2026-08-21 설계관 지적). 예전엔 src/만 옮겨
#   scripts/extract_doc.py(파이썬 추출기·OCR)를 고쳐도 운영은 옛 스크립트로 돌았다 — 「배포는 됐는데
#   운영은 옛 코드」의 급소. requirements-ocr.txt(옵션 OCR)도 옮기되 설치는 자동 안 함(무겁다 —
#   OCR을 켤 때만 수동: cd server && venv/bin/pip install -r requirements-ocr.txt). copy-assets도 함께.
wsl -d $distro -- bash -c "rsync -a --delete '/mnt/d/Connect AI/server/src/' '$wslServer/src/' && rsync -a '/mnt/d/Connect AI/server/scripts/' '$wslServer/scripts/' && cp '/mnt/d/Connect AI/server/requirements.txt' '$wslServer/' && cp '/mnt/d/Connect AI/server/requirements-ocr.txt' '$wslServer/' && cd '$wslServer' && npx tsc -p tsconfig.json && node scripts/copy-assets.mjs && echo BUILD_OK"
if ($LASTEXITCODE -ne 0) { throw "WSL 동기화/빌드 실패 — 배포 중단 (운영은 아직 이전 코드로 구동 중)" }

# ⚠ 문서도 함께 옮긴다(2026-08-08 실사고). 예전엔 소스만 옮겨서, 문서를 고쳐도 운영 AI는
#   **옛 문서를 근거로 계속 답했다**(8월 7일판이 쓰이고 있었다). 사람이 기억해야만 맞는 구조였다.
#   ⚠ 운영이 읽는 곳은 **env가 가리키는 한 곳뿐**이다(gijo-as.env의 GIJO_DOCS_DIR).
#      다른 폴더에 복사하면 조용히 옛 문서가 계속 쓰인다 — 그래서 env를 읽어 그 자리에 넣는다.
# 🔓 개발 모드 표지 — **배포할 때마다 눈에 띄게 말한다**(2026-09-01 완결성 비평 [중]).
#   자가 진단에 항목을 만들어 뒀지만 그건 **사람이 그 화면을 열어야** 보인다. 되돌리는 걸 잊는
#   사고는 「아무도 안 봐서」 나므로, 사람이 반드시 지나가는 **배포 순간**에 말한다.
#   ⚠ 여기서 배포를 막지는 않는다 — 개발 기간에는 일부러 켜 둔 값이라 막으면 매번 걸린다.
#     끄는 시점은 사장님 결정이고, 이 표지는 **잊지 말라는 알림**이다.
$devMode = (wsl -d $distro -- bash -c "grep -m1 ^GIJO_DEV_MODE= /home/gijo/gijo-as/gijo-as.env | cut -d= -f2").Trim()
if ($devMode -eq "1") {
  Write-Output ""
  Write-Output "  ⚠⚠  개발 모드가 켜져 있습니다(GIJO_DEV_MODE=1) — 업무정보 등급(기밀·민감)"
  Write-Output "       열람 제한이 **꺼진 채** 운영이 돕니다. 개발 기간 조치라면 그대로 두시고,"
  Write-Output "       출하·파일럿 전에는 gijo-as.env에서 그 줄을 지우고 재시작하세요."
  Write-Output ""
} else {
  Write-Output "개발 모드: 꺼짐 (등급 열람 제한 정상)"
}

Step "3.5/5 제품 문서 동기화 (docs-manifest 열거분)"
$docsDir = (wsl -d $distro -- bash -c "grep -m1 '^GIJO_DOCS_DIR=' /home/gijo/gijo-as/gijo-as.env | cut -d= -f2").Trim()
if (-not $docsDir) { $docsDir = "$wslServer/docs" }
Write-Output "운영 문서 위치: $docsDir"
# ⚠ 매니페스트도 함께 옮긴다 — 새 문서를 목록에 더해도 운영 매니페스트가 옛것이면
#   서버는 그 문서를 **아예 모른다**(2026-08-13: 운영 매니페스트가 8월 9일판이었다).
wsl -d $distro -- bash -c "cp '/mnt/d/Connect AI/server/docs-manifest.json' '$wslServer/docs-manifest.json'"
$manifest = Get-Content "$repo\server\docs-manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$문서옮김 = 0; $문서없음 = @()
foreach ($entry in $manifest.files) {
  $src = Join-Path $repo $entry.file
  if (Test-Path -LiteralPath $src) {
    $wslSrc = "/mnt/d/Connect AI/" + ($entry.file -replace '\\', '/')
    # ⚠ **하위 폴더를 살려서 넣는다**(2026-08-13 실사고). 예전엔 `cp <파일> <docsDir>/`로
    #   평평하게 복사했는데, 서버는 매니페스트 경로 그대로 찾는다
    #   (docsbundle.ts resolveDocPath = path.resolve(docsDir, "knowledge/…")).
    #   그래서 `knowledge/` 문서를 이 스크립트로 넣으면 **영영 인입되지 않았다** —
    #   지금 운영에 있는 지식 7종은 누군가 8월에 **손으로** 넣어 둔 것이고,
    #   그 뒤로 아무도 그 사실을 몰랐다. 새 지식 문서를 더한 사람은 시험을 통과시키고
    #   배포까지 끝내고도 **AI는 그 문서를 모르는** 상태가 된다(조용한 지식 공백).
    $하위 = Split-Path $entry.file -Parent
    $대상 = if ($하위) { "$docsDir/" + ($하위 -replace '\\', '/') } else { $docsDir }
    wsl -d $distro -- bash -c "mkdir -p '$대상' && cp '$wslSrc' '$대상/'"
    if ($LASTEXITCODE -eq 0) { $문서옮김++ } else { $문서없음 += ("복사실패:" + $entry.file) }
  } else { $문서없음 += $entry.file }
}
Write-Output "문서 $문서옮김건 동기화 (하위 폴더 유지)"
if ($문서없음.Count -gt 0) { Write-Warning "리포지토리에 없는 문서(목록만 있고 파일 없음): $($문서없음 -join ', ')" }

Step "4/5 운영 프로세스 재시작 (systemd Restart=always)"
# grep/awk 파이프는 셸 경유 인용 문제로 빈 결과가 나는 함정(2026-07-24 실측) — systemd MainPID 직접 조회.
$pid = (wsl -d $distro -- systemctl show gijo-as.service -p MainPID --value).Trim()
if ($pid -and $pid -ne "0") {
  wsl -d $distro -- kill $pid
  Write-Output "killed $pid"
} else {
  Write-Output "no running pid (systemd가 새로 띄움)"
}

Step "5/5 health + **PID가 실제로 바뀌었는지** 확인 (최대 60초 대기)"
# ⚠ **「health 200 = 새 코드」는 거짓이다**(2026-08-12, max에서 실사고).
#   max의 개발 서버에서 재기동 스크립트가 「재기동됨·HEALTH OK」를 찍었는데, 손으로 띄운
#   옛 프로세스가 포트를 쥐고 있어 새 인스턴스는 EADDRINUSE로 죽고 **옛 프로세스가 200을
#   답했다.** 그 상태로 라우팅을 재서 「max 8/13 vs win 0/13 = 기계 차이」로 보고될 뻔했다.
#   여기(systemd)는 사정이 다르지만 — kill이 빗나가거나 PID를 잘못 읽으면 Restart=always가
#   되살릴 것도 없이 **옛 프로세스가 그대로 응답한다.** 그러면 배포는 안 됐는데 초록이 뜬다.
#   그래서 health만으로 끝내지 않는다: **PID가 바뀌었고, 그 프로세스가 빌드보다 뒤에 떴는가.**
$before = $pid
$ok = $false
foreach ($i in 1..12) {
  Start-Sleep -Seconds 5
  try {
    $h = Invoke-RestMethod -Uri "http://localhost:4000/api/health" -TimeoutSec 4
    if ($h.ok) { $ok = $true; Write-Output "HEALTH OK — schema $($h.schema.count) · latest $($h.schema.latest)"; break }
  } catch {}
}
if (-not $ok) { throw "health 실패 — 운영 서버가 60초 내에 응답하지 않음. WSL 로그 확인 필요." }

$after_pid = (wsl -d $distro -- systemctl show gijo-as.service -p MainPID --value).Trim()
if (-not $after_pid -or $after_pid -eq "0") { throw "재시작 확인 실패 — MainPID가 비어 있다(서비스가 안 떴다). health 200은 다른 프로세스가 답했을 수 있다." }
if ($before -and $before -ne "0" -and $after_pid -eq $before) {
  throw "재시작 확인 실패 — PID가 $before 그대로다. **옛 프로세스가 health에 답하고 있다.** 새 코드가 안 올라갔다."
}
$started = (wsl -d $distro -- bash -c "ps -o lstart= -p $after_pid").Trim()
$built = (wsl -d $distro -- bash -c "stat -c '%y' /home/gijo/gijo-as/server/dist/index.js").Trim()
Write-Output "PID $before → $after_pid"
Write-Output "  프로세스 기동: $started"
Write-Output "  dist 빌드    : $built   ← 기동이 빌드보다 뒤여야 새 코드다"

Write-Output ""
Write-Output "✅ 배포 완료: $($after.Substring(0,7)) ($(git -C $repo log -1 --format=%s))"
Write-Output "⚠ 참고: 재시작으로 접속 중이던 사용자 세션은 끊겼을 수 있음(재로그인)."
