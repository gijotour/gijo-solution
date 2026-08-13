# tools/nightly-ops-sim.ps1 — 야간 자동 회귀(152상황) 실행기 (2026-08-14 재생성)
#
# 왜 이 방식인가: 예전 예약(Claude 예약 루틴)이 세션 소멸과 함께 사라져 **이틀 결석**했다
# (마지막 08-12 03:12, 발견 08-14 04:41 — 등록부 양쪽 다 빈 상태). Windows 작업 스케줄러는
# 세션과 무관하게 돌므로 이 실행기를 03:00 KST 일일 예약으로 건다.
#   등록:  schtasks /query /tn "GIJO AS - 야간 회귀(152상황)"  로 확인
# 결과: .tmp-reports\ops-sim.md(하네스 자체 보고) + 날짜별 실행 로그(아래).
# ⚠ 측정 전용이다 — 코드 수정·배포는 하지 않는다(자율성 단계 표의 예약 루틴 원칙).

$ErrorActionPreference = "Continue"
Set-Location "D:\Connect AI"
$env:QA_USER = "claude-deploy"
$env:QA_PASS = [Environment]::GetEnvironmentVariable("GIJO_ADMIN_PASSWORD", "User")
if (-not $env:QA_PASS) {
  "GIJO_ADMIN_PASSWORD(User env)가 비어 있어 실행 불가" | Out-File ".tmp-reports\ops-sim-nightly-오류.log" -Encoding utf8
  exit 2
}
$log = ".tmp-reports\ops-sim-nightly-$(Get-Date -Format yyyyMMdd).log"
"시작 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $log -Encoding utf8
node tools/ops-sim.mjs 2>&1 | Out-File $log -Append -Encoding utf8
"끝 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · 종료코드 $LASTEXITCODE" | Out-File $log -Append -Encoding utf8
exit $LASTEXITCODE
