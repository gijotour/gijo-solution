// learnmemoryresync.test.ts — 겹 1 「기억 성장」의 **유실 복구** 계약 (증류학습 계획서 §12 갈래 ①, 2026-09-03).
//
// ★ 왜 이 시험이 있나 — 2026-09-03 운영 실측
//   승인 1,856건 vs approved-qa 문서 1,253건. **603건이 기억에 안 들어갔는데 감사 기록은 0건**이었다.
//   화면은 「승인됨」이라 아무도 몰랐다. 원인은 둘이 겹친 것:
//     ① 반입 큐가 로그 id별로 갈려 있어 **동시 실행이 무제한** — 일괄 승인 1,700여 건이 임베딩 서버
//        한 대로 한꺼번에 몰려 큐가 길게 밀렸다.
//     ② 그 큐가 **메모리에만** 있어 그날 배포(재시작 3회)에 통째로 증발했다. 프로세스가 죽어서
//        실패 감사조차 못 남겼다.
//   그래서 이 시험이 못 박는 것: ⓐ 큐는 **전역 직렬**(한 번에 한 건) ⓑ 작업이 실패해도 **감사에 남고
//   뒤 작업은 계속 돈다** ⓒ 부팅 때 **DB를 진실로 삼아 다시 채운다**(멱등) ⓓ 위생에 걸리는 것은
//   「채워야 할 수」에서 빼서 영원히 안 줄어드는 거짓 숫자를 만들지 않는다 ⓔ 승인자 등급 되찾기는
//   애매하면 포기(기밀로 닫힘)한다.
//
// ⚠ 시험 env는 GIJO_MEMORY_GROWTH=0이라 실제 임베딩·LanceDB에 안 닿는다. 그래서 반입 자체가 아니라
//   **고르는 규칙·큐·감사·배선**을 본다(반입 모양은 memorygrowth.test가 본다).
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { db } from "../src/db";
import { recordChatLog, listChatLogs, rateChatLog, resetLearnloopForTests } from "../src/engine/learnloop";
import {
  APPROVED_QA_DOC_PREFIX, APPROVED_QA_ORIGIN, approvedQaDocId,
  missingApprovedQaLogs, approvedQaDocStats, approverForLog,
  syncApprovedQaDocs, memoryGrowthIdle, memoryGrowthPending, __enqueueForTests,
} from "../src/engine/learnmemory";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

// 좋은 답(위생 통과)과 회피 답(위생 차단)을 각각 하나씩 만들어 승인한다.
const 좋은답 = "정기점검은 정책 백업, 룰 검토, 로그 확인 순서로 진행합니다. 결과는 점검 대장에 남기고 담당자가 확인합니다.";
// ⚠ 실운영에서 흔한 「등록된 사내 자료에는 관련 내용이 없습니다」는 **지금 위생을 통과한다**(실측 2026-09-03,
//   NO_ANSWER의 `자료(가|는|도) 없`·`해당 내용(이|은) 없`에 조사가 안 맞는다). 그건 sessionpatterns.ts 소관이라
//   여기서 고치지 않고 보고했다 — 이 시험은 **지금 실제로 걸리는** 문구로 위생 경로만 본다.
const 회피답 = "관련 정보를 찾지 못했습니다. 문서를 올려 주시면 다시 확인하겠습니다.";

function 승인하기(question: string, answer: string): string {
  recordChatLog("orchestrator", question, answer);
  const id = listChatLogs(1, 0).logs[0].id;
  rateChatLog(id, 1, null);
  return id;
}

/** 반입에 성공한 척 — 실제 임베딩 없이 memory_documents 행만 만든다(멱등 판정의 잣대가 이 표다). */
function 문서만들기(logId: string): void {
  db.prepare(
    "INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, ingestedAt, origin) VALUES (?, 'global', 1, 'test', ?, ?)"
  ).run(approvedQaDocId(logId), new Date().toISOString(), APPROVED_QA_ORIGIN);
}

describe("★ 재동기화 대상 고르기 — 진실은 큐가 아니라 DB(rating=1)", () => {
  beforeEach(() => {
    resetLearnloopForTests();
    db.exec("DELETE FROM memory_documents; DELETE FROM audit_log; DELETE FROM users;");
  });

  it("승인됐는데 문서가 없으면 대상, 문서가 생기면 대상에서 빠진다(멱등 — 두 번 돌려도 다시 안 넣는다)", () => {
    const id = 승인하기("방화벽 월간 정기점검 절차를 알려줘", 좋은답);
    expect(missingApprovedQaLogs().ingestable.map((l) => l.id)).toEqual([id]);
    문서만들기(id);
    expect(missingApprovedQaLogs().ingestable).toHaveLength(0);
  });

  it("미평가·👎는 대상이 아니다 — 승인만 기억이 된다", () => {
    recordChatLog("orchestrator", "미평가 질문 취약점 조치 순서", 좋은답);
    const 미평가 = listChatLogs(1, 0).logs[0].id;
    recordChatLog("orchestrator", "부정 평가 질문 취약점 조치 순서", 좋은답);
    rateChatLog(listChatLogs(1, 0).logs[0].id, -1);
    expect(missingApprovedQaLogs().ingestable.map((l) => l.id)).not.toContain(미평가);
    expect(missingApprovedQaLogs().ingestable).toHaveLength(0);
  });

  it("위생에 걸리는 답은 「채워야 할 수」에서 빼고 따로 센다 — 안 그러면 영원히 안 줄어드는 숫자가 보고표에 남는다", () => {
    const 좋은 = 승인하기("방화벽 월간 정기점검 절차를 알려줘", 좋은답);
    승인하기("COBOL 메인프레임 JCL 배치 취약점 사례 알려줘", 회피답);
    const r = missingApprovedQaLogs();
    expect(r.ingestable.map((l) => l.id)).toEqual([좋은]);
    expect(r.hygieneBlocked).toBe(1);
  });

  it("보고표 숫자 — 승인 수·문서 수·차이·위생 제외가 한 번에 나온다(매일 드러나야 또 몇 달을 안 모른다)", () => {
    const a = 승인하기("방화벽 월간 정기점검 절차를 알려줘", 좋은답);
    승인하기("침해사고 신고 기한을 알려줘", 좋은답.replace("정기점검", "신고 절차"));
    승인하기("COBOL 메인프레임 JCL 배치 취약점 사례 알려줘", 회피답);
    문서만들기(a);
    expect(approvedQaDocStats()).toEqual({ approved: 3, docs: 1, missing: 1, hygieneBlocked: 1 });
  });

  it("문서 유무 판정은 접두사 상수 하나로만 한다 — SQL에 문자열을 또 적으면 언젠가 어긋난다", () => {
    const src = read("src", "engine", "learnmemory.ts");
    const sqlBlock = src.slice(src.indexOf("const missingIdsStmt"), src.indexOf("const approvedCountStmt"));
    expect(sqlBlock).toContain("m.documentId = ? || c.id");
    expect(sqlBlock).not.toContain("승인문답:");
    expect(approvedQaDocId("x1")).toBe(`${APPROVED_QA_DOC_PREFIX}x1`);
  });

  it("스위치가 꺼져 있으면(GIJO_MEMORY_GROWTH=0) 재동기화도 아무것도 안 한다", async () => {
    승인하기("방화벽 월간 정기점검 절차를 알려줘", 좋은답);
    expect(process.env.GIJO_MEMORY_GROWTH).toBe("0"); // 시험 env 전제 자체를 못 박는다
    await expect(syncApprovedQaDocs()).resolves.toEqual({ candidates: 0, ingested: 0, failed: 0, hygieneBlocked: 0, aborted: false });
  });
});

describe("★ 큐는 전역 직렬 — 일괄 승인이 임베딩 서버로 몰리지 않는다", () => {
  beforeEach(() => { db.exec("DELETE FROM audit_log;"); });

  it("동시에 도는 작업은 언제나 1개, 순서는 들어온 대로", async () => {
    const 순서: number[] = [];
    let 동시 = 0;
    let 최대동시 = 0;
    const 일 = (n: number) => async () => {
      동시 += 1;
      최대동시 = Math.max(최대동시, 동시);
      await new Promise((r) => setTimeout(r, 5));
      순서.push(n);
      동시 -= 1;
    };
    for (let i = 0; i < 5; i++) void __enqueueForTests(`log-${i}`, 일(i));
    expect(memoryGrowthPending()).toBe(5); // 넣자마자 전부 대기 — 하나도 먼저 끝나 있지 않다
    await memoryGrowthIdle();
    expect(최대동시).toBe(1);
    expect(순서).toEqual([0, 1, 2, 3, 4]);
    expect(memoryGrowthPending()).toBe(0);
  });

  it("작업이 실패하면 감사에 남고, **뒤 작업은 그대로 돈다** — 꼬리가 죽으면 이후 전부가 조용히 건너뛴다", async () => {
    const 돌았나: string[] = [];
    const 실패 = __enqueueForTests("bad-1", async () => { throw new Error("임베딩 서버 연결 실패"); }, "반입");
    const 성공 = __enqueueForTests("good-1", async () => { 돌았나.push("good-1"); }, "반입");
    expect(await 실패).toBe(false);
    expect(await 성공).toBe(true);
    expect(돌았나).toEqual(["good-1"]);
    const rows = db.prepare("SELECT action, target, detail, result FROM audit_log").all() as { action: string; target: string; detail: string; result: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "승인 문답 반입 실패", target: approvedQaDocId("bad-1"), result: "error" });
    expect(rows[0].detail).toContain("임베딩 서버 연결 실패");
  });
});

describe("★ 승인자 등급 되찾기 — 못 찾으면 좁게 닫는다(등급 세탁 금지)", () => {
  beforeEach(() => { db.exec("DELETE FROM audit_log; DELETE FROM users;"); });

  const 계정만들기 = (id: string, username: string, displayName: string) =>
    db.prepare("INSERT INTO users (id, username, passwordHash, displayName, role, createdAt, clearance) VALUES (?, ?, 'x', ?, 'user', 0, 'S')")
      .run(id, username, displayName);
  const 결정감사 = (logId: string, actor: string) =>
    db.prepare("INSERT INTO audit_log (id, at, kind, actor, action, target, detail, result) VALUES (?, ?, 'write', ?, '학습 후보 결정', '승인', ?, 'ok')")
      .run(`a-${logId}-${actor}`, Date.now(), actor, `cl:${logId}`);

  it("감사 기록의 표시이름으로 계정을 되짚는다", () => {
    계정만들기("u-1", "kim", "김보안");
    결정감사("log-a", "김보안");
    expect(approverForLog("log-a")).toBe("u-1");
  });

  it("기록이 없으면 null — 등급은 기밀로 닫힌다", () => {
    expect(approverForLog("없는-로그")).toBeNull();
  });

  it("표시이름이 겹치면 **포기**한다 — 아무나 골랐다가 더 넓은 등급이면 그게 등급 세탁이다", () => {
    계정만들기("u-1", "kim1", "김보안");
    계정만들기("u-2", "kim2", "김보안");
    결정감사("log-b", "김보안");
    expect(approverForLog("log-b")).toBeNull();
  });

  it("되짚기가 읽는 감사 문구를 learncandidates가 그대로 쓴다 — 두 곳에 적힌 문자열이라 어긋나면 조용히 등급만 좁아진다", () => {
    const lc = read("src", "engine", "learncandidates.ts");
    expect(lc).toContain(`action: "학습 후보 결정", target: accept ? "승인" : "제외", detail: id`);
    expect(lc).toContain('id.startsWith("cl:")'); // detail의 'cl:<로그id>' 형식이 되짚기의 열쇠다
  });
});

describe("★ 배선 — 부팅에서 안 부르면 재시작마다 또 사라진다", () => {
  it("index.ts가 부팅 뒤 syncApprovedQaDocsWithRetry()를 부른다", () => {
    const idx = read("src", "index.ts");
    expect(idx).toContain("syncApprovedQaDocsWithRetry()");
    // 사례 문서 동기화 **뒤에** 붙는다 — 둘이 임베딩 서버 한 대를 동시에 쓰면 서로 느려진다.
    expect(idx.indexOf("syncIncidentCaseDocsWithRetry()")).toBeLessThan(idx.indexOf("syncApprovedQaDocsWithRetry()"));
    // ★ 그 앞에 제품 문서 인입이 온다(2026-09-04) — 빈 지식 베이스로 첫 부팅할 때 셋이 겹치면
    //   「지식 표를 처음 만드는 순간」까지 경합해 사례 반입 3건이 실패하고 20초 재시도로 복구됐다.
    expect(idx.indexOf("bootstrapDocsBundleWithRetry()")).toBeLessThan(idx.indexOf("syncIncidentCaseDocsWithRetry()"));
    expect(idx, "셋을 줄줄이 잇지 않으면 순서가 말뿐이다").toContain(".then(() => syncIncidentCaseDocsWithRetry())");
  });

  it("연속 실패로 스스로 멈춘다 — 임베딩이 죽었을 때 남은 걸 다 갈아 감사만 더럽히지 않는다", () => {
    const src = read("src", "engine", "learnmemory.ts");
    expect(src).toContain("const RESYNC_ABORT_AFTER = 3");
    const fn = src.slice(src.indexOf("export async function syncApprovedQaDocs"), src.indexOf("export async function syncApprovedQaDocsWithRetry"));
    expect(fn).toContain("연속실패 >= RESYNC_ABORT_AFTER");
    expect(fn).toContain('action: "승인 문답 재동기화 중단"');
  });
});
