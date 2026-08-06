// 라우팅 규칙표 ↔ 실제 코드 대조.
//
// 왜 필요한가: 규칙표(routes.ts)는 실행하지 않는다 — 그래서 **낡아도 아무도 모른다.**
//   낡은 표는 없는 표보다 나쁘다(있는 줄 알고 믿기 때문). 그래서 시험이 표와 코드를 맞대 본다.
//
// ⚠ 이 시험은 **동작을 재지 않는다.** 라우팅이 맞게 도는지는 평가 게이트(routing 65문항)와
//   실전 147상황이 잰다. 여기서 재는 것은 "표가 코드를 정직하게 말하는가" 하나다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 길목록, 층, 순서대로 } from "../src/engine/routes";

const 읽기 = (f: string) => fs.readFileSync(path.join(__dirname, "../src/engine", f), "utf8");
const 소스: Record<string, string> = {
  "dispatcher.ts": 읽기("dispatcher.ts"),
  "agentloop.ts": 읽기("agentloop.ts"),
  "gateway.ts": 읽기("gateway.ts"),
};

describe("라우팅 규칙표 — 표가 코드를 정직하게 말한다", () => {
  it("표가 가리키는 판별자가 코드에 실재하고 **실제로 불린다**", () => {
    // ⚠ 「파일에 그 글자가 있다」로만 봤다가 치명 결함을 놓쳤다(2026-08-07 검토관 발견):
    //   가리킬것없는대명사가 dispatcher의 **import 줄에만** 있고 호출부가 없는데 초록이었다 —
    //   규칙표가 거짓을 말하는데 감시가 통과였다. 함수꼴 판별자는 **호출 자리**(이름 뒤 여는 괄호,
    //   import·export·정의 줄 제외)까지 요구한다.
    const 불리나 = (파일: string, 이름: string): boolean => {
      const src = 소스[파일];
      if (!/^[A-Za-z가-힣_][A-Za-z가-힣0-9_]*$/.test(이름)) return src.includes(이름); // 함수꼴 아님 — 존재만 본다
      // 쓰임 = 이름 뒤 여는 괄호(함수 호출) 또는 .test( (정규식 판별). import·정의 줄은 쓰임이 아니다.
      const 쓰임 = new RegExp(`${이름}(\\.test)?\\(`);
      const 정의 = new RegExp(`function ${이름}\\b|const ${이름}\\s*[=:]`);
      return src.split("\n").some((l) => !/^\s*import\b/.test(l) && !정의.test(l) && 쓰임.test(l));
    };
    const 없는것 = 길목록
      .filter((r) => !/^FORCED_INTENTS\[\d+\]$/.test(r.판별))
      .filter((r) => !r.판별.split(" + ").every((n) => 불리나(r.파일, n)))
      .map((r) => `${r.이름}: ${r.파일} → ${r.판별}`);
    expect(없는것, `표에 적힌 판별자가 코드에 없거나 **불리지 않는다**(표가 거짓말한다):\n  ${없는것.join("\n  ")}`).toEqual([]);
  });

  it("강제 도구 자리 번호가 실제 배열과 맞는다", () => {
    // FORCED_INTENTS는 **배열 순서가 곧 우선순위**다 — 자리가 어긋나면 표가 거짓이 된다.
    const a = 소스["agentloop.ts"];
    const i = a.indexOf("const FORCED_INTENTS");
    const 블록 = a.slice(i, a.indexOf("\n];", i));
    const 실제 = [...블록.matchAll(/tool: "([a-z_]+)"/g)].map((m) => m[1]);

    const 표 = 길목록.filter((r) => /^FORCED_INTENTS\[\d+\]$/.test(r.판별));
    expect(표.length, `강제 도구 개수가 다르다 — 코드 ${실제.length}개, 표 ${표.length}개`).toBe(실제.length);

    const 어긋남 = 표
      .map((r) => ({ r, 자리: Number(/\[(\d+)\]/.exec(r.판별)![1]) }))
      .filter(({ r, 자리 }) => 실제[자리] !== r.도착)
      .map(({ r, 자리 }) => `${자리}번: 표는 ${r.도착}, 코드는 ${실제[자리]}`);
    expect(어긋남, `강제 도구 자리가 어긋났다:\n  ${어긋남.join("\n  ")}`).toEqual([]);
  });

  it("모든 길에 이유가 있다", () => {
    // ⚠ 이유 없는 규칙은 나중에 지울 수도 고칠 수도 없다 — 왜 넣었는지 아무도 모르기 때문.
    const 부실 = 길목록.filter((r) => r.왜.length < 20).map((r) => r.이름);
    expect(부실, `이유가 너무 짧은 길:\n  ${부실.join(", ")}`).toEqual([]);
  });

  it("이름이 겹치지 않는다", () => {
    const 본것 = new Set<string>();
    const 중복 = 길목록.filter((r) => (본것.has(r.이름) ? true : (본것.add(r.이름), false))).map((r) => r.이름);
    expect(중복, `같은 이름의 길이 둘 이상이다: ${중복.join(", ")}`).toEqual([]);
  });

  it("층 순서가 실제 실행 순서와 같다 — 가드레일이 맨 앞, 모델 선택이 맨 뒤", () => {
    const 순 = 순서대로();
    expect(순[0].층).toBe("가드레일");
    expect(층[순[순.length - 1].층]).toBeGreaterThanOrEqual(층.강제도구);
  });

  it("★ 「가로지르는 검색」이 비켜서는 말들 — 앞에 있는 규칙이 뒤의 좁은 규칙을 가로채면 안 된다", () => {
    // FORCED_INTENTS는 배열 순서가 곧 우선순위다. 넓은 규칙(search)이 앞에 있어
    // 좁은 규칙을 삼킨 사고가 두 번 있었다:
    //   · 2026-08-02 — "지금 가장 급한 취약점"이 search로 새어 게이트 routing 100%→96.9%
    //   · 2026-08-03 — "잃은 취약점 있어?"가 query="잃은"으로 검색에 새어 "찾지 못했습니다".
    //     담당자는 4,467건이 덮여 있다는 사실을 영영 못 본다.
    // 비켜섬은 정규식이 아니라 **적용부의 continue**에 있어 표만 봐서는 안 보인다 — 소스를 읽는다.
    const 적용부 = 소스["agentloop.ts"].slice(소스["agentloop.ts"].indexOf('if (f.tool === "search")'));
    expect(적용부.length, "search 적용부를 못 찾았다 — 이 시험이 헛돌고 있다").toBeGreaterThan(400);
    const 비켜야할것: [string, RegExp][] = [
      ["세는 질문", /몇\\s\*\(건\|개\)/],
      ["오늘·우선순위", /오늘\|지금/],
      ["잃은 취약점", /잃\|사라진/],
    ];
    for (const [이름, 있어야] of 비켜야할것) {
      expect(있어야.test(적용부), `search가 「${이름}」에 비켜서지 않는다`).toBe(true);
    }
  });

  it("이 대조가 헛돌고 있지 않다", () => {
    // 표가 비었거나 소스를 못 읽었으면 위 시험들이 전부 조용히 통과한다.
    expect(길목록.length, "표가 너무 작다 — 규칙을 안 옮겼다").toBeGreaterThanOrEqual(25);
    for (const [f, s] of Object.entries(소스)) expect(s.length, `${f}를 못 읽었다`).toBeGreaterThan(5000);
    expect(new Set(길목록.map((r) => r.층)).size, "층이 하나뿐이면 우선순위를 안 적은 것이다").toBeGreaterThanOrEqual(4);
  });
});
