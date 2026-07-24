# GIJO AS 개발환경 가이드라인 (마스터 문서)

최종 갱신: 2026-07-24 · 2머신(Windows↔Mac) 개발환경의 **단일 기준 문서**.
세부 절차는 하단 "관련 문서"의 개별 가이드 참조 — 충돌 시 이 문서가 우선.

---

## 1. 전체 구성

```
                    WireGuard VPN (10.8.0.x)
   ┌────────────────────┐        ┌──────────────────────────┐
   │  Mac M1 Max 32GB   │◄──────►│  Windows PC (공인IP 직결)  │
   │  "개발기" 10.8.0.11 │  SSH   │  "운영+허브" 10.8.0.1      │
   ├────────────────────┤  git   ├──────────────────────────┤
   │ · 서버+Metal LLM    │  scp   │ · WSL 운영서버 :4000(실사용)│
   │   (채팅1·임베딩1)    │        │ · git 허브 D:\gijo-hub.git │
   │ · 운영 데이터 사본    │        │ · 클라 .exe 빌드·게시       │
   │ · Claude Code      │        │ · Claude Code             │
   └────────────────────┘        └──────────────────────────┘
```

| 머신 | 역할 | 고유 권한 |
|---|---|---|
| **Windows** | 주 개발 · 검토 · **운영 배포** · **클라 게시** · git 허브 보관 · WireGuard 서버 | WSL 운영 접근, NSIS 빌드, claude-deploy 게시 |
| **Mac** | macOS 검증(Metal LLM·dmg) · 이동 중 개발 · 범위 명확한 대량 작업 | Metal 빌드, dmg 패키징(추후) |

## 2. 절대 규칙 (역할 고정)

1. **Mac은 hub push까지.** 검토·운영 배포·클라 게시는 **Windows 담당**. Mac은 버전 bump도 미리 하지 않는다.
2. **GitHub(origin)는 백업용 — 사용자가 명시 요청할 때만 push.** hub push는 동기화용이라 자유.
3. **운영 배포·게시는 사용자가 지시했을 때만.** 자동/선제 반영 금지.
4. **data/(DB·RAG)는 git 밖 — 운영이 원본.** Mac은 시점 사본, 실시간 동기화·양쪽 동시 사용 금지. 필요 시 재이식.
5. 코드는 반드시 git(hub)으로만 이동 — 운영에 파일 직접 복사 금지(배포 절차 경유).
6. 구글드라이브는 문서·산출물 열람용 — **git repo·DB 동기화 금지**(.git 깨짐).

## 3. 일상 워크플로 — 공용 슬래시 명령 4종 (.claude/commands/)

```
어느 머신이든:  /동기화 → 개발 → /인계
운영 반영:     (Windows) /배포 → 클라 변경 있으면 /게시
```

| 명령 | 용도 | 핵심 동작 |
|---|---|---|
| `/동기화` | 작업 시작 전 | hub 최신 받기(ff-only). 갈라졌으면 rebase 안내. 서버/클라 변경 감지 시 후속 조치 알림 |
| `/인계` | 작업 마무리 | 커밋 → (서버 변경 시) `npm test` → hub push → **상대 머신 인계 블록 출력** |
| `/배포` | 운영 배포 | Windows: 테스트 게이트(914개, 실패=중단)→WSL rsync·tsc→MainPID kill→health. Mac: ssh 한 줄 안내/인계 |
| `/게시` | 클라 게시 | Windows 전용: 버전 bump→`npm run dist`→**실화면 검증 필수**→claude-deploy 게시→server-dist 원복→bump 커밋 |

수동 배포 한 줄(Mac 터미널에서): `ssh user@10.8.0.1 "powershell -NoProfile -ExecutionPolicy Bypass -File 'd:/Connect AI/tools/deploy-prod.ps1'"`
역방향(Mac 갱신): `cd ~/gijo-as && ./tools/update-dev-mac.sh`

## 4. 서로 수정이 겹칠 때 (충돌)

- 늦게 push하는 쪽이 거부됨 → `git pull --rebase hub main` → push. **다른 파일이면 자동 병합, 코드 유실 없음.**
- 같은 줄 충돌이면 그 머신의 Claude에게 "hub랑 충돌 났어, 정리해줘".
- 배포/갱신 스크립트는 전부 **ff-only** — 정리 안 된 상태로는 운영에 절대 안 나감.
- 예방: 작업 시작 전 `/동기화` 습관 + 가능하면 한 번에 한 머신 + 영역 분담(파일 안 겹치게).

## 5. 인프라 상세

### 네트워크 (WireGuard)
- 설정 일습: `D:\GIJO-AS-vpn\`. Mac 피어 = `client-mac.conf`(10.8.0.11). 예비 슬롯(10.8.0.4) 보존. 다음 빈 IP = 10.8.0.12.
- 서버 conf 수정 후엔 **터널 재설치 필요**(관리자): `wireguard.exe /uninstalltunnelservice wg0-server` → `/installtunnelservice "D:\GIJO-AS-vpn\wg0-server.conf"` (수 초 끊김, 자동 재접속). 실행 중 터널은 dpapi 사본을 쓰므로 파일만 고쳐선 반영 안 됨.
- 어디서든 Windows = `10.8.0.1` 고정 (LAN이어도 VPN 경유 — 주소 단일화).

### SSH (Windows OpenSSH)
- GitHub MSI로 설치(`D:\gijo-tools\OpenSSH-Win64-v10.0.0.0.msi`) — Windows Update 경유는 hang 이력.
- Mac 공개키 등록: 관리자 계정이라 `C:\ProgramData\ssh\administrators_authorized_keys` (사용자 폴더 authorized_keys는 무시됨!). ACL은 SYSTEM+Administrators 전용 필수.
- **방화벽: 22번은 10.8.0.0/24만 + Profile=Any** — wg 인터페이스가 Public 분류라 Private 전용 규칙은 조용히 무시됨(무응답 타임아웃). 공인 IP 직결이라 RemoteAddress 제한은 생명줄.

### git 허브
- `D:\gijo-hub.git`(bare). 양쪽 repo의 remote 이름 = `hub`. Mac 접근: `ssh://user@10.8.0.1/d:/gijo-hub.git`.
- Windows가 꺼져 있으면 Mac은 push/pull 불가(트레이드오프). GitHub = `origin`(요청 시만).

### 계정
- SSH/scp: `user` (Mac 키 등록으로 비번 불필요)
- 제품 게시·앱 테스트: `claude-deploy`(admin) — 비번은 Windows 사용자 환경변수 `GIJO_ADMIN_USER/PASSWORD` (셸 상속 안 되면 `[Environment]::GetEnvironmentVariable(...,"User")`로 명시 로드). 게시는 `--force`(자기 세션만 교체, jyh 무사).
- 실사용: jyh — Claude 작업에 사용 금지(세션 끊김 방지).

## 6. Mac 올인원 구성 (개발기)

- LLM: llama.cpp **Metal 소스 빌드**(`server/llama.cpp`, brew는 sudo 필요해 불가했음) + `GIJO_LLAMA_SERVER_PATH` ~/.zshrc 등록.
- 모델: bge-m3(HF gpustack), gijo-main-orchestrator + merged-lily (Windows에서 scp 이식).
- 데이터: 운영 `data/` 시점 사본 (sqlite+lancedb+**encryption.key**). 이식 검증: `server/scripts/migrate-data-to-mac.mjs verify`.
- 알려진 정상 상태: 자동시작 모델=merged-lily(운영 lastModelId 승계·한국어 최고), 티어 "pro 권장" 배지=무시하고 **standard 유지**(macOS 메모리 공유), JWT 시크릿 경고=개발기라 무방.
- 성능 기대치: 7~8B Q4 ≈ 25~40 tok/s (대역폭 400GB/s).

## 7. 함정 사전 (실사고 기반 — 재발 방지)

| 함정 | 증상 | 해법 |
|---|---|---|
| Windows 방화벽 Profile | VPN에서 특정 포트만 무응답 타임아웃 | 규칙 Profile=Any + RemoteAddress로 제한 |
| 관리자용 authorized_keys | 키 등록했는데 비번 계속 물음 | ProgramData\ssh\administrators_authorized_keys + ACL |
| scp 경로 공백 | `"d:/Connect AI/..."` 따옴표 중첩 실패 | `d:/Connect\ AI/...` 백슬래시 이스케이프 |
| WSL kill 파이프 | grep\|awk로 PID 조회가 빈 값 | `systemctl show -p MainPID --value` 직접 조회 |
| User 스코프 env | 게시 스크립트가 "계정 필요" 오류 | 셸에서 `[Environment]::GetEnvironmentVariable("...","User")` 명시 로드 |
| 허브 iframe 검증 | 같은 페이지 프레임 2개(스테일 빈 프레임) | 렌더된 프레임(.hero 등 존재)을 골라 검사 |
| curl 한글 | HTTP 검증에서 한글 깨짐 | Node fetch 사용 |
| server-dist | 빌드 후 package.json 더럽혀짐 | `git checkout --`으로 원복 |
| Windows Update 설치 hang | Add-WindowsCapability 무한 대기 | GitHub MSI 등 직접 설치로 우회 |
| 운영 재시작 | 배포마다 전체 세션 로그아웃 | 정상 동작 — 근무시간대 배포는 접속자 확인 후 |

## 8. 관련 문서

| 문서 | 내용 |
|---|---|
| `CLAUDE.md` | 양 머신 Claude 공통 컨텍스트(규칙·구조·함정 요약) — 세션 자동 로드 |
| `GIJO_AS_2머신_개발환경_가이드.md` | 초기 구축 절차 상세 (1회성 세팅) |
| `GIJO_AS_MAC_올인원_배포_가이드.md` | Mac Metal 빌드·데이터 이식 상세 |
| `GIJO_AS_개발환경_테스트_매뉴얼.md` | 사용자 직접 검증 T1~T7 |
| `.claude/commands/*.md` | /동기화·/인계·/배포·/게시 동작 정의 |
| `tools/deploy-prod.ps1`, `tools/update-dev-mac.sh` | 배포·갱신 스크립트 본체 |
