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
- `max`에서 [WireGuard mac 앱](https://apps.apple.com/app/wireguard/id1451685025) 설치 → `client-예비.conf` 임포트 → 켜기.
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

## 4. Mac 1회 준비
```bash
# ① WireGuard 켠 상태에서 SSH 확인
ssh user@10.8.0.1   # Windows 로그인 비번. (권장: ssh-copy-id로 키 등록)

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
- Windows가 허브 보관자이므로 **Mac에서 push/pull하려면 Windows가 켜져 있어야 함** (직접 remote 방식의 트레이드오프).
- GitHub(origin) push는 **기존 규칙 유지 — 요청 시만**. 허브(hub) push는 동기화용 일상 동작.

## 6. 교차 테스트 토폴로지 (코드 수정 불필요 — 로그인 화면 서버 URL만)
```
Windows 클라 ── http://10.8.0.4:4000 ──▶ Mac 서버      (mac 올인원 원격 검증)
Mac 클라     ── http://10.8.0.1:4000 ──▶ WSL 운영 서버 (기존 운영 회귀)
```
- Mac 서버 테스트 시 mac 방화벽에서 4000 인바운드 허용(VPN 인터페이스).

## 7. 주의사항
- `data/`(sqlite·lancedb)는 **양쪽에서 동시에 쓰지 말 것** — 서로 다른 운영 데이터가 됨. 원본은 WSL 운영, mac은 시점 복사본으로 검증.
- `client-예비.conf`를 Mac이 점유하므로 예비 슬롯 소진 — 향후 진짜 예비가 필요하면 새 피어 발급.
- Windows OpenSSH 기본 셸은 cmd — git 명령은 동작하나, 문제가 생기면 `git-upload-pack` PATH를 확인.
- **Mac: `npm ci` 하면 Electron 서명이 깨진다**(2026-08-09 실측). 앱이 안 뜨거나 손상됐다고 나오면
  재서명하면 복구된다. **의존성을 설치할 때마다 재발**하므로 `qa-mac.mjs`가 이걸 잡는다 —
  Mac에서 `npm ci` 뒤에는 QA를 한 번 돌리고 넘어갈 것.
- **의존성이 바뀌면 받는 쪽은 `npm ci`부터.** 안 하면 원인이 엉뚱하게 보인다 — 2026-08-09에
  `better-sqlite3-multiple-ciphers`가 추가된 걸 모르고 넘어가 Mac에서 **275개 시험 파일이
  전부 실패**했다. 코드 문제로 오해하기 딱 좋다. (`/GIJOAS인계`가 이제 자동으로 확인해 적는다.)
- **DB 저장 암호화 이후 `sqlite3` CLI·일반 드라이버로는 운영 DB를 못 연다.** "file is not a
  database"가 나오면 파일이 깨진 게 아니라 **잠긴 것**이다. 서버 API를 쓰거나, 꼭 직접 읽어야
  하면 서버 폴더에서 제품의 db 모듈을 빌린다(`node -e 'const {db}=require("./dist/db.js")'`).
  `server/scripts/_dbguard.mjs`가 이 상황을 미리 알려 준다.
