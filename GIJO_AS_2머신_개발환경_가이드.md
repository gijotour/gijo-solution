# GIJO AS — 2머신 개발환경 가이드 (Windows ↔ M1 Max)

**구성 결정(2026-07-24)**: 코드 허브 = **머신 간 직접 git remote**(GitHub 미경유), 네트워크 = **WireGuard VPN 상시**(LAN이든 원격이든 같은 주소로 동작 — 노트북 이동 대응).

## 0. 역할 분담
| 머신 | 역할 |
|---|---|
| **Windows PC** (desktop-4qplvnc) | 주 개발 + Windows 클라 테스트 + 운영 서버(WSL 4000) + **git 허브 보관** + WireGuard 서버 |
| **M1 Max 32GB** | mac 개발 + mac 올인원(서버+Metal LLM) 빌드·검증 + mac 클라 테스트 |

## 1. 3계층 동기화 (수단이 계층마다 다름)
| 계층 | 내용 | 수단 | 비고 |
|---|---|---|---|
| 코드 | git repo | **git push/pull ↔ `D:\gijo-hub.git`** (bare 허브) | ⚠ 구글드라이브로 git repo 동기화 금지(.git 깨짐) |
| 대용량 | `models/`(GGUF)·`data/`(sqlite·lancedb) | **scp/rsync over VPN** + `migrate-data-to-mac.mjs` verify | 동기화 아닌 "시점 복사" — DB 실시간 동기화 금지 |
| 문서·산출물 | 설치본·PDF·작업내역 | **구글드라이브** ("GIJO AS to Claude") | 열람·공유 전용 |

## 2. 네트워크 — WireGuard (기존 자산 재활용, 서버 무변경)
- Mac은 **`D:\GIJO-AS-vpn\client-예비.conf` 재사용** (10.8.0.4, 서버에 이미 등록됨 — 피어 추가 불필요).
- Mac에서 [WireGuard mac 앱](https://apps.apple.com/app/wireguard/id1451685025) 설치 → `client-예비.conf` 임포트 → 켜기.
- 이후 **어디서든 Windows = `10.8.0.1`** 하나로 접근(LAN에 있어도 VPN 경유 — 주소 고정의 단순함이 장점).

## 3. Windows 1회 준비 (관리자 PowerShell — 사용자 실행 필요)
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
