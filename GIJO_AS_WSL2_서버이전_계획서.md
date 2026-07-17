# GIJO AS 서버 WSL2 이전 계획서

> **목표:** 현재 Windows에서 직접 돌리는 GIJO AS 서버를 **같은 GPU 머신의 WSL2(Ubuntu) 안**으로 옮긴다.
> **범위:** 서버만. 데스크톱 클라이언트(NSIS 설치본)·개발 환경은 Windows 그대로 유지.
> **원칙:** 운영에 필요한 파일만 반입(개발 산출물 제외), 실 GPU end-to-end 검증 후 전환, 실패 시 즉시 Windows로 롤백.
>
> **총 예상 소요: 약 1.5~2일** (모델 복사·llama.cpp 빌드 대기 포함, 실작업 약 6~8시간)

---

## 1. 왜 WSL2인가 (결정 배경)

- UTF-8 기본 로케일 → `PYTHONUTF8=1` 우회·cp949 한글 깨짐 클래스 버그 원천 제거
- torch/unsloth/llama.cpp 등 CUDA 생태계의 1차 지원 대상(Linux) 사용
- OS 재설치 없이 Windows 위에 얹는 방식 → **롤백이 쉬움** (문제 시 기존 Windows 서버 프로세스 재기동)
- WSL2 CUDA passthrough는 공식 지원, 추론 성능 베어메탈 대비 손실 미미

---

## 2. 현재 코드의 Windows 의존 지점 (수정 필요)

| 위치 | 현재 | 수정 방향 |
|---|---|---|
| `server/src/engine/localengine.ts:21` | `llama.cpp/build/bin/Release/llama-server.exe` 하드코딩 | 플랫폼 분기: Linux는 `build/bin/llama-server` |
| `server/src/engine/learnloop.ts:544` | `llama-quantize.exe` 존재 체크 | 동일 분기 |
| `server/src/engine/merge.ts:92,140` | `llama-quantize.exe` 경로 | 동일 분기 |
| `server/src/engine/bridge.ts:42` 외 4곳 | `spawn("python", …)` | Ubuntu는 `python3`가 기본 → **venv의 `python`이 PATH에 오도록 systemd 유닛에서 venv 활성화** (코드 무수정으로 해결 가능) |
| `server/src/engine/localengine.ts:131` | `nvidia-smi` 호출 | WSL2에서 `/usr/lib/wsl/lib/nvidia-smi` 자동 제공 — **무수정 통과 예상, 검증만** |
| `better-sqlite3`, `@lancedb/lancedb` | Windows 네이티브 바이너리 | WSL 안에서 `npm ci` 재설치로 자동 해결 |

**공통 유틸 제안:** `llamaBinPath(name)` 헬퍼 하나 만들어 3개 파일이 공유 (`process.platform === "win32" ? Release/${name}.exe : ${name}`).

---

## 3. 반입 파일 목록 — 필요한 것만

### 포함 (WSL ext4 내부 `~/gijo-as/` 로 복사)

| 항목 | 출처 | 비고 |
|---|---|---|
| 서버 소스 | `server/src`, `tsconfig.json`, `package.json`, `package-lock.json` | WSL에서 `npm ci` + `tsc` 빌드 (dist를 복사하지 않고 재빌드 — 코드 수정이 있으므로) |
| Python 스크립트 | `server/scripts/` (export_gguf.py, extract_doc.py, finetune_unsloth.py), `server/modelscan_wrapper.py`, `server/requirements.txt` | 학습 루프·문서 추출용 |
| DB | `server/data/gijo-as.sqlite` | 기존 운영 데이터 이관. **이관 시점에 Windows 서버 중지 후 복사** |
| 모델 (선별) | `server/models/` 중 운영 모델만 | 전체 82GB(21종) — 전체 복사 금지, 운영 3~4종(약 15~20GB)만 |
| llama.cpp | **소스만** (Windows 빌드 산출물 무용) | WSL에서 CUDA 켜고 재빌드 |

### 제외 (개발 전용 — 반입하지 않음)

- `server/node_modules/` (Windows 바이너리 — WSL에서 새로 설치)
- `server/test/`, `vitest.config.ts` (운영 서버엔 불필요, 개발 PC에서 계속 실행)
- `server/outputs/`, `server/unsloth_compiled_cache/`, `server/server.log`
- `server/llama.cpp/build/`, `*.exe`, `*.dll` (Windows 빌드 산출물)
- 리포지토리 루트의 클라이언트·개발 파일 전부: `client/`, `mockups/`, `GIJO_AS_*.html` 시안, Electron 배포 파일(`*.dll`, `*.pak`, `Connect AI.exe` 등), `antigravit-pro-app/`, `crud-app/`, `flask-app/`, `tools/`, 문서 `*.md`

> ⚠️ **모델·DB는 반드시 WSL ext4 내부**(`~/gijo-as/...`)에 둔다. `/mnt/d/...` 에 두면 9p 파일시스템 경계 때문에 모델 로드·SQLite I/O가 수 배 느려짐.

---

## 4. 단계별 계획

### Phase 0 — 사전 확인 (예상 30분)
- [ ] Windows 호스트 NVIDIA 드라이버가 WSL CUDA 지원 버전인지 확인 (`nvidia-smi` 최신)
- [ ] `wsl --version` 으로 WSL2 + 최신 버전 확인 (mirrored networking은 WSL 2.0+, Windows 11 22H2+)
- [ ] 디스크 여유 확인: WSL 가상디스크에 운영 모델 약 15~20GB + llama.cpp 빌드·venv·torch 약 10~15GB 필요 (C: 기본 — 여유 없으면 `wsl --import`로 D:에 배치)

### Phase 1 — WSL2 Ubuntu 환경 구축 (예상 1시간)
- [ ] `wsl --install -d Ubuntu-24.04` (또는 22.04)
- [ ] `/etc/wsl.conf`에 `[boot] systemd=true` → `wsl --shutdown` 후 재진입
- [ ] `sudo apt install build-essential cmake nodejs npm python3.12-venv` (Node는 LTS를 NodeSource 또는 nvm으로)
- [ ] CUDA toolkit(WSL용) 설치 — **호스트 드라이버는 건드리지 않음**, WSL 안에는 toolkit만
- [ ] `nvidia-smi` 로 GPU 인식 확인

### Phase 2 — 코드 수정 + llama.cpp 빌드 (예상 2~3시간, 빌드 대기 포함)
- [ ] `llamaBinPath()` 헬퍼 추가, `localengine.ts` / `learnloop.ts` / `merge.ts` 3곳 치환 (Windows에서도 동작 유지 — 개발 PC 회귀 없음)
- [ ] Windows 개발 PC에서 기존 294 테스트 통과 확인 후 커밋
- [ ] WSL에서 llama.cpp 클론 → `cmake -B build -DGGML_CUDA=ON && cmake --build build --config Release -j` → `llama-server`, `llama-quantize` 산출 확인

### Phase 3 — 서버 배치 (예상 1~2시간 + 모델 복사 대기)
- [ ] `~/gijo-as/server/` 에 §3 포함 목록 복사 (`/mnt/d/Connect AI/server/...` → ext4)
- [ ] `npm ci --omit=dev` → `npx tsc` 빌드 (better-sqlite3·lancedb Linux 재빌드 자동)
- [ ] `python3 -m venv ~/gijo-as/venv` → `pip install -r requirements.txt` + (학습 시) unsloth·torch(CUDA)·peft·gguf·transformers
- [ ] 운영 모델만 복사: **보안 채팅(merged-lily-gijo 또는 Lily-7B) · bge-m3(RAG 필수) · 오케스트레이터(gijo-main-orchestrator/-ko)** — 나머지 모델은 필요 시 추가 반입
- [ ] 환경변수: `GIJO_SERVER_PORT=4000`, `GIJO_MODELS_DIR`, `GIJO_LLAMA_CPP_DIR` (PYTHONUTF8 불필요해짐)

### Phase 4 — 네트워킹 + 상시 상주 (예상 1~2시간)
분산 모드(데스크톱 N대 → `http://<서버IP>:4000`)가 계속 동작해야 하는 핵심 구간.

- [ ] **1안(권장, Windows 11 22H2+):** `.wslconfig`에 `networkingMode=mirrored` → WSL이 호스트 IP를 공유, 포트포워딩 불필요
- [ ] **2안(구버전 fallback):** `netsh interface portproxy add v4tov4 listenport=4000 connectaddress=<WSL IP> connectport=4000` + WSL IP 변동 대응 스크립트
- [ ] Windows 방화벽 `4000/tcp` 인바운드 허용(사내망 한정) — 기존 규칙 재확인
- [ ] systemd 유닛 `gijo-as.service` 작성: venv PATH 포함, `Restart=always`, `WantedBy=multi-user.target`
- [ ] **Windows 부팅 시 WSL 자동 기동:** 작업 스케줄러에 `wsl -d Ubuntu-24.04 --exec /bin/true` (로그온 불필요·최고 권한) 등록 — systemd가 서비스를 이어서 올림
- [ ] Windows Update 재부팅 후 자동 복구되는지 재부팅 테스트 **필수**

### Phase 5 — 실검증 및 전환 (예상 2~3시간)
> 검증 원칙: 목업·통과 위장 없이 실 GPU end-to-end. HTTP 한글 검증은 curl이 아닌 **Node fetch** 사용.

- [ ] llama-server 모델 로드 + 채팅 응답 (한글 프롬프트 왕복)
- [ ] RAG: bge-m3 임베딩 + 장기기억 질의
- [ ] 온톨로지 규칙 주입 응답 (기존 검증 시나리오 재실행)
- [ ] WebSocket `/ws` 연결
- [ ] **다른 PC의 데스크톱 앱**에서 `GIJO_SERVER_URL=http://<서버IP>:4000` 접속 → 로그인·채팅·문서업로드
- [ ] (학습 루프 쓰는 경우) finetune_unsloth 소형 모델 1회 실행
- [ ] DB 이관 정합성: 자산·계정·문서 건수 대조
- [ ] 전환: Windows 서버 프로세스(nssm/스케줄러) 중지·비활성화, WSL을 기본으로

---

## 5. 리스크와 롤백

| 리스크 | 대응 |
|---|---|
| mirrored 모드 미지원(Windows 구버전) | 2안 portproxy로 대체 (Phase 4에 내장) |
| WSL 자동 기동 실패 → 서버 다운 | 재부팅 테스트를 전환 전 필수 통과 조건으로 |
| 장시간 학습 시 vmmem 메모리 이슈 | `.wslconfig`에 `memory=` 상한 설정, 학습은 당분간 Windows에서 병행 가능 |
| 성능 저하 | 모델·DB를 ext4 내부에 두는 것으로 대부분 회피, 추론 속도 Windows 대비 벤치 1회 |
| **롤백** | Windows 쪽 서버·모델·DB를 지우지 않고 그대로 둔다(디스크 여유 확인). 문제 시 WSL 중지 → 기존 Windows 서비스 재기동으로 즉시 복귀. DB는 전환 후 변경분이 생기므로 **롤백 시 WSL DB를 역복사** |

---

## 6. 산출물

- 코드: `llamaBinPath()` 플랫폼 분기 커밋 (Windows 개발 환경 호환 유지)
- `gijo-as.service` systemd 유닛 파일 + WSL 자동기동 스케줄러 등록 절차
- `GIJO_AS_배포_가이드.md`에 "WSL2 서버 배포" 섹션 추가 (기존 Windows 절차는 대안으로 보존)
