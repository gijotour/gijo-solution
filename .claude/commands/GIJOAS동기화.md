# /GIJOAS동기화 (구 /sync) — 작업 시작 전 코드 최신화

작업을 시작하기 전 코드를 최신으로 맞춘다. 다음을 순서대로 수행하라:

0. **어느 원격을 쓸지 먼저 정한다** — 머신마다 다르다. `git remote`로 실제 확인하고 고른다:
   - `hub`가 있으면 → **`hub`** (사장님 머신 `win`·`max`. 허브는 `win`의 `D:\gijo-hub.git`, WireGuard 경유)
   - `hub`가 없으면 → **`origin`** (GitHub. 외부 협업자 머신은 이쪽뿐이다)
   - ⚠ 원격 이름을 넘겨짚지 말 것. 없는 원격을 부르면 그냥 실패한다.
   - ⚠ **`gb10`은 받는 곳이 아니라 보내는 곳이다** — 여기서 fetch/merge 대상으로 고르지 말 것.
     `gb10`은 `win`이 `git push gb10 main`으로 밀어넣는다(그쪽이 `updateInstead`).
   아래에서 `<원격>`은 이렇게 고른 것을 말한다.
1. `git status --short`로 커밋 안 된 변경 확인. 있으면 **먼저 사용자에게 보고**하고 (커밋할지/두고 갈지) 확인받은 뒤 진행.
2. `git fetch <원격>` 후 `git merge --ff-only <원격>/main`.
3. **ff-only가 실패하면** (로컬과 원격이 갈라짐): 로컬 커밋을 먼저 확인시키고, `git pull --rebase <원격> main`으로 합친다. 충돌 나면 충돌 파일과 양쪽 의도를 사용자에게 보여주고 병합안을 제안한 뒤 해결.
4. 결과 보고: HEAD 이전→이후 해시, 새로 받은 커밋 요약(한 줄씩).
5. **서버 코드(server/)가 갱신됐으면** 알려줄 것:
   - `max`: `./tools/update-dev-mac.sh` 실행을 제안 (빌드+재시작+health까지)
   - `win`: 운영 반영이 필요한 변경인지 판단해 `/GIJOAS배포` 필요 여부를 알려줄 것
     + **`gb10`에도 밀 것인지** 알려줄 것(`git push gb10 main` — ARM CUDA 실측이 걸린 변경이면 필요)
6. 클라이언트(client/src/renderer/)가 갱신됐으면: 화면 반영은 게시(/GIJOAS게시) 또는 로컬 앱 재실행이 필요함을 알려줄 것.
7. **의존성이 바뀌었으면**(`git diff --name-only HEAD@{1}..HEAD -- server/package.json client/package.json`이 비지 않으면)
   `npm ci` 먼저 하라고 알릴 것. ⚠ 실사고(2026-08-09): 이걸 놓쳐 `max`에서 275개 시험 파일이 통째로 실패했다.

주의:
- `hub`를 쓰는 머신에서 **GitHub(origin) push/fetch는 사용자가 명시 요청할 때만.**
  `origin`만 있는 머신에서는 origin이 유일한 통로이므로 이 제한이 적용되지 않는다.
- 공동작업 중이면 **main에 직접 push하지 않는다** — 브랜치 + PR이다. `GIJO_AS_공동작업_가이드.md` 참조.
