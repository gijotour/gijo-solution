# 고객 QA 인스턴스(형태 ⓑ · 포트 4100) — 도구와 규칙

> 고객은 클라이언트만 설치하고 WireGuard로 **우리 쪽 고객 QA 인스턴스(4100)** 에 붙는다.
> 운영 4000(사내 실데이터)은 고객에게 보이지 않는다 — 그 전제를 지키는 것이 이 폴더의 일이다.
> 근거 문서: `GIJO_AS_AI팀_증류학습_계획서.md` §13.5 · §13.5.1 · §14.

## 파일

| 파일 | 무엇 |
|---|---|
| `preflight.sh` | **기동 전 자물쇠 검사** — 운영 노드 생존(cwd로 가름)·운영 health 200·모델 폴더 빔·DEV_MODE 없음·**GIJO_NO_SELF_SCAN=1 있음**. start.sh와 systemd 유닛이 **같은 이 파일**을 부른다 |
| `start.sh` | sudo 없이 임시 기동(setsid nohup). 먼저 preflight를 지난다 |
| `verify.sh` | 4100이 성한지 + **운영이 무사한지**. 기준선 파일을 주면 llama PID·4000 health를 문자열 비교 |
| `chat-probe.mjs` | **고객이 쓰는 길**(POST /api/dispatch)로 한 문답 + 그 대화가 chat_logs에 쌓였는지 |
| `gijo-qa.service` | 시스템 유닛 본보기(ExecStartPre로 preflight) — 등록은 관리자 |
| `refresh-portproxy.ps1` | 재부팅으로 바뀐 WSL IP에 4000·4100 포워딩을 다시 맨다(관리자·작업 스케줄러) |

### env에 반드시 있어야 하는 줄 — `GIJO_NO_SELF_SCAN=1`

```
GIJO_NO_SELF_SCAN=1
```

`/home/gijo/gijo-qa/gijo-qa.env`에 이 한 줄이 없으면 **preflight가 막아 4100이 안 뜬다**
(systemd는 `StartLimitBurst=30` 뒤 멈춘다). 하는 일은 「이 서버 자신」 하드닝 점검을 끄는 것이다 —
없으면 「보안설정 점검 안 한 장비 있어?」 같은 물음에 **우리 호스트 OS의 설정 상태**(준수율·U-02 …)가
고객 화면에 그대로 나간다(2026-09-10 예행 ㉔ · 형태 ⓑ 격리 전제 위반).
env 줄의 전체 목록과 「어기면 무슨 일이 나는가」는 `gijo-qa.service` 머리글의 표가 단일 출처다.

⚠ **env만 넣고 끝이 아니다** — preflight.sh는 아래 「스크립트 사본」대로 복사해 쓰는 사본이라,
새 검사가 든 파일을 다시 복사하지 않으면 자물쇠가 아예 안 돈다.

### 스크립트 사본
유닛은 `/home/gijo/gijo-qa/tools/preflight.sh`를 부른다 — 저장소 파일의 **사본**이다.
저장소에서 고쳤으면 사본도 갱신할 것:

```bash
cp "/mnt/d/Connect AI/tools/qa-instance/"{preflight.sh,start.sh,verify.sh,chat-probe.mjs} /home/gijo/gijo-qa/tools/
```

## 검사 순서(실행자)

```bash
# 기동 전
bash tools/qa-instance/verify.sh --baseline > /home/gijo/gijo-qa/tmp-review/baseline.txt
bash tools/qa-instance/start.sh
# 기동 후 — 기준선을 반드시 넘긴다(안 넘기면 PID 비교를 못 한다)
bash tools/qa-instance/verify.sh /home/gijo/gijo-qa/tmp-review/baseline.txt
QA_USER=… QA_PASS=… QA_ADMIN_USER=… QA_ADMIN_PASS=… node tools/qa-instance/chat-probe.mjs
```

## 야간 회귀 2차 패스 — 4100도 밤마다(2026-09-11 사장님 「권고순서대로」 ①)

지금까지 야간 회귀(`tools/nightly-ops-sim.ps1`, 03:00 KST)는 운영(4000)에만 돌았다.
이제 4000 패스가 **끝난 뒤** 같은 하네스(`tools/ops-sim.mjs`)를 4100에도 돌린다 —
잣대는 하나다(하네스를 두 벌로 만들지 않는다). 근거 문서:
`GIJO_AS_AI팀_증류학습_계획서.md` §13.5.1 「되돌리기」 줄(2026-09-11 변경 이력 참고).

| 무엇 | 값 |
|---|---|
| 실행기 | `tools/nightly-ops-sim.ps1`의 2차 패스 블록(4000 패스 뒤) |
| 실제로 도는 것 | `tools/qa-instance/nightly-4100.sh` → `GIJO_SERVER_URL=http://localhost:4100 QA_USER=qa-observer node tools/ops-sim.mjs --out ops-sim-4100` |
| 결과 파일 | `.tmp-reports\ops-sim-4100-nightly-YYYYMMDD.log`(Windows 쪽 실행 로그) · `.tmp-reports/ops-sim-4100.json`·`.meta.json`·`.md`(WSL 쪽 하네스 자체 보고 — `--out` 이름을 따른다) |
| 계정 | `qa-observer`(관찰용, README 「계정」절 — 등급 null) |
| 4100이 내려가 있을 때 | Windows 쪽에서 `/api/health`를 먼저 보고, 200이 아니면 WSL을 부르지 않고 로그에 「건너뜀」만 남긴다 — **4000 패스에는 영향 0**(이미 끝나 있다) |

### 비밀 규칙

비밀번호는 `/home/gijo/gijo-qa/secrets/계정-비밀번호.txt`(700, gijo 소유)에**만** 있다.
Windows 쪽(`nightly-ops-sim.ps1`·`.tmp-reports` 로그)에는 **새로 저장하지 않는다.**
`nightly-4100.sh`가 그 파일에서 읽어 이 프로세스의 env로만 넘기고, `ops-sim.mjs`의
표준출력은 `grep -v "$QA_PASS"`를 한 번 더 지나 로그에 평문이 찍히지 않게 막는다.
파일 형식(라벨 뒤 몇 번째 낱말이 진짜 비밀번호인지)은 코드가 가정하지 않는다 — 라벨 뒤
낱말을 전부 후보로 모아 `/api/auth/login`에 실제로 던져 **200이 나는 것만** 쓴다(판정은
서버가 한다).

### qa:true라 4100에 학습 후보·세션이 안 쌓인다 — 코드로 확인한 근거

`ops-sim.mjs`는 `/api/dispatch`에 항상 `qa: true`를 싣는다(`tools/ops-sim.mjs:1039`).
서버 쪽에서 그 플래그가 실제로 막는 지점 세 곳을 코드로 확인했다(2026-09-11):

1. **학습 후보(chat_logs)** — `dispatcher.ts`의 `dispatchInstructionScoped`는
   `if (qa) { … return … }`(약 1068행)로 **일찍 분기**한다. 세션 생성·`appendTurn`·
   `recordChatLog`(학습 후보 수집의 유일한 호출 지점, 1119행)는 전부 그 **아래 else 블록**에만
   있어서, `qa:true`면 애초에 그 코드를 지나지 않는다. 계정이 무엇이든(옛 설계 문서가 가정한
   "노학습 계정 목록"과 무관하게) 막힌다 — 더 강한 보장이다.
2. **작업 세션(work sessions)** — 같은 분기 이유로 `createSession`·`markSession`도
   `qa:true`에서는 안 불린다. 4100 대화 목록에 4100 회귀 문항이 세션으로 안 쌓인다.
3. **작업 원장(work_events)** — `worklog.ts`의 `recordWork()`가 단일 관문이다:
   `if (e.qa) return;`(114행). `qa`를 실어 보내는 호출부(`actioncheck.ts`·
   `agentloop.ts`의 도구 실행 기록)는 전부 이 관문을 지나 **기록 안 함**으로 떨어진다.
   ⚠ 정직하게 적는다 — `recordWork` 호출부 중 `hardeningscan.ts`(스케줄 실행 경로)·
   `memory.ts`(문서 인입 API)·`verifyroutes.ts`(장비 검증 API) 세 곳은 `qa` 인자를 아예
   안 받는다. 다만 `ops-sim.mjs`는 `/api/auth/login`·`/api/auth/logout`·`/api/dispatch`·
   `/api/agents`(GET)·`/api/llm/remote/where`(GET)만 두드리고 위 세 경로(문서 업로드·
   장비 검증 API·스케줄 하드닝)는 호출하지 않으므로 **이번 회귀 트래픽으로는 닿지 않는다.**
   채팅으로 하드닝 점검을 시키는 문항이 있다면 그 경로는 `agenttools/handlers.ts`가
   `skipWorkLog:true`로 hardeningscan.ts 쪽 기록을 끄고, 대신 agentloop의
   `recordToolWork`가 `scope.qa`를 그대로 실어 `recordWork`의 같은 관문을 지난다 — 이중
   기록도 없다.

### 되돌리기

`tools/nightly-ops-sim.ps1`에서 위 「2차 패스 — 고객 QA 인스턴스(4100)」 블록만 지우면
4000 패스만 남은 예전 상태로 돌아간다. `tools/qa-instance/nightly-4100.sh` 자체는 독립
실행 가능한 도구라 지우지 않아도 된다(손으로 `bash tools/qa-instance/nightly-4100.sh`도 된다).

## 운영 재시작 순서 — **먼저 4100을 내린다**

운영의 고아 정리(`localengine.ts:749-759`)는 **살아 있는 형제 노드가 보이면 통째로 건너뛴다.**
4100을 상주로 두면 앞으로 운영이 재시작할 때마다 그 정리가 영구히 꺼진다.
포트를 쥔 고아가 남아 있으면 `allocPort`(530행)가 OS 바인딩 가능 여부를 안 보기 때문에
운영의 새 llama가 못 뜨고 **화면은 멀쩡한데 챗봇만 조용히 죽는다**(735행 주석이 부르는 그 고장).

```bash
sudo systemctl stop gijo-qa      # ① 고객 인스턴스 정지
sudo systemctl restart gijo-as   # ② 운영 재시작(고아 정리가 제대로 돈다)
sudo systemctl start gijo-qa     # ③ 고객 인스턴스 재기동(preflight가 운영 health를 확인한다)
```

## 관리자 단계(사장님 · sudo/승격 필요)

1. **방화벽 겹침 — 결정이 먼저다.** 지금 규칙 「GIJO AS - 서버(VPN 전용)」= TCP **4000** · 원격 **10.8.0.0/24** · Allow.
   고객 피어(client-ext-tester1~6 = 10.8.0.5~10)도 그 대역이라, 4100을 같은 대역으로 열면
   **고객이 운영 4000에도 닿는다**(운영 4000은 `/api/health`·`/api/auth/login`이 인증 전 창구다 — 실측 무인증 200).
   두 길 중 하나를 고르셔야 한다:
   - ⓐ 운영 4000 규칙을 우리 피어로 좁힌다(권장 · **2026-09-10 사장님 「방화벽 직접 설정」으로 채택**):
     **한 번에**: 관리자 PowerShell에서 `powershell -ExecutionPolicy Bypass -File "D:Connect AI	oolsqa-instanceadmin-network-once.ps1"`
     (①방화벽 ②포워딩 ③재부팅 예약 ④확인 출력을 한 번에 한다 · `-WhatIf`면 점검만 · 되돌리기는 파일 머리에)
     손으로 하면 — 운영 4000은 **우리 피어**(.2 담당자1 · .3 담당자2 · .4 예비 · .11 mac · .12 gb10)로:
     `Set-NetFirewallRule -DisplayName "GIJO AS - 서버(VPN 전용)" -RemoteAddress 10.8.0.2,10.8.0.3,10.8.0.4,10.8.0.11,10.8.0.12`
     4100은 **고객 피어(.5~.10) + 관찰용 우리 피어(.2 .3 .4 .11)** 로만(대역 전체 `/24`로 열면 고객끼리·운영 도구가 섞인다):
     `New-NetFirewallRule -DisplayName "GIJO AS - 고객 QA(4100·VPN 전용)" -Direction Inbound -Protocol TCP -LocalPort 4100 -RemoteAddress 10.8.0.5,10.8.0.6,10.8.0.7,10.8.0.8,10.8.0.9,10.8.0.10,10.8.0.2,10.8.0.3,10.8.0.4,10.8.0.11 -Action Allow`
     ⚠ 피어 주소의 단일 출처는 `D:GIJO-AS-vpnwg0-server.conf`의 [Peer] AllowedIPs 다 — 피어를 더하면 두 목록도 고친다.
   - ⓑ 고객을 다른 대역(예: 10.9.0.0/24)에 두고 4100만 그 대역에 연다(WireGuard 피어 재발급 필요).
2. **포워딩**: `refresh-portproxy.ps1`을 한 번 실행 + 작업 스케줄러에 「부팅 시」로 등록(스크립트 머리에 명령 그대로 있음).
3. **systemd 유닛**: `sudo cp tools/qa-instance/gijo-qa.service /etc/systemd/system/` → `daemon-reload` → `enable --now gijo-qa`.
   등록 전에 임시 기동본을 내린다: `pgrep -f 'dist/index.js' | xargs -r -I{} sh -c 'readlink -f /proc/{}/cwd | grep -q gijo-qa && kill {}'`
   (PID를 적어 두지 말 것 — 며칠 뒤엔 남의 PID다.) 등록 뒤 `verify.sh`를 **다시** 돌린다.
4. **node_modules 심볼릭 링크**: QA 트리의 `server/node_modules`가 운영 트리를 가리키고 **쓰기가 된다**.
   QA에서 `npm ci`를 한 번만 잘못 돌려도 운영 의존성이 바뀐다. 읽기 전용 bind mount가 옳다:
   `mount --bind -o ro /home/gijo/gijo-as/server/node_modules /home/gijo/gijo-qa/server/node_modules`
   (그 전까지는 **QA 트리에서 npm 금지**가 유일한 방어다.)
5. **비밀 인계**: `/home/gijo/gijo-qa/secrets/`(700)에 `db-복구열쇠.txt`·`계정-비밀번호.txt`가 있다.
   종이에 옮긴 뒤 **지운다**. 두 값은 작업 기록에 한 번 노출됐으므로 인계 때
   **계정 비밀번호 교체 + DB 복구 열쇠 재발급**(설정 > 관리자)이 필요하다.

## 알아 둘 것(위험은 아니나 기록)

- **8080 슬롯 공유**: 고객 질문과 사내 질문이 같은 llama-server 슬롯·프롬프트 캐시를 쓴다 —
  서로의 응답 시간을 흔든다(유휴 뒤 첫 질문이 느려지는 계보와 같은 자리).
- **모델 받기 창구는 QA에서 무의미**: `hfmodels.ts:142`가 `GIJO_MODELS_DIR`이 아니라 `<cwd>/models`에 받는다.
  4100에서는 그 자리가 `server/models`라 자물쇠(`models-empty`)와 **다른 폴더**다 — 자물쇠는 안 풀리지만,
  받아도 엔진이 못 본다.
- **제품 문서 2건 재인입**: 재기동마다 `docsbundle`이 2건을 다시 넣는다(35 → 이후 2건씩).
  숨은 지시문이 걸린 문서 수와 맞아, 정화본과 원본 해시가 어긋나는 것으로 보인다 — 서버 코드 갈래(별도 라운드).
- **고객 인스턴스 env 원칙**: 출하 기본값을 쓰되, **수집이 목적인 두 줄만** 운영과 맞춘다
  (`GIJO_CHATLOG_MAX`·`GIJO_KPI_SUBJECT_RULE`). 그 밖의 운영 전용 줄(특히 `GIJO_DEV_MODE`)은 넣지 않는다.
