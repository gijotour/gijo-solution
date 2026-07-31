// 화면이 **있지도 않은 함수**를 부르고 있지 않은지 전수 대조한다.
//
// ⚠ 실사고(2026-07-31, 사용자 신고 "복구 열쇠 재발급 메뉴 클릭이 안 되는데"):
//   settings.html이 `window.gijoDialog.confirm(...)`을 불렀는데 **gijoDialog는 이 제품에
//   존재하지 않았다.** 저장소를 통틀어 그 한 줄만 그 이름을 썼다. 버튼을 누르면 TypeError로
//   죽고 **아무 일도 일어나지 않는다** — 화면은 멀쩡히 보이고 버튼도 눌리는데 반응만 없다.
//
//   왜 못 잡았나:
//     · 타입 검사 — window.* 는 any라 통과한다
//     · 스윕(menu-sweep) — 화면이 렌더되는지만 본다. 버튼을 눌러 보지 않는다
//     · 실화면 검증 — 그 버튼을 안 눌러 봤다(admin 파괴적 동작이라 자동으로 누르기 조심스럽다)
//   그래서 **부르는 이름과 노출된 이름을 대조**한다. 누르지 않고도 잡힌다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);
const preloadSrc = fs.readFileSync(new URL("../../client/src/preload.ts", import.meta.url), "utf8");
const pageFiles = fs.readdirSync(pagesDir).filter((f) => /\.(html|js)$/.test(f));
const pageSrc = new Map(pageFiles.map((f) => [f, fs.readFileSync(new URL(f, pagesDir), "utf8")]));

describe("화면이 부르는 window.gijo.* 는 preload가 실제로 노출한 것이어야 한다", () => {
  // preload의 최상위 키(2칸 들여쓰기 `name:`)를 노출 목록으로 본다.
  const 노출 = new Set([...preloadSrc.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));

  it("노출 목록을 실제로 읽어 온다 — 못 읽으면 이 시험이 거짓 통과다", () => {
    expect(노출.size).toBeGreaterThan(100);
    expect(노출.has("me")).toBe(true);
    expect(노출.has("navigateTo")).toBe(true);
  });

  it("없는 함수를 부르는 화면이 없다", () => {
    const 없는것: string[] = [];
    for (const [file, src] of pageSrc) {
      for (const m of src.matchAll(/window\.gijo\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (!노출.has(m[1])) 없는것.push(`${file}: window.gijo.${m[1]}`);
      }
    }
    expect([...new Set(없는것)], "부르면 TypeError로 죽는다 — 버튼이 조용히 안 먹는다").toEqual([]);
  });
});

describe("window.gijo* 전역은 정의된 것만 쓴다", () => {
  // gijoDialog처럼 **아예 존재하지 않는 전역**을 부르는 것을 잡는다.
  // 노출 경로는 두 가지다: preload의 exposeInMainWorld, 또는 화면 스크립트의 window.X = ...
  const 정의 = new Set<string>(["gijo"]);
  for (const m of preloadSrc.matchAll(/exposeInMainWorld\(\s*["']([A-Za-z0-9_]+)["']/g)) 정의.add(m[1]);
  for (const src of pageSrc.values()) {
    for (const m of src.matchAll(/window\.(gijo[A-Za-z0-9_]*)\s*=/g)) 정의.add(m[1]);
  }

  it("노출 경로를 실제로 읽어 온다", () => {
    expect(정의.has("gijoRealtime"), "preload의 exposeInMainWorld를 못 읽었다").toBe(true);
  });

  it("정의되지 않은 window.gijo* 를 부르지 않는다", () => {
    const 미정의: string[] = [];
    for (const [file, src] of pageSrc) {
      // 주석 줄은 뺀다 — 사고 이력을 주석에 적어 두는 것이 이 저장소의 관례다.
      const 코드 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
      for (const m of 코드.matchAll(/window\.(gijo[A-Za-z0-9_]*)\s*\./g)) {
        if (!정의.has(m[1])) 미정의.push(`${file}: window.${m[1]}`);
      }
    }
    expect([...new Set(미정의)], "이 전역은 어디에도 없다 — 부르는 순간 TypeError").toEqual([]);
  });
});

describe("Electron에서 네이티브 모달을 쓰지 않는다", () => {
  // ⚠ window.confirm/alert/prompt는 Electron에서 **OS 네이티브 모달**이라 렌더러가 통째로
  //   멈춘다. 사람이 직접 누르기 전까지 아무것도 못 하고 자동화는 닫지도 못한다
  //   (2026-07-29 실측: Playwright "No dialog is showing"으로 QA가 로그인을 통과 못 했다).
  //   확인은 **화면 안에서** 묻는다.
  it("확인·입력 창을 네이티브로 띄우지 않는다", () => {
    const 위반: string[] = [];
    for (const [file, src] of pageSrc) {
      const 코드 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
      for (const m of 코드.matchAll(/\bwindow\.(confirm|prompt)\s*\(/g)) 위반.push(`${file}: window.${m[1]}()`);
    }
    expect([...new Set(위반)], "Electron에서 렌더러가 멈춘다 — 화면 안에서 물을 것").toEqual([]);
  });
});

describe("★ 없는 화면으로 보내지 않는다", () => {
  // 같은 계열의 사고다: 부르는 이름이 실제로 있는지 아무도 대조하지 않는다.
  //   · howto.ts — 8개 안내 중 **5개가 없는 화면**을 가리켰다(2026-07-31)
  //   · kpi.html 「지금 손댈 일」 — 첫 구현에서 6개 중 5개가 틀렸다(2026-08-01)
  // 버튼은 멀쩡히 눌리고 아무 일도 안 일어난다. 파일 목록과 맞춰 보면 누르지 않고 잡힌다.
  const 있는화면 = new Set(pageFiles.filter((f) => f.endsWith(".html")));

  it("data-page가 가리키는 화면이 전부 실재한다", () => {
    const 없음: string[] = [];
    for (const [file, src] of pageSrc) {
      for (const m of src.matchAll(/data-page=["']([a-z0-9_-]+\.html)["']/gi)) {
        if (!있는화면.has(m[1])) 없음.push(`${file} → ${m[1]}`);
      }
      // '문자열 조립' 형태(page: "x.html")도 본다 — 표에 적어 두고 배선하는 방식이 흔하다.
      for (const m of src.matchAll(/\bpage:\s*["']([a-z0-9_-]+\.html)["']/gi)) {
        if (!있는화면.has(m[1])) 없음.push(`${file} → ${m[1]}`);
      }
    }
    expect([...new Set(없음)], "눌러도 아무 일이 없는 버튼이다").toEqual([]);
  });

  it("서버가 안내하는 화면(howto·screenguide)도 실재한다", () => {
    const 서버 = ["../src/engine/howto.ts", "../src/engine/screenguide.ts"]
      .map((p) => new URL(p, import.meta.url))
      .filter((u) => fs.existsSync(u));
    const 없음: string[] = [];
    for (const u of 서버) {
      const src = fs.readFileSync(u, "utf8");
      for (const m of src.matchAll(/["']([a-z0-9_-]+\.html)["']/gi)) {
        if (!있는화면.has(m[1])) 없음.push(`${u.pathname.split("/").pop()} → ${m[1]}`);
      }
    }
    expect([...new Set(없음)], "AI가 없는 화면으로 안내한다").toEqual([]);
  });
});

// 「내 업무로 돌아가기」 띠(worknow.js)는 **삭제됐다**(2026-07-31).
// 사용자 신고로 세 개가 겹쳐 뜨는 것을 고쳤지만, 근본은 "화면을 떠나면 길을 잃는다"에
// 버튼을 붙인 증상 치료였다. 대화창(지휘소)이 늘 옆에 있으면 돌아갈 일 자체가 없어
// 개념을 하나 없앴다 — 고치는 것보다 없애는 편이 나은 자리였다.
