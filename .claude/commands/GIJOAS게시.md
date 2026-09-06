# /GIJOAS게시 — 클라이언트 빌드·게시 (`win` 전용)

Electron 클라이언트를 빌드해 운영 서버에 게시한다(자동 업데이트 배포). **`win`에서만 수행** — `max`에서 이 명령을 받으면 "게시는 `win` 담당"이라 안내하고 /GIJOAS인계를 권할 것.

절차:

1. **버전 bump**: client/package.json의 version을 패치 올림(예: 2.7.16→2.7.17). 게시 노트에 쓸 변경 요약을 git log에서 뽑아 정리.
   ★ **client/package-lock.json의 두 자리도 같이 올린다** — 루트 `"version"`과 `packages[""].version`.
   우리는 판을 올릴 때 `npm install`을 안 도는 관례라 lock이 **저절로 안 따라온다**(실측 2026-09-06:
   package.json 5.91.0인데 lock은 5.62.0 — 29판이 밀려 있었다).
   ⚠ 안 맞추면 `server/test/shipscripts.test.ts`가 빨개지는데, 그 시험은 `tools/deploy-prod.ps1`의
   배포 관문(`npm test`)이기도 하다 — **게시가 아니라 나중에 엉뚱한 사람의 서버 배포에서** 터진다.
   게시 명령(publish-release) 자체는 vitest를 안 돌리므로 여기서 안 걸린다.
2. **빌드**: 먼저 **실행 중인 앱을 모두 종료**한다 — 개발 실행·설치본이 `client/server-dist`를
   잡고 있으면 빌드가 폴더 삭제에 실패한다(2026-07-26 실사고, exe가 안 나오는데 exit 0으로 끝남).
   `Get-Process -Name electron,"GIJO AS" | Where-Object { $_.Path -like "D:\Connect AI\*" -or $_.Path -like "*gijo-as*" } | Stop-Process -Force`
   ★ **게시 때는 사장님 앱(설치본)도 묻지 않고 닫는다**(2026-08-20 사장님 허가 "게시할때 앱을
   너가 강제로닫아도도"). 그전에는 매번 "닫아 주세요"를 요청하고 답을 기다리느라 게시가 멈췄다.
   ⚠ 대신 **보고에 「앱을 닫고 게시했습니다」를 한 줄 적는다** — 사장님이 그 앱으로 뭘 보고
   있었을 수 있으니 닫힌 사실을 숨기지 않는다. ⚠ 이 허가는 **게시에만** 적용된다:
   QA·측정 중 남의 세션을 끊는 것은 여전히 금지(계정당 1세션·직렬 자원).
   그 뒤 `cd client && npm run dist` (백그라운드 권장, 수 분 소요. **NSIS exe가 실제로 생겼는지 확인** —
   빌드 로그 tail만 보고 성공으로 판단하지 말 것)
   - ⚠ **빌드 완료 판정은 exe 존재로 하지 않는다**(2026-09-06 실측): electron-builder가 쓰는 도중의
     273KB짜리 exe에 `[ -f … ]`가 먼저 걸려 「완성」으로 오판했다(최종 259,551,569바이트). 판정은
     빌드 프로세스 종료 + latest.yml의 size/sha512와 실제 exe 대조 + .blockmap 존재로 한다.

3. **게시 전 실화면 검증**: 게시 명령이 **UI 실화면 관문을 자동으로 태운다**(2026-08-20 도입,
   `tools/publish-gate-ui.mjs` — publish-release가 강제 호출). 관문은 win-unpacked를 **전용 포트
   9227**로 스스로 띄워 배선(선택카드·감사 행·부품 로드·허브 릴레이·히트맵)을 실측하고,
   실패하면 게시가 중단된다. exit 3은 선행 점검 중단(원인 4가지를 메시지가 말한다 — 대표적으로
   **앱이 떠 있음**: 사람이 쓰는 앱은 관문이 절대 닫지 않으니 닫고 다시).
   - ⚠ 옛 방식(9223 수동 CDP)은 **남의 앱에 붙는 함정**이 있어 관문으로 대체했다. 이번 변경
     화면이 관문 검사 목록에 없으면 **관문에 검사를 더하는 것**이 정석이고, 급하면 수동 CDP로
     보완하되 9223에 뜬 것이 내 검사 대상이 맞는지 반드시 확인.
   - 우회는 `--skip-ui-gate`뿐 — 사유를 게시 커밋에 남길 것.
   - ⚠ **실화면 확인 질문은 prefill만** — 사람 길(입력창에 실제로 보내기)로 보내면 운영 대화에
     실입력이 남는다(2026-09-06: 「인용 제거가 뭐야?」 1건이 남았다 — 「운영 데이터는 전부 실입력」
     약속에 흠집). 관문이 ask 대신 prefill을 쓰는 이유가 바로 이것이다. 답 내용까지 봐야 하면
     읽기 전용 API(answer_samples·supervision)나 qa 표식이 붙는 하네스 경로를 쓴다.

4. **게시**: **게시 전용 계정 gijo-publish**로 (사람이 쓰는 세션은 어느 것도 안 끊긴다):
   ```powershell
   cd "D:\Connect AI\client"
   $env:GIJO_PUBLISH_USER=[Environment]::GetEnvironmentVariable("GIJO_PUBLISH_USER","User")
   $env:GIJO_PUBLISH_PASSWORD=[Environment]::GetEnvironmentVariable("GIJO_PUBLISH_PASSWORD","User")
   npm run publish-release -- --force --notes "<변경 요약>"
   ```
   ⚠ 노트에 **판 번호를 다시 적지 않는다**(2026-09-07): 서버가 version을 따로 주고 화면이 둘을
   나란히 그려(설정 → 업데이트 판·「게시된 배포판」 표) 「5.91.1  5.91.1 — …」로 두 번 찍힌다.
   그래도 습관으로 적히면 게시 스크립트가 **자기 판 번호 접두만** 떼고 그 사실을 한 줄로 알린다
   (남의 번호 「5.90.0 되돌림」은 그대로 둔다 — client/scripts/lib/artifactcheck.mjs 게시노트정리).
   ⚠ 스크립트는 로그인 **앞에서** 빌드 산출물을 대조한다 — `.blockmap`이 없거나 조각 합이 실제
   크기와 다르면(=쓰다 만 exe) 거기서 멈춘다(2026-09-06 273KB 사고).
   (User 스코프 env가 셸에 상속 안 되므로 위처럼 명시 로드. UI 관문의 앱 로그인 비번
   GIJO_ADMIN_PASSWORD는 관문이 User 스코프에서 **스스로 읽는다** — 따로 안 실어도 된다.)
   ⚠ **claude-deploy로 게시하지 말 것**(2026-07-26 실사고): 게시는 --force로 로그인하므로
   그 계정으로 앱에 로그인해 두면 작업 중이던 앱이 로그인 화면으로 튕긴다.
   claude-deploy는 앱 테스트·UI 관문용, gijo-publish는 게시용으로 나눠 쓴다.
5. **정리**: 버전 bump 커밋("클라 X.Y.Z 게시 — …") → `git push hub main`.
   (~~server-dist/package.json 원복~~ — 2026-08-13 추적 폐지로 필요 없어졌다.)
6. 보고: 버전·sha256·게시 노트·검증 결과.

전제: 사용자가 게시를 지시했을 때만 실행("빌드 및 게시" 등). 서버 변경이 함께 있으면 /GIJOAS배포를 먼저.
