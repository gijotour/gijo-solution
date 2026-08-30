// 「○○은 어디서 해?」 — 우리 화면 이름으로 자리를 찾는다.
//
// ★ 출처(실전 147상황, 2026-08-03): 「설정은 어디서 해?」에 32초를 쓰고
//   **"설정은 Tenable Security Center의 인터페이스에서 이루어집니다"**라고 답했다.
//   우리 제품 설정을 물었는데 **남의 제품 매뉴얼**을 읽어 준 것이다.
//   화면 이름을 알아보는 길이 없어 RAG로 샜고, RAG에는 벤더 문서가 있으니 거기서 지어냈다.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 이름으로화면찾기, 화면위치안내, getScreenGuide } from "../src/engine/screenguide";

describe("이름으로화면찾기 — 자리를 물을 때만, 우리 이름으로만", () => {
  it("★ 「설정은 어디서 해?」가 우리 설정 화면을 찾는다", () => {
    const r = 이름으로화면찾기("설정은 어디서 해?");
    expect(r, "못 찾으면 RAG로 새어 벤더 매뉴얼을 읽는다").not.toBeNull();
    expect(r!.screen).toBe("settings.html");
  });

  it("여러 말로 물어도 찾는다 — 담당자는 한 가지로만 말하지 않는다", () => {
    for (const q of ["리포트 어디 있어?", "자산 목록 어느 메뉴야?", "조치·승인 어떻게 가?", "보고서 보려면 어디로?"]) {
      expect(이름으로화면찾기(q), `「${q}」를 못 찾는다`).not.toBeNull();
    }
  });

  it("★ 긴 이름이 이긴다 — 「보안 KPI」가 「KPI」로 잘리면 엉뚱한 화면이 열린다", () => {
    expect(이름으로화면찾기("보안 KPI 어디서 봐?")!.screen).toBe("kpi.html");
  });

  it("⚠ 자리를 묻는 말이 아니면 안 걸린다 — 「설정 바꿔줘」는 길찾기가 아니다", () => {
    expect(이름으로화면찾기("설정 바꿔줘")).toBeNull();
    expect(이름으로화면찾기("리포트 만들어줘")).toBeNull();
  });

  it("⚠ 우리 화면 이름이 없으면 안 걸린다 — 아무 말에나 화면을 열지 않는다", () => {
    expect(이름으로화면찾기("Tenable은 어디서 사?")).toBeNull();
    expect(이름으로화면찾기("그건 어디 있어?")).toBeNull();
  });
});

describe("★ 🤖는 AI가 쓴 글에만 붙는다 (2026-08-04, 파트너 의견 「AI 아닌 듯한 화면」)", () => {
  // 예전 뜻은 "챗봇이 안내하는 글(화면 안내·AI 초안)"이라 **코드가 표에서 꺼낸 안내에도** 붙었다.
  // 그러면 담당자는 그 글도 지어낸 줄 알고 한 번 더 의심한다 — 정확히 반대 효과다.
  // 화면 안내는 GUIDES 표에서 그대로 꺼낸 글이다. AI가 쓴 것이 아니다.
  it("화면 위치 안내에 🤖를 붙이지 않는다", () => {
    expect(화면위치안내("settings.html", "설정")).not.toContain("🤖");
  });

  it("★ 감시가 헛돌지 않는다 — 그 함수가 실제로 글을 내고 있다", () => {
    const 글 = 화면위치안내("settings.html", "설정");
    expect(글.length, "빈 글이면 위 시험이 저절로 통과한다").toBeGreaterThan(40);
    expect(글).toContain("설정");
  });
});

describe("화면위치안내 — 어디에 있는지와 거기서 하는 일을 함께", () => {
  it("사이드바 위치·설명·할 수 있는 일을 담는다", () => {
    const 글 = 화면위치안내("settings.html", "설정");
    expect(글).toContain("설정");
    expect(글, "어디에 있는지를 말해야 길찾기다").toMatch(/사이드바/);
    expect(글.length, "한 줄로 끝내면 안내가 아니다").toBeGreaterThan(40);
  });

  it("★ 우리 기능이 **남의 제품 안에 있다**고 말하지 않는다", () => {
    // ⚠ 처음엔 "벤더 이름이 아예 없어야 한다"로 썼다가 이 시험이 나를 되돌렸다.
    //   취약점 화면 안내의 "Tenable Nessus 등의 스캔 결과(.nessus/CSV)를 올리면…"은
    //   **맞는 말**이다 — 어떤 파일을 받는지 알려 준다. 결함은 이름이 나온 것이 아니라
    //   「설정은 Tenable Security Center의 인터페이스에서 이루어집니다」처럼
    //   **우리 화면이 남의 제품 안에 있다**고 말한 것이었다. 그 모양만 막는다.
    const 남의것안에 = /(Tenable|Qualys|Rapid7|Splunk)[^.\n]{0,20}(에서\s*(이루어|합니다|설정|관리)|의\s*(인터페이스|화면|메뉴|콘솔))/i;
    for (const s of ["settings.html", "report.html", "inventory.html", "vulnscan.html", "kpi.html"]) {
      expect(화면위치안내(s, "아무개"), `${s} 안내가 우리 기능을 남의 제품 안이라고 말한다`).not.toMatch(남의것안에);
    }
  });
});

// ⚠ 2026-08-22 — Smart MD 별도 창을 없애면서 「문서 작성」 별칭이 가리키는 곳이
//   "smartmd" → "mydocs.html"로 바뀌었다(문서 작성이 내 문서 화면 안으로 들어왔다).
//   지키는 것은 그대로다: **별칭이 다른 질문을 삼키지 않는가.**
const 문서작성화면 = "mydocs.html";

describe("★ 「문서 작성」 별칭이 다른 질문을 삼키지 않는다 (2026-08-14 · 2026-08-22 대상 변경)", () => {
  // ⚠ 이 표는 dispatcher에서 **isHelpIntent보다 먼저** 걸리는 가로채기 자리다. 흔한 낱말을
  //   넣으면 다른 질문이 여기서 끝난다 — 과거 「법령」 낱말이 law_lookup으로 가로챈 실사고와
  //   같은 모양이다. 라우팅 회귀 하네스를 못 돌리는 상황이라(로그인 자격 필요) 여기서 못박는다.
  it("「문서 작성 어디서 해?」는 내 문서를 가리킨다", () => {
    const r = 이름으로화면찾기("문서 작성 어디서 해?");
    expect(r?.screen, "별칭이 안 걸린다").toBe(문서작성화면);
  });

  it("★ 없어진 별도 창(smartmd)을 아무도 안 가리킨다 — 가리키면 없는 자리를 안내한다", () => {
    for (const q of ["문서 작성 어디서 해?", "문서작성 어디서 해?", "스마트MD 어디서 해?"]) {
      expect(이름으로화면찾기(q)?.screen, `"${q}"가 없어진 창을 가리킨다`).not.toBe("smartmd");
    }
  });

  it("★ 「마크다운」 같은 흔한 낱말은 별칭이 아니다 — 넣었다가 되돌렸다", () => {
    // ⚠ 처음 쓴 시험은 **아무것도 못박지 못했다**(재검토 A-3): 고른 문장들이 자리질문 관문에
    //   애초에 안 걸려, 별칭이 있든 없든 전부 null이었다 — 「마크다운」을 다시 넣어도 초록이었다.
    //   그래서 **자리질문형**으로 바꾼다. 이 형태여야 별칭이 실제로 걸리는지를 잰다.
    for (const q of ["마크다운 어디서 해?", "마크다운 어디 있어?", "마크다운은 어디서 써?"]) {
      const r = 이름으로화면찾기(q);
      expect(r?.screen, `"${q}"가 문서 작성 안내로 가로채였다 — 흔한 낱말이 별칭에 들어갔다`).not.toBe(문서작성화면);
    }
  });

  it("이 시험이 헛돌지 않는지 스스로 확인 — 자리질문형은 실제로 관문을 지난다", () => {
    // ⚠ 위 시험이 「관문에 안 걸려서」 통과하는 것이 아님을 보인다(A-3의 재발 방지).
    //   같은 문형에 **등록된** 이름을 넣으면 반드시 걸려야 한다.
    expect(이름으로화면찾기("문서작성 어디서 해?")?.screen, "자리질문 문형이 관문을 못 지난다 — 위 시험이 헛돈다").toBe(문서작성화면);
  });

  it("자리를 묻는 말이 아니면 아예 안 걸린다 — 이 표는 「어디서」 질문 전용이다", () => {
    expect(이름으로화면찾기("문서 작성 기능이 왜 필요한가")).toBeNull();
    expect(이름으로화면찾기("스마트MD 좋다")).toBeNull();
  });
});

// ★ 2026-08-22 흡수분 별칭 5개 — **시험 없이 들어갔다**(검토관 [낮음]). 이 표는 dispatcher에서
//   isHelpIntent보다 먼저 걸리는 가로채기 자리라, 새 낱말은 반드시 두 가지를 함께 봐야 한다:
//     ① 물은 사람을 **맞는 갈래**로 데려가는가(그냥 화면만 열면 기본 탭이 떠서 헛걸음이다)
//     ② 다른 질문을 **삼키지 않는가**(「법령」 낱말 실사고와 같은 모양)
describe("★ 내 문서 흡수 별칭(보안제품 자료·연락처) — 맞는 탭으로, 남의 질문은 안 삼키고", () => {
  const 짝: [string, string][] = [
    ["보안제품 자료 어디서 봐?", "mydocs.html?tab=vendor"],
    ["제품 소개자료 어디 있어?", "mydocs.html?tab=vendor"],
    ["보안제품 비교 어디서 해?", "mydocs.html?tab=vendor"],
    ["담당자 연락처 어디서 봐?", "mydocs.html?tab=contacts"],
    ["나만의 연락처 어디 있어?", "mydocs.html?tab=contacts"],
  ];

  it("★ 화면 안내는 내 문서로, **여는 자리는 물은 탭으로** 간다", () => {
    for (const [q, 열기] of 짝) {
      const r = 이름으로화면찾기(q);
      expect(r, `"${q}"가 안 걸린다 — 별칭이 빠졌다`).not.toBeNull();
      // 안내 열쇠는 GUIDES에 있는 그대로여야 한다(쿼리가 붙으면 안내문이 통째로 사라진다).
      expect(r!.screen, `"${q}"의 안내 열쇠에 쿼리가 붙었다 — GUIDES를 못 찾는다`).toBe("mydocs.html");
      expect(r!.open, `"${q}"가 기본 탭으로 열린다 — 물은 것이 안 보인다`).toBe(열기);
    }
  });

  it("★ 흔한 낱말이 다른 질문을 삼키지 않는다 — 「연락처」 홑낱말은 별칭이 아니다", () => {
    // 보안제품 등록부의 「공급업체/담당자 연락처」 필드·레드팀 「고객 연락처」 어형이 실재한다.
    for (const q of ["연락처 어디서 봐?", "제품 어디 있어?", "자료 어디서 받아?"]) {
      const r = 이름으로화면찾기(q);
      if (r) expect(r.screen, `"${q}"가 내 문서 안내로 가로채였다`).not.toBe("mydocs.html");
    }
  });

  it("자리질문이 아니면 안 걸린다 — 「보안제품 자료 좋다」는 길찾기가 아니다", () => {
    expect(이름으로화면찾기("보안제품 자료 좋다")).toBeNull();
    expect(이름으로화면찾기("담당자 연락처 등록해줘")).toBeNull();
  });
});

// ★★ **소비 경로까지 잰다** — 생산자만 재면 어느 쪽이 끊겨도 초록이다 (2026-08-22 2라운드 [낮음])
//
// ■ 위 시험들은 `이름으로화면찾기`(생산자)가 `open`을 잘 주는지만 본다. 그런데 그 값이
//   실제로 화면을 여는 데 쓰이려면 **두 소비 경로**를 지나야 한다:
//     ① dispatcher가 `openScreen.page`에 `open`을 싣는가
//     ② 내 문서 화면이 `?tab=` 을 읽어 그 갈래를 펴는가
//   어느 하나가 끊겨도 「맞는 탭으로 연다」는 약속은 깨지는데 시험은 초록이었다.
describe("★ 흡수 별칭의 **소비 경로** — 생산자만 재면 반쪽이다", () => {
  const 저장소 = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

  it("★★ dispatcher가 `open`을 openScreen에 싣는다 — 안 실으면 기본 탭이 열린다", () => {
    const src = fs.readFileSync(path.join(저장소, "server", "src", "engine", "dispatcher.ts"), "utf8");
    expect(src, "찾는화면.open을 안 쓴다 — 물은 갈래가 아니라 기본 탭(👤 내 것)이 열린다")
      .toMatch(/찾는화면\.open\s*\?\?\s*찾는화면\.screen/);
  });

  it("★★ 내 문서 화면이 `?tab=`을 읽어 그 갈래를 편다 — 안 읽으면 주소만 바뀌고 화면은 그대로다", () => {
    const 화면 = fs.readFileSync(
      path.join(저장소, "client", "src", "renderer", "pages", "mydocs.html"), "utf8"
    );
    expect(화면, "주소의 tab을 안 읽는다 — ?tab=vendor로 열어도 기본 탭이 뜬다")
      .toMatch(/get\(["']tab["']\)/);
    // 우리가 별칭에서 쓰는 갈래 이름이 화면에 실제로 있는가 — 없으면 조용히 기본 탭으로 떨어진다.
    for (const t of ["vendor", "contacts", "guide"]) {
      expect(화면, `탭 「${t}」이 화면에 없다 — 별칭이 없는 갈래를 가리킨다`)
        .toMatch(new RegExp(`data-t="${t}"`));
    }
  });
});

// ── 흡수 화면의 자리 안내 — 「사이드바에서 찾으세요」가 거짓이 되는 자리 (2026-08-30) ──────
//
// ★ 왜: 허브 통합(2026-08-09~20)으로 화면 19종이 사이드바에서 빠졌는데, 자리 안내는 폴백
//   「사이드바 메뉴에서 찾을 수 있습니다」를 그대로 냈다 — 메뉴를 아무리 봐도 없는 화면을
//   보라고 한 것이다. 검토관이 [높음]으로 잡았고, 그것을 막으려 만든 흡수자리 표에는
//   supervision 한 줄뿐이었다(장치는 있고 채워지지 않은 부류).
// ⚠ 이 표는 클라 nav.js TAB_REDIRECT와 **손으로** 맞춘다(서버는 화면 파일을 배포물에
//   안 갖는다). 그래서 **시험 시각에 두 표를 대조**한다 — clientglobals·screen-where가
//   이미 쓰는 방식이다. 어긋나면 여기서 빨간불이 난다.
describe("★ 흡수된 화면의 자리 안내 — 없는 메뉴를 가리키지 않는다", () => {
  const PAGES = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
  const nav = fs.readFileSync(path.join(PAGES, "nav.js"), "utf-8");

  /** nav.js TAB_REDIRECT를 읽어 **전이를 끝까지 따라간** 흡수 지도를 만든다. */
  function 흡수지도(): Record<string, string> {
    // ⚠ **정의를 찾는다**(게시 관문 [낮음]) — 그냥 "TAB_REDIRECT"로 찾으면 105줄 앞 **주석**에
    //   먼저 걸려 GROUPS 배열 후반부까지 구간에 들어온다.
    const i = nav.indexOf("TAB_REDIRECT = {");
    const 구간 = nav.slice(i, nav.indexOf("};", i));
    const 표: Record<string, string> = {};
    for (const m of 구간.matchAll(/"([\w.-]+\.html)":\s*"([^"]+)"/g)) if (!m[1].includes("?")) 표[m[1]] = m[2];
    const 최종 = (p: string) => {
      let cur = p;
      for (let n = 0; n < 5; n++) {
        const nx = 표[cur.split("?")[0]];
        if (!nx || nx.split("?")[0] === cur.split("?")[0]) break;
        cur = nx;
      }
      return cur;
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(표)) {
      const f = 최종(v);
      if (f.split("?")[0] === k) continue; // settings.html→?s=ai 같은 자기 정규화는 흡수가 아니다
      out[k] = f;
    }
    return out;
  }

  it("추출이 헛돌지 않는다 — TAB_REDIRECT를 실제로 읽는다", () => {
    expect(Object.keys(흡수지도()).length, "흡수 지도를 못 뽑았다 — 이 시험이 통째로 헛돈다").toBeGreaterThanOrEqual(20);
  });

  it("★★ 흡수된 화면의 안내에 「사이드바/왼쪽 메뉴에서 찾으세요」가 안 나온다", () => {
    const 샌것: string[] = [];
    let 잰것 = 0; // 헛돌이 방지(검토관 [중]) — GUIDES 필터가 모집단을 0으로 줄여도 통과하면 안 된다
    for (const 화면 of Object.keys(흡수지도())) {
      // GUIDES에 항목이 **있는** 화면만 본다 — 없는 화면(reference·mcp·assethub 등 옛 이름)은
      // 안내가 개요로 떨어지고, 그쪽은 「그런 화면이 없다」가 참이라 자리 안내가 뜻이 없다.
      // ⚠ 개요 폴백을 값으로 가른다: 같은 개요를 받으면 그 화면 전용 안내가 없다는 뜻이다.
      if (getScreenGuide(화면).title === getScreenGuide("__없는화면__.html").title) continue;
      const 글 = 화면위치안내(화면, "아무개");
      if (!글 || 글.length < 40) continue;
      잰것++;
      if (/사이드바|왼쪽 메뉴/.test(글)) 샌것.push(화면);
    }
    expect(잰것, "실제로 잰 흡수 화면이 0이다 — 필터가 모집단을 통째로 지웠다(거짓 초록)").toBeGreaterThanOrEqual(15);
    expect(샌것, "허브로 흡수돼 메뉴에 없는 화면인데 「메뉴에서 찾으세요」라고 답한다 — " +
      "screenguide.ts의 흡수자리 표에 실제 가는 길을 적어라:\n  " + 샌것.join("\n  ")).toEqual([]);
  });

  it("흡수 안내는 셸 중립이다 — 프로 담당자에게 표준 셸 말이 나가면 안 된다", () => {
    // 흡수 갈래는 pro 인자를 안 타므로, 문구 자체가 셸에 안 매여 있어야 한다.
    for (const 화면 of ["vulnscan.html", "approvals.html", "kpi.html"]) {
      const 글 = 화면위치안내(화면, "아무개");
      expect(글, `${화면} 흡수 안내가 셸에 매인 말을 쓴다`).not.toMatch(/사이드바|왼쪽 메뉴/);
    }
  });
});

// ── 새 별칭은 **걸리는가 + 삼키는가**를 함께 본다 (2026-08-30) ─────────────────────
//
// ★ 왜 이 짝이 필요한가: 허브 별칭을 넣으면서 홑낱말 「조치」·「보고」·「검증」을 넣었다가
//   검토관에게 [높음] 3건으로 잡혔다 — 이 낱말들은 **업무 낱말**이라 자리 질문이 아닌 문장까지
//   삼킨다. dispatcher에서 이름으로화면찾기가 침해사고 초동절차·법령 조회보다 **앞**이라
//   즉시 return으로 그 길을 막는다:
//     「랜섬웨어 감염됐는데 조치 절차 어디서 봐?」 → 초동절차 대신 화면 안내
//   같은 파일이 「마크다운」·「기록」에서 이미 두 번 성문화한 규칙인데 또 밟았다.
//   ⇒ 별칭을 더할 때는 **반드시 이 두 짝**을 같이 쓴다.
describe("★ 허브 별칭 — 맞는 화면으로 가고, 남의 질문은 안 삼킨다", () => {
  it("허브를 부르는 말로 물으면 그 허브를 찾는다", () => {
    const 짝: [string, string][] = [
      ["우선순위화면 어디야?", "triage.html"],
      ["조치화면 어디 있어?", "fix.html"],
      ["검증허브 어디로 가?", "verify.html"],
      ["보고화면 어디서 봐?", "reporting.html"],
      ["기록화면 어디야?", "records.html"],
      ["AI허브 어디 있어?", "aihub.html"],
      ["보안분석 어디서 봐?", "analysis.html"],
    ];
    for (const [q, 기대] of 짝) {
      const r = 이름으로화면찾기(q);
      expect(r, `「${q}」를 못 찾는다 — 허브 제목의 「(통합)」 접미사 때문에 원리상 안 걸리던 자리다`).not.toBeNull();
      expect(r!.screen, `「${q}」`).toBe(기대);
    }
  });

  it("★★ 업무 낱말이 든 문장은 삼키지 않는다 — 초동절차·법령·플레이북의 길을 막지 않게", () => {
    // 이 문장들은 화면 안내가 아니라 **다른 엔진**이 답해야 한다(침해 초동절차·법령 조회·조치 절차).
    const 삼키면안됨 = [
      "랜섬웨어 감염됐는데 조치 절차 어디서 봐?",
      "개인정보 유출 시 어디에 보고해야 하나요?",
      "해킹당하면 어디에 신고해야 하나요?",
      "백업 복원 검증은 어떻게 하나요?",
      "이 취약점 조치 방법 알려줘",
      "유출 신고 의무는 어디에 보고해?",
    ];
    for (const q of 삼키면안됨) {
      const r = 이름으로화면찾기(q);
      expect(r, `「${q}」를 화면 안내가 가로챈다(→ ${r?.screen}) — 홑낱말 별칭을 넣지 마라. ` +
        "이름으로화면찾기는 dispatcher에서 침해사고·법령보다 앞이라 즉시 return으로 그 길을 막는다").toBeNull();
    }
  });

  it("헛돌이 방지 — 위 두 시험이 같은 잣대를 쓰는지(별칭표가 실제로 살아 있나)", () => {
    // 「전부 null」로 통과하는 거짓 초록을 막는다: 걸려야 할 것은 걸리는지 한 번 더 못박는다.
    expect(이름으로화면찾기("조치화면 어디야?"), "별칭표가 죽었다 — 위 삼킴 시험이 저절로 통과한다").not.toBeNull();
  });
});
