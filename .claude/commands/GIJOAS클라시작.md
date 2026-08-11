# /GIJOAS클라시작 — 클라이언트(Electron) 개발 실행

최신 코드로 클라이언트를 빌드해 띄운다(개발 실행 — 설치본과 별개). **Windows·Mac 공통**(GB10은 화면 없는 서버 실측용이라 해당 없음).

1. 빌드: `cd <repo>/client && npm run build` (tsc + preload 번들. 실패하면 중단·보고)
2. 실행:
   - **Windows**: `Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList "--remote-debugging-port=9223","."`
     (검증 자동화를 위해 CDP 9223을 기본으로 켠다. npx 경유는 Start-Process에서 조용히 실패하는 이력 있음 — electron.exe 직접 실행)
   - **macOS**: `npx electron . --remote-debugging-port=9223 &` (또는 `node_modules/.bin/electron`)
3. 뜨는지 확인: 5~8초 후 `http://127.0.0.1:9223/json/version` 응답 확인. 안 뜨면 stderr 로그를 파일로 받아 원인 보고
   (`-RedirectStandardError`로 받아야 보인다 — "DevTools listening" 줄이 정상 신호).
4. 안내: 로그인 화면에서 서버 주소 선택 —
   - Windows: 운영 `localhost:4000` / Mac 서버 테스트는 `10.8.0.11:4000`
   - Mac: 자기 서버 `localhost:4000` / 운영 교차 테스트는 `10.8.0.1:4000`
5. 로그인까지 자동으로 해달라고 하면 **claude-deploy 계정**을 쓴다(실사용 jyh 세션 보호).

주의:
- 설치된 정식 앱(GIJO AS.exe)과 개발 실행이 동시에 떠 있으면 혼동된다 — 개발 확인 끝나면 종료할 것.
- 타이틀바(C안)·배율 등 main.ts 변경은 빌드해야 반영된다(HTML만 고쳤으면 새로고침으로 충분).
