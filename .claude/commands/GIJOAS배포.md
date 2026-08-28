# /GIJOAS배포 — 운영(WSL) 서버 배포

운영 서버(`win`의 WSL, localhost:4000)에 hub 최신 코드를 배포한다. **머신에 따라 동작이 다르다:**

## `win`에서 (직접 수행)
tools/deploy-prod.ps1과 같은 절차를 **단계별로** 수행한다 (스크립트 일괄 실행은 권한 정책에 막히므로 단계 분리가 표준):

1. `git fetch hub && git merge --ff-only hub/main` — 갈라졌으면 중단하고 /GIJOAS동기화 먼저.
2. **테스트 게이트 — WSL에서 돌린다**(2026-08-10 확립):
   `wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/wsl-test.sh"`
   하나라도 실패하면 **배포 중단**, 결과 보고.
   - ⚠ **`win`에서 `cd server && npm test` 하지 말 것.** 느린 게 문제가 아니라
     **제품이 안 도는 환경을 재는 것**이 문제다(그 python3은 0바이트 껍데기).
     실측: `win` 한 파일 14분(전체는 못 끝냄) ↔ WSL 전체 2,979개 **27초**.
   - ⚠ WSL 사본에서 **구조적으로 못 도는 시험 2개**는 스크립트가 끝에 이름을 찍는다
     (`no-hardcoded-credentials`=git 필요 · `shotlist`=이미지 필요). 그 둘은 `win`에서 따로.
     「WSL에서 전부 통과」는 이 둘을 뺀 말이다 — 그대로 말하면 거짓이 된다.
3. 의존성 변경 확인: 직전 배포 이후 server/package.json 변경 시 경고(WSL에서 npm ci 필요할 수 있음).
3′. **파이썬 의존 실효 확인(필수)** — 배포 대상 환경에서 직접:
   `wsl -d Ubuntu-24.04 -- bash -c "cd /home/gijo/gijo-as/server && node scripts/check-python-deps.mjs"`
   종료코드 1이면 안내대로 설치 후 재확인. **통과 전에는 배포를 끝내지 않는다.**
   - ⚠ 2026-08-09 실사고 2건: `pypdf`는 requirements.txt에 **적혀 있는데 설치가 안 돼**
     PDF 추출이 몇 달간 죽어 있었고, `netmiko`(장비 접속)는 **적혀 있지도 않았다.**
     둘 다 조용히 죽어 있었다 — 화면엔 아무 표시도 없었다.
   - ⚠ 개발 기계의 `npm test`로는 못 잡는다. `win` 호스트의 python3은 0바이트 껍데기라
     **제품이 도는 환경이 아니다.** 그래서 이 확인은 반드시 WSL 안에서 한다.
   - 없으면: `venv/bin/pip install -r requirements.txt` (venv가 없으면 `python3 -m venv venv` 먼저)
4. WSL 동기화+빌드:
   `wsl -d Ubuntu-24.04 -- bash -c "rsync -a --delete '/mnt/d/Connect AI/server/src/' /home/gijo/gijo-as/server/src/ && rsync -a '/mnt/d/Connect AI/server/scripts/' /home/gijo/gijo-as/server/scripts/ && cd /home/gijo/gijo-as/server && npx tsc -p tsconfig.json && node scripts/copy-assets.mjs && echo BUILD_OK"`
   - ⚠ **`scripts/`도 함께 옮긴다**(2026-08-29 실사고). 그전에는 `src/`만 옮겨서
     `scripts/`의 파이썬 추출기(extract_doc.py)·장비 접속기(netmiko_runner.py)가 **영영 안 갔다.**
     실측: pptx 추출기를 고치고 배포했는데 운영은 옛 코드였고, 세 스크립트 모두 89줄씩 어긋나
     있었다. TS만 배포하는 절차라 **파이썬 쪽 수리는 배포한 적이 없던 셈**이다.
     ⚠ `--delete`는 안 붙인다 — 운영에서만 만들어지는 파일(venv 등)을 지울 위험이 있다.
   - ⚠ **`copy-assets.mjs`를 빼지 말 것**(2026-08-13에 빠져 있던 것을 찾음). `tsc`만 돌리면
     `import`로 읽지 않는 자료 파일(`engine/examquestions.json` 등)이 dist에 안 들어간다.
     `npm run build`는 이 둘을 함께 돌리는데 **배포 절차만 앞의 하나를 부르고 있었다** —
     새 자료 파일을 더한 사람은 시험을 통과시키고도 운영에서 조용히 그 기능이 꺼진다.
     (`import`로 읽는 .json은 tsc가 알아서 옮긴다 — `lite-tools.json`·`onto-aliases-ko.json`.)
4′. **제품 문서 동기화(필수)** — ⚠ 4단계는 `server/src/`만 옮긴다. **문서와 매니페스트는 안 간다.**
   `node tools/docs-drift.mjs` 로 먼저 재고(읽기만 함), 어긋나면 `tools/deploy-prod.ps1`의
   3.5단계와 같은 일을 한다: `server/docs-manifest.json` → 운영 서버로,
   그리고 매니페스트에 열거된 문서를 **하위 폴더를 살려서** `GIJO_DOCS_DIR`로.
   - ⚠ **평평하게 복사하면 안 된다**(2026-08-13 실사고). 서버는 매니페스트 경로 그대로 찾는다
     (`docsbundle.ts` `resolveDocPath` = `path.resolve(docsDir, "knowledge/…")`).
     `knowledge/` 문서를 `docsDir/` 바로 밑에 넣으면 **영영 인입되지 않는다** —
     운영의 지식 7종은 누군가 8월에 **손으로** 넣어 둔 것이었고 아무도 그 사실을 몰랐다.
   - ⚠ 문서를 바꿨으면 **재시작해야 재인입**된다(해시가 같으면 건너뛴다).
   - 끝나고 `node tools/docs-drift.mjs`를 **다시** 돌려 초록인지 본다.
     「고쳤다」와 「AI가 안다」는 다른 말이다.
5. 재시작 (grep/awk 파이프 금지 — 인용 함정):
   `wsl -d Ubuntu-24.04 -- systemctl show gijo-as.service -p MainPID --value` 로 PID 얻고 `wsl -d Ubuntu-24.04 -- kill <PID>`
6. health 확인: Node fetch로 http://localhost:4000/api/health 를 최대 60초 폴링 (curl은 한글 응답 검증에 쓰지 말 것).
6′. **PID가 실제로 바뀌었는지 확인(필수)** — ⚠ **「health 200 = 새 코드」는 거짓이다.**
   `systemctl show gijo-as.service -p MainPID --value` 를 **다시** 읽어 **이전 PID와 다른지**,
   그리고 `ps -o lstart= -p <새PID>` 가 `stat -c '%y' .../dist/index.js` **보다 뒤인지** 본다.
   같으면 배포 실패다 — **옛 프로세스가 health에 답하고 있는 것**이고 새 코드는 안 올라갔다.
   - 실사고(2026-08-12, `max`): 재기동 스크립트가 「재기동됨·HEALTH OK」를 찍었는데 손으로 띄운
     옛 프로세스가 포트를 쥐고 있어 새 인스턴스가 EADDRINUSE로 죽었다. 옛 코드를 재고
     **「기계 차이」로 보고될 뻔했다.** `tools/deploy-prod.ps1`은 이제 이걸 검사하고 실패시킨다.
7. 보고: 이전→새 PID, **프로세스 기동 시각 vs dist 빌드 시각**, health, 배포된 커밋.
   ⚠ 재시작으로 접속 중 세션이 끊겼음을 명시.

## `max`에서 (2026-08-09 변경 — `max`에서 트리거한다)
사장님의 `max`는 **운영 배포를 직접 트리거한다**(그전에는 `win` 담당이었다).
제임스 작업을 `max`에서 확인한 뒤 그대로 운영에 넣기 위해서다 — `GIJO_AS_공동작업_가이드.md`.

1. **테스트 게이트 먼저**: `cd server && npm test` — 실패하면 배포 중단, 결과 보고.
2. 사용자 승인을 받는다. ⚠ 재시작하면 **접속 중인 전 사용자 세션이 끊긴다** — 반드시 사전 확인.
3. 실행:
   `ssh user@10.8.0.1 "powershell -NoProfile -ExecutionPolicy Bypass -File 'd:/Connect AI/tools/deploy-prod.ps1'"`
4. health 확인: Node fetch로 `http://10.8.0.1:4000/api/health` (curl은 한글 검증에 쓰지 말 것).
   `schema.latest`가 이번에 넣은 마이그레이션인지 확인 — 배포가 실제로 반영됐는지 가르는 가장 확실한 표시.
5. 보고: 배포된 커밋, health 결과, **세션이 끊겼다는 사실**을 명시.

⚠ **게시(/GIJOAS게시)는 여전히 `win` 전용이다** — `max`에서 대체 불가.
⚠ 제임스 머신에서는 이 명령을 쓰지 않는다(운영 접근 없음).

공통 규칙: 운영 배포는 사용자가 명시적으로 지시했을 때만 실행한다. 자동/선제 배포 금지.
