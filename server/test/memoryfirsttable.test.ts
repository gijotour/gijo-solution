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
//
// ■ 2026-09-04 — 이 시험은 한동안 **전체 동시 실행에서 간헐로 붉었다.** 원인과 수리를 적어 둔다
//   (다음 사람이 또 「시험 격리」를 의심하며 하루를 쓰지 않게):
//   · 격리 탓이 **아니었다.** 이 파일은 처음부터 자기만의 빈 임시 디렉터리를 쓰고(아래 mkdtemp),
//     vitest.config.ts는 GIJO_MEMORY_DB_PATH를 아예 걸지 않는다 — 다른 시험과 경로가 겹칠 길이 없다.
//   · 붉었던 이유는 **이 시험이 잡으라고 만들어진 그 경합이 반만 막혀 있어서**였다.
//     memory.ingestText가 줄(첫표만들기) **밖에서** `tableNames()`를 먼저 봤다. LanceDB는
//     `createTable`이 도는 도중에도 그 표 이름을 이미 보여 준다 — 격리 실측(2026-09-04,
//     lancedb 0.31.0/WSL): 40회 중 **39회**가 「만드는 중인데 이름이 보였다」, 그중 **34회**가
//     이어진 `openTable`에서 `Table 'documents' was not found … documents.lance/_versions`로 죽었다.
//     그래서 늦게 온 호출자가 「표 있음」으로 읽고 붙이기(add) 경로로 새어 나가 죽었다.
//     한가할 땐 셋이 거의 동시에 tableNames()를 마쳐 안 걸리고, 전체 시험처럼 CPU가 꽉 차
//     한 호출자만 늦어지면 걸린다 — 「전체에서만 붉다」가 그 뜻이었다.
//   · **수리(2026-09-04): memory.ts의 `openDocsTable` 한 곳**으로 모았다 — 「표가 있나」 판정·열기·
//     만들기를 전부 줄 안에서 하고, openTable이 위 오류를 내면 「만드는 중」으로 보고 줄에 다시 선다.
//     읽기 전용 자리는 표가 없으면 null(빈 결과)이다. 인입·검색·목록·조각·삭제·업무영역 7곳이
//     같은 창구를 쓰며, 아래 **소스 감시**가 새 코드의 샛길을 막는다.
//   · ⚠ 시험을 무르게 고쳐 초록으로 만들지 말 것 — 그러면 **고객 첫 부팅의 빨간 줄 세 개**를
//     도로 못 보게 될 뿐이다.
import { describe, it, expect, vi, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as lancedb from "@lancedb/lancedb";

// LanceDB 경로는 모듈 로드 시점에 읽힌다 — import 전에 **비어 있는** 임시 디렉터리로 고정한다.
// ⚠ 이름에 pid·시각을 넣는다 — 강제 종료로 남은 찌꺼기가 「누가 언제 만든 것인지」 말해 준다.
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), `gijo-lancedb-first-${process.pid}-${Date.now()}-`));
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

const { ingestText, getDocumentChunks, queryMemory, listDocuments } = await import("../src/engine/memory");

// ⚠ 청소는 **파일 전체가 끝난 뒤**다(top-level afterAll). describe 안에 두면 그 describe가
//   끝나는 순간 지워져, 뒤에 오는 「몰림」 시험이 남의 손에 지워진 자리에서 돌게 된다.
afterAll(() => fs.rmSync(tmpDb, { recursive: true, force: true })); // /tmp에 매 실행마다 쌓이면 그것도 사고다

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

describe("★ 첫 부팅 몰림 — 인입 8개와 검색 4개가 **동시에** 들이닥쳐도 아무도 없는 표를 열지 않는다", () => {
  // ■ 왜 이 시험이 따로 필요한가
  //   위 세 건짜리 시험은 「만드는 사람들끼리」의 경합만 본다. 실제 첫 부팅에는 **읽는 사람도 같이**
  //   들어온다 — 화면이 열리자마자 문서 목록을 부르고, 대화창이 첫 질문을 검색한다. 읽는 경로가
  //   `tableNames()` → `openTable()`을 밖에서 하면 「만드는 중인데 이름이 보이는」 39/40 창에 그대로
  //   빠져 `documents.lance/_versions`로 죽는다. 인입만 고치고 검색을 안 고치면 빨간 줄은 남는다.
  // ■ 판정 규칙 — 검색이 **빈 결과를 주는 것은 정상**이다(그 순간 아직 지식이 0건일 수 있다).
  //   이 시험이 잡는 것은 **예외로 죽는 것**이다. 그래서 allSettled로 받아 rejected를 0으로 못박는다.
  it("인입 8 + 검색 4 동시 — 예외 0건이고 8개가 전부 남는다", async () => {
    // 「표가 없는 순간」을 **다시 만든다** — 저장소 하나에 한 번뿐인 그 순간이 이 시험의 전부다.
    const conn = await lancedb.connect(tmpDb);
    if ((await conn.tableNames()).includes("documents")) await conn.dropTable("documents");

    const 인입 = Array.from({ length: 8 }, (_, i) =>
      ingestText(`몰림문서-${i + 1}`, `${i + 1}번째 사고입니다. 계정이 털려 내부 자료가 새어 나갔습니다.`)
    );
    const 읽기 = [
      queryMemory("계정이 털린 사고", 3),
      queryMemory("내부 자료 유출", 3),
      listDocuments(),
      getDocumentChunks("몰림문서-1"),
    ];
    const 결과 = await Promise.allSettled([...인입, ...읽기]);
    const 터진것 = 결과
      .map((r, i) => (r.status === "rejected" ? `${i < 8 ? `인입 ${i + 1}` : `읽기 ${i - 7}`}: ${String((r as PromiseRejectedResult).reason)}` : ""))
      .filter(Boolean);
    expect(터진것, `첫 부팅 몰림에서 ${터진것.length}건이 예외로 죽었다(고객 화면의 빨간 줄이다)`).toEqual([]);

    for (let i = 1; i <= 8; i++) {
      expect((await getDocumentChunks(`몰림문서-${i}`)).length, `몰림문서-${i}가 지식 베이스에 없다 — 경합에서 밀렸다`).toBe(1);
    }
  });
});

describe("★ 소스 감시 — 지식 표를 여는 창구는 openDocsTable 한 곳뿐이다", () => {
  // ⚠ 세 번째면 소스 감시(이 저장소의 규칙). 「밖에서 표 이름부터 보는」 꼴은 고쳐 놓아도
  //   새 함수를 짤 때 손이 먼저 기억한다 — 그래서 시험이 대신 기억한다.
  //   여기서 막는 것은 `tableNames()`·`openTable()`·`createTable()`의 **직접 호출**이다.
  it("memory.ts에서 tableNames·openTable·createTable을 부르는 곳은 openDocsTable 안뿐이다", () => {
    const 소스 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "memory.ts"), "utf8");
    const 줄 = 소스.split(/\r?\n/);
    const 주석 = (l: string) => /^\s*(\/\/|\/\*|\*)/.test(l); // 설명문에 적힌 이름은 호출이 아니다
    const 시작 = 줄.findIndex((l) => l.includes("async function openDocsTable("));
    expect(시작, "openDocsTable이 없다 — 표를 여는 단일 창구가 사라졌다").toBeGreaterThan(-1);
    const 끝상대 = 줄.slice(시작).findIndex((l, i) => i > 0 && l === "}");
    expect(끝상대, "openDocsTable의 끝(열 0의 })을 못 찾았다").toBeGreaterThan(0);
    const 끝 = 시작 + 끝상대;

    const 샛길 = 줄
      .map((l, i) => ({ l, i }))
      .filter(({ i }) => i < 시작 || i > 끝)
      .filter(({ l }) => !주석(l))
      .filter(({ l }) => /\.tableNames\(|\.openTable\(|\.createTable\(/.test(l))
      .map(({ l, i }) => `${i + 1}: ${l.trim()}`);
    expect(
      샛길,
      "표를 openDocsTable 밖에서 직접 연다 — createTable이 도는 중에도 표 이름이 보이므로 이 자리는 첫 부팅에 죽는다"
    ).toEqual([]);
  });
});
