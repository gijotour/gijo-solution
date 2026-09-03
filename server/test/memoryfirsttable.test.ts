// memoryfirsttable.test.ts — 빈 지식 베이스에 **동시에** 들어온 첫 인입이 서로 걸려 넘어지지 않는다(2026-09-04).
//
// ■ 무엇을 지키나
//   표가 없을 때 동시에 온 인입은 셋 다 「표 없음」을 보고 각자 만든다 — 하나만 이기고 나머지는
//   `Table documents already exists` / `documents.lance not found`로 죽었다.
//   win 격리 왕복 실측(2026-09-04): 빈 LanceDB로 첫 부팅하면 침해사고 사례 문서 반입 3건이 그렇게
//   실패하고 20초 뒤 재시도로 겨우 복구됐다 — **고객이 처음 켤 때마다 빨간 줄 세 개**를 봤다.
//   (사례 문서 큐는 id별로 갈라져 있어(incidentcases.enqueue) 서로 다른 사례는 진짜로 동시에 온다.)
//
// ■ 왜 memory.test.ts에 안 붙였나 — 그 파일은 첫 시험에서 이미 표를 만든다. 「표가 없는 순간」은
//   저장소 하나에 **한 번뿐**이라, 그 순간을 재현하려면 이 파일만의 빈 LanceDB가 필요하다.
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB 경로는 모듈 로드 시점에 읽힌다 — import 전에 **비어 있는** 임시 디렉터리로 고정한다.
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-lancedb-first-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;
process.env.GIJO_INGEST_ROOT = tmpDb;

// 임베딩은 목 — 시험 환경엔 임베딩 서버가 없다(memory.test.ts와 같은 목 표면: 실제 import 경로를 따라간다).
vi.mock("../src/engine/embedding", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
}));
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { ingestText, getDocumentChunks } = await import("../src/engine/memory");

describe("★ 빈 지식 베이스 첫 인입 경합 — 표 만들기를 한 줄로 세운다", () => {
  it("동시에 셋이 들어와도 셋 다 저장된다(예전엔 둘이 'Table documents already exists'로 죽었다)", async () => {
    const 문서 = [
      ["사건사례-가", "로그를 남기는 부품의 구멍으로 남이 우리 서버에서 명령을 실행할 수 있었습니다."],
      ["사건사례-나", "랜섬웨어로 공장 생산 라인이 사흘 동안 멈춘 사고였습니다."],
      ["사건사례-다", "계정을 빼앗겨 임원 메일함의 내용이 통째로 새어 나간 사고였습니다."],
    ] as const;
    // ⚠ 순차로 부르면 이 시험은 아무것도 못 본다 — **동시에** 부르는 것이 시험의 전부다.
    const r = await Promise.all(문서.map(([id, 글]) => ingestText(id, 글)));
    expect(r.map((x) => x.chunks), "인입이 조각을 못 남겼다").toEqual([1, 1, 1]);
    for (const [id] of 문서) {
      expect((await getDocumentChunks(id)).length, `${id}가 지식 베이스에 없다 — 경합에서 밀렸다`).toBe(1);
    }
  });

  it("표가 생긴 뒤의 인입은 붙이기(add) 경로로 간다 — 앞 시험이 만든 표에 그대로 쌓인다", async () => {
    await ingestText("사건사례-라", "협력사 계정으로 내부망에 들어와 자료를 가져간 사고였습니다.");
    expect((await getDocumentChunks("사건사례-라")).length).toBe(1);
    expect((await getDocumentChunks("사건사례-가")).length, "앞서 넣은 문서가 사라졌다 — 표를 다시 만들었다").toBe(1);
  });
});
