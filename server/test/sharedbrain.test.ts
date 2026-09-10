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

/** llama-server 흉내 — 채팅은 GET /v1/models, 임베딩은 POST /v1/embeddings에만 답한다. */
function 스텁띄우기(): Promise<두뇌스텁> {
  const 받은경로: string[] = [];
  const server = http.createServer((req, res) => {
    받은경로.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "qwen3-14b" }] }));
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
