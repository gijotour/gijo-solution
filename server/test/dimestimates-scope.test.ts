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

/** 제품 부품을 그대로 불러온다 — DOM은 안 쓰는 함수만 만진다(vitest 환경=node). */
const P: any = (() => {
  const win: any = {};
  // eslint-disable-next-line no-new-func
  new Function("window", partsSrc)(win);
  return win.gijoChatParts;
})();

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
    expect(partsSrc).toMatch(/function dimEstimates\(el, 근거없음\) \{\s*\n\s*if \(!근거없음\) return 0;/);
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
