// 「지금 두뇌가 답하나」 — 자가 진단·설치 진단이 **내 프로세스**가 아니라 **응답**을 본다.
//
// ■ 왜 필요했나(2026-09-10 고객 QA ⓑ 인스턴스 실측): 고객 인스턴스는 제 모델 폴더가 비어 있고
//   다른 기계에서 띄운 채팅·임베딩 서버를 주소로 **나눠 쓴다**. 채팅도, 근거 인용도, 대화 수집도
//   전부 정상이었는데 첫 화면은 빨강이었다 —
//     · /api/system-health   → 「임베딩 서버가 떠 있지 않습니다」(fail) · 채팅은 warn
//     · /api/admin/preflight → llama-server 없음(fail) · models/ 채팅 모델 없음(fail) → ready=false
//   판정이 전부 「내 프로세스가 있나」였기 때문이다. 고객은 그 빨강을 **제품 고장**으로 읽는다.
//
// ★ 여기서 재는 계약(계획서 §13 고객 QA 수리):
//   ① 주소가 답하면 초록 · ② 아무 두뇌도 안 답하면 **여전히 빨강**(폴백을 정상으로 치지 않는다)
//   ③ 내 프로세스가 있으면 **찌르지도 않고** 종전 결과 그대로 · ④ 잣대는 함수 하나(세는 곳을 안 늘린다)
//
// ⚠ 목으로 프로브를 가리지 않는다 — **진짜 HTTP 서버**를 띄워 제품이 조립한 주소로 오게 한다.
//   주입만 쓰면 「/v1을 두 번 붙이는」 부류(2026-07-19 실사고)를 원리상 못 잡는다.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const engineDir = path.join(__dirname, "..", "src", "engine");

interface 두뇌스텁 {
  port: number;
  받은경로: string[];
  close: () => Promise<void>;
}

/**
 * llama-server 흉내 — 채팅은 GET /v1/models, 임베딩은 POST /v1/embeddings에만 답한다.
 * @param 모양 modelId=목록이 돌려줄 id(경로가 섞인 판본을 흉내 낼 때 쓴다) ·
 *   health=/health가 낼 상태코드(503=모델 적재 중 · 0=창구 자체가 없음)
 */
function 스텁띄우기(모양: { modelId?: string; health?: number } = {}): Promise<두뇌스텁> {
  const 받은경로: string[] = [];
  const server = http.createServer((req, res) => {
    받은경로.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/health") {
      const code = 모양.health ?? 0;
      if (!code) { res.writeHead(404); res.end("no health"); return; }
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(code === 503 ? { error: { message: "Loading model" } } : { status: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: 모양.modelId ?? "qwen3-14b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/embeddings") {
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end("nope");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, 받은경로, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const 원래임베딩 = process.env.GIJO_EMBEDDING_URL;
const 원래포트 = process.env.GIJO_LOCAL_LLM_PORT;
let 스텁: 두뇌스텁;

beforeEach(async () => {
  스텁 = await 스텁띄우기();
});
afterEach(async () => {
  await 스텁.close();
  if (원래임베딩 === undefined) delete process.env.GIJO_EMBEDDING_URL;
  else process.env.GIJO_EMBEDDING_URL = 원래임베딩;
  if (원래포트 === undefined) delete process.env.GIJO_LOCAL_LLM_PORT;
  else process.env.GIJO_LOCAL_LLM_PORT = 원래포트;
  vi.resetModules();
});

/** 스텁을 「나눠 쓰는 두뇌」로 세운다 — 제품이 읽는 그 설정 그대로 갈아끼운다. */
function 스텁을가리키게(): void {
  process.env.GIJO_EMBEDDING_URL = `http://127.0.0.1:${스텁.port}/v1`;
  process.env.GIJO_LOCAL_LLM_PORT = String(스텁.port);
}

/** 스텁을 다른 모양(적재 중·경로 같은 이름)으로 다시 세운다 — 포트도 그 스텁으로 갈아 끼운다. */
async function 스텁을다시(모양: { modelId?: string; health?: number }): Promise<void> {
  await 스텁.close();
  스텁 = await 스텁띄우기(모양);
  스텁을가리키게();
}

/** 두뇌가 통째로 없는 기계 — 스텁을 닫고 그 자리(아무도 안 듣는 포트)를 가리킨다. */
async function 아무도안답하게(): Promise<void> {
  스텁을가리키게();
  await 스텁.close();
}

/** 고객 인스턴스처럼 「내 프로세스는 하나도 없음」으로 본다. */
function 내프로세스없음() {
  return { running: false, port: 8080, modelId: null, loaded: [] as unknown[], embedding: { running: false, port: 8081, modelId: null } };
}

describe("프로브 — 주소가 답하는지 실제로 찔러 본다", () => {
  it("임베딩: 답하면 참이고, 제품이 조립한 경로는 /v1/embeddings 하나다", async () => {
    스텁을가리키게();
    const { 임베딩응답확인 } = await import("../src/engine/embedding");
    expect(await 임베딩응답확인()).toBe(true);
    expect(스텁.받은경로, "/v1/v1/embeddings로 가면 404다 — 2026-07-19에 실제로 났던 사고").toContain("POST /v1/embeddings");
  });

  it("채팅: 답하면 살아 있다고 하고 모델 이름까지 돌려준다(GET /v1/models)", async () => {
    스텁을가리키게();
    const { 외부채팅응답확인 } = await import("../src/engine/localengine");
    const r = await 외부채팅응답확인();
    expect(r.alive).toBe(true);
    expect(r.modelId).toBe("qwen3-14b");
    expect(스텁.받은경로).toContain("GET /v1/models");
  });

  it("★ 채팅 프로브는 실추론을 안 부른다 — ping이 프롬프트 캐시를 밀어내 유휴 뒤 첫 답이 40초가 된 실측이 있다", async () => {
    스텁을가리키게();
    const { 외부채팅응답확인 } = await import("../src/engine/localengine");
    await 외부채팅응답확인();
    expect(스텁.받은경로.some((p) => p.includes("chat/completions")), "자가 진단은 호출이 잦다 — 추론을 부르면 안 된다").toBe(false);
  });

  it("아무도 안 답하면 거짓이다 — 폴백을 정상으로 세지 않는다", async () => {
    await 아무도안답하게();
    const { 임베딩응답확인 } = await import("../src/engine/embedding");
    const { 외부채팅응답확인 } = await import("../src/engine/localengine");
    expect(await 임베딩응답확인(800)).toBe(false);
    expect((await 외부채팅응답확인(800)).alive).toBe(false);
  });
});

describe("자가 진단 — 나눠 쓰는 두뇌를 초록으로 읽는다", () => {
  it("① 내 프로세스가 없어도 주소가 답하면 임베딩·모델 둘 다 ok", async () => {
    스텁을가리키게();
    vi.resetModules();
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => 내프로세스없음(),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const h = await systemHealth();
    const 임베딩 = h.checks.find((c) => c.id === "embedding")!;
    const 모델 = h.checks.find((c) => c.id === "model")!;
    expect(임베딩.level, "문서 검색이 멀쩡한데 빨강이면 고객은 제품이 고장 났다고 읽는다").toBe("ok");
    expect(모델.level).toBe("ok");
    expect(모델.detail).toContain("qwen3-14b");
    vi.doUnmock("../src/engine/localengine");
  });

  it("② 아무 두뇌도 안 답하면 여전히 임베딩 fail · 모델 warn — 종전 판정 그대로", async () => {
    await 아무도안답하게();
    vi.resetModules();
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => 내프로세스없음(),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const h = await systemHealth();
    expect(h.checks.find((c) => c.id === "embedding")!.level).toBe("fail");
    expect(h.checks.find((c) => c.id === "model")!.level).toBe("warn");
    vi.doUnmock("../src/engine/localengine");
  });

  it("③ 내 프로세스가 있으면 밖을 찌르지도 않는다 — 운영에서 결과도 비용도 안 바뀐다", async () => {
    스텁을가리키게();
    vi.resetModules();
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => ({
        running: true, port: 8080, modelId: "m1",
        loaded: [{ modelId: "m1", port: 8080, ready: true }],
        embedding: { running: true, port: 8081, modelId: "bge-m3" },
      }),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const h = await systemHealth();
    expect(h.checks.find((c) => c.id === "embedding")!.level).toBe("ok");
    expect(h.checks.find((c) => c.id === "model")!.level).toBe("ok");
    expect(스텁.받은경로, "운영은 이 판정에 네트워크를 한 번도 안 써야 한다").toEqual([]);
    vi.doUnmock("../src/engine/localengine");
  });
});

describe("설치 진단(preflight) — 파일이 없어도 두뇌가 답하면 막지 않는다", () => {
  const 없는경로 = path.join(__dirname, "__없는_llama_server__");
  const 없는폴더 = path.join(__dirname, "__없는_모델폴더__");
  const 원래바이너리 = process.env.GIJO_LLAMA_SERVER_PATH;
  const 원래모델폴더 = process.env.GIJO_MODELS_DIR;

  afterEach(() => {
    if (원래바이너리 === undefined) delete process.env.GIJO_LLAMA_SERVER_PATH;
    else process.env.GIJO_LLAMA_SERVER_PATH = 원래바이너리;
    if (원래모델폴더 === undefined) delete process.env.GIJO_MODELS_DIR;
    else process.env.GIJO_MODELS_DIR = 원래모델폴더;
  });

  async function 빈기계로진단() {
    process.env.GIJO_LLAMA_SERVER_PATH = 없는경로;
    process.env.GIJO_MODELS_DIR = 없는폴더;
    vi.resetModules();
    // 이 시험이 보는 것은 두뇌 항목뿐이다 — 기본 비밀번호(별개의 fail)를 치워야 ready를 정직하게 잰다.
    const { findUserByUsername, changePassword } = await import("../src/auth/users");
    const jyh = findUserByUsername("jyh");
    if (jyh) changePassword(jyh.id, "NotDefaultP@ss1");
    const { runPreflight } = await import("../src/engine/preflight");
    return runPreflight();
  }

  it("llama-server·모델 파일이 없고 두뇌가 답하면 info이고 ready가 참이다", async () => {
    스텁을가리키게();
    const r = await 빈기계로진단();
    expect(r.checks.find((c) => c.name === "llama-server")!.status, "나눠 쓰는 두뇌가 답하는데 fail이면 첫 화면이 거짓말을 한다").toBe("info");
    expect(r.checks.find((c) => c.name === "로컬 모델")!.status).toBe("info");
    expect(r.checks.filter((c) => c.status === "fail").map((c) => c.name), "이 설치를 막을 이유가 없다").toEqual([]);
    expect(r.ready, "info는 **알려 줄 일**이지 막을 일이 아니다").toBe(true);
  });

  it("아무 두뇌도 안 답하면 종전대로 fail·ready=false — 준비 안 된 기계를 통과시키지 않는다", async () => {
    await 아무도안답하게();
    const r = await 빈기계로진단();
    expect(r.checks.find((c) => c.name === "llama-server")!.status).toBe("fail");
    expect(r.checks.find((c) => c.name === "로컬 모델")!.status).toBe("fail");
    expect(r.ready).toBe(false);
  });
});

// ── 소스 감시: 잣대를 **한 곳**에 둔다 ────────────────────────────────────────
// 2026-08-11에 티어와 preflight가 서로 다른 말을 했고, 2026-08-17에 대시보드와 엔진 상태가
// 갈렸다. 같은 판정을 여러 곳에서 새로 적으면 화면마다 다른 답이 나온다.
describe("★ 잣대는 한 곳 — 세는 곳을 늘리지 않는다", () => {
  const 읽기 = (f: string) => fs.readFileSync(path.join(engineDir, f), "utf8");

  it("자가 진단·설치 진단·엔진 상태가 같은 함수(외부채팅응답확인)를 부른다", () => {
    for (const f of ["observability.ts", "preflight.ts", "localengine.ts"]) {
      expect(읽기(f), `${f}가 채팅 두뇌 판정을 스스로 적으면 화면마다 다른 답이 나온다`).toContain("외부채팅응답확인");
    }
  });

  it("자가 진단은 임베딩 판정도 주인 파일(embedding.ts)에서 받는다", () => {
    expect(읽기("observability.ts")).toContain("임베딩응답확인");
    expect(읽기("embedding.ts")).toContain("export async function 임베딩응답확인");
  });

  it("반증 — 자가 진단이 제 손으로 두뇌를 찌르지 않는다(주소를 새로 적으면 잣대가 둘이 된다)", () => {
    const src = 읽기("observability.ts");
    expect(src).not.toContain("/v1/models");
    expect(src).not.toContain("/embeddings");
    expect(src).not.toContain("GIJO_EMBEDDING_URL");
    expect(src).not.toContain("GIJO_LOCAL_LLM_PORT");
  });

  it("반증 — 채팅 프로브는 실추론 경로를 안 쓴다(프롬프트 캐시 사고 재발 방지)", () => {
    const src = 읽기("localengine.ts");
    const i = src.indexOf("export async function 외부채팅응답확인");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 700)).not.toContain("chat/completions");
  });

  it("시험이 진짜 llama-server(8080)를 두드리지 않게 포트를 막아 뒀다", () => {
    const conf = fs.readFileSync(path.join(__dirname, "..", "vitest.config.ts"), "utf8");
    expect(conf, "안 막으면 WSL에선 초록·Windows에선 노랑인 환경 의존 시험이 된다").toContain("GIJO_LOCAL_LLM_PORT");
    expect(Number(conf.match(/GIJO_LOCAL_LLM_PORT:\s*"(\d+)"/)?.[1] ?? 8080)).not.toBe(8080);
  });
});

// ── 2026-09-10 검토관 적발 짝 시험 ────────────────────────────────────────────
// 세 갈래를 여기서 못 박는다: ① 밖에서 받은 이름을 그대로 싣지 않는다(경로 누출)
//   ② /v1/models 200 하나로 「답한다」고 말하지 않는다(적재 중) ③ 임베딩도 같은 잣대다(화면).

describe("밖에서 받은 모델 이름 — 그대로 싣지 않는다", () => {
  it("경로가 오면 파일 이름만 남기고, 개행·제어문자는 지우고, 60자에서 자른다", async () => {
    const { 모델이름다듬기 } = await import("../src/engine/localengine");
    expect(모델이름다듬기("/home/gijo/gijo-as/server/models/qwen3-14b/qwen3-14b.gguf")).toBe("qwen3-14b.gguf");
    expect(모델이름다듬기("D:\\models\\qwen3-14b.gguf")).toBe("qwen3-14b.gguf");
    expect(모델이름다듬기("qwen3-14b\n두 번째 줄")).not.toContain("\n");
    expect((모델이름다듬기("가".repeat(200)) ?? "").length, "조치 요청서는 앞 8줄만 싣는다 — 길면 진단이 잘린다").toBeLessThanOrEqual(61);
    expect(모델이름다듬기(null)).toBeNull();
    expect(모델이름다듬기("   ")).toBeNull();
  });

  it("★ 진단 문구에 상대 기계의 절대경로가 실리지 않는다 — 그 글은 밖으로 나가는 문서에도 담긴다", async () => {
    await 스텁을다시({ modelId: "/srv/llm/models/qwen3-14b/qwen3-14b.gguf" });
    vi.resetModules();
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => 내프로세스없음(),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const 모델 = (await systemHealth()).checks.find((c) => c.id === "model")!;
    expect(모델.level).toBe("ok");
    expect(모델.detail).toContain("qwen3-14b.gguf");
    expect(모델.detail, "조치 요청서(밖으로 나가는 산출물)에 남의 기계 경로가 실린다").not.toContain("/srv/llm");
    vi.doUnmock("../src/engine/localengine");
  });
});

describe("「응답한다」와 「지금 답할 수 있다」를 가른다", () => {
  it("★ 모델을 올리는 중(/health 503)이면 초록이 아니라 노랑이다 — /v1/models는 그때도 200을 준다", async () => {
    await 스텁을다시({ health: 503 });
    const { 외부채팅응답확인 } = await import("../src/engine/localengine");
    const r = await 외부채팅응답확인();
    expect(r.alive).toBe(true);
    expect(r.적재중, "임베딩 쪽에서 배격한 신호(모델 없이도 200)로 채팅만 초록을 내면 잣대가 앞뒤로 다르다").toBe(true);

    vi.resetModules();
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => 내프로세스없음(),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const 모델 = (await systemHealth()).checks.find((c) => c.id === "model")!;
    expect(모델.level).toBe("warn");
    expect(모델.detail).toContain("올리는 중");
    vi.doUnmock("../src/engine/localengine");
  });

  it("반증 — /health가 아예 없는 서버(404)는 종전대로 초록이다. 없는 창구로 빨강을 내지 않는다", async () => {
    스텁을가리키게(); // 기본 스텁은 /health에 404를 준다
    const { 외부채팅응답확인 } = await import("../src/engine/localengine");
    const r = await 외부채팅응답확인();
    expect(r.alive).toBe(true);
    expect(r.적재중).toBe(false);
  });
});

describe("AI 엔진 화면 — 임베딩도 같은 잣대를 쓴다", () => {
  it("★ 나눠 쓰는 설치에서 임베딩 배지·🔎 팀원 카드가 그려진다(예전엔 진단만 초록이고 화면엔 없었다)", async () => {
    스텁을가리키게();
    const { 외부두뇌를채운다 } = await import("../src/engine/localengine");
    const st = await 외부두뇌를채운다(내프로세스없음() as never);
    expect(st.embedding.running, "agent.html이 이 값으로 임베딩 카드를 그린다 — false면 카드 자체가 안 생긴다").toBe(true);
    expect(st.running).toBe(true);
    expect(st.loaded.some((l) => l.ready)).toBe(true);
  });

  it("적재 중이면 화면에도 「로딩중」으로 간다 — ready를 참으로 채우지 않는다", async () => {
    await 스텁을다시({ health: 503 });
    const { 외부두뇌를채운다 } = await import("../src/engine/localengine");
    const st = await 외부두뇌를채운다(내프로세스없음() as never);
    expect(st.running).toBe(true);
    expect(st.loaded.every((l) => !l.ready)).toBe(true);
  });

  it("아무도 안 답하면 화면도 종전 그대로 — 없는 것을 있다고 하지 않는다", async () => {
    await 아무도안답하게();
    const { 외부두뇌를채운다 } = await import("../src/engine/localengine");
    const st = await 외부두뇌를채운다(내프로세스없음() as never);
    expect(st.running).toBe(false);
    expect(st.embedding.running).toBe(false);
    expect(st.loaded).toEqual([]);
  });

  it("내 프로세스가 있으면 밖을 찌르지 않는다 — 운영에서 결과도 비용도 안 바뀐다", async () => {
    스텁을가리키게();
    const { 외부두뇌를채운다 } = await import("../src/engine/localengine");
    const 원래 = {
      running: true, port: 8080, modelId: "m1",
      loaded: [{ modelId: "m1", port: 8080, ready: true }],
      embedding: { running: true, port: 8081, modelId: "bge-m3" },
    };
    const st = await 외부두뇌를채운다(원래 as never);
    expect(st).toEqual(원래);
    expect(스텁.받은경로).toEqual([]);
  });
});

describe("안 답할 때의 안내 — 나눠 쓰는 설치에는 반대로 말하지 않는다", () => {
  it("★ 나눠 쓰는 설치에 「models/ 아래 파일을 확인하세요」라고 하지 않는다(그 폴더는 일부러 비어 있다)", async () => {
    await 아무도안답하게();
    vi.resetModules();
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => 내프로세스없음(),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const 임베딩 = (await systemHealth()).checks.find((c) => c.id === "embedding")!;
    expect(임베딩.level, "아무도 안 답하면 여전히 빨강이다").toBe("fail");
    expect(임베딩.action ?? "", "따라 하면 오히려 나빠지는 안내다").not.toContain("models/");
    expect(임베딩.detail).toContain("나눠 쓰는");
    vi.doUnmock("../src/engine/localengine");
  });

  it("반증 — 나눠 쓰지 않는 보통 설치에는 종전 안내 그대로다", async () => {
    // ⚠ 여기서 진짜 기본 주소(8081)를 보게 두면 **운영 임베딩 서버를 두드린다** — 작업 규칙 위반이고
    //   「WSL에선 빨강, Windows에선 초록」인 환경 의존 시험이 된다. 그래서 이 시험만 주인 파일의
    //   두 답(안 답한다 · 나눠 쓰지 않는다)을 갈아 끼운다. 재는 것은 **자가 진단의 갈래**다.
    vi.resetModules();
    vi.doMock("../src/engine/embedding", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      임베딩응답확인: async () => false,
      임베딩나눠쓰기: () => false,
    }));
    vi.doMock("../src/engine/localengine", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getLocalEngineStatus: () => 내프로세스없음(),
    }));
    const { systemHealth } = await import("../src/engine/observability");
    const 임베딩 = (await systemHealth()).checks.find((c) => c.id === "embedding")!;
    expect(임베딩.level).toBe("fail");
    expect(임베딩.action ?? "", "이 기계에 임베딩을 둔 설치에는 이 안내가 맞다").toContain("models/");
    vi.doUnmock("../src/engine/embedding");
    vi.doUnmock("../src/engine/localengine");
  });
});

describe("★ 잣대는 한 곳 — 임베딩 축도 마찬가지다", () => {
  const 읽기 = (f: string) => fs.readFileSync(path.join(engineDir, f), "utf8");

  it("엔진 상태 창구도 임베딩 판정을 주인 파일에서 받는다 — 화면과 진단이 갈리지 않게", () => {
    expect(읽기("localengine.ts"), "채팅만 갈아 끼우면 진단은 초록·화면은 무표시로 갈린다").toContain("임베딩응답확인");
  });

  it("임베딩 주소를 아는 곳은 함수 하나다 — 진단과 제품이 딴 주소를 보지 않게", () => {
    const emb = 읽기("embedding.ts");
    expect((emb.match(/process\.env\.GIJO_EMBEDDING_URL/g) ?? []).length).toBe(1);
    expect(읽기("llm.ts"), "llm.ts에 주소 사본이 다시 생겼다").not.toContain("const EMBEDDING_SERVER_URL");
  });
});
