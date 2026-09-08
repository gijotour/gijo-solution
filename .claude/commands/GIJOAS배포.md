# /GIJOAS배포 — 운영(WSL) 서버 배포

운영 서버(`win`의 WSL, localhost:4000)에 hub 최신 코드를 배포한다. **머신에 따라 동작이 다르다:**

> ⛔ **03:00~03:05 KST에는 배포·라이브 검증을 하지 않는다.** 그 창에 야간 회귀(`tools/nightly-ops-sim.ps1`)가
> **claude-deploy 계정으로** 서버에 붙는다. 계정당 1세션이라 우리가 그때 로그인하면
> 회귀가 튕기고, 서버를 재시작하면 회귀가 통째로 깨진다. 실측: 03:00:09 시작 →
> 03:04:32 완주(약 4분 30초 · 2026-09-07 회차). **끝난 것을 확인하고 들어간다** —
> `.tmp-reports/ops-sim-nightly-<날짜>.log`의 **끝부분**에 「■ 끝 …」이 찍혀 있으면 끝난 것이다.
> ⚠ **문항 수를 여기 적지 않는다**(2026-09-08). 예전엔 「158문항」이라 박아 두었는데 하네스가
>   자라 실제로는 177문항이었다 — 문서에 박은 숫자는 **반드시 낡는다**(같은 실수를 2026-09-06에
>   `nightly-ops-sim.ps1` 머리말에서 이미 한 번 걷어냈다). 몇 문항인지는 **하네스가 말한다**:
>   `.tmp-reports/ops-sim.meta.json`의 `총문항`. 걸리는 시간도 그 회차 로그에서 본다.
> ⚠ 「마지막 줄」이 아니다 — 그 뒤에 보고서 경로와 **세션 반납** 줄이 더 붙는다(2026-09-08).
>   오히려 그 반납 줄(「세션 반납 완료(완주)」)이 보이면 **회귀가 계정을 이미 놓았다**는 뜻이라
>   `claude-deploy`로 바로 붙어도 된다. 반납 줄이 없이 끝났으면 유휴 만료(30분)를 기다리거나
>   `force:true`로 밀어내야 한다.

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
   - ✅ **병렬 안전**(2026-09-04) — 호출자마다 사본(`.../gijo-as-test/runs/<식별자>`)이 갈리므로
     다른 에이전트가 같은 때 돌려도 **결과가 섞이지 않는다.** 한두 파일만 반복해 돌릴 땐 `--serial`.
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
4″. **운영 dist 고아 산출물 청소(필수)** — 위 rsync는 `--delete`로 `src/`를 저장소와 똑같이
   맞추지만 **`dist/`는 tsc가 만들 뿐 지우지 않는다.** 그래서 화면·엔진을 통째로 내려도
   운영 디스크에는 옛 `.js`가 계속 산다(2026-09-07 `merge.ts` 삭제가 그 예다).
   `wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/clean-orphan-dist.sh" /home/gijo/gijo-as/server`
   - 먼저 보고 싶으면 뒤에 `--dry-run`을 붙인다(지우지 않고 `DRY|이름`만 낸다).
   - **참조 0을 확인한 것만 지운다.** 살아남은 dist가 아직 부르면 `REF|이름|수`로 알리고 **안 지운다**
     — 부르는데 지우면 다음 기동이 MODULE_NOT_FOUND로 죽는다. `REF`가 나오면 그건 **반쪽 삭제**이니
     사람이 봐야 할 자리다(소스에서 지웠는데 부르는 곳이 남았다는 뜻).
   - ⚠ **출력이 0줄이면 「없음」이라고 말하지 말 것.** 스크립트가 없거나 경로가 틀려도 0줄이다 —
     종료코드를 함께 본다(0이 아니면 청소가 안 돈 것이다). `deploy-prod.ps1`은 이걸 검사해 경고한다.
   - ⚠ 왜 필요한가: 소스 감시(「흔적 0건」 시험)는 `src`만 본다 — **운영 dist의 잔재를 원리상 못 잡는다.**
     아무도 안 부르는 옛 모듈이 남으면 다음 사람이 「아직 있는 기능」으로 읽고, 잘못 살아난 import
     하나로 지웠다고 믿은 창구가 다시 열린다.
4′. **제품 문서 동기화(필수)** — ⚠ 4단계는 `server/src/`만 옮긴다. **문서와 매니페스트는 안 간다.**
   - ⚠ `docs-drift.mjs`는 **win 호스트에서** 돌린다(WSL 안에서 돌리면 거짓 경보 — 2026-09-04 실사고:
     WSL엔 `wsl` 명령이 없어 「30건 어긋남 · 0건 인입」이 났지만 win에서는 30/30 초록이었다).
     지금은 그런 자리에서 판정하지 않고 **exit 2 + 안내**로 멈춘다 — 2가 나오면 win에서 다시 돌린다.
   `node tools/docs-drift.mjs` 로 먼저 재고(읽기만 함), 어긋나면 `tools/deploy-prod.ps1`의
   3.5단계와 같은 일을 한다: `server/docs-manifest.json` → 운영 서버로,
   그리고 매니페스트에 열거된 문서를 **하위 폴더를 살려서** `GIJO_DOCS_DIR`로.
   - ⚠ **평평하게 복사하면 안 된다**(2026-08-13 실사고). 서버는 매니페스트 경로 그대로 찾는다
     (`docsbundle.ts` `resolveDocPath` = `path.resolve(docsDir, "knowledge/…")`).
     `knowledge/` 문서를 `docsDir/` 바로 밑에 넣으면 **영영 인입되지 않는다** —
     운영의 지식 7종은 누군가 8월에 **손으로** 넣어 둔 것이었고 아무도 그 사실을 몰랐다.
   - ⚠ 문서를 바꿨으면 **재시작해야 재인입**된다(해시가 같으면 건너뛴다).
   - 끝나고 `node tools/docs-drift.mjs`를 **다시** 돌려 초록인지 본다.
   - ⚠ **청커 판(CHUNKER_VERSION)이 오른 배포**(2026-09-08부터)는 재시작 직후 매니페스트 35편이 지우고 다시 넣기로 돈다(약 1,500조각·수 분). 그 창에서 docs-drift를 재면 「반쪽 유령」 헛빨강이 난다 — server.log에 `[docsbundle] … updated` 줄이 다 찍힌 **뒤에** 잰다. 판이 올랐는지는 memory.ts의 CHUNKER_VERSION과 직전 배포 커밋을 견줘 안다.
     「고쳤다」와 「AI가 안다」는 다른 말이다.
5. 재시작 (grep/awk 파이프 금지 — 인용 함정):
   `wsl -d Ubuntu-24.04 -- systemctl show gijo-as.service -p MainPID --value` 로 PID 얻고 `wsl -d Ubuntu-24.04 -- kill <PID>`
6. health 확인: Node fetch로 http://localhost:4000/api/health 를 최대 60초 폴링 (curl은 한글 응답 검증에 쓰지 말 것).
   - ⚠⚠ **오류를 볼 곳은 `journalctl`이 아니라 `/home/gijo/gijo-as/server.log`다.**
     유닛이 `StandardOutput=append:/home/gijo/gijo-as/server.log`(StandardError도 같은 파일)라,
     서버가 찍는 글은 **저널로 한 줄도 안 간다.** 실측(2026-09-08) `journalctl -u gijo-as.service`는
     systemd 자신의 「Started/Deactivated/Scheduled restart」만 보여 준다 — 앱 오류는 하나도 없다.
     그래서 저널만 보고 「오류 없음」이라고 하면 **거짓 초록**이다(기동 직후 죽는 부류가 여기 숨는다).
   - 보는 법: `wsl -d Ubuntu-24.04 -- tail -n 80 /home/gijo/gijo-as/server.log`
     (배포 뒤 새로 붙은 줄만 보려면 재시작 전에 `wc -l`을 재 두고 그 뒤부터 읽는다.
     ⚠ `append:`라 파일은 **잘리지 않고 계속 쌓인다** — 맨 앞은 옛 기동의 글이다.)
   - 저널이 쓸모없다는 뜻은 아니다: **프로세스가 몇 번 되살아났는지**(restart counter)와 기동·종료
     시각은 저널에만 있다. 「죽고 살아났나」는 저널, 「왜 죽었나」는 server.log — 자리가 다르다.
6′. **PID가 실제로 바뀌었는지 확인(필수)** — ⚠ **「health 200 = 새 코드」는 거짓이다.**
   `systemctl show gijo-as.service -p MainPID --value` 를 **다시** 읽어 **이전 PID와 다른지**,
   그리고 `ps -o lstart= -p <새PID>` 가 `stat -c '%y' .../dist/index.js` **보다 뒤인지** 본다.
   같으면 배포 실패다 — **옛 프로세스가 health에 답하고 있는 것**이고 새 코드는 안 올라갔다.
   - 실사고(2026-08-12, `max`): 재기동 스크립트가 「재기동됨·HEALTH OK」를 찍었는데 손으로 띄운
     옛 프로세스가 포트를 쥐고 있어 새 인스턴스가 EADDRINUSE로 죽었다. 옛 코드를 재고
     **「기계 차이」로 보고될 뻔했다.** `tools/deploy-prod.ps1`은 이제 이걸 검사하고 실패시킨다.
6″. **확인용 로그인도 반드시 로그아웃**(2026-09-06 실사고) — 「재로그인 200으로 유령 세션 없음 확인」이
   로그아웃을 빠뜨려 **확인 행위가 스스로 유령을 남겼고** 다음 게시가 409에 걸렸다. claude-deploy는
   계정당 1세션이다: API 확인·하네스·유령 점검 어느 것이든 마지막 호출은 logout(Authorization 헤더
   + refreshToken body)이어야 하고, 출력을 자르는 파이프(Select-Object -First 등)로 node를 죽이지 않는다.
   - ⚠ 운영 WSL에는 **sqlite3 CLI가 없다.** 없는 명령이 빈 결과를 내놓아 「표 없음」이라는 거짓 판정이
     났다(2026-09-06). 운영 DB 읽기 질의는 `/home/gijo/gijo-as/server` 안에서 node + better-sqlite3(readonly)로만.
   - ⚠ PowerShell → wsl 로 **한글·파이프(|)가 든 명령**을 넘기면 문자열이 깨져 0건(거짓 음성)이 난다.
     그런 명령은 .sh 파일로 써서 `wsl bash 파일`로 넘긴다.
   - ⚠ 배포 뒤 「지식저장소 N건 인입」(docs-drift)과 memory_documents 행수는 **다른 잣대**다(2026-09-06: 3920 vs 3921).
     같기를 기대하지 말고, 다르면 매니페스트 밖 문서가 무엇인지 적는다.

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
