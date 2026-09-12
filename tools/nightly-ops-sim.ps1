# tools/nightly-ops-sim.ps1 — 야간 자동 회귀 실행기 (2026-08-14 재생성)
#
# 왜 이 방식인가: 예전 예약(Claude 예약 루틴)이 세션 소멸과 함께 사라져 **이틀 결석**했다
# (마지막 08-12 03:12, 발견 08-14 04:41 — 등록부 양쪽 다 빈 상태). Windows 작업 스케줄러는
# 세션과 무관하게 돌므로 이 실행기를 03:00 KST 일일 예약으로 건다.
#   등록:  schtasks /query /tn "GIJO AS - 야간 회귀"  로 확인
# 결과: .tmp-reports\ops-sim.md(하네스 자체 보고) + 날짜별 실행 로그(아래).
# ⚠ 측정 전용이다 — 코드 수정·배포는 하지 않는다(자율성 단계 표의 예약 루틴 원칙).
#
# ★★ **이름에 문항 수를 박지 않는다** (2026-09-06 수리)
#   이 파일의 머리말도, 작업 스케줄러의 이름도 「152상황」이었는데 **실제는 162문항**이었다
#   (.tmp-reports\ops-sim.meta.json 총문항=162, 2026-09-05 회차). 하네스에 문항을 더할 때마다
#   이름·주석·문서 세 곳을 같이 고쳐야 하는데 아무도 안 고친다 — 「같은 것을 여러 곳에 적으면
#   어긋난다」의 교과서다. 실제로 GA 판정표·연대기·제안자료까지 152로 굳어 **바깥에 내보내는
#   숫자가 틀린 채로** 돌아다녔다.
#   → 이름에서 숫자를 뺀다. **문항 수는 meta.json이 말한다** — 하네스가 매 회차 직접 적는
#     단일 출처다(tools/ops-sim.mjs의 「총문항」). 아래에서 로그 머리·꼬리에 그 값을 찍는다.
#   ⚠ 작업 스케줄러 이름 바꾸기는 schtasks에 rename이 없다 — **지우고 다시 만든다**:
#       schtasks /create /tn "GIJO AS - 야간 회귀" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\Connect AI\tools\nightly-ops-sim.ps1\"" /sc daily /st 03:00 /f
#       schtasks /delete /tn "GIJO AS - 야간 회귀(152상황)" /f
#     (지우기를 **나중에** 한다 — 새것을 먼저 만들어야 그 사이에 회차가 비지 않는다.
#      순서를 뒤집으면 딱 하루 결석이 나고, 그 결석은 아무도 못 알아챈다.)
#
# 🆕 **2차 패스 — 고객 QA 인스턴스(4100)** (2026-09-11 22:55 사장님 「권고순서대로」 ① 결정)
#   운영(4000) 패스가 **끝난 뒤에** 4100에도 같은 하네스를 돌린다. 별도 로그·별도 종료코드라
#   4100이 죽어 있거나 실패해도 위 4000 패스의 결과·종료코드에는 영향이 없다(맨 아래 참고).
#   비밀번호는 여기(Windows)에 새로 두지 않는다 — WSL 쪽 tools/qa-instance/nightly-4100.sh가
#   /home/gijo/gijo-qa/secrets/에서 직접 읽는다. 되돌리려면 맨 아래 블록만 지우면 된다.

$ErrorActionPreference = "Continue"
# node의 utf8 출력을 PS 파이프가 OEM으로 읽어 로그가 깨졌다(첫 실행 실측 「醫낅즺肄붾뱶」) — 통일.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location "D:\Connect AI"
$env:QA_USER = "claude-deploy"
$env:QA_PASS = [Environment]::GetEnvironmentVariable("GIJO_ADMIN_PASSWORD", "User")
if (-not $env:QA_PASS) {
  "GIJO_ADMIN_PASSWORD(User env)가 비어 있어 실행 불가" | Out-File ".tmp-reports\ops-sim-nightly-오류.log" -Encoding utf8
  exit 2
}
$log = ".tmp-reports\ops-sim-nightly-$(Get-Date -Format yyyyMMdd).log"
"시작 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $log -Encoding utf8

# 📏 **문항 수는 meta.json이 말한다** — 이 파일에도, 작업 이름에도 숫자를 박지 않는다.
#   ⚠ 로그 머리에서 읽는 값은 **지난 회차**의 것이다(하네스가 회차 끝에 적으므로). 그 사실을
#     문구에 그대로 적는다 — 「지금 몇 문항 도는지」로 읽히면 그게 또 다른 틀린 숫자가 된다.
#     이번 회차의 진짜 값은 아래 꼬리에서 다시 찍는다.
#   ⚠ `node -e "…"`로 쓰지 않는다 — PS 5.1이 네이티브 인자를 ANSI로 넘겨 **한글이 깨지고
#     큰따옴표가 사라진다**(2026-09-06 실측). 그래서 읽는 코드를 파일로 뺐다.
"문항 수(지난 회차 기록 기준) — $(node tools/ops-sim-meta.mjs)" | Out-File $log -Append -Encoding utf8
# 🌙 **결석을 다음 회차가 알린다**(2026-08-31). 결석은 아무 일도 안 일어나는 것이라 스스로
#   못 알린다 — 그래서 **돌아온 회차가 지난 공백을 로그 머리에 적는다.** 실제로 08-25·26
#   두 밤을 건너뛰고도 아무도 몰랐고, 그 전에도 08-12에 같은 일이 있었다(이 파일 머리 주석).
node tools/nightly-gap.mjs 2>&1 | Out-File $log -Append -Encoding utf8
node tools/ops-sim.mjs 2>&1 | Out-File $log -Append -Encoding utf8
$코드 = $LASTEXITCODE
# 이번 회차의 **진짜** 문항 수 — 하네스가 방금 적은 값이다(머리의 것은 지난 회차).
"문항 수(이번 회차) — $(node tools/ops-sim-meta.mjs)" | Out-File $log -Append -Encoding utf8
"끝 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · 종료코드 $코드" | Out-File $log -Append -Encoding utf8

# ══════════════════ 2차 패스 — 고객 QA 인스턴스(4100) ══════════════════
# 사장님 결정(2026-09-11 22:55 「권고순서대로」 ①): 운영 4000에 이어 4100에도 밤마다 돌린다.
# ⚠ 되돌리려면 이 블록만 지우면 된다 — tools/qa-instance/nightly-4100.sh 자체는 독립 도구라
#   안 지워도 되고, 4000 패스(위)는 이 블록과 무관하게 그대로 돈다.
# ⚠ 이 블록의 성패는 **위 $코드(4000 종료코드)에 섞지 않는다** — 스크립트 전체의 exit는
#   여전히 4000 결과만 반영한다(맨 아래 `exit $코드`가 그대로다).
$log4100 = ".tmp-reports\ops-sim-4100-nightly-$(Get-Date -Format yyyyMMdd).log"
"시작 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $log4100 -Encoding utf8

# 4100이 내려가 있으면 WSL을 부르지 않고 건너뛴다 — health는 Windows 쪽에서 확인한다
# (refresh-portproxy.ps1이 Windows localhost:4100 → WSL로 이미 잇고 있다).
$살아있다 = $false
try {
  $응답4100 = Invoke-WebRequest -Uri "http://localhost:4100/api/health" -UseBasicParsing -TimeoutSec 5
  if ($응답4100.StatusCode -eq 200) { $살아있다 = $true }
} catch {
  $살아있다 = $false
}

if (-not $살아있다) {
  "4100 health가 200이 아니다 — 이번 회차는 건너뜁니다(4000 패스와 무관, 4000은 이미 끝났다)." | Out-File $log4100 -Append -Encoding utf8
  "끝 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · 건너뜀" | Out-File $log4100 -Append -Encoding utf8
} else {
  wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/qa-instance/nightly-4100.sh" ops-sim-4100 2>&1 | Out-File $log4100 -Append -Encoding utf8
  $코드4100 = $LASTEXITCODE
  # 📏 2026-09-12 설계관 실측 ② — ops-sim-meta.mjs가 이름 인자를 받게 고쳐 1차와 같은 꼴의
  #   문항 수 줄을 여기도 남긴다. nightly-4100.sh가 ops-sim.mjs --out ops-sim-4100으로 돌아
  #   .tmp-reports\ops-sim-4100.meta.json을 이미 쓰고 있었는데, 그 메타를 읽는 자리가 없었다.
  "문항 수(이번 회차) — $(node tools/ops-sim-meta.mjs ops-sim-4100)" | Out-File $log4100 -Append -Encoding utf8
  "끝 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · 종료코드 $코드4100" | Out-File $log4100 -Append -Encoding utf8
}

exit $코드
