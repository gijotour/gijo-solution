// 부팅 인입은 **임베딩이 답한 뒤에** 시작한다 (2026-09-05 · 계획서 전-4)
//
// ■ 무엇을 고쳤나 (실측: 재시작마다 나던 로그)
//   `[memory] 임베딩 일시 실패(시도 1/5, N건) — 10초 후 재시도` → 10초 뒤 준비됨 → 문서 N건 재인입.
//   부팅 인입 셋(제품 문서·사례·승인 문답)이 임베딩 llama-server(8081)의 모델 적재보다 먼저
//   달려들어 HTTP 503(Loading model)을 맞은 것이다. 결과는 재시도로 정상이지만 **매 재시작마다**
//   사고 흔적이 남아 진짜 사고와 구별이 안 됐다 — 로그가 늘 빨가면 아무도 안 본다.
//
// ■ 무엇을 안 고쳤나 (일부러)
//   memory.embedWithRetry의 재시도(5회·10초)는 **그대로** 둔다. 이 대기는 로그를 깨끗하게 하는
//   장치이지 새 관문이 아니다 — 임베딩이 영영 안 뜨는 기계에서 부팅 인입을 영구히 막으면
//   그게 더 나쁜 회귀다. 그래서 기한을 넘기면 **그대로 진행**하되 「기다렸다」는 로그를 남긴다.
//
// ⚠ 이 시험은 **진짜 임베딩 서버를 띄우지 않는다.** 503→200을 흉내 내는 stub http 서버로만 잰다
//   (llama.cpp를 스폰하면 시험이 GPU·모델 파일에 매이고, 이 시험이 재는 것은 그게 아니다).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as http from "node:http";

/** 503을 N번 준 뒤 200을 주는 stub 임베딩 서버 — 부팅 직후 llama-server의 실제 거동을 흉내 낸다. */
function stub임베딩(실패횟수: number, 순서: string[]): Promise<{ port: number; close: () => Promise<void>; 탐침수: () => number }> {
  let 탐침 = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      탐침 += 1;
      순서.push(`탐침${탐침}`);
      if (탐침 <= 실패횟수) {
        // llama-server가 모델을 올리는 중일 때 실제로 주는 응답 꼴.
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: 503, message: "Loading model", type: "unavailable_error" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        탐침수: () => 탐침,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** 주소는 모듈 로드 때 한 번 읽힌다(EMBEDDING_SERVER_URL) — stub을 가리키려면 다시 불러와야 한다.
 *  ⚠ env를 덮어써 **제품이 아니라 시험을 검증**하는 함정을 피한다: 여기서 바꾸는 것은 주소뿐이고,
 *    준비 판정 방식·기다림·로그는 제품 코드 그대로다(아래 소스 감시가 그 사실을 따로 못박는다). */
async function 대기함수(port: number) {
  vi.resetModules();
  process.env.GIJO_EMBEDDING_URL = `http://127.0.0.1:${port}/v1`;
  const mod = await import("../src/engine/embedding");
  return mod.임베딩준비대기;
}

const 원래주소 = process.env.GIJO_EMBEDDING_URL;
afterEach(() => {
  if (원래주소 === undefined) delete process.env.GIJO_EMBEDDING_URL;
  else process.env.GIJO_EMBEDDING_URL = 원래주소;
  vi.restoreAllMocks();
});

describe("★ 임베딩 준비 대기 — 인입은 신호 뒤에 딱 한 번", () => {
  it("준비 신호 **전에는 인입이 안 불리고**, 신호 뒤 1회 불린다", async () => {
    const 순서: string[] = [];
    const stub = await stub임베딩(2, 순서); // 503 두 번 → 세 번째에 200
    try {
      const 임베딩준비대기 = await 대기함수(stub.port);
      let 인입횟수 = 0;
      // index.ts의 부팅 사슬과 **같은 꼴**로 잇는다: 준비대기().then(() => 인입()).
      const 준비 = await 임베딩준비대기(5_000, 10).then((ok) => {
        인입횟수 += 1;
        순서.push("인입");
        return ok;
      });
      expect(준비, "200을 받고도 준비됨으로 안 읽었다").toBe(true);
      // ★ 「인입」이 마지막이라는 것이 이 시험의 전부다 — 앞에 탐침이 세 번 찍혀 있어야 한다.
      expect(순서).toEqual(["탐침1", "탐침2", "탐침3", "인입"]);
      expect(인입횟수, "인입이 여러 번 불렸다").toBe(1);
    } finally {
      await stub.close();
    }
  });

  it("첫 번에 뜨면 조용히 넘어간다 — 평상시 부팅 로그를 한 줄도 안 늘린다", async () => {
    const 순서: string[] = [];
    const stub = await stub임베딩(0, 순서);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const 임베딩준비대기 = await 대기함수(stub.port);
      expect(await 임베딩준비대기(5_000, 10)).toBe(true);
      expect(stub.탐침수(), "한 번에 떴는데 더 찔렀다").toBe(1);
      expect(log, "기다리지 않았는데 기다렸다는 로그를 남겼다").not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      await stub.close();
    }
  });

  it("기한을 넘기면 **종전대로 진행**한다 — 다만 기다렸다는 사실을 로그로 남긴다", async () => {
    const 순서: string[] = [];
    const stub = await stub임베딩(999, 순서); // 영영 503
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const 임베딩준비대기 = await 대기함수(stub.port);
      let 인입횟수 = 0;
      const 준비 = await 임베딩준비대기(120, 40).then((ok) => {
        인입횟수 += 1;
        return ok;
      });
      // fail-open이 **아니라** fail-forward다: 막지 않되 조용히 넘어가지도 않는다.
      expect(준비, "기한을 넘겼는데 준비됨이라 말했다").toBe(false);
      expect(인입횟수, "기한을 넘기면 인입이 아예 안 돈다 — 그건 더 나쁜 회귀다").toBe(1);
      const 문구 = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(문구, "조용히 넘어갔다 — 기다린 사실이 로그에 없다").toContain("준비되지 않았습니다");
      expect(문구, "인입을 그대로 시작한다는 사실을 안 밝혔다").toContain("그대로 시작합니다");
    } finally {
      warn.mockRestore();
      await stub.close();
    }
  });
});

describe("★ 배선 — 부팅 사슬 맨 앞에 있어야 뜻이 있다(소스 감시)", () => {
  const 읽기 = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

  it("index.ts가 인입 셋보다 **먼저** 임베딩준비대기()를 부른다", () => {
    const idx = 읽기("src", "index.ts");
    expect(idx, "부팅에서 안 부르면 이 대기는 죽은 코드다").toContain("void 임베딩준비대기()");
    expect(idx.indexOf("void 임베딩준비대기()")).toBeLessThan(idx.indexOf("bootstrapDocsBundleWithRetry()"));
    expect(idx, "줄줄이 잇지 않으면 순서가 말뿐이다").toContain(".then(() => bootstrapDocsBundleWithRetry())");
  });

  it("주소·준비 판정은 embedding.ts 한 곳이다 — 두 벌로 적으면 어긋난다", () => {
    const emb = 읽기("src", "engine", "embedding.ts");
    expect(emb).toContain("export async function 임베딩준비대기");
    // 실제 임베딩을 한 번 돌려 본다 — /health·/v1/models는 모델이 안 올라와도 200을 준다.
    expect(emb, "준비 판정이 embedPost(실제 임베딩)를 안 쓴다").toMatch(/임베딩준비대기[\s\S]{0,1600}embedPost\(`\$\{EMBEDDING_SERVER_URL\}\/embeddings`/);
    const idx = 읽기("src", "index.ts");
    expect(idx.includes("localhost:8081"), "부팅 쪽에 주소를 다시 적었다").toBe(false);
  });

  it("★ 인입 쪽 재시도는 **그대로 둔다** — 대기가 실패해도 종전 동작이어야 한다", () => {
    const mem = 읽기("src", "engine", "memory.ts");
    expect(mem, "embedWithRetry가 사라졌다 — 대기를 관문으로 바꿔 버린 것은 아닌지 보라").toContain("const embedWithRetry");
    expect(mem).toContain("GIJO_EMBED_RETRIES");
    const docs = 읽기("src", "engine", "docsbundle.ts");
    expect(docs, "docsbundle 재시도가 사라졌다").toContain("export async function bootstrapDocsBundleWithRetry");
  });
});
