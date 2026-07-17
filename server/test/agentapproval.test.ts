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
    // dispatch는 LLM을 두 번 쓴다: ① intent 라우팅 ② 에이전트 루프의 도구 결정.
    mockChat
      .mockResolvedValueOnce('{"action":"chat","targetAssetId":null}')
      .mockResolvedValueOnce('{"action":"tool","tool":"register_asset","args":{"name":"챗봇","path":"c.gguf"}}');
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "챗봇 등록해줘 경로는 c.gguf" });
    expect(res.status).toBe(200);
    expect(res.body.approval.tool).toBe("register_asset");
    expect(listAssets()).toHaveLength(0);
  });
});
