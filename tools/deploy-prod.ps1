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

# ⚠⚠ **WSL 출력 읽기는 반드시 이 함수로.**
#   PowerShell 5.1에서 출력이 0줄인 네이티브 명령의 결과는 문자열이 아니라 $null이고,
#   이 스크립트는 위에서 $ErrorActionPreference="Stop"을 걸었다. 그래서 `(wsl …).Trim()`은
#   **줄이 없을 때 그 자리에서 배포를 죽인다.**
#   2026-09-01에 개발모드 표지 한 곳에서 이걸 겪었는데(끄라고 안내해 놓고 끄면 죽는 꼴),
#   검토관이 **같은 함정이 다섯 곳 더** 있다고 짚었다 — 서비스 PID·프로세스 시작시각·
#   dist 시각·문서 경로가 전부 「값이 없을 수 있는」 자리다.
#   ⇒ 자리마다 try/catch를 흩뿌리지 않고 **읽는 길을 하나로** 만든다.
function Read-WslLine {
  param([Parameter(Mandatory)][string]$Command, [string]$Default = "")
  try {
    $raw = wsl -d $distro -- bash -c $Command
    if ($null -eq $raw) { return $Default }
    return ([string]$raw).Trim()
  } catch { return $Default }
}
function Read-WslRaw {
  param([Parameter(Mandatory)][string[]]$Args, [string]$Default = "")
  try {
    $raw = & wsl -d $distro -- @Args
    if ($null -eq $raw) { return $Default }
    return ([string]$raw).Trim()
  } catch { return $Default }
}

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
# ⚠⚠ **줄이 없을 때 죽지 않게** 한다(2026-09-01 재검토 [상]).
#   이 스크립트는 위에서 $ErrorActionPreference="Stop"을 건다. GIJO_DEV_MODE 줄이 env에 없으면
#   grep이 아무것도 안 뱉고, PowerShell 5.1에서 출력 0줄인 네이티브 명령의 결과는 $null이다.
#   $null.Trim()은 던지고, Stop이라 배포가 **거기서 멈춘다** — 문서 동기화·서버 재시작·health가
#   전부 안 돈다. 하필 이 표지가 스스로 권하는 「그 줄을 지우고 재시작하세요」를 따르는 순간
#   배포가 깨진다. **끄라고 해 놓고 끄면 벌주는** 꼴이었다.
$devMode = Read-WslLine "grep -m1 '^GIJO_DEV_MODE=' /home/gijo/gijo-as/gijo-as.env | cut -d= -f2"
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
$docsDir = Read-WslLine "grep -m1 '^GIJO_DOCS_DIR=' /home/gijo/gijo-as/gijo-as.env | cut -d= -f2"
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

Step "4/5 운영 dist 고아 산출물 청소 + 프로세스 재시작 (systemd Restart=always)"
# ── 고아 산출물 청소 ────────────────────────────────────────────────────────
# ⚠ **소스에서 지운 파일이 운영 dist에는 그대로 남는다.** 3단계 rsync는 `--delete`로 src/를
#   깨끗이 맞추지만, dist/는 tsc가 만들 뿐 **지우지 않는다.** 그래서 화면·엔진을 통째로 내려도
#   운영에는 옛 .js가 계속 살아 있다(2026-09-07 merge.ts 삭제가 그 예다).
#   왜 나쁜가 — 세 가지 다 실제로 겪은 부류다:
#     ① 아무도 안 부르는 코드가 운영 디스크에 남아, 다음 사람이 「아직 있는 기능」으로 읽는다.
#     ② 옛 모듈이 남아 있으면 잘못 살아난 import 하나로 **지웠다고 믿은 창구가 다시 열린다**
#        (소비자 0인 인증 창구는 공격면일 뿐이라는 그 판단의 반대편이다).
#     ③ 소스 감시(「흔적 0건」)는 src만 본다 — 운영 dist의 잔재를 원리상 못 잡는다.
# ⚠ **지우기 전에 참조 0을 확인한다.** 살아남은 dist 파일이 아직 그 모듈을 부르면 지우지 않고
#   경고만 낸다 — 부르는데 지우면 다음 기동이 MODULE_NOT_FOUND로 죽고, 그건 배포 사고다.
#   (참조가 있다는 것은 「반쪽 삭제」라는 뜻이므로 사람이 봐야 할 자리다.)
# ⚠ 범위·잣대·출력 규약은 **tools/clean-orphan-dist.sh 한 곳**에 있다. 여기 다시 적지 않는다.
# ⚠⚠ **여기에 bash 본문을 문자열로 적지 말 것**(2026-09-08 실측으로 확인). PowerShell 5.1은
#   네이티브 명령에 넘기는 문자열의 **큰따옴표를 먹는다** — `echo "REF|$b|$n"`이 따옴표를 잃고
#   `echo REF | $b | $n`(파이프!)이 되어, 시험 하네스에서 실제로 이런 오류가 났다:
#     /bin/bash: line 7: ; else rm -f dist/engine/.js … : No such file or directory
#   그리고 그 상태로도 스크립트는 안 죽고 **「고아 산출물: 없음」이라는 거짓 초록**을 냈다.
#   ⇒ 로직은 파일로 두고 **경로만** 넘긴다(따옴표가 인자 하나뿐이라 먹혀도 안전하다).
$청소스크립트 = "/mnt/d/Connect AI/tools/clean-orphan-dist.sh"
# ⚠ @()로 감싼다 — 줄이 0개면 네이티브 명령 결과가 $null이고, 이 스크립트는 Stop이라
#   그대로 두면 다음 줄에서 배포가 죽는다(이 파일 맨 위 Read-WslLine 주석이 적어 둔 그 함정).
$청소출력 = @()
$청소코드 = 0
try { $청소출력 = @(wsl -d $distro -- bash $청소스크립트 $wslServer); $청소코드 = $LASTEXITCODE } catch { $청소출력 = @(); $청소코드 = -1 }
$지움 = @($청소출력 | Where-Object { $_ -like "DEL|*" } | ForEach-Object { ($_ -split '\|')[1] })
$남김 = @($청소출력 | Where-Object { $_ -like "REF|*" })
# ⚠⚠ **못 돌았을 때 「없음」이라고 말하지 않는다.** 이 청소가 실패하는 길(스크립트가 없다·경로가
#   틀렸다·WSL이 안 뜬다)은 전부 출력 0줄이라, 종료코드를 안 보면 「고아 산출물: 없음」이라는
#   **거짓 초록**이 된다 — 이 저장소가 반복해 겪은 「잰 것이 없는데 초록」 그 자체다.
#   ⚠ 여기서 배포를 막지는 않는다. 청소는 위생이지 배포 조건이 아니고, 못 돌았다고 새 코드를
#     안 올리면 더 나쁘다. 대신 **크게 말한다.**
if ($청소코드 -ne 0) {
  Write-Warning "고아 산출물 청소가 못 돌았다(종료코드 $청소코드) — dist에 지운 파일이 남아 있을 수 있다. 확인: wsl bash '$청소스크립트' '$wslServer' --dry-run"
} elseif ($지움.Count -gt 0) {
  Write-Output "고아 산출물 $($지움.Count)건 제거(소스에 없고 참조 0): $($지움 -join ', ')"
} else {
  Write-Output "고아 산출물: 없음(청소 정상 수행)"
}
if ($남김.Count -gt 0) {
  Write-Warning "소스에 없는데 **아직 참조되는** dist 모듈이 있다 — 반쪽 삭제다. 지우지 않았으니 사람이 볼 것: $($남김 -join ', ')"
}

# grep/awk 파이프는 셸 경유 인용 문제로 빈 결과가 나는 함정(2026-07-24 실측) — systemd MainPID 직접 조회.
$pid = Read-WslRaw @("systemctl","show","gijo-as.service","-p","MainPID","--value")
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

$after_pid = Read-WslRaw @("systemctl","show","gijo-as.service","-p","MainPID","--value")
if (-not $after_pid -or $after_pid -eq "0") { throw "재시작 확인 실패 — MainPID가 비어 있다(서비스가 안 떴다). health 200은 다른 프로세스가 답했을 수 있다." }
if ($before -and $before -ne "0" -and $after_pid -eq $before) {
  throw "재시작 확인 실패 — PID가 $before 그대로다. **옛 프로세스가 health에 답하고 있다.** 새 코드가 안 올라갔다."
}
$started = Read-WslLine "ps -o lstart= -p $after_pid"
$built = Read-WslLine "stat -c '%y' /home/gijo/gijo-as/server/dist/index.js"
Write-Output "PID $before → $after_pid"
Write-Output "  프로세스 기동: $started"
Write-Output "  dist 빌드    : $built   ← 기동이 빌드보다 뒤여야 새 코드다"

Write-Output ""
Write-Output "✅ 배포 완료: $($after.Substring(0,7)) ($(git -C $repo log -1 --format=%s))"
Write-Output "⚠ 참고: 재시작으로 접속 중이던 사용자 세션은 끊겼을 수 있음(재로그인)."
