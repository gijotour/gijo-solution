// 행동 대조(계획서 전-2, 2026-07-29) — 시장 조사에서 확인된 교차 공백 기능.
// [전중후 계획서 정렬] 가장 중요한 성질: **근거 없으면 판정하지 않는다**(조치검증 NA 계약).
// 7B에게는 판정 한 조각만 맡기고 형식·인용·면책은 코드가 조립한다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const chatMock = vi.fn(async () => JSON.stringify({ verdict: "deny", reason: "근거 1이 보관 기간 단축을 금지한다." }));
vi.mock("../src/engine/llm", () => ({
  chat: (...a: unknown[]) => chatMock(...a as []),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

let memoryHits: { text: string; distance: number; documentId?: string; lexicalHit?: boolean }[] = [];
// 판정 자격 게이트용 문서 카테고리 — 기본으로 규정 문서 1개 + 벤더 매뉴얼 1개를 등록해 둔다.
let docList: { documentId: string; category: string | null }[] = [];
vi.mock("../src/engine/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/memory")>()),
  queryMemoryScored: vi.fn(async () => memoryHits),
  listDocuments: vi.fn(async () => docList),
}));

let lawEnabled = false;
let lawResults: { title: string; meta: string; link: string }[] = [];
vi.mock("../src/engine/lawinfo", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/engine/lawinfo")>();
  return {
    ...orig,
    getLawConfig: vi.fn(() => ({ enabled: lawEnabled, hasKey: lawEnabled, domain: "www.gijo.ai", laws: [], updatedAt: null })),
    searchLaw: vi.fn(async () => lawResults),
  };
});

import { ACTION_CHECK_RE, runActionCheck } from "../src/engine/actioncheck";
import { LEGAL_DISCLAIMER } from "../src/engine/lawinfo";

const RULE_CHUNK = {
  text: "개인정보처리시스템 접속기록은 최소 1년 이상 보관·점검하여야 하며, 5만 명 이상 정보주체를 처리하는 경우 2년 이상 보관한다.",
  distance: 0.4,
  documentId: "사내_개인정보_내부관리계획.pdf",
  lexicalHit: false,
};

beforeEach(() => {
  chatMock.mockClear();
  memoryHits = [];
  lawEnabled = false;
  lawResults = [];
  docList = [
    { documentId: "사내_개인정보_내부관리계획.pdf", category: "사내규정" },
    { documentId: "Tenable_User_Guide.pdf", category: "장비운영" },
  ];
});

describe("행동 대조 — 의도 감지", () => {
  it("허락·적법성 질문만 잡는다", () => {
    expect(ACTION_CHECK_RE.test("접속기록 보관 주기를 6개월로 줄여도 돼?")).toBe(true);
    expect(ACTION_CHECK_RE.test("방화벽에 임시 any 룰 넣으려는데 괜찮아?")).toBe(true);
    expect(ACTION_CHECK_RE.test("이거 규정에 어긋나?")).toBe(true); // 규정(에) 어긋
    expect(ACTION_CHECK_RE.test("이거 위반인가?")).toBe(true);
    expect(ACTION_CHECK_RE.test("방화벽에 임시로 any 허용 룰 넣어도 돼?")).toBe(true); // 동사 일반화(실측 누락분)
  });
  // [전중후 계획서 정렬: 중-3] 평가 게이트 첫 실행이 잡은 구멍 — 줄어든 어미(주+어도=줘도,
  // 보내+어도=보내도, 바꾸+어도=바꿔도)는 '아도/어도/여도'로 끝나지 않아 통째로 비껴갔다.
  it("줄어든 어미(줘도·보내도·바꿔도)도 잡는다", () => {
    expect(ACTION_CHECK_RE.test("USB에 고객 자료 담아서 외부 협력사에 갖다줘도 돼?")).toBe(true);
    expect(ACTION_CHECK_RE.test("점검 결과를 개인 메일로 보내도 돼?")).toBe(true);
    expect(ACTION_CHECK_RE.test("장비 설정 바꿔도 되나?")).toBe(true);
    expect(ACTION_CHECK_RE.test("포트를 열어놔도 되나")).toBe(true);
  });
  it("조회·실행·기능 질문은 잡지 않는다", () => {
    expect(ACTION_CHECK_RE.test("미조치 취약점 알려줘")).toBe(false);
    expect(ACTION_CHECK_RE.test("하드닝 점검해줘")).toBe(false);
    expect(ACTION_CHECK_RE.test("원격 스캔 가능해?")).toBe(false); // 기능 질문 — 일부러 안 잡는다
    // 명사+보조사 '도'는 일부러 제외 — 삼키면 평범한 물음이 판정 불가(NA)로 튄다.
    expect(ACTION_CHECK_RE.test("이것도 돼?")).toBe(false);
    expect(ACTION_CHECK_RE.test("우리도 되나요?")).toBe(false);
  });
});

describe("행동 대조 — NA 계약", () => {
  it("사내 근거 0건이면 판정하지 않고, LLM도 부르지 않는다", async () => {
    const r = await runActionCheck("USB 반출 정책 완화해도 돼?");
    expect(r.output).toContain("판단 불가");
    expect(r.output).toContain("못 찾았다");
    expect(r.output).toContain(LEGAL_DISCLAIMER);
    expect(r.sources).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled(); // 근거 없이 모델에게 묻지 않는다
  });

  it("근거 없음 + 법령만 있으면 판정 없이 법령 원문 안내만 붙는다", async () => {
    lawEnabled = true;
    lawResults = [{ title: "개인정보 보호법", meta: "법률", link: "https://law.go.kr/1" }];
    const r = await runActionCheck("접속기록 보관 주기 줄여도 돼?");
    expect(r.output).toContain("판단 불가");
    expect(r.output).toContain("개인정보 보호법");
    expect(r.output).not.toContain("【행동 대조】"); // 법령 제목만으론 판정하지 않는다
  });
});

describe("행동 대조 — 판정 자격 게이트 (2026-07-29 실측 사고 방지)", () => {
  it("벤더 매뉴얼만 걸리면 판정하지 않는다 — 장비 사용법은 회사의 허락이 아니다", async () => {
    // 실사고: Tenable 가이드를 근거로 '외부 공유 ○ 허용'이 나왔다. 규정 아닌 문서는 참고로 강등.
    memoryHits = [{ text: "Export 메뉴에서 PDF로 내보내 공유할 수 있다.", distance: 0.5, documentId: "Tenable_User_Guide.pdf" }];
    const r = await runActionCheck("외부 업체에 스캔 결과 pdf 공유해도 돼?");
    expect(r.output).toContain("판단 불가");
    expect(r.output).toContain("판정 근거로 쓰지 않았습니다");
    expect(r.output).toContain("Tenable_User_Guide.pdf"); // 참고로는 보여준다(감추지 않음)
    expect(r.sources).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("규정+비규정이 섞이면 규정만 판정 근거, 비규정은 참고로 분리된다", async () => {
    memoryHits = [
      RULE_CHUNK,
      { text: "로그 화면에서 보관 주기를 설정한다.", distance: 0.5, documentId: "Tenable_User_Guide.pdf" },
    ];
    const r = await runActionCheck("접속기록 보관 주기 줄여도 돼?");
    expect(r.output).toContain("【행동 대조】");
    expect(r.sources).toEqual(["사내_개인정보_내부관리계획.pdf"]); // 근거 배지는 규정 문서만
    expect(r.output).toContain("참고 자료");
  });
});

describe("행동 대조 — 판정과 조립", () => {
  it("사내 근거가 있으면 판정+인용+면책을 코드가 조립한다", async () => {
    memoryHits = [RULE_CHUNK];
    const r = await runActionCheck("접속기록 보관 주기를 6개월로 줄여도 돼?");
    expect(r.output).toContain("【행동 대조】 × 금지");
    expect(r.output).toContain("사내_개인정보_내부관리계획.pdf");
    expect(r.output).toContain("사내 근거(원문 발췌");
    expect(r.output).toContain(LEGAL_DISCLAIMER);
    expect(r.sources).toEqual(["사내_개인정보_내부관리계획.pdf"]);
  });

  it("법령 조회가 꺼져 있으면 그 사실을 답에 밝힌다(폐쇄망 정직)", async () => {
    memoryHits = [RULE_CHUNK];
    const r = await runActionCheck("접속기록 보관 주기 줄여도 돼?");
    expect(r.output).toContain("조회 꺼짐(폐쇄망 모드)");
  });

  it("모델이 형식을 못 지키면 판정을 지어내지 않고 보류한다", async () => {
    memoryHits = [RULE_CHUNK];
    chatMock.mockResolvedValueOnce("접속기록은 중요합니다. 보관하세요."); // JSON 아님
    const r = await runActionCheck("접속기록 보관 주기 줄여도 돼?");
    expect(r.output).toContain("판정 보류");
    expect(r.output).toContain("사내_개인정보_내부관리계획.pdf"); // 근거는 그대로 보여준다
  });

  it("판정 이유가 영어면 이유만 정직하게 바꾼다(7B 실측)", async () => {
    memoryHits = [RULE_CHUNK];
    chatMock.mockResolvedValueOnce(JSON.stringify({ verdict: "deny", reason: "The grounds prohibit this action." }));
    const r = await runActionCheck("접속기록 보관 주기 줄여도 돼?");
    expect(r.output).toContain("× 금지"); // 판정은 유지
    // ⚠ 문구가 바뀌었다(2026-08-02): "한국어로 받지 못했습니다"는 **우리 사정**이라
    //   담당자가 알 이유가 없다. 147상황 실전 시뮬레이션이 내부 사정 노출로 잡았다.
    //   지키는 것은 문구가 아니라 **영어 설명을 그대로 내보내지 않는다**는 성질이다.
    expect(r.output).toContain("우리말로 정리하지 못했습니다");
    expect(r.output, "영어 설명이 그대로 나갔다").not.toMatch(/[A-Za-z]{12,}/);
  });

  it("관련성 문턱을 못 넘는 조각은 근거로 쓰지 않는다", async () => {
    memoryHits = [{ ...RULE_CHUNK, distance: 1.4, lexicalHit: false }]; // 0.95 초과
    const r = await runActionCheck("접속기록 보관 주기 줄여도 돼?");
    expect(r.output).toContain("판단 불가");
    expect(chatMock).not.toHaveBeenCalled();
  });
});

// 「해도 되나」 판정이 **띄어쓰기 하나**로 갈리던 것 (2026-08-03 실전 시뮬레이션 실측).
//   "USB로 로그 반출해도 돼?"는 행동 대조가 떴는데 "협력사에 자산 목록 줘도 되나?"는
//   잡담으로 떨어졌다 — 정규식이 동사 바로 앞에 한글을 요구해 "목록 줘도"의 공백에 걸렸다.
//   ★ 우리 차별 기능이 띄어쓰기에 따라 켜졌다 꺼졌다 하면 담당자는 그 기능을 못 믿는다.
describe("행동 대조 — 물음 형태가 달라도 같게 잡는다", () => {
  const 잡아야 = [
    "협력사에 자산 목록 줘도 되나?",      // ★ 공백이 있어 놓치던 것
    "USB로 로그 반출해도 돼?",
    "방화벽에 임시로 any 허용 룰 넣어도 돼?",
    "점검 결과를 개인 메일로 보내도 돼?",
    "테스트 서버에 실제 데이터 써도 될까?",
  ];
  for (const q of 잡아야) {
    it(`허락 질문으로 잡는다 — "${q}"`, () => {
      expect(ACTION_CHECK_RE.test(q), "행동 대조가 안 켜지면 잡담으로 떨어진다").toBe(true);
    });
  }

  // ⚠ 과발동 방지 — 기능 질문·조회 질문까지 행동 대조로 끌면 답이 엉뚱해진다.
  const 잡으면안됨 = ["원격 스캔 가능해?", "취약점 알려줘", "오늘 뭐부터 해야 해?", "리포트 만들어줘"];
  for (const q of 잡으면안됨) {
    it(`허락 질문이 아니다 — "${q}"`, () => {
      expect(ACTION_CHECK_RE.test(q)).toBe(false);
    });
  }
});
