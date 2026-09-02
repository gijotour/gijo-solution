# GIJO AS — Mac 환경 QA 계획

**제정** 2026-07-26 · **대상** Mac 개발기(M1 Max 32GB / macOS 26) · **짝 문서** `GIJO_AS_버전관리_기준.md`

---

## 1. 원칙 — Mac은 "Windows가 못 하는 것"만 검증한다

기존 QA 자산은 이미 상당하다: `qa-full.mjs`(변경 영향 계층만 선별 실행) · `qa-suite.mjs` · `qa-auto.mjs` · 서버 테스트 112개 파일 · `tools/regress/`.

**그런데 이것들은 Windows/WSL 운영 기준으로 작성돼 있다.** `qa-auto.mjs`의 사용법부터가 `wsl.exe -e bash -lc ...`다.

따라서 Mac QA의 역할은 **재실행이 아니라 보완**이다. 같은 것을 두 번 도는 것은 낭비고, Mac에서만 잡히는 것을 놓치는 것이 진짜 손실이다.

> **한 줄 규칙**: Windows에서 검증 가능한 것은 Mac에서 다시 돌지 않는다.

---

## 2. Mac 고유 검증 대상

### A. 플랫폼 분기 코드 — 4개 파일

Windows에서 **절대 실행되지 않는 경로**다. 서버 코드가 바뀌면 Mac에서 반드시 확인한다.

| 파일 | darwin 분기 내용 |
|---|---|
| `server/src/util/llamabin.ts` | win32는 `build/bin/Release/*.exe`, 그 외는 `build/bin/*` |
| `server/src/engine/preflight.ts` | darwin이면 GPU를 **Apple Metal**로 보고(nvidia-smi 아님) |
| `server/src/engine/localengine.ts` | darwin이면 **통합메모리를 VRAM으로 간주** → 티어 판정 |
| `server/src/engine/hardeningscan.ts` | `hostRunner` / `winHostRunner` 분기 |

### B. 창 · OS 통합 — Windows에 개념 자체가 없음

| 항목 | 기준 |
|---|---|
| 신호등 ↔ 헤더 로고 겹침 | 신호등 우측끝 ≈62px vs 로고 좌측 ≈93px → **여유 31px** |
| 네이티브 풀스크린 | 자체 Space 전환 · 메뉴막대/Dock 숨김 (Windows F11과 다름) |
| ⌘ 단축키 | 동작 + **표기**(`⌘ +`·`⌘ −`·`⌃⌘F`. `Ctrl`·`F11` 아님) |
| 헤더 드래그 창 이동 | 빈 영역 드래그로 창이 따라오는가 |

### C. 배포 위생 — 실제로 터진 것들

| 항목 | 사고 내용 |
|---|---|
| Electron 코드서명 | `npm install` 하면 서명이 깨져 **XProtect가 앱을 휴지통으로 보냄**(2026-07-24 발생) |
| `better-sqlite3` ABI | Electron(Node 20) vs 시스템(Node 22) 불일치 → 번들 서버 즉사 |

### D. 렌더링 차이

- **오버레이 스크롤바** — macOS는 기본 숨김, Windows는 항상 표시 → **레이아웃 실폭이 다름**
- 폰트 폴백 — Pretendard 없으면 Apple SD Gothic Neo (Windows는 맑은 고딕)
- 한글 줄바꿈(`word-break: keep-all`) 결과 차이

### E. Metal 추론 성능

- tok/s — M1 Max 기준선 **25~40** (2026-07-24 실측 32.6)
- 모델 로드 — cold ≈14초 / warm ≈2초

---

## 3. 3계층 실행 체계

### L0 — 자동 (동기화할 때마다)

```bash
cd ~/gijo-as && node tools/qa-mac.mjs      # Mac 고유 전수 (§2 A·C 자동화분)
cd ~/gijo-as/server && npm test            # 112개 파일 — 플랫폼 분기 포함
cd ~/gijo-as && ./tools/update-dev-mac.sh  # 빌드+재기동+health
```

`qa-mac.mjs`는 FAIL이 있으면 종료 코드 1을 낸다(스크립트 연동 가능). `--json`으로 기계 판독, `--no-net`으로 오프라인 실행.

### L1 — 반자동 (CDP 9223) · **Mac에서 가장 값어치 있는 계층**

앱을 `--remote-debugging-port=9223`으로 띄우면 DOM을 직접 잴 수 있다. 2026-07-25~26 반응형·타이틀바·사이드바 검증을 전부 이 방식으로 했다.

```bash
cd ~/gijo-as/client && npm run build
GIJO_SERVER_URL=http://localhost:4000 ./node_modules/.bin/electron . --remote-debugging-port=9223 &
curl -s http://127.0.0.1:9223/json/version    # 뜬 것 확인
```

측정 항목: 신호등/로고 좌표 · 가로세로 넘침 · 그리드 열 수 · sticky 유지 · 팝업 셸 로드 · 배율 적용 · 권한 거부 동작.

### L2 — 육안 (사람)

`GIJO_AS_버전관리_기준.md`가 게시 필수 조건으로 요구:

> "실화면 검증 통과 — 자동검사 + 육안(스크린샷). **자동만 믿지 않는다(실사고 다수)**"

**§2-B(창·OS 통합)는 DOM으로 볼 수 없다.** 신호등이 로고를 가리는지는 OS 레벨 캡처가 필요하다.

---

## 4. 회귀 체크리스트 — 실사고 기반

추측 항목 없음. 전부 2026-07-24~26에 실제로 발생해 작업을 중단시킨 것들.

| # | 사고 | 재발 조건 | 자동 검사 |
|---|---|---|---|
| 1 | Electron이 휴지통으로 격리 | `client`에서 `npm install/ci` | ✅ `qa-mac.mjs` |
| 2 | `better_sqlite3.node` ABI 불일치 | 번들 서버 실행 | ✅ (존재 확인) |
| 3 | 서버가 죽어 있음(SIGTERM, 원인 불명) | 재부팅·불명 | ✅ + **launchd로 근본 해결** |
| 4 | VPN 터널 끊김(하루 2회) | 불명 | ✅ **TCP로 확인** |
| 5 | 낡은 lock 파일이 hub 머지 차단 | — | ✅ 작업트리 검사 |
| 6 | 하네스가 잘못된 cwd로 빈 DB 생성 | 서버 모듈 직접 import | ✅ `qa-mac.mjs` 내 chdir |

> ⚠ **4번 주의**: 이 환경은 ICMP를 정책상 차단한다. **ping 실패를 근거로 판단하면 오진한다.**
> 실제로 2026-07-26 "Windows가 꺼졌다"고 잘못 결론냈다가, TCP 4000이 붙는 것을 보고 정정했다.
> 도달성 판단은 반드시 `nc -z` 등 **TCP**로 한다.

---

## 5. 실행 시점

| 시점 | 계층 |
|---|---|
| `/GIJOAS동기화` 후 `server/` 변경 있음 | L0 |
| `/GIJOAS동기화` 후 `client/src/renderer` 변경 있음 | L1 |
| **창·타이틀바·배율 관련 변경** | **L1 + L2**(Mac 고유) |
| Windows가 게시 전 Mac 검증 요청 | L0 + L1 + L2 |
| 매일 첫 작업 | `qa-mac.mjs` 만 |

---

## 6. 인프라 — 2026-07-26 구축분

### 6-1. 서버 자동 기동 (launchd)

```
~/Library/LaunchAgents/com.gijo.as.server.plist
```

- **RunAtLoad** — 로그인 시 기동 (재부팅해도 살아남음)
- **KeepAlive(SuccessfulExit=false)** — 비정상 종료 시 자동 재기동. 정상 종료는 존중
- **ThrottleInterval 10** — 재기동 폭주 방지
- 로그: `~/gijo-as-server.log`

검증 완료: `kill -9` 후 **PID 4544 → 4586 자동 복구 확인**.

```bash
launchctl print gui/$(id -u)/com.gijo.as.server     # 상태
launchctl kickstart -k gui/$(id -u)/com.gijo.as.server  # 수동 재기동
launchctl bootout gui/$(id -u)/com.gijo.as.server   # 해제
```

⚠ 에이전트가 로드돼 있으면 **`pkill` 해도 launchd가 되살린다.** 코드 갱신 후 재시작은 반드시 `update-dev-mac.sh`를 쓸 것 — 그 스크립트가 에이전트를 감지해 `kickstart`로 전환한다(포트 충돌 방지).

### 6-2. Mac QA 하네스

```
tools/qa-mac.mjs
```

§2-A·C와 §4를 한 번에 검사. 종료 코드로 판정.

---

## 7. 미해결 — 육안 검증(L2) 차단

| 방식 | 상태 | 볼 수 있는 것 |
|---|---|---|
| CDP 스크린샷 | ✅ 가능 | 화면 **내용** |
| **OS 화면 캡처** | ❌ **권한 없음** | **창 프레임 · 신호등 · 풀스크린** |
| `gen-screenshots.mjs` | ⚠ 미확인 | **msedge 채널 의존** — Mac에 Edge 없으면 실패 |

**문제**: Mac 고유 항목(§2-B)이 정확히 OS 캡처가 필요한 영역이다.

**필요 조치**: macOS **시스템 설정 › 개인정보 보호 및 보안 › 화면 기록**에서 Claude 데스크톱 앱 허용. 이것은 사용자만 부여할 수 있다.

**그전까지의 대안**: §2-B는 사람이 직접 눈으로 확인하고 결과를 알려주는 방식으로 진행한다. 이 상태에서는 **Mac이 정책상 "게시 가능" 판정을 단독으로 낼 수 없다.**

---

## 8. 요약

- Mac QA는 **Windows가 못 하는 것만** — 중복 실행 금지
- 대상: 플랫폼 분기 4곳 · 창/OS 통합 · 배포 위생 · 렌더링 차이 · Metal 성능
- L0 자동(`qa-mac.mjs`) → L1 CDP → L2 육안
- 회귀 6건은 전부 **실사고 기반**. 특히 **ping으로 도달성 판단 금지**
- 서버 자동 기동 완료 → 회귀 3번 근본 해결
- **남은 것: 화면 기록 권한** — 없으면 L2 불가
