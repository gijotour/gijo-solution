// 옅은 숫자 — **무엇이 옅어지고 무엇은 안 되나**를 글자로 못박는다 (2026-09-05 · 전-4)
//
// ■ 왜 이 시험이 필요한가
//   회색 처리는 「경고를 시선이 가는 픽셀로 옮기는」 장치다. 범위가 넓으면 식별자(CVE·판번호)까지
//   옅어져 **진짜 근거가 근거 아닌 것처럼** 보이고, 좁으면 정작 지어낸 표의 숫자를 못 잡는다.
//   그래서 승인 시안(mockups/no-evidence-numbers §4)의 포함·제외 표를 **고정 표본**으로 잰다.
//
// ■ 어떻게 재나
//   제품 코드(chatparts.js)의 순수 함수 추정치조각()을 **그대로 불러** 잰다.
//   정규식을 시험에 베껴 적으면 제품과 시험이 따로 늙는다(이 저장소가 반복해 덴 자리).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 페이지 = path.join(__dirname, "../../client/src/renderer/pages");
const partsSrc = fs.readFileSync(path.join(페이지, "chatparts.js"), "utf8");
const consoleSrc = fs.readFileSync(path.join(페이지, "console.js"), "utf8");
const widgetSrc = fs.readFileSync(path.join(페이지, "chatwidget.js"), "utf8");
const mdSrc = fs.readFileSync(path.join(페이지, "gijomd.js"), "utf8");

/* ═══ 최소 DOM — 범위(2026-09-06)를 **실제로 그려 보고** 재기 위해 ═══════════════════
 *
 * ⚠ jsdom·happy-dom이 이 저장소에 없다(vizpromise.test와 같은 판단 — 문구 하나 보자고
 *   의존성을 늘리지 않는다). 그래서 **제품이 실제로 부르는 것만** 흉내 낸다:
 *     createTreeWalker(SHOW_TEXT) · createDocumentFragment · createElement · createTextNode ·
 *     childNodes · textContent · parentElement · replaceChild · closest · matches · querySelector
 *
 * ⚠⚠ **가짜 DOM은 그 자체가 함정이다**(vizpromise.test가 값을 치르고 배운 것). 그래서
 *   트리 모양을 내 상상으로 짓지 않고 **두 렌더러 소스에서 확인한 꼴**로만 짓는다:
 *     · 지휘소 = gijomd.js:106  `out.push("<p>" + para.map(inline).join(" ") + "</p>")`
 *     · 위젯   = chatwidget.js:41 `fmt = esc + **굵게**→<b> + \n→<br>`
 *   아래 「렌더러 꼴 감시」가 그 두 줄을 글자로 지킨다 — 바뀌면 이 흉내부터 빨개진다.
 *   이 흉내가 재는 것은 **덩어리 경계와 글자 노드 순서**뿐이다. 픽셀·CSS는 안 잰다.
 */
class DText {
  nodeType = 3;
  parentNode: any = null;
  constructor(public nodeValue: string) {}
  get textContent(): string { return this.nodeValue; }
  get parentElement(): any { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
}
class DFrag {
  nodeType = 11;
  childNodes: any[] = [];
  appendChild(n: any) { n.parentNode = this; this.childNodes.push(n); return n; }
}
function 셀렉터맞나(el: any, sel: string): boolean {
  return String(sel).split(",").map((s) => s.trim()).filter(Boolean).some((one) =>
    one.startsWith(".")
      ? String(el.className || "").split(/\s+/).includes(one.slice(1))
      : el.tagName === one.toUpperCase());
}
class DEl {
  nodeType = 1;
  tagName: string;
  childNodes: any[] = [];
  className = "";
  title = "";
  parentNode: any = null;
  attrs: Record<string, string> = {};
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get parentElement(): any { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get classList() { const cn = String(this.className); return { contains: (c: string) => cn.split(/\s+/).includes(c) }; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  appendChild(n: any): any {
    if (n.nodeType === 11) { for (const c of [...n.childNodes]) this.appendChild(c); return n; }
    if (n.parentNode) { const i = n.parentNode.childNodes.indexOf(n); if (i >= 0) n.parentNode.childNodes.splice(i, 1); }
    n.parentNode = this; this.childNodes.push(n); return n;
  }
  replaceChild(nw: any, old: any): any {
    const i = this.childNodes.indexOf(old);
    if (i < 0) throw new Error("replaceChild: 없는 자식 — 흉내가 틀렸다");
    const 새것 = nw.nodeType === 11 ? [...nw.childNodes] : [nw];
    for (const c of 새것) c.parentNode = this;
    this.childNodes.splice(i, 1, ...새것); old.parentNode = null; return old;
  }
  get textContent(): string { return this.childNodes.map((c: any) => c.textContent).join(""); }
  set textContent(v: string) { this.childNodes = []; this.appendChild(new DText(v)); }
  matches(sel: string) { return 셀렉터맞나(this, sel); }
  closest(sel: string): any { let n: any = this; while (n) { if (n.nodeType === 1 && 셀렉터맞나(n, sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel: string): any {
    for (const c of this.childNodes) {
      if (c.nodeType !== 1) continue;
      if (셀렉터맞나(c, sel)) return c;
      const r = c.querySelector(sel); if (r) return r;
    }
    return null;
  }
  querySelectorAll(sel: string): any[] {
    const out: any[] = [];
    for (const c of this.childNodes) { if (c.nodeType !== 1) continue; if (셀렉터맞나(c, sel)) out.push(c); out.push(...c.querySelectorAll(sel)); }
    return out;
  }
}
const 문서: any = {
  createElement: (t: string) => new DEl(t),
  createTextNode: (v: string) => new DText(v),
  createDocumentFragment: () => new DFrag(),
  // ensureCss는 「이미 넣었다」로 답한다 — 이 시험은 CSS가 아니라 **어느 글자를 감쌌나**를 잰다.
  getElementById: () => ({ id: "gijoChatPartsCss" }),
  createTreeWalker: (root: any) => {
    const 목록: any[] = [];
    (function 훑기(n: any) { for (const c of n.childNodes || []) { if (c.nodeType === 3) 목록.push(c); else 훑기(c); } })(root);
    let i = -1;
    return { nextNode: () => (++i < 목록.length ? 목록[i] : null) };
  },
};
const 노드필터 = { SHOW_TEXT: 4 };

/** 제품 부품을 그대로 불러온다 — 순수 함수도, DOM을 만지는 dimEstimates도 **이 한 벌**로 잰다. */
const P: any = (() => {
  const win: any = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "NodeFilter", partsSrc)(win, 문서, 노드필터);
  return win.gijoChatParts;
})();

/** 지휘소 꼴로 그린다 — 문단마다 <p>, **굵게**는 <strong>(gijomd.js). */
function 지휘소로(답: string): any {
  const row = new DEl("div"); row.className = "cs-row";
  const cb = new DEl("div"); cb.className = "cb"; row.appendChild(cb);
  const cm = new DEl("div"); cm.className = "cm"; cb.appendChild(cm);
  for (const 문단 of 답.split(/\n{2,}/)) {
    if (!문단.trim()) continue;
    const p = new DEl("p");
    인라인(p, 문단.split("\n").join(" "), "strong");   // gijomd는 문단 안 줄을 공백으로 잇는다
    cm.appendChild(p);
  }
  return row;
}
/** 위젯 꼴로 그린다 — 줄바꿈은 <br>뿐, **굵게**는 <b>(chatwidget.js fmt). */
function 위젯으로(답: string): any {
  const row = new DEl("div"); row.className = "gcw-row";
  const 줄들 = 답.split("\n");
  줄들.forEach((줄, i) => { 인라인(row, 줄, "b"); if (i < 줄들.length - 1) row.appendChild(new DEl("br")); });
  return row;
}
function 인라인(부모: any, 글: string, 굵기태그: string) {
  글.split(/\*\*(.+?)\*\*/g).forEach((s, i) => {
    if (!s) return;
    if (i % 2 === 1) { const b = new DEl(굵기태그); b.textContent = s; 부모.appendChild(b); }
    else 부모.appendChild(new DText(s));
  });
}
/** 실제로 옅어진 글자들 — 화면에서 회색 점선이 그어진 그 조각 그대로. */
function 옅힌것(root: any): string[] {
  const out: string[] = [];
  (function 훑기(n: any) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 1 && String(c.className) === "dim-est") { out.push(c.textContent); continue; }
      훑기(c);
    }
  })(root);
  return out;
}

const 옅게 = (t: string): string[] => P.추정치조각(t).map((g: any) => g.text);

describe("★ 옅은 숫자 — 고정 표본(시안 §4 표)", () => {
  it("부품을 불러왔다 — 이 감시가 헛돌고 있지 않다", () => {
    expect(typeof P?.추정치조각, "chatparts.js에서 추정치조각을 못 가져왔다").toBe("function");
    expect(typeof P?.dimEstimates, "dimEstimates가 없다").toBe("function");
  });

  // 시안 장면 ①(「카페테리아 만족도」)의 답 본문 — 표·굵은 글씨·식별자가 한 답에 섞인 실물 꼴.
  const 표본 = [
    "사내 카페테리아 만족도는 일반적인 사무공간 기준으로 다음 수준에서 형성됩니다.",
    "| 항목 | 만족도 | 응답 |",
    "| 메뉴 다양성 | 75점 | 120명 |",
    "| 위생 상태 | 80점 | 118명 |",
    "| 대기 시간 | 70점 | 121명 |",
    "| 가격 | 65점 | 119명 |",
    "종합하면 평균 72.5점 수준이고, 불만 접수는 14건으로 보입니다. 개선 예산은 약 3,200만원이 필요합니다.",
    "3가지 개선안을 함께 적었습니다.",
    "이 수치는 보안 취약점(CVE-2024-21762, CVSS 9.8, CWE-79)이나 자산 대장과는 무관하며,",
    "2026-09-05 기준 제품 5.83.0에서 조회한 것이 아닙니다. TLS 1.3·ISO 27001과도 무관하고,",
    "14:22:05에 확인했습니다. 근거 표기 [1]도 붙이지 않았습니다.",
  ].join("\n");

  it("옅어질 것 11개 — 표 안 숫자가 **가장 많이 지어내는 자리**라 반드시 포함한다", () => {
    expect(옅게(표본)).toEqual([
      "75점", "120명", "80점", "118명", "70점", "121명", "65점", "119명", // 표
      "72.5점", "14건", "3,200만원",                                       // 문장
    ]);
  });

  it("제외 0건 — 식별자·날짜·시각·판번호·인용번호는 하나도 안 옅어진다", () => {
    const 결과 = 옅게(표본).join(" ");
    for (const 금지 of ["2024", "21762", "9.8", "79", "2026", "09", "5.83", "1.3", "27001", "14:22", "[1]"]) {
      expect(결과.includes(금지), `제외 대상이 옅어졌다: ${금지}`).toBe(false);
    }
  });

  it("단위 없는 한 자리 수는 안 잡는다 — 「3가지 방법」의 3까지 옅게 하면 글이 누더기가 된다", () => {
    expect(옅게("3가지 방법이 있습니다.")).toEqual([]);
    expect(옅게("항목 2개를 봤습니다.")).toEqual(["2개"]);  // 단위가 붙으면 한 자리도 잡는다
    expect(옅게("응답자 42명")).toEqual(["42명"]);
  });

  it("★ 맨 글자 코드는 안 옅어진다 — 화면 위젯은 마크다운을 안 그려 백틱이 그대로 남는다", () => {
    // 실측(2026-09-05 실브라우저): 이 규칙이 없을 때 **위젯에서만** 설정값(max_items = 75,
    // timeout_sec = 30)이 옅어졌다 — 지휘소는 gijomd가 <pre>로 감싸 안 걸렸다.
    // 같은 답이 자리마다 다르게 보이는 것이 이 부품을 한 곳에 둔 이유와 정면으로 어긋난다.
    expect(옅게("설정은 `max_items = 75`로 잡습니다.")).toEqual([]);
    expect(옅게("`survey.timeout_sec = 30`이고 응답은 120명입니다.")).toEqual(["120명"]);
  });

  it("자리수 쉼표를 한 덩어리로 본다 — 안 하면 쉼표만 진하게 남는 꼴이 된다", () => {
    expect(옅게("예산 3,200만원과 인원 12,500명")).toEqual(["3,200만원", "12,500명"]);
  });

  // ── 2026-09-05 검토관이 실측으로 잡은 **약속-코드 어긋남 5종** — 고친 뒤 여기서 못박는다 ──
  //   전부 「안내문·시안은 제외라고 적었는데 코드는 옅게 했다」 부류다. 하나하나가 화면에서
  //   **진짜 근거를 근거 아닌 것처럼** 보이게 하거나(식별자), 낱말 한가운데서 밑줄을 끊었다.
  describe("★ 약속대로 제외되나 (2026-09-05 검토관 수리)", () => {
    it("한국식 날짜·시각 — 「12월 25일」·「2시 30분」이 옅어지던 것을 막는다", () => {
      // 옛 실측: "작년 12월 25일 점검" => ["12","25일"] · "오후 2시 30분" => ["30분"]
      expect(옅게("작년 12월 25일 점검")).toEqual([]);
      expect(옅게("2026년 9월 5일 신고")).toEqual([]);
      expect(옅게("9월 5일까지입니다.")).toEqual([]);
      expect(옅게("오후 2시 30분에 확인")).toEqual([]);
      // ⚠ 기간은 날짜가 아니다 — 「5일 뒤」의 5일은 지어낸 값일 수 있어 그대로 옅게 둔다.
      expect(옅게("5일 뒤에 다시 봅니다.")).toEqual(["5일"]);
    });

    it("두 마디 판번호 — 「Apache 2.4」·「Log4j 2.17」은 식별자다", () => {
      for (const t of ["Apache 2.4", "OpenSSL 3.0", "Log4j 2.17", "nginx v1.24"]) {
        expect(옅게(`${t} 환경입니다.`), `판번호가 옅어졌다: ${t}`).toEqual([]);
      }
      // ⚠ 한글 앞말은 판번호가 아니다 — 이걸 같이 빼면 이 기능이 잡아야 할 숫자를 놓친다.
      expect(옅게("평균 72.5점입니다.")).toEqual(["72.5점"]);
      // ⚠ **알려진 한계**(안내문에도 그대로 적었다): 점이 없는 판번호는 못 가른다.
      //   「이름 뒤 숫자」를 통째로 빼면 "GPU 3개" 같은 진짜 셈까지 빠져서 일부러 안 뺐다.
      expect(옅게("Windows 11 기준"), "한계가 바뀌었으면 안내문(screenguide·용어사전)도 함께 고칠 것").toEqual(["11"]);
      expect(옅게("GPU 3개를 씁니다.")).toEqual(["3개"]);
    });

    it("KEV 번호 — 시안 §4 표에 있었는데 패턴이 없어 「2024」·「001」로 갈렸다", () => {
      expect(옅게("KEV 2024-001 목록")).toEqual([]);
    });

    it("「개월」이 「개」에 가려 낱말 한가운데서 끊기던 것 — 단위는 긴 것이 앞", () => {
      // 옛 실측: "6개월 뒤" => ["6개"] (밑줄이 「6개」까지만 그어졌다)
      expect(옅게("점검 주기는 6개월입니다.")).toEqual(["6개월"]);
      expect(옅게("3개월 계약")).toEqual(["3개월"]);
      expect(옅게("자산 6개를 봤습니다.")).toEqual(["6개"]);   // 「개」도 그대로 산다
    });

    it("마크다운 링크·URL·목록 번호 — 위젯은 <a>·<ol>을 안 그려 맨 글자로 남는다", () => {
      expect(옅게("[문서](https://intra/docs/1234) 참고")).toEqual([]);
      expect(옅게("https://intra/docs/1234 를 보세요")).toEqual([]);
      expect(옅게("10. 열째 항목")).toEqual([]);
      expect(옅게("1. 첫째 항목")).toEqual([]);
    });

    it("단위가 없으면 뒤 공백을 안 먹는다 — 점선이 숫자보다 넓게 그어지던 것", () => {
      // 옛 실측: "총 3500 이었다" => ["3500 "](뒤 공백 포함) → 밑줄이 한 칸 넓었다.
      expect(옅게("총 3500 이었다")).toEqual(["3500"]);
      expect(옅게("약 45 정도")).toEqual(["45"]);
      // 단위가 있으면 사이 공백은 **함께** 감싼다(「12 개월」이 둘로 갈리면 더 이상하다).
      expect(옅게("12 개월 뒤")).toEqual(["12 개월"]);
    });
  });

  it("배너 문장 자체에는 옅게 할 숫자가 없다(경고문이 스스로 옅어지면 안 된다)", () => {
    // 지금 배너 4종에는 숫자가 없다. 미래에 숫자가 들어가도 화면 쪽에서 **배너 덩어리를 통째로**
    // 건너뛴다 — 그 규칙은 아래 「후처리 배선」에서 소스로 지킨다.
    const 배너원문 = fs.readFileSync(path.join(__dirname, "../src/engine/noevidence.ts"), "utf8");
    const 배너들 = [...배너원문.matchAll(/export const \S*배너 = `([^`]*)`/g)].map((m) => m[1]);
    expect(배너들.length, "배너 상수를 못 읽었다").toBeGreaterThanOrEqual(4);
  });
});

describe("★ 후처리 배선 — 두 대화 입구에 **둘 다** 붙는다", () => {
  it("공용 부품에만 있다 — 지휘소·위젯이 각자 그리면 두 벌이 된다", () => {
    expect(partsSrc, "부품에 dimEstimates가 없다").toContain("function dimEstimates(");
    expect(partsSrc, "옅은 숫자 CSS(.dim-est)가 부품에 없다").toContain(".dim-est{");
    // 취소선 금지(「값이 틀렸다」로 오독된다) · 크기·굵기 변경 금지(세로 총합이 흔들린다).
    const css = /"\.dim-est\{([^"]*)\}/.exec(partsSrc);
    expect(css, ".dim-est 규칙을 못 찾았다").toBeTruthy();
    for (const 금지 of ["line-through", "font-size", "font-weight", "padding", "margin", "border"]) {
      expect(css![1].includes(금지), `.dim-est가 레이아웃을 건드린다(세로 증감 0px가 깨진다): ${금지}`).toBe(false);
    }
  });

  it("지휘소(console.js)와 화면 위젯(chatwidget.js)이 **둘 다** 부품을 부른다", () => {
    // 한쪽만 배선하면 「대화창은 옅은데 위젯은 진한」 상태가 된다(근거세기가 겪은 그 함정).
    expect(consoleSrc, "지휘소가 dimEstimates를 안 부른다").toMatch(/P\.dimEstimates\(replyEl[\s\S]{0,60}?근거없음/);
    expect(widgetSrc, "화면 위젯이 dimEstimates를 안 부른다").toMatch(/P\.dimEstimates\(typing[\s\S]{0,60}?근거없음/);
  });

  it("★ 이어보기(restore)로 되살린 답에도 붙는다 — 같은 답이 자리마다 달라 보이면 안 된다", () => {
    // 2026-09-05 검토관: 복원 경로에 통로가 없어 「방금 받았을 때는 옅던 숫자가 다시 열면 진한」
    //   상태였다. 서버가 저장 본문에서 표식을 읽어 실어 주고(worksessions GET), 여기서 건다.
    expect(consoleSrc, "restore()가 dimEstimates를 안 부른다").toMatch(/async function restore\(\)[\s\S]{0,1200}?P\.dimEstimates\(/);
    const ws = fs.readFileSync(path.join(__dirname, "../src/engine/worksessions.ts"), "utf8");
    expect(ws, "이어보기 응답에 근거없음 표식을 안 싣는다").toMatch(/근거없음종류판정\(t\.content\)/);
    // ⚠ 판정기는 한 곳(noevidence.ts)에서 가져온다 — 배너 문구를 여기 다시 적으면 두 벌로 늙는다.
    expect(ws, "판정기를 noevidence에서 안 가져왔다").toMatch(/근거없음종류판정[^\n]*from "\.\/noevidence"/);
  });

  it("★ quotes보다 **먼저** 부른다 — 뒤에 부르면 배지·칩의 숫자까지 옅어진다", () => {
    for (const [이름, src, 앵커] of [
      ["지휘소", consoleSrc, "P.quotes(replyEl"],
      ["위젯", widgetSrc, "P.quotes(typing"],
    ] as [string, string, string][]) {
      expect(src.indexOf("P.dimEstimates("), `${이름}: 순서가 뒤집혔다`).toBeLessThan(src.indexOf(앵커));
    }
  });

  it("★ 코드블록 울타리(```)를 글자로 따라간다 — 위젯에는 <pre>가 없다", () => {
    // 지휘소만 보고 짜면 「pre, code 제외」로 끝난 줄 안다. 위젯 입구는 마크다운을 안 그려서
    // 울타리가 맨 글자로 남고, 그 안의 설정값이 옅어진다(2026-09-05 실브라우저 실측으로 잡음).
    expect(partsSrc, "울타리 추적이 없다 — 위젯에서 코드블록 안 값이 옅어진다")
      .toMatch(/울타리[\s\S]{0,300}코드안/);
  });

  it("공용 마크다운 렌더러(gijomd.js)는 안 건드렸다 — 문서함 문서까지 옅어진다", () => {
    expect(mdSrc.includes("dim-est"), "gijomd.js가 오염됐다 — 문서함 본문 숫자까지 옅어진다").toBe(false);
    // 제외가 성립하는 근거: 코드·링크가 실제로 그 태그로 나온다(closest('pre, code, a')가 먹는다).
    expect(mdSrc, "코드블록이 <pre><code>로 안 나온다").toContain("<pre><code");
    expect(partsSrc, "제외 선택자에 코드·링크가 없다").toMatch(/pre, code, a[,"]/);
  });

  it("복사하면 원문이 그대로 나온다 — 감싸기만 하고 글자를 만들지 않는다", () => {
    expect(partsSrc, "글자를 CSS로 만들면 복사 텍스트에 섞인다").not.toMatch(/\.dim-est::(after|before)/);
    expect(partsSrc, "span에 원문을 그대로 안 넣는다").toContain("span.textContent = g.text");
  });

  it("표식이 없으면 **아무것도 안 한다** — 근거 있는 답은 그대로 진하다", () => {
    expect(partsSrc).toMatch(/function dimEstimates\(el, 근거없음, 범위\) \{\s*\n\s*if \(!근거없음\) return 0;/);
  });

  // ── 2026-09-06 · 범위(시안 mockups/dim-range) ────────────────────────────
  it("★ 세 자리 **전부** 셋째 인자(근거범위)를 넘긴다 — 한쪽만 배선하면 자리마다 딴말이 된다", () => {
    // 「세 번째면 소스 감시」. 근거세기가 실제로 그 함정에 빠진 전례가 있다.
    expect(consoleSrc, "지휘소(새 답)가 근거범위를 안 넘긴다")
      .toContain("P.dimEstimates(replyEl, r && r.근거없음, r && r.근거범위)");
    expect(consoleSrc, "지휘소(이어보기)가 근거범위를 안 넘긴다")
      .toContain("P.dimEstimates(el, m.근거없음, m.근거범위)");
    expect(widgetSrc, "화면 위젯이 근거범위를 안 넘긴다")
      .toContain("P.dimEstimates(typing, r.근거없음, r.근거범위)");
  });

  it("★ 배너 덩어리를 **어디에 있든** 건너뛴다 — 꼬리의 숫자가 스스로 옅어지면 안 된다", () => {
    // 부분 접지 배너에는 꼬리로 숫자가 들어간다: 「… (사내 자료에 없는 수치: 12.5%)」.
    // 옛 규칙(맨 앞 덩어리만)으로는 복합 답의 중간 배너를 못 잡았고, 마크다운이 배너 한 줄을
    // 여러 글자 노드로 쪼개면 첫 조각만 ⚠로 시작해 나머지가 새어 나왔다 → **덩어리 단위**여야 한다.
    expect(partsSrc, "덩어리 단위 배너 건너뛰기가 없다").toMatch(/건너뜀 = \/\^\\s\*⚠\/\.test\(몸\)/);
    expect(partsSrc, "단계 머리표를 뗀 뒤 보지 않는다 — 「【2. 분석】 ⚠배너」가 한 덩어리로 온다")
      .toMatch(/var 몸 = d\.text\.replace\(/);
    // ⚠ 건너뛰어도 울타리는 계속 센다 — 건너뛴다고 열린 코드블록이 닫히는 것이 아니다.
    expect(partsSrc, "건너뛰기가 울타리 계산보다 앞에 있다").toMatch(/코드안 = !코드안;[\s\S]{0,140}?if \(건너뜀\) continue;/);
  });

  it("「2분기」의 2가 「2분」으로 옅어지던 것 — 「분」은 「분기」를 안 먹는다", () => {
    // 「개」가 「개월」을 자르던 것과 같은 부류다. 이쪽은 순서로 못 고친다(분기는 시간 단위가 아니다).
    expect(옅게("2분기 보안 교육 이수율")).toEqual([]);
    expect(옅게("3분기 실적입니다.")).toEqual([]);
    expect(옅게("소요 시간은 30분입니다.")).toEqual(["30분"]);   // 진짜 「분」은 그대로 산다
    expect(옅게("12 분 걸렸습니다.")).toEqual(["12 분"]);
  });
});

describe("★ 안내에 실렸나 — 만들고 안 실으면 있는 줄도 모른다", () => {
  const guide = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8");

  it("대화창 공통 안내(OVERVIEW.panels)에 「옅은 숫자」가 있다", () => {
    expect(guide, "panels에 옅은 숫자가 없다").toContain('"옅은 숫자": "');
    expect(guide, "「틀렸다는 뜻이 아니다」를 안 말한다 — 이 안내의 핵심이다").toContain("틀렸다는 뜻이 아니라");
  });

  it("사람이 부르는 말로도 닿는다(별명)", () => {
    for (const 별명 of ["흐린 숫자", "회색 숫자", "숫자가 흐려", "추정치"]) {
      expect(guide, `별명이 없다: ${별명}`).toContain(`"${별명}": "옅은 숫자"`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ★★ 범위 — **어디를** 옅게 하나 (2026-09-06 · 승인 시안 mockups/dim-range)
//
// 표식은 지금까지 「이 답에 근거 없는 숫자가 있다」만 말했다. 그래서 두 자리가 어긋났다:
//   ⓐ 복합 지시 답 — 배너가 본문 중간이라 표식이 아예 안 붙었다(아무것도 안 옅어짐).
//   ⓑ 부분 접지 — 백분율 다섯 중 하나만 지어냈는데 배너가 안 붙었다(진하게 나감).
// 범위 없이 표식만 붙이면 **없던 거짓말이 새로 생긴다** — 아래 「범위 없이 켜면」 대조가 그 크기다.
import {
  자료요청배너, 숫자무근거배너, 없는수치꼬리, 없는수치꼬리상한, 근거범위, 근거없음종류판정,
} from "../src/engine/noevidence";

describe("★★ 범위 — 두 렌더러에 **똑같이** 걸린다", () => {
  it("흉내가 헛돌고 있지 않다 — 최소 DOM으로 실제 옅힘이 일어난다", () => {
    const el = 지휘소로(`${숫자무근거배너}\n\n종합 만족도는 75점이고 불만 14건입니다.`);
    expect(P.dimEstimates(el, "숫자무근거"), "하나도 안 옅어졌다 — 흉내가 틀렸다").toBe(2);
    expect(옅힌것(el)).toEqual(["75점", "14건"]);
  });

  it("★ 렌더러 꼴 감시 — 이 흉내가 기대는 두 줄이 그대로인가", () => {
    // 흉내는 「지휘소=문단마다 <p> · 위젯=<br>이 유일한 경계」에 기댄다. 그 전제가 무너지면
    // 이 시험 전체가 **제품이 아니라 내 상상**을 재게 된다.
    expect(mdSrc, "gijomd가 문단을 <p>로 안 그린다").toContain('out.push("<p>" + para.map(inline).join(" ") + "</p>")');
    expect(widgetSrc, "위젯 fmt가 줄바꿈을 <br>로 안 바꾼다").toContain(String.raw`.replace(/\n/g, "<br>")`);
  });

  // ── 장면 ① 복합 지시(구멍 ⓐ) — 1단계의 **세어 온 숫자**를 지켜야 한다 ──────────────
  const 복합답 = [
    "【1. 스캔】 3개 자산 스캔 완료 — 발견 0건 · 처리 12건",
    "",
    `【2. 우선순위 분석】 ${자료요청배너}`,
    "",
    "일반적으로 만족도는 75점 수준이고 미조치 12건이 남습니다.",
  ].join("\n");

  it("ⓐ 복합 답에 이제 표식이 붙는다 — 범위는 배너가 실린 **그 단계**뿐", () => {
    expect(근거없음종류판정(복합답), "단계 앞머리를 못 읽는다").toBe("자료요청");
    expect(근거범위(복합답)).toEqual({ 단계: [2] });
  });

  for (const [이름, 그리기] of [["지휘소", 지휘소로], ["위젯", 위젯으로]] as [string, (s: string) => any][]) {
    it(`ⓐ ${이름} — {단계:[2]}면 2단계 안만 옅어진다(1단계의 0건·12건은 진하다)`, () => {
      const el = 그리기(복합답);
      const n = P.dimEstimates(el, "자료요청", { 단계: [2] });
      expect(옅힌것(el), "1단계의 세어 온 숫자가 회색이 됐다 = 없던 거짓말").toEqual(["75점", "12건"]);
      expect(n).toBe(2);
    });

    it(`ⓐ ${이름} — **범위 없이 켜면** 1단계까지 옅어진다(이 시안이 막는 바로 그 상태)`, () => {
      const el = 그리기(복합답);
      P.dimEstimates(el, "자료요청");   // 범위 undefined = 답 전체
      expect(옅힌것(el)).toEqual(["3개", "0건", "12건", "75점", "12건"]);
    });
  }

  // ── 장면 ② 부분 접지(구멍 ⓑ·ⓒ) — 문서에 그대로 있는 넷을 지켜야 한다 ──────────────
  const 부분답 =
    `${숫자무근거배너}${없는수치꼬리(["12.5%"])}\n\n` +
    "2분기 보안 교육 이수율은 82.3%입니다. 부서별로는 91.2% · 78.4% · 88.1%이고, 전년 대비 12.5% 증가했습니다.";

  it("ⓑ 배너 꼬리에서 수치 표면형을 읽는다 — 저장하지 않고 **답 글자에서**", () => {
    expect(근거범위(부분답)).toEqual({ 수치: ["12.5%"] });
  });

  for (const [이름, 그리기] of [["지휘소", 지휘소로], ["위젯", 위젯으로]] as [string, (s: string) => any][]) {
    it(`ⓑ ${이름} — {수치:["12.5%"]}면 지어낸 하나만 옅어진다(문서에 있는 넷은 진하다)`, () => {
      const el = 그리기(부분답);
      const n = P.dimEstimates(el, "숫자무근거", { 수치: ["12.5%"] });
      expect(옅힌것(el), "문서에 그대로 적힌 값이 「모델 추정치」가 됐다").toEqual(["12.5%"]);
      expect(n).toBe(1);
    });

    it(`ⓒ ${이름} — 배너 **꼬리의 12.5%가 스스로 옅어지지 않는다**`, () => {
      // 옛 규칙(맨 앞 덩어리의 첫 글자 노드만 ⚠ 검사)에서는 마크다운이 배너를 여러 조각으로
      // 쪼개 꼬리가 새어 나왔다 — 경고문이 제 숫자를 「모델 추정치」라 부르는 꼴이었다.
      const el = 그리기(부분답);
      P.dimEstimates(el, "숫자무근거", { 수치: ["12.5%"] });
      expect(옅힌것(el).length, "배너 안 숫자까지 옅어졌다").toBe(1);
    });

    it(`ⓒ ${이름} — 범위 없이 켜면 다섯 다 옅어진다(참인 넷이 회색)`, () => {
      const el = 그리기(부분답);
      P.dimEstimates(el, "숫자무근거");
      expect(옅힌것(el)).toEqual(["82.3%", "91.2%", "78.4%", "88.1%", "12.5%"]);
    });
  }

  it("★ 범위가 undefined면 **오늘과 한 글자도 다르지 않다**(뒷걸음 보증)", () => {
    const 보통답 = `${숫자무근거배너}\n\n미조치는 42건, 평균 72.5점, 예산 3,200만원입니다.`;
    for (const 그리기 of [지휘소로, 위젯으로]) {
      const a = 그리기(보통답), b = 그리기(보통답), c = 그리기(보통답);
      P.dimEstimates(a, "숫자무근거");
      P.dimEstimates(b, "숫자무근거", undefined);
      P.dimEstimates(c, "숫자무근거", {});          // 빈 객체도 「범위 없음」이다
      expect(옅힌것(a)).toEqual(["42건", "72.5점", "3,200만원"]);
      expect(옅힌것(b)).toEqual(옅힌것(a));
      expect(옅힌것(c)).toEqual(옅힌것(a));
    }
  });

  it("★ 화면에 단계 머리표가 없는데 단계 범위가 오면 **아무것도 안 옅게 한다**(안전한 실패)", () => {
    // 서버·화면이 어긋났을 때 엉뚱한 숫자를 회색 칠하는 것보다 기능이 꺼지는 쪽이 안전하다.
    const el = 지휘소로(`${숫자무근거배너}\n\n만족도는 75점입니다.`);
    expect(P.dimEstimates(el, "숫자무근거", { 단계: [2] })).toBe(0);
  });

  it("★ 단계 머리표의 번호는 답의 값이 아니다 — 「【10. 리포트】」의 10이 안 옅어진다", () => {
    const 답 = `【9. 스캔】 자산 3개\n\n【10. 리포트】 ${자료요청배너}\n\n총평 점수는 75점입니다.`;
    for (const 그리기 of [지휘소로, 위젯으로]) {
      const el = 그리기(답);
      P.dimEstimates(el, "자료요청", { 단계: [10] });
      expect(옅힌것(el), "머리표 번호가 옅어졌다").toEqual(["75점"]);
    }
  });

  it("★ 코드블록 울타리는 **건너뛴 덩어리에서도** 계속 센다", () => {
    // 건너뛴다고 열린 울타리가 닫히는 것이 아니다 — 안 세면 그 뒤 코드 안 설정값이 옅어진다.
    const 답 = `${숫자무근거배너}\n\n\`\`\`\n\nmax_items = 75\n\n\`\`\`\n\n미조치는 42건입니다.`;
    const el = 지휘소로(답);
    P.dimEstimates(el, "숫자무근거");
    expect(옅힌것(el), "코드블록 안 설정값이 옅어졌다").toEqual(["42건"]);
  });
});

describe("★★ 배너 꼬리 ↔ 소비자 4곳 — 「안전하다」를 주장이 아니라 시험으로", () => {
  const 꼬리답 = `${숫자무근거배너}${없는수치꼬리(["12.5%", "30%"])}\n\n전년 대비 12.5% 늘어 30% 수준입니다.`;

  it("꼬리는 배너와 **같은 줄**이다 — 줄을 넘기면 네 소비자가 전부 어긋난다", () => {
    expect(꼬리답.split("\n")[0].endsWith(")"), "꼬리가 줄을 넘어갔다").toBe(true);
    expect(없는수치꼬리(["12.5%"]).includes("\n"), "꼬리에 줄바꿈이 들어갔다").toBe(false);
  });

  it("① evalgate 배너_RE — 꼬리까지 떼고 본문만 남긴다", () => {
    const 게이트 = fs.readFileSync(path.join(__dirname, "../../tools/evalgate/run.mjs"), "utf8");
    const m = /const 배너_RE = \/(.+)\/([gimsuy]*);/.exec(게이트);
    expect(m, "배너_RE를 못 읽었다").toBeTruthy();
    expect(꼬리답.replace(new RegExp(m![1], m![2]), "")).toBe("전년 대비 12.5% 늘어 30% 수준입니다.");
  });

  it("② team-bench 자료없음이라말함 — 앞 60자만 보므로 꼬리에 안 흔들린다", () => {
    const gates = fs.readFileSync(path.join(__dirname, "../../tools/team-bench/gates.mjs"), "utf8");
    const g = /export const 자료없음중복가드 = \/(.+)\/([gimsuy]*);/.exec(gates);
    expect(g, "자료없음중복가드를 못 읽었다").toBeTruthy();
    const re = new RegExp(g![1], g![2]);
    const 꼬리없음 = `${숫자무근거배너}\n\n본문`;
    expect(re.test(꼬리답.slice(0, 60)), "꼬리가 앞 60자 판정을 바꿨다").toBe(re.test(꼬리없음.slice(0, 60)));
  });

  it("③ learncandidates NO_GROUND_RE — 배너 문장을 한 글자도 안 바꿨다", () => {
    const lc = fs.readFileSync(path.join(__dirname, "../src/engine/learncandidates.ts"), "utf8");
    const m = /const NO_GROUND_RE = \/(.+)\/([gimsuy]*);/.exec(lc);
    expect(m, "NO_GROUND_RE를 못 읽었다").toBeTruthy();
    const re = new RegExp(m![1], m![2]);
    expect(re.test(꼬리답)).toBe(re.test(`${숫자무근거배너}\n\n본문`));
  });

  it("④ 근거없음종류판정 — startsWith라 꼬리가 뒤에 붙어도 그대로 성립한다", () => {
    expect(근거없음종류판정(꼬리답)).toBe("숫자무근거");
  });

  it("★ 상한을 넘으면 꼬리를 안 붙인다 = 답 전체가 범위 — 화면이 뒷걸음한다", () => {
    expect(없는수치꼬리상한).toBe(6);
    // 상한 그대로일 때는 범위가 잡히고, 꼬리가 없으면 범위도 없다(=오늘 동작).
    expect(근거범위(`${숫자무근거배너}${없는수치꼬리(["1%", "2%", "3%", "4%", "5%", "6%"])}\n\n본문`)?.수치?.length).toBe(6);
    expect(근거범위(`${숫자무근거배너}\n\n본문 12.5%`)).toBeUndefined();
  });
});
