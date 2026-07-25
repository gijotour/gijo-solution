# /QA전수조사 — 변경사항 기반 QA 전수조사

사용자가 "QA 전수조사"(또는 이 명령)를 말하면 아래를 수행한다.

## 절차
1. **실행** (Windows PowerShell 기준):
   ```powershell
   Set-Location "D:\Connect AI"
   $env:QA_USER="claude-deploy"; $env:QA_PASS=[Environment]::GetEnvironmentVariable("GIJO_ADMIN_PASSWORD","User")
   node tools/qa-full.mjs
   ```
   - 스크립트가 알아서: 마지막 통과 커밋 이후 **변경 파일을 git으로 수집** → 영향 계층만 선택 실행.
   - 매핑: 품질 엔진(llm·memory·dispatcher·hybridsearch 등) 변경→지식·시나리오·회귀까지 / server→단위테스트 / client→실페이지·스윕 / regress·rag-seed→회귀. 스모크(server 13)는 항상.
   - 옵션: `--all` 전 계층 강제, `--fast` vitest·LLM 시나리오 생략.
2. **Electron 스윕(sweep)이 "미기동 스킵"으로 나오면**: 클라를 CDP 9223으로 띄우고 claude-deploy 로그인 후(기존 /GIJOAS클라시작 + 로그인 자동화 패턴) 재실행해 스윕까지 포함시킨다.
3. **결과 보고**: 계층별 통과/실패 표 + 변경 파일 요약(`.tmp-reports/qa-full-report.md`). 실패가 있으면 마커가 갱신되지 않으므로, **원인을 고친 뒤 재실행해 통과를 확인**하고 나서 보고를 마친다 — 실패를 감추지 않는다.

## 주의
- 실패 시 낡은 QA 기대값(탭 수·그룹 변경 미반영)이 단골 원인 — 제품 정상 여부를 실화면으로 먼저 확인 후, 기대값 갱신은 근거와 함께.
- 테스트가 만든 문서·데이터는 반드시 정리(QA* 접두 문서 삭제).
- 운영(4000) 서버가 죽어 있으면 server 계층부터 실패한다 — /GIJOAS서버시작 절차로 상태 확인.
