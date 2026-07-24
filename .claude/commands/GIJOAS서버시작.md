# /GIJOAS서버시작 — 개발 서버 기동/재시작

머신에 따라 "서버"의 의미가 다르다 — 플랫폼을 확인하고 맞는 동작을 수행하라.

## macOS에서 (개발 서버 — 직접 기동)
1. 기존 프로세스 정리: `pkill -f "node dist/index.js"` (없으면 무시. 이 명령 자체는 bash라 자기매칭 안 됨)
2. 빌드: `cd ~/gijo-as/server && npm run build`
3. 기동: `nohup node dist/index.js > ~/gijo-as-server.log 2>&1 &`
   - `GIJO_LLAMA_SERVER_PATH`가 env에 있는지 확인(~/.zshrc 등록됨) — 없으면 임베딩/LLM이 안 뜬다.
4. health 확인: Node fetch로 `http://localhost:4000/api/health` 최대 30초 폴링 (curl로 한글 응답 검증 금지)
5. 보고: PID·health 결과·로드된 모델 상태(`/api/localengine/status`는 인증 필요하니 로그로 확인).
   실패 시 `~/gijo-as-server.log` 끝 20줄을 보여줄 것.

## Windows에서 (운영 WSL 서버 — 상시 구동이므로 "상태 확인·재시작")
운영 서버는 systemd(gijo-as.service)가 상시 구동한다. "시작"이 필요한 상황은 사실상 재시작이다:
1. 상태: `wsl -d Ubuntu-24.04 -- systemctl status gijo-as.service --no-pager | head -8` + health 확인
2. 재시작이 필요하면(코드 갱신 후 등) **사용자에게 확인 후**:
   `wsl -d Ubuntu-24.04 -- systemctl show gijo-as.service -p MainPID --value` → `kill <PID>` (grep/awk 파이프 금지)
   ⚠ 재시작하면 접속 중인 전체 사용자 세션이 끊긴다 — 반드시 고지.
3. Windows 로컬에 별도 개발 서버를 띄우는 건 **권장하지 않는다** — 4000 포트가 WSL 운영과 충돌한다.
   꼭 필요하면 `GIJO_PORT`(또는 해당 env)를 바꿔 띄우고 클라이언트 서버 주소도 맞출 것.
