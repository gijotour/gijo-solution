import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { runAgentLoop } from "../src/engine/agentloop";
import { findAgentTool, buildApproval, generateAssetId, executeApprovedTool } from "../src/engine/agenttools";
import { resetAssetsForTests, registerAsset, listAssets, getAsset } from "../src/engine/assets";
import { listCompliance, resetComplianceForTests } from "../src/engine/compliance";
import { listMaintenanceItems, resetMaintenanceForTests } from "../src/engine/maintenance";
import { listProducts, resetSecurityProductsForTests } from "../src/engine/securityproducts";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

beforeEach(() => {
  mockChat.mockReset();
  resetAssetsForTests();
});

describe("generateAssetId — 이름에서 id 자동생성 (UX 러프엣지 해소)", () => {
  it("한글 이름을 슬러그+번호로 만든다", () => {
    expect(generateAssetId("사내 챗봇")).toBe("사내-챗봇-01");
  });

  it("이미 있는 id면 번호를 올린다", () => {
    registerAsset({ id: "사내-챗봇-01", name: "사내 챗봇", path: "p" });
    expect(generateAssetId("사내 챗봇")).toBe("사내-챗봇-02");
  });

  it("경로·특수문자를 걸러낸다", () => {
    expect(generateAssetId("Fraud/Detect (LLM)!")).toBe("frauddetect-llm-01");
  });

  it("이름이 전부 특수문자여도 빈 id를 만들지 않는다", () => {
    expect(generateAssetId("!!!")).toBe("asset-01");
  });
});

describe("buildApproval — 값 출처 추적 (시안 B 핵심)", () => {
  const tool = () => findAgentTool("register_asset")!;

  it("지시문에 나온 값은 said, 서버가 채운 값은 auto, LLM 추정은 guess", () => {
    const ap = buildApproval(
      tool(),
      { name: "사내 챗봇", path: "models/chatbot.gguf", owner: "보안팀" },
      "사내 챗봇 등록해줘. 경로는 models/chatbot.gguf 야"
    );
    const by = (k: string) => ap.fields.find((f) => f.key === k)!;
    expect(by("name").source).toBe("said"); // 지시문에 있음
    expect(by("path").source).toBe("said");
    expect(by("assetId").source).toBe("auto"); // autoFill이 생성
    expect(by("assetId").value).toBe("사내-챗봇-01");
    expect(by("assetType").source).toBe("auto"); // .gguf → 규칙 추정
    expect(by("assetType").value).toBe("LLM 서비스");
    expect(by("owner").source).toBe("guess"); // 지시문에 없는데 LLM이 넣음 → 검증 대상
  });

  it("공백 표기 차이를 흡수한다(사내챗봇 ↔ 사내 챗봇)", () => {
    const ap = buildApproval(tool(), { name: "사내 챗봇", path: "p.gguf" }, "사내챗봇 등록");
    expect(ap.fields.find((f) => f.key === "name")!.source).toBe("said");
  });

  it("빠진 필수값은 empty + missing에 담긴다(되물어보기 = 빈 칸)", () => {
    const ap = buildApproval(tool(), { name: "사내 챗봇" }, "사내 챗봇 등록해줘");
    const path = ap.fields.find((f) => f.key === "path")!;
    expect(path.source).toBe("empty");
    expect(path.required).toBe(true);
    expect(ap.missing).toEqual(["path"]);
  });

  // 실 GPU 실측(2026-07-17): 경로를 안 알려주면 7B 모델이 그럴듯한 경로를 지어낸다.
  // 근거 없는 필수값이 채워져 있으면 사람이 무심코 승인할 수 있으므로 빈 칸으로 되묻는다.
  it("LLM이 지어낸 필수값(guess)은 채우지 않고 되묻는다", () => {
    const ap = buildApproval(tool(), { name: "테스트봇", path: "models/testbot.gguf" }, "테스트봇 자산 등록해줘");
    const path = ap.fields.find((f) => f.key === "path")!;
    expect(path.value).toBe(""); // 지어낸 값을 버린다
    expect(path.source).toBe("empty");
    expect(ap.missing).toEqual(["path"]);
  });

  it("선택값의 AI 추정은 배지로 표시만 하고 남긴다(저위험)", () => {
    const ap = buildApproval(tool(), { name: "봇", path: "p.gguf", owner: "보안팀" }, "봇 등록해줘 경로는 p.gguf");
    const owner = ap.fields.find((f) => f.key === "owner")!;
    expect(owner.value).toBe("보안팀");
    expect(owner.source).toBe("guess");
  });

  it("실행 영향·되돌리기 고지를 포함한다", () => {
    const ap = buildApproval(tool(), { name: "봇", path: "p.gguf" }, "봇 등록");
    expect(ap.effect).toContain("자산 인벤토리에 1건 추가");
    expect(ap.undo).toContain("삭제");
  });
});

describe("runAgentLoop — 쓰기 도구는 실행하지 않고 결재판을 돌려준다", () => {
  it("register_asset 선택 시 자산이 생기지 않고 approval이 나온다", async () => {
    mockChat.mockResolvedValueOnce(
      '{"action":"tool","tool":"register_asset","args":{"name":"사내 챗봇","path":"models/chatbot.gguf"}}'
    );
    const r = await runAgentLoop("사내 챗봇 등록해줘. 경로는 models/chatbot.gguf 야");
    expect(r).not.toBeNull();
    expect(r!.approval).toBeDefined();
    expect(r!.approval!.tool).toBe("register_asset");
    expect(r!.output).toContain("승인");
    // 핵심: 승인 전에는 절대 쓰이지 않는다.
    expect(listAssets()).toHaveLength(0);
    // 결재판을 띄우는 데 LLM을 한 번만 쓴다(안내문은 규칙 생성).
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("필수값이 빠지면 안내문이 무엇이 필요한지 알려준다", async () => {
    mockChat.mockResolvedValueOnce('{"action":"tool","tool":"register_asset","args":{"name":"사내 챗봇"}}');
    const r = await runAgentLoop("사내 챗봇 등록해줘");
    expect(r!.approval!.missing).toEqual(["path"]);
    expect(r!.output).toContain("모델 경로");
  });
});

describe("executeApprovedTool — 승인된 것만 실행", () => {
  it("승인 실행이 실제로 자산을 등록한다", async () => {
    const out = await executeApprovedTool("register_asset", {
      assetId: "사내-챗봇-01",
      name: "사내 챗봇",
      path: "models/chatbot.gguf",
      assetType: "LLM 서비스",
    });
    expect(out).toContain("사내-챗봇-01");
    expect(getAsset("사내-챗봇-01")?.name).toBe("사내 챗봇");
  });

  it("id가 없으면 이름에서 생성해 등록한다", async () => {
    await executeApprovedTool("register_asset", { name: "사내 챗봇", path: "models/c.gguf" });
    expect(getAsset("사내-챗봇-01")).toBeDefined();
  });

  it("필수값이 없으면 실행하지 않는다(화면 우회 방어)", async () => {
    await expect(executeApprovedTool("register_asset", { name: "봇" })).rejects.toThrow("필수 인자 누락");
    expect(listAssets()).toHaveLength(0);
  });

  it("조회 도구는 승인 경로로 실행할 수 없다", async () => {
    await expect(executeApprovedTool("list_assets", {})).rejects.toThrow("쓰기 도구가 아닙니다");
  });

  it("중복 id는 덮어쓰지 않고 거절한다", async () => {
    registerAsset({ id: "사내-챗봇-01", name: "기존", path: "old.gguf" });
    const out = await executeApprovedTool("register_asset", { assetId: "사내-챗봇-01", name: "새것", path: "n.gguf" });
    expect(out).toContain("이미 존재하는");
    expect(getAsset("사내-챗봇-01")!.name).toBe("기존"); // 보존
  });
});

// ③ 쓰기 역량 — asset_coverage(결손 조회) 짝: assign_owner(담당부서 채우기).
describe("assign_owner — 자산 담당부서 채우기 (쓰기, 결재판 경유)", () => {
  it("단건: 승인 실행이 담당부서를 지정한다", async () => {
    registerAsset({ id: "ai-secbot-01", name: "사내 챗봇", path: "p.gguf" });
    const out = await executeApprovedTool("assign_owner", { assetId: "ai-secbot-01", owner: "보안팀" });
    expect(out).toContain("1건");
    expect(getAsset("ai-secbot-01")!.owner).toBe("보안팀");
  });

  it("다건: 쉼표로 나열한 자산 전부에 담당부서를 지정한다", async () => {
    registerAsset({ id: "vuln:10.20.0.5", name: "호스트A", path: "-" });
    registerAsset({ id: "vuln:10.20.0.9", name: "호스트B", path: "-" });
    const out = await executeApprovedTool("assign_owner", { assetId: "vuln:10.20.0.5, vuln:10.20.0.9", owner: "인프라팀" });
    expect(out).toContain("2건");
    expect(getAsset("vuln:10.20.0.5")!.owner).toBe("인프라팀");
    expect(getAsset("vuln:10.20.0.9")!.owner).toBe("인프라팀");
  });

  it("접두어(vuln:)를 흘려도 자산을 찾아 지정한다", async () => {
    registerAsset({ id: "vuln:192.168.219.98", name: "oracle.local", path: "-" });
    const out = await executeApprovedTool("assign_owner", { assetId: "192.168.219.98", owner: "DBA팀" });
    expect(getAsset("vuln:192.168.219.98")!.owner).toBe("DBA팀");
    expect(out).toContain("1건");
  });

  it("대상을 못 찾으면 등록 자산 목록을 안내한다(오발동 방지)", async () => {
    registerAsset({ id: "real-01", name: "실자산", path: "-" });
    const out = await executeApprovedTool("assign_owner", { assetId: "존재안함", owner: "x" });
    expect(out).toContain("찾지 못했습니다");
    // ⚠ 안내에는 **이름**이 나온다 — 내부 id는 사람이 읽는 글자가 아니다(2026-08-03 말투 규범).
    expect(out).toContain("실자산");
  });

  it("결재판: coverage 결과에서 온 자산 id는 found, 지시문 담당부서는 said", () => {
    registerAsset({ id: "vuln:10.20.0.5", name: "호스트A", path: "-" });
    const ap = buildApproval(
      findAgentTool("assign_owner")!,
      { assetId: "vuln:10.20.0.5", owner: "인프라팀" },
      "이 자산들 담당부서 인프라팀으로 지정해줘",
      "담당부서가 알려지지 않은 자산: vuln:10.20.0.5" // 앞선 asset_coverage 결과
    );
    const by = (k: string) => ap.fields.find((f) => f.key === k)!;
    expect(by("assetId").source).toBe("found");
    expect(by("owner").value).toBe("인프라팀");
    expect(by("owner").source).toBe("said");
    expect(ap.effect).toContain("담당부서");
  });

  it("runAgentLoop: 쓰기라 실행하지 않고 결재판을 돌려준다", async () => {
    registerAsset({ id: "vuln:10.20.0.5", name: "호스트A", path: "-" });
    mockChat.mockResolvedValueOnce('{"action":"tool","tool":"assign_owner","args":{"assetId":"vuln:10.20.0.5","owner":"인프라팀"}}');
    const r = await runAgentLoop("vuln:10.20.0.5 담당부서 인프라팀으로 지정해줘");
    expect(r!.approval!.tool).toBe("assign_owner");
    expect(getAsset("vuln:10.20.0.5")!.owner).not.toBe("인프라팀"); // 승인 전에는 안 바뀜(등록 기본값 유지)
  });
});

// 도메인별 쓰기 역량 — 조회만 있던 도메인(compliance·products·maintenance·sbom)에 쓰기 짝 추가.
describe("도메인 쓰기 역량 — 결재판 승인 실행", () => {
  beforeEach(() => {
    resetComplianceForTests();
    resetMaintenanceForTests();
    resetSecurityProductsForTests();
  });

  it("set_compliance_status: 코드로 대응 상태를 기록한다", async () => {
    const out = await executeApprovedTool("set_compliance_status", { code: "M06", status: "covered", note: "가드레일 적용" });
    expect(out).toContain("M06");
    expect(listCompliance().find((t) => t.code === "M06")!.status).toBe("covered");
  });

  it("set_compliance_status: 위협명(탈옥)으로도 지목하고 한국어 상태를 매핑한다", async () => {
    const out = await executeApprovedTool("set_compliance_status", { code: "탈옥", status: "대응완료", note: "" });
    expect(listCompliance().find((t) => t.code === "M06")!.status).toBe("covered"); // 탈옥 = M06
    expect(out).toContain("대응완료");
  });

  it("set_compliance_status: 알 수 없는 코드/상태는 실행하지 않고 안내한다", async () => {
    expect(await executeApprovedTool("set_compliance_status", { code: "ZZ99", status: "covered" })).toContain("특정하지 못했");
    expect(await executeApprovedTool("set_compliance_status", { code: "M06", status: "몰라요" })).toContain("알 수 없");
  });

  it("register_product: 보안제품을 등록부에 추가한다", async () => {
    const before = listProducts().length;
    const out = await executeApprovedTool("register_product", { name: "경계 방화벽 FW-01", category: "방화벽", vendor: "SECUI", model: "MF2" });
    expect(out).toContain("경계 방화벽 FW-01");
    expect(listProducts().length).toBe(before + 1);
    expect(listProducts().some((p) => p.name === "경계 방화벽 FW-01" && p.category === "방화벽")).toBe(true);
  });

  it("register_product: 모르는 종류는 기타로 흡수한다", async () => {
    await executeApprovedTool("register_product", { name: "정체불명", category: "이상한종류" });
    expect(listProducts().find((p) => p.name === "정체불명")!.category).toBe("기타");
  });

  it("schedule_maintenance: 점검 일정을 등록한다", async () => {
    const out = await executeApprovedTool("schedule_maintenance", { productName: "경계 방화벽", scheduleDate: "2026-08-01" });
    expect(out).toContain("2026-08-01");
    expect(listMaintenanceItems().some((m) => m.productName === "경계 방화벽" && m.scheduleDate === "2026-08-01")).toBe(true);
  });

  it("schedule_maintenance: 잘못된 날짜는 실행하지 않고 되묻는다", async () => {
    const out = await executeApprovedTool("schedule_maintenance", { productName: "방화벽", scheduleDate: "아무때나" });
    expect(out).toContain("YYYY-MM-DD");
    expect(listMaintenanceItems()).toHaveLength(0);
  });

  it("schedule_maintenance: autoFill이 상대 표현을 YYYY-MM-DD로 정정한다", () => {
    const ap = buildApproval(
      findAgentTool("schedule_maintenance")!,
      { productName: "방화벽", scheduleDate: "오늘" },
      "방화벽 점검 오늘로 잡아줘"
    );
    const date = ap.fields.find((f) => f.key === "scheduleDate")!;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date.source).toBe("auto");
  });

  it("generate_sbom: 자산의 SBOM을 생성한다", async () => {
    registerAsset({ id: "fraud-detect-llm", name: "이상거래탐지", path: "m.gguf" });
    const out = await executeApprovedTool("generate_sbom", { assetId: "fraud-detect-llm" });
    expect(out).toContain("SBOM");
    expect(getAsset("fraud-detect-llm")!.sbomGeneratedAt).toBeTruthy();
  });
});

describe("POST /api/agent/approve", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("승인 요청이 자산을 등록한다", async () => {
    const res = await request(app)
      .post("/api/agent/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "register_asset", args: { name: "사내 챗봇", path: "models/chatbot.gguf" } });
    expect(res.status).toBe(200);
    expect(res.body.output).toContain("등록했습니다");
    expect(getAsset("사내-챗봇-01")).toBeDefined();
  });

  it("인증 없이는 실행할 수 없다", async () => {
    const res = await request(app).post("/api/agent/approve").send({ tool: "register_asset", args: { name: "x", path: "y" } });
    expect(res.status).toBe(401);
    expect(listAssets()).toHaveLength(0);
  });

  it("잘못된 인자는 400으로 거절한다", async () => {
    const res = await request(app)
      .post("/api/agent/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "register_asset", args: { name: "봇" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("필수 인자 누락");
  });

  it("dispatch가 쓰기 지시에 approval을 실어 보낸다(실행 없이)", async () => {
    // 에이전트 루프가 intent 분류보다 먼저 돈다 — 첫 LLM 호출이 곧 도구 결정이다.
    mockChat.mockResolvedValueOnce('{"action":"tool","tool":"register_asset","args":{"name":"챗봇","path":"c.gguf"}}');
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "챗봇 등록해줘 경로는 c.gguf" });
    expect(res.status).toBe(200);
    expect(res.body.approval.tool).toBe("register_asset");
    expect(listAssets()).toHaveLength(0);
  });
});
