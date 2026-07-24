# /GIJOAS게시 — 클라이언트 빌드·게시 (Windows 전용)

Electron 클라이언트를 빌드해 운영 서버에 게시한다(자동 업데이트 배포). **Windows에서만 수행** — macOS에서 이 명령을 받으면 "게시는 Windows 담당"이라 안내하고 /GIJOAS인계를 권할 것.

절차:

1. **버전 bump**: client/package.json의 version을 패치 올림(예: 2.7.16→2.7.17). 게시 노트에 쓸 변경 요약을 git log에서 뽑아 정리.
2. **빌드**: `cd client && npm run dist` (백그라운드 권장, 수 분 소요. NSIS exe 생성 확인)
3. **게시 전 실화면 검증(필수)**: release/win-unpacked의 새 빌드를 `--remote-debugging-port=9223`으로 띄우고 playwright-core CDP로:
   - claude-deploy 계정으로 로그인 (운영 localhost:4000)
   - 이번 변경 화면 + 회귀 표본 1~2개 렌더·동작 확인, 스크린샷
   - 허브 iframe은 스테일 중복 프레임이 있을 수 있음 — **렌더된 프레임을 골라** 검사할 것
4. **게시**: 반드시 claude-deploy로 (jyh 실사용 세션 보호):
   ```powershell
   cd "D:\Connect AI\client"
   $env:GIJO_ADMIN_USER=[Environment]::GetEnvironmentVariable("GIJO_ADMIN_USER","User")
   $env:GIJO_ADMIN_PASSWORD=[Environment]::GetEnvironmentVariable("GIJO_ADMIN_PASSWORD","User")
   npm run publish-release -- --force --notes "<버전 - 변경 요약>"
   ```
   (User 스코프 env가 셸에 상속 안 되므로 위처럼 명시 로드. --force는 claude-deploy 자기 세션만 교체라 안전)
5. **정리**: `git checkout -- client/server-dist/package.json client/server-dist/package-lock.json` (추적 산출물 원복) → 버전 bump 커밋("클라 X.Y.Z 게시 — …") → `git push hub main`.
6. 보고: 버전·sha256·게시 노트·검증 결과.

전제: 사용자가 게시를 지시했을 때만 실행("빌드 및 게시" 등). 서버 변경이 함께 있으면 /GIJOAS배포를 먼저.
