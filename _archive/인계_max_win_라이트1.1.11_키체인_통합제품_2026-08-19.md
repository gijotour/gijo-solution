# 인계 — `max` → `win` (2026-08-19)

## 0. 한 줄

라이트 **1.1.11** 나갔다(hub `7c7ef35`). **win의 두 수리(조합 가드·화면 얼림 방지 `dialog.js`)를 실빌드에서 검증**했고, 사장님이 겪던 **키체인 '항상 허용' 반복을 뿌리째** 잡았다(서명 문제 아님). 사장님 지시로 **라이트 standalone 설치는 통합 제품 나올 때까지 보류**.

---

## 1. win 수리 2건 — 실빌드에서 닫힘 ✅

win이 공용 뿌리에서 고쳐 준 것을 라이트 dmg(1.1.11)에 담아 실앱에서 확인했다.

- **조합 가드**: 라이트 7파일에 `&& !e.isComposing` 한 줄씩 — 재편 화면 안 깨짐 확인.
- **화면 얼림 방지(`dialog.js`)**: 라이트 5파일 native `alert/confirm` → `gijoTell/gijoAsk`.
  - ⚠ **검증**: 실행 중인 1.1.11 셸에서 `typeof window.gijoTell === "function"`, `gijoAsk`도 function. `dialog.js`가 `src/renderer/**`로 라이트 번들에 실려(표준 `nav.js` `loadDialog()`와 같은 상대경로) **정상 해소**. win이 짚은 「셸이 `gijoTell`을 부르는데 스크립트를 안 실어 undefined였다」 회귀가 **라이트에서 실제로 닫혔다.**

→ win 몫 수리가 라이트에 잘 안착했다. 추가 조치 없음.

---

## 2. 키체인 '항상 허용' 반복 — **서명 아니라 키체인 항목 문제**였다

사장님 반복 불만("항상 허용해도 계속 뜸")의 진짜 원인을 잡았다. **`mac-adhoc-sign.cjs`(인증서 서명)는 손댈 것 없다.**

- 서명은 정상: `codesign -dvvv`에 `Authority=GIJO AS Lite Signing`, `Signature size≠0`(ad-hoc 아님).
- 그런데도 프롬프트가 계속 뜬 건 → **Safe Storage 키체인 항목(단일)의 ACL이 예전 ad-hoc 빌드 신원에 묶여** 있어, 인증서 신원으로 '항상 허용'을 눌러도 **partition-list가 안 맞아 매번 재요청**. '항상 허용'으론 **절대 안 고쳐지는 자리**.
- **해결**: 그 항목을 지우면 인증서 서명된 앱이 **새 항목을 만들며 스스로 소유자**가 됨 → 이후 안 뜸.
  ```
  pkill -f "GIJO AS Lite"; security delete-generic-password -s "GIJO AS Lite Safe Storage" ~/Library/Keychains/login.keychain-db && open -n ".../GIJO AS Lite.app"
  ```
  검증(무프롬프트): `security dump-keychain login.keychain-db | grep -c 'svce"<blob>="GIJO AS Lite Safe Storage"'`가 로그인 후 **1**이면 재소유 성공. 부작용은 저장 로그인 1회 재입력뿐.
- ⚠ **진단 함정 둘** — 앞으로 Mac에서 서명/키체인 볼 때:
  1. `security find-identity -v -p codesigning`은 자체서명 인증서를 **"0 valid identities"**로 보이지만(신뢰 정책 없음) `codesign --sign "GIJO AS Lite Signing"`은 **정상 작동**한다. "0 valid"에 속지 말 것.
  2. `security find-generic-password -g`(비번 표시)는 **키체인 프롬프트를 띄운다** — 진단 중 절대 쓰지 말고 `dump-keychain`(메타데이터, 무프롬프트)으로 셀 것.

---

## 3. win 최근 인계 6연속 — 전부 라이트 안전(max 확인함)

win이 표준/프로에서 한 작업들, 라이트 관점에서 하나씩 확인했다. **하나도 라이트를 깨지 않음:**

- **자산 범위(`#표식` 누출·범위 필터)**: 라이트 13도구에 범위 도구 없음 + `lite-chat`이 `sendInstructionStream(…, undefined, …)`로 스코프 없이 호출 → `parseScopeMark`=null → **표식 주입도 누출도 불가.** 라이트 무관.
- **프로 셸(main.ts `shell:get/set`·`query.shell=pro`)**: `에디션() !== "lite"` 가드로 라이트 차단 확인(`빌드에디션 lite`면 모드 변경도 거부). `query.shell`은 `app.html`에만 실림(라이트는 `lite-app.html`). max의 허용스킴(mailto/tel ⑤) 온전.
- **screenguide 문구(「사이드바」→「☰ 전체 메뉴」)**: `화면위치안내(…, pro=false)` 기본값이라 **라이트 호출부 한 글자도 안 바뀜** + 라이트 전용 문구("라이트는 위쪽 제목줄의 📝 문서 작성") 보존. 무관.

→ win이 라이트를 못 빌드하니(max 몫), 위 확인은 max가 책임진다. **현재까지 라이트 회귀 0건.**

---

## 4. 통합 제품 — 라이트 배포 보류(사장님 2026-08-19)

- 사장님: **통합 제품 나오니 라이트 `/Applications` 영구 설치는 그때 함께** 정한다. 지금은 `release-lite` 검증본 사용.
- **win에게**: 통합 제품 설계할 때 **라이트를 에디션 축으로 함께** 넣으면 자연스럽다 — 이미 `main.ts`가 `에디션()`(lite/standard) × `저장된셸모드()`(standard/pro) 두 축을 갖고 있고, 라이트는 그 첫 축이다. **라이트 배포 마감(설치 위치·자동업데이트·아이콘)을 지금 확정하지 말 것** — 통합 제품이 흡수/변경할 수 있다.

---

## 5. max 쪽 준수 사항

- 새 라이트 화면에서 `Enter` 판정 쓰면 `&& !e.isComposing` 붙인다(`imecomposition.test.ts` 준수). 알겠다.
- 라이트 재빌드 레시피(stage-llama-**metal**·인증서 서명·CDP)는 max 메모리에 있음. `stage-llama-cuda`는 Windows 전용이라 Mac에선 절대 안 씀.
