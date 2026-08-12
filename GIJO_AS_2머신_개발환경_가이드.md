# GIJO AS — 머신 개발환경 가이드 (`win` ↔ `max` ↔ `gb10`)

> **2026-08-11 — 3머신으로 늘어나는 중.** NVIDIA GB10(DGX Spark 계열)이 세 번째 머신으로
> 들어온다(VPN 10.8.0.12 예정). 피어 발급 절차·자산 주기 점검 경로·최소권한 설계는
> **`GIJO_AS_GB10_VPN_자산점검_구성안.md`** 에 따로 적었다. 아래 본문은 그대로 유효하다.

**구성 결정(2026-07-24)**: 코드 허브 = **머신 간 직접 git remote**(GitHub 미경유), 네트워크 = **WireGuard VPN 상시**(LAN이든 원격이든 같은 주소로 동작 — 노트북 이동 대응).

## 0. 기계 이름과 역할 분담

**기계는 `win` · `max` · `gb10` 세 이름으로만 부른다(2026-08-12 결정).**
"윈도우"·"맥"은 **고객 OS**를 가리킬 때만 쓴다 — 라이트 에디션의 「윈도우/맥 설치 가이드」가 그 예다.

> ⚠ 왜 나눴나: "윈도우 클라이언트에서 계정을 만드세요"가 *어느 기계에서*인지로 읽히지 않아
> 실제로 헷갈렸다(2026-08-12, QA 계정 건). 기계는 `win`, OS는 윈도우 — 이 한 줄이 그걸 막는다.

| 이름 | 기계 | VPN | 역할 |
|---|---|---|---|
| **`win`** | Windows PC (desktop-4qplvnc) | `10.8.0.1` | 주 개발 · `win` 클라 시험 · **운영 서버(WSL 4000)** · **git 허브 보관**(`D:\gijo-hub.git`) · WireGuard 서버 |
| **`max`** | M1 Max 32GB (GIJOHNMAC, arm64) | `10.8.0.11` | `max` 개발 · 올인원(서버+Metal LLM) 빌드·검증 · `max` 클라 시험 |
| **`gb10`** | NVIDIA GB10 / DGX Spark (`gijohn_llm`, `promaxgb10-1d0a`, aarch64) | `10.8.0.12` | ARM CUDA 실측 담당 — **`win`에서는 열려 있다**(아래 참고) |

⚠ **`gb10`에 코드를 넣는 건 `win`이 한다** — `git push gb10 main`은 `win`에서. `max`에서 직접 밀지 않는다.

> **2026-08-12 정정 — `gb10`은 "준비 중"이 아니다.** 이 표에 잠시 「4000·22 모두 닫힘」으로 적혔는데,
> 그건 **`max`에서 잰 값**이다. 같은 날 `win`에서 재면 `ssh gb10`도 `git push gb10 main`도 정상이고
> (`uname -m` = `aarch64`), `gb10`의 작업트리는 이미 최신 커밋까지 올라와 있다.
> **`max`에서 안 닿는 것은 고장이 아니라 설계다** — WireGuard 피어끼리는 서로 라우팅되지 않고,
> `gb10` 반영은 원래 `win` 담당이다(바로 위 줄). 「닫혔다」로 적어 두면 `win`에서 밀 수 있는 것을
> 아무도 안 미는 자리가 생긴다. **접속 가능 여부는 그 일을 맡은 기계에서 잰다.**

## 1. 3계층 동기화 (수단이 계층마다 다름)
| 계층 | 내용 | 수단 | 비고 |
|---|---|---|---|
| 코드 | git repo | **git push/pull ↔ `D:\gijo-hub.git`** (bare 허브) | ⚠ 구글드라이브로 git repo 동기화 금지(.git 깨짐) |
| 대용량 | `models/`(GGUF)·`data/`(sqlite·lancedb) | **scp/rsync over VPN** + `migrate-data-to-mac.mjs` verify | 동기화 아닌 "시점 복사" — DB 실시간 동기화 금지 |
| 문서·산출물 | 설치본·PDF·작업내역 | **구글드라이브** ("GIJO AS to Claude") | 열람·공유 전용 |

## 2. 네트워크 — WireGuard (기존 자산 재활용, 서버 무변경)
- `max`는 **`D:\GIJO-AS-vpn\client-예비.conf` 재사용**으로 붙였다(서버에 이미 등록됨 — 피어 추가 불필요).
- `max`에서 [WireGuard macOS 앱](https://apps.apple.com/app/wireguard/id1451685025) 설치 → `client-예비.conf` 임포트 → 켜기.
- 이후 **어디서든 `win` = `10.8.0.1`** 하나로 접근(LAN에 있어도 VPN 경유 — 주소 고정의 단순함이 장점).

> **2026-08-12 정정 — `max`의 주소는 `10.8.0.11`이다.** 이 절에 오래 `10.8.0.4`(예비 conf의 원래 값)로
> 적혀 있었는데, 실제 `max`에서 잰 값은 `10.8.0.11`이다(`ifconfig | grep 'inet 10.8.'`).
> 어느 시점에 피어가 갈렸다. **접속 주소를 문서에서 베끼지 말고 기계에서 잴 것.**

## 3. `win` 1회 준비 (관리자 PowerShell — 사용자 실행 필요)
```powershell
# ① OpenSSH 서버 설치·시작
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd; Set-Service sshd -StartupType Automatic

# ② ⚠ 중요: 이 PC는 공인 IP 직결 — SSH(22)를 VPN 대역만 허용으로 제한
Set-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -RemoteAddress 10.8.0.0/24

# ③ git이 SSH 세션에서 보이도록 시스템 PATH 확인(이미 C:\Program Files\Git\cmd 있음 — 보통 불필요)
```
git 허브는 이미 생성됨: **`D:\gijo-hub.git`** (bare). 로컬 repo에 `hub` remote 연결·push 완료.

## 4. `max` 1회 준비
```bash
# ① WireGuard 켠 상태에서 SSH 확인
ssh user@10.8.0.1   # `win` 로그인 비번. (권장: ssh-copy-id로 키 등록)

# ② 코드 받기
git clone "ssh://user@10.8.0.1/d:/gijo-hub.git" ~/gijo-as
cd ~/gijo-as && git remote rename origin hub

# ③ 대용량 받기 (모델·데이터 — 시점 복사)
scp -r "user@10.8.0.1:d:/Connect AI/server/models" ~/gijo-as/server/
scp -r "user@10.8.0.1:d:/Connect AI/server/data"   ~/gijo-as/server/
node server/scripts/migrate-data-to-mac.mjs verify   # 온전성 확인
```

## 5. 일상 워크플로
```
어느 머신이든:  수정 → 커밋 → git push hub main
반대편:        git pull hub main → npm test → 그 플랫폼 검증
```
- `win`이 허브 보관자이므로 **`max`에서 push/pull하려면 `win`이 켜져 있어야 함** (직접 remote 방식의 트레이드오프).
- GitHub(origin) push는 **기존 규칙 유지 — 요청 시만**. 허브(hub) push는 동기화용 일상 동작.

## 6. 교차 테스트 토폴로지 (코드 수정 불필요 — 로그인 화면 서버 URL만)
```
`win` 클라 ── http://10.8.0.11:4000 ──▶ `max` 개발 서버   (올인원 원격 검증)
`max` 클라 ── http://10.8.0.1:4000  ──▶ `win` 운영 서버   (운영 회귀 — 읽기만)
```
**계정·권한·안전 난간은 `GIJO_AS_교차QA_방안.md`에 따로 적었다.** 그쪽이 본문이다.

- 2026-08-12 실측: 양방향 다 HTTP 200(`win`→`max` 왕복 5ms·손실 0%). `max` 방화벽은 꺼져 있고
  서버는 `*:4000`으로 열려 있어 **추가 허용이 필요 없었다.**
- ⚠ `max`에서 **자기** 주소(`10.8.0.11:4000`)로는 안 붙는다 — utun 경로가 `LOCAL`로 잡힌다.
  자기 기계는 `localhost:4000`으로 본다. 이걸 「서버가 안 열렸다」로 읽지 말 것.
- ⚠ **`win`은 ICMP를 막는다** — `max`→`win` ping은 실패해도 TCP는 된다.

## 7. 주의사항
- `data/`(sqlite·lancedb)는 **양쪽에서 동시에 쓰지 말 것** — 서로 다른 운영 데이터가 됨. 원본은 WSL 운영, `max`는 시점 복사본으로 검증.
- `client-예비.conf`를 `max`가 점유하므로 예비 슬롯 소진 — 향후 진짜 예비가 필요하면 새 피어 발급.
- `win` OpenSSH 기본 셸은 cmd — git 명령은 동작하나, 문제가 생기면 `git-upload-pack` PATH를 확인.
- **`max`: `npm ci` 하면 Electron 서명이 깨진다**(2026-08-09 실측). 앱이 안 뜨거나 손상됐다고 나오면
  재서명하면 복구된다. **의존성을 설치할 때마다 재발**하므로 `qa-mac.mjs`가 이걸 잡는다 —
  `max`에서 `npm ci` 뒤에는 QA를 한 번 돌리고 넘어갈 것.
- **의존성이 바뀌면 받는 쪽은 `npm ci`부터.** 안 하면 원인이 엉뚱하게 보인다 — 2026-08-09에
  `better-sqlite3-multiple-ciphers`가 추가된 걸 모르고 넘어가 `max`에서 **275개 시험 파일이
  전부 실패**했다. 코드 문제로 오해하기 딱 좋다. (`/GIJOAS인계`가 이제 자동으로 확인해 적는다.)
- **DB 저장 암호화 이후 `sqlite3` CLI·일반 드라이버로는 운영 DB를 못 연다.** "file is not a
  database"가 나오면 파일이 깨진 게 아니라 **잠긴 것**이다. 서버 API를 쓰거나, 꼭 직접 읽어야
  하면 서버 폴더에서 제품의 db 모듈을 빌린다(`node -e 'const {db}=require("./dist/db.js")'`).
  `server/scripts/_dbguard.mjs`가 이 상황을 미리 알려 준다.

## 8. 비밀번호·자격증명은 어디에 두나 (기계마다 자리가 다르다)

**공통 원칙 하나: 저장소(repo)에는 절대 적지 않는다.** 기계마다 OS가 주는 금고가 달라서
넣고 꺼내는 명령만 다를 뿐, 「코드 밖에 둔다」는 같다.

| 기계 | 자리 | 넣기 | 꺼내기 |
|---|---|---|---|
| **`win`** | Windows **사용자 환경변수** | `setx GIJO_ADMIN_PASSWORD "<값>"` | `$env:GIJO_ADMIN_PASSWORD` |
| **`max`** | **macOS 키체인** | `security add-generic-password -a claude-qa -s gijo-max-claude-qa -U -w` | `security find-generic-password -a claude-qa -s gijo-max-claude-qa -w` |
| **`gb10`** | `~/.gijo-secrets` (**`chmod 600`**) — `~/gijo-env.sh`에서 `source` | 편집기로 `export KEY=값` | `. ~/gijo-env.sh` 뒤 `$KEY` |

현재 쓰는 것: `win`은 게시·QA용 `claude-deploy` 계정 비밀번호(`GIJO_ADMIN_PASSWORD`),
`max`는 QA 계정 `claude-qa`. `gb10`은 **아직 담을 비밀이 없다**(자리만 정해 둔 것).

### 지키면 사고가 안 나는 네 가지

- **`-w`는 값 없이 쓴다.** `security add-generic-password … -w` 뒤에 값을 붙이면 그 비밀번호가
  `~/.zsh_history`와 `ps` 출력에 **평문으로 남는다.** 값 없이 쓰면 화면에서 입력받는다(재입력까지 요구).
- **꺼내는 명령은 화면에 평문을 찍는다.** 터미널 스크롤백·화면 갈무리·대화 기록에 그대로 남는다.
  스크립트에서는 변수로 받을 것: `PASS=$(security find-generic-password -a claude-qa -s gijo-max-claude-qa -w)`
- **`-a`와 `-s`가 한 글자라도 다르면 못 찾는다**(종료코드 44, "could not be found in the keychain").
  넣을 때와 꺼낼 때 **같은 이름**을 쓴다 — 계정은 `claude-qa`, 서비스는 `gijo-max-claude-qa`로 맞췄다.
  (2026-08-12에 `-a gijo-qa`로 넣고 `claude-qa`로 꺼내려다 어긋날 뻔했다.)
- **이미 있으면 `add`는 오류 45로 실패한다**(덮어쓰지 않는다). 바꿀 때는 `-U`를 붙인다.

> ⚠ **`gb10`의 `~/gijo-env.sh`에는 비밀을 넣지 말 것.** 2026-08-12 확인 시 권한이 `664`라
> **같은 기계의 다른 사용자도 읽을 수 있다.** 비밀은 반드시 `~/.gijo-secrets`(`chmod 600`)에 두고
> 거기서 `source`한다. 지금은 `CUDA_HOME`·`PATH`·`LD_LIBRARY_PATH`뿐이라 위험하지 않다.

> ⚠ 비대화형 ssh(`ssh gb10 '<명령>'`)는 `.bashrc`를 안 읽는다. 원격 명령마다
> `. ~/gijo-env.sh &&` 를 앞에 붙여야 값이 보인다.
