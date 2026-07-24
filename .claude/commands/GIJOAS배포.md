# /GIJOAS배포 — 운영(WSL) 서버 배포

운영 서버(Windows의 WSL, localhost:4000)에 hub 최신 코드를 배포한다. **머신에 따라 동작이 다르다:**

## Windows에서 (직접 수행)
tools/deploy-prod.ps1과 같은 절차를 **단계별로** 수행한다 (스크립트 일괄 실행은 권한 정책에 막히므로 단계 분리가 표준):

1. `git fetch hub && git merge --ff-only hub/main` — 갈라졌으면 중단하고 /GIJOAS동기화 먼저.
2. **테스트 게이트**: `cd server && npm test` — 하나라도 실패하면 **배포 중단**, 결과 보고.
3. 의존성 변경 확인: 직전 배포 이후 server/package.json 변경 시 경고(WSL에서 npm ci 필요할 수 있음).
4. WSL 동기화+빌드:
   `wsl -d Ubuntu-24.04 -- bash -c "rsync -a --delete '/mnt/d/Connect AI/server/src/' /home/gijo/gijo-as/server/src/ && cd /home/gijo/gijo-as/server && npx tsc -p tsconfig.json && echo BUILD_OK"`
5. 재시작 (grep/awk 파이프 금지 — 인용 함정):
   `wsl -d Ubuntu-24.04 -- systemctl show gijo-as.service -p MainPID --value` 로 PID 얻고 `wsl -d Ubuntu-24.04 -- kill <PID>`
6. health 확인: Node fetch로 http://localhost:4000/api/health 를 최대 60초 폴링 (curl은 한글 응답 검증에 쓰지 말 것).
7. 보고: 이전→새 PID, health, 배포된 커밋. ⚠ 재시작으로 접속 중 세션이 끊겼음을 명시.

## macOS에서 (직접 배포하지 않음)
운영 배포는 Windows 담당이다. 다음 중 하나를 안내:
- 사용자 직접 실행용 한 줄 출력: `ssh user@10.8.0.1 "powershell -NoProfile -ExecutionPolicy Bypass -File 'd:/Connect AI/tools/deploy-prod.ps1'"`
- 또는 /GIJOAS인계 인계 블록을 만들어 "Windows Claude에게 검토·배포 요청"을 권한다.

공통 규칙: 운영 배포는 사용자가 명시적으로 지시했을 때만 실행한다. 자동/선제 배포 금지.
