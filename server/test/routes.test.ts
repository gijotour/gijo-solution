// 라우팅 규칙표 ↔ 실제 코드 대조.
//
// 왜 필요한가: 규칙표(routes.ts)는 실행하지 않는다 — 그래서 **낡아도 아무도 모른다.**
//   낡은 표는 없는 표보다 나쁘다(있는 줄 알고 믿기 때문). 그래서 시험이 표와 코드를 맞대 본다.
//
// ⚠ 이 시험은 **동작을 재지 않는다.** 라우팅이 맞게 도는지는 평가 게이트(routing 65문항)와
//   실전 147상황이 잰다. 여기서 재는 것은 "표가 코드를 정직하게 말하는가" 하나다.
import { describe, it, expect, vi } from "vitest";

// ⚠ 역방향 감시가 **제품 함수**(결정적체인)를 부른다 — 표를 소스에서 다시 긁어 흉내 내지 않는다
//   (두 벌이면 어긋난다 · helpers/routing.ts 머리글 계약). 그러려면 llm 목이 필요하다:
//   llm이 RAG·수집 훅을 내보내므로 목도 그 표면을 따라가야 한다(안 주면 그 모듈을 import하는
//   파일이 통째로 죽는다). routeexplain.route.test.ts와 **같은 목**이다.
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import { 길목록, 층, 순서대로 } from "../src/engine/routes";
import { 결정적체인 } from "../src/engine/dispatcher";

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
      // 쓰임 = 이름 뒤 여는 괄호(함수 호출) 또는 .test(/.exec(/.match( (정규식 판별).
      // import·정의 줄은 쓰임이 아니다.
      // ⚠ .exec·.match를 2026-09-04에 더했다 — 되열기_RE는 `되열기_RE.exec(...)`로만 쓰여
      //   「불리지 않는다」로 잡혔다. 정규식을 쓰는 법이 .test 하나뿐이라고 본 것이 좁았다.
      const 쓰임 = new RegExp(`${이름}(\\.test|\\.exec|\\.match)?\\(`);
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
    // ⚠ 2026-08-10: 규칙 하나를 배열 **중간에** 넣자 그 뒤 자리가 전부 밀려 표가 거짓이 됐다.
    //   이 시험이 잡아 주긴 했지만, 잡힌 뒤 58줄을 **손으로 세어 고치는 것**이 남는다 —
    //   세다가 또 틀린다. 그래서 고치는 법을 실패 메시지에 넣는다(사람이 기억할 일이 아니다).
    expect(
      어긋남,
      `강제 도구 자리가 어긋났다:\n  ${어긋남.join("\n  ")}\n\n` +
        `→ 고치기: node tools/routes-renumber.mjs --write\n` +
        `   (도구 이름이 유일한 줄만 자동으로 옮긴다 — 중복 도구는 직접 봐야 한다)`,
    ).toEqual([]);
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

  it("층 순서가 실제 실행 순서와 같다 — 가드레일이 맨 앞, 강제도구가 맨 뒤", () => {
    const 순 = 순서대로();
    expect(순[0].층).toBe("가드레일");
    expect(층[순[순.length - 1].층]).toBeGreaterThanOrEqual(층.강제도구);
    // ⚠ `순서대로()`는 **차례**로 줄 세운다(층이 아니다). 층으로 세우면 되묻기[31]이
    //   특수경로[11]보다 앞으로 올라와 거짓이 된다 — 그 함정을 여기서 못 박는다.
    const 차례들 = 순.map((r) => r.차례).filter((n): n is number => n !== undefined);
    expect(차례들, "차례가 붙은 길은 오름차순으로 나와야 한다").toEqual([...차례들].sort((a, b) => a - b));
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

// ═══════════════════════════════════════════════════════════════════════════════
//  ★★ 역방향 — **코드에 있는데 표에 없는 것**을 잡는다 (2026-09-04 신설)
//
//  ★★ 왜 있나 (실측 2026-09-04 · 00b47a67 뒤)
//    위 시험들은 전부 「표에 적힌 것」에서 출발한다 — 그래서 **안 적은 것**은 원리상 못 본다.
//    그날 세어 보니 dispatcher의 결정적 갈래 37개 중 **26개가 표에 아예 없었다**
//    (isFindingListAsk·isMyWorkAsk·screenNameCard·isHardeningStatusAsk·이름으로화면찾기·
//     findHowTo·isOutOfScope·isTooVague·장애질문인가·침해사고질문인가·isScopeCommand·
//     isScenarioAsk·faqAnswerFor·결재승인요청_RE …). 시험은 내내 초록이었고, 그 사이
//    route-explain은 「미조치 취약점 뭐 있어?」를 「search로 갑니다」라고 **거짓 설명**했다.
//    「낡은 표는 없는 표보다 나쁘다」의 실례 — 빠뜨림은 역방향으로만 잡힌다.
//
//  ⚠ 여기서 표를 소스에서 다시 긁지 않는다 — **제품 함수**(결정적체인)를 그대로 부른다.
//    흉내 낸 두 벌은 반드시 어긋난다(helpers/routing.ts 머리글이 세워 둔 계약).
// ═══════════════════════════════════════════════════════════════════════════════
describe("★★ 역방향 — 코드 체인 ⊆ 표", () => {
  const 체인줄 = () => 길목록.filter((r) => r.차례 !== undefined);

  it("결정적 체인의 `감시` 글자가 표에 **전부** 있다 — 빠진 것을 이름으로 알린다", async () => {
    const 체인 = await 결정적체인();
    const 표감시 = new Set(길목록.map((r) => r.감시).filter(Boolean));
    const 빠진것 = 체인.filter((s) => !표감시.has(s.감시)).map((s) => `[${s.차례}] ${s.이름} (${s.판별}) — 감시: ${s.감시}`);
    expect(
      빠진것,
      `코드 체인에 있는데 **표에 없는** 갈래 ${빠진것.length}개 — routes.ts 길목록에 적어야 한다:\n  ${빠진것.join("\n  ")}\n\n` +
        `→ 적는 법: dispatcher.ts 체인훑기()의 그 줄에서 이름·층·판별·도착·감시를 **그대로** 옮기고 왜를 한 줄 쓴다.`,
    ).toEqual([]);
  });

  it("판별자 이름도 표에 전부 있다 — 감시만 맞고 판별이 낡은 경우를 잡는다", async () => {
    const 체인 = await 결정적체인();
    const 표판별 = new Set(길목록.map((r) => r.판별));
    const 빠진것 = 체인.filter((s) => !표판별.has(s.판별)).map((s) => `[${s.차례}] ${s.이름} — ${s.판별}`);
    expect(빠진것, `체인의 판별자가 표에 없다:\n  ${빠진것.join("\n  ")}`).toEqual([]);
  });

  it("★ 표의 체인 줄이 코드와 **한 글자도** 안 갈린다 — 차례·이름·판별·도착·층·감시", async () => {
    const 체인 = await 결정적체인();
    const 표 = [...체인줄()].sort((a, b) => a.차례! - b.차례!);
    // 개수부터 — 표에만 있는 차례(없는 갈래를 적어 둔 것)도 여기서 걸린다.
    expect(표.length, `표의 체인 줄 ${표.length}개 vs 코드 체인 ${체인.length}단계`).toBe(체인.length);
    const 갈린것: string[] = [];
    표.forEach((r, i) => {
      const s = 체인[i];
      if (r.차례 !== s.차례) 갈린것.push(`[${i}] 차례: 표 ${r.차례} / 코드 ${s.차례}`);
      if (r.이름 !== s.이름) 갈린것.push(`[${i}] 이름: 표 「${r.이름}」 / 코드 「${s.이름}」`);
      if (r.판별 !== s.판별) 갈린것.push(`[${i}] 판별: 표 ${r.판별} / 코드 ${s.판별}`);
      if (r.층 !== s.층) 갈린것.push(`[${i}] 층: 표 ${r.층} / 코드 ${s.층}`);
      if (r.감시 !== s.감시) 갈린것.push(`[${i}] 감시: 표 「${r.감시}」 / 코드 「${s.감시}」`);
    });
    expect(갈린것, `표가 코드와 갈렸다(표가 거짓말한다):\n  ${갈린것.join("\n  ")}`).toEqual([]);
  });

  it("★ 표에 적힌 줄 순서가 **코드 순서 그대로**다 — 읽는 사람이 위에서 아래로 따라갈 수 있다", () => {
    const 적힌순 = 체인줄().map((r) => r.차례!);
    expect(적힌순, "길목록에 적힌 체인 줄이 차례 순이 아니다 — 줄을 옮겨 적을 것").toEqual(
      적힌순.map((_, i) => i),
    );
  });

  it("★ 층 번호 = 그 층이 체인에서 **처음 나오는 차례** — 화면안내 30·체크선택 40 같은 거짓말을 막는다", () => {
    // ⚠ 2026-09-04 이전의 번호(화면안내 30 · 체크선택 40 · 내업무 50)는 실제와 **거꾸로**였다.
    //   코드는 내업무[7] → 체크선택[10] → 화면안내[20] 순으로 본다. 손으로 매기면 또 틀린다.
    const 첫차례 = new Map<string, number>();
    for (const r of 체인줄()) if (!첫차례.has(r.층)) 첫차례.set(r.층, r.차례!);
    const 어긋남 = [...첫차례].filter(([이름, 차례]) => 층[이름 as keyof typeof 층] !== 차례)
      .map(([이름, 차례]) => `${이름}: 표는 ${층[이름 as keyof typeof 층]}, 체인 첫 차례는 ${차례}`);
    expect(어긋남, `층 번호가 실제 순서와 다르다:\n  ${어긋남.join("\n  ")}`).toEqual([]);
    // 체인 밖 층(잡담·모델선택)은 체인의 맨 끝(강제도구)보다 뒤여야 한다 — 앞에 두면 거짓이 된다.
    expect(층.잡담, "잡담은 체인 밖(llm 답 경로)이라 강제도구보다 뒤다").toBeGreaterThan(층.강제도구);
    expect(층.모델선택, "모델 선택은 결정적 갈래가 하나도 안 걸렸을 때다 — 맨 뒤").toBeGreaterThan(층.잡담);
  });

  it("이 역방향 대조가 헛돌고 있지 않다", async () => {
    const 체인 = await 결정적체인();
    expect(체인.length, "체인이 비었다 — 제품 함수를 못 불렀다").toBeGreaterThan(30);
    expect(체인줄().length, "표에 체인 줄이 하나도 없다 — 차례를 안 적었다").toBe(체인.length);
    expect(체인[체인.length - 1].판별, "강제도구가 체인의 맨 끝이라는 전제가 깨졌다").toBe("forcedToolFor");
  });
});
