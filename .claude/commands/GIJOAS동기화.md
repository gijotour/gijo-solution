# /GIJOAS동기화 (구 /sync) — 작업 시작 전 hub 동기화

2머신(Windows↔Mac) 개발환경에서 작업을 시작하기 전 코드를 최신으로 맞춘다. 다음을 순서대로 수행하라:

1. `git status --short`로 커밋 안 된 변경 확인. 있으면 **먼저 사용자에게 보고**하고 (커밋할지/두고 갈지) 확인받은 뒤 진행.
2. `git fetch hub` 후 `git merge --ff-only hub/main`.
3. **ff-only가 실패하면** (로컬과 hub가 갈라짐): 로컬 커밋을 먼저 확인시키고, `git pull --rebase hub main`으로 합친다. 충돌 나면 충돌 파일과 양쪽 의도를 사용자에게 보여주고 병합안을 제안한 뒤 해결.
4. 결과 보고: HEAD 이전→이후 해시, 새로 받은 커밋 요약(한 줄씩).
5. **서버 코드(server/)가 갱신됐으면** 알려줄 것:
   - macOS: `./tools/update-dev-mac.sh` 실행을 제안 (빌드+재시작+health까지)
   - Windows: 운영 반영이 필요한 변경인지 판단해 `/GIJOAS배포` 필요 여부를 알려줄 것
6. 클라이언트(client/src/renderer/)가 갱신됐으면: 화면 반영은 게시(/GIJOAS게시) 또는 로컬 앱 재실행이 필요함을 알려줄 것.

주의: GitHub(origin)는 건드리지 않는다 — origin push/fetch는 사용자가 명시 요청할 때만.
