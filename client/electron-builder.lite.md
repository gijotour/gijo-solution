# `electron-builder.lite.json` — 왜 이렇게 두었나

⚠ **이 설명이 왜 옆 파일에 있나**: `electron-builder`는 설정 JSON에 **모르는 열쇠가 있으면 빌드를 거부한다.**
2026-08-12에 `_설명`을 넣었다가 그 자리에서 깨졌다(`unknown property '_설명'`). JSON엔 주석을 못 단다.
그래서 「왜」를 여기 두고 파일 이름을 나란히 맞췄다 — 폴더를 열면 둘이 붙어 보인다.

GIJO AS Lite 배포 설정 — `npm run dist:lite`가 이것을 쓴다(win이 이름만 뚫어 두고 넘겼다).
본 제품(package.json의 build)과 **나란히 깔릴 수 있어야 한다** — 같은 PC에 둘 다 있을 수 있고,
그러려면 appId·productName·출력 폴더가 갈려 있어야 한다. 그게 이 파일의 첫 번째 이유다.

## ⚠ 아직 못 푼 것 둘 — 설정이 조용히 감추지 않게 적어 둔다

① 첫 화면 — 로그인 뒤 app.html로 가는 것이 login.html:302에 **박혀 있다.**
   라이트는 lite-app.html로 가야 하는데 그건 공용 파일이라 win이 한 줄 넣어야 한다
   (main.ts의 navigate:to에서 GIJO_EDITION=lite면 app.html → lite-app.html).
   그 한 줄이 없으면 이 배포본은 **본 제품 화면으로 들어간다.**
② llama-server가 안 들어간다 — extraResources가 server-dist뿐이다.
   본 제품은 서버 관리자가 따로 깔지만 **라이트는 담당자 PC에 혼자 도는 제품**이라
   엔진이 없으면 첫날부터 대화가 안 된다. 2026-08-10부터 미결이고 라이트에서 더 아프다.

⚠ 화면을 안 걸렀다(files가 본 제품과 같다) — 라이트 배포본에 표준 화면 40개가 같이 들어간다.
   좁히는 것이 옳지만 **깨질 위험이 있어 1차는 담고 간다.** 실제 위험은 낮다:
   라이트 셸의 사이드바가 라이트 화면만 내주고, window.gijoOpenScreen도 라이트 목록만 연다.
   ▶ win이 ①을 넣을 때 **라이트에서 표준 화면 이동을 막는 것**까지 같이 하면 그때 좁힌다.

## 확인한 것 (2026-08-12)

- 본 제품과 갈린 것: `appId` `ai.gijo.as` → `ai.gijo.as.lite` · `productName` → `GIJO AS Lite` ·
  출력 폴더 `release` → `release-lite`. **같은 PC에 나란히 깔릴 수 있어야 한다.**
- 본 제품 build에 있는 열쇠 중 **빠뜨린 것 없음**(대조로 확인).
- 참조 파일 실재 확인: `build/installer.nsh` · `build/mac-adhoc-sign.cjs` · `server-dist`.

## 첫 빌드 실측 (2026-08-12)

```
GIJO AS Lite-5.15.1-arm64.dmg   191M
GIJO AS Lite-5.15.1-arm64.zip   186M
ad-hoc 서명 통과 · appId ai.gijo.as.lite (본 제품 ai.gijo.as와 갈림)
app.asar 안: lite-*.html 10개 + lite-screens.json ✅
server-dist/dist/lite ✅ (라이트 진입점이 들어갔다)
```

⚠ **`find`로는 화면이 0개로 보인다** — `app.asar` 안이라서다.
　처음에 그걸 보고 「안 들어갔다」로 읽을 뻔했다. 안을 보려면:
```bash
node -e 'console.log(require("@electron/asar").listPackage("<앱>/Contents/Resources/app.asar"))'
```

⚠ **`llama-server`는 여전히 0개다.** 위 ②가 실물로 확인된 것이다 —
　이 dmg를 받은 고객은 화면은 다 보이는데 **대화가 안 된다.**
