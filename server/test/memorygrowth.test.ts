// memorygrowth.test.ts — 겹 1 「기억 성장」 배선 계약 (증류학습 계획서 §6-1 · 설계관 ★3·9·10 · 검토관 5갈래, 2026-09-03).
//
// ★ 왜 이 시험이 있나
//   승인 입구가 여러 곳(후보 결정·일괄 승인·직접 평가·작업내역/시드 편입)이라 한 곳만 후크하면 나머지가
//   샌다. 삭제 입구도 둘(deleteChatLog·pruneChatLogs)이다. 그리고 등록(app.ts)을 잊으면 청취자 루프가 0회 돌아
//   **소리 없이** 아무것도 안 된다(memoryhooks와 같은 부류). 그래서 ① app.ts의 등록 줄 ② 청취자 수 ③ 입구가
//   전부 신호를 보내는가 ④ 승인→반입, 해제/삭제/정리→제거의 사건 자체 ⑤ 문서 수 소비처 **일곱 곳**이 승인 문답을
//   빼는가 ⑥ 등급 잠금(승인자 등급, 모르면 기밀)을 못 박는다.
//   실제 임베딩·LanceDB는 시험에서 안 부른다 — vitest env GIJO_MEMORY_GROWTH=0이 청취자를 끈다(사건까지만 본다).
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// prune 시험이 정리분을 아카이브한다 — 실제 data/session-archive에 쓰지 않게 시험 전용 폴더로 돌린다(testisolation 표에 등록).
const ARCHIVE_DIR = join(__dirname, "..", "data", "test-tmp", "session-archive-memorygrowth");
beforeAll(() => { process.env.GIJO_SESSION_ARCHIVE_DIR = ARCHIVE_DIR; mkdirSync(ARCHIVE_DIR, { recursive: true }); });
afterAll(() => { delete process.env.GIJO_SESSION_ARCHIVE_DIR; rmSync(ARCHIVE_DIR, { recursive: true, force: true }); });
import {
  recordChatLog, listChatLogs, rateChatLog, deleteChatLog, pruneChatLogs, resetLearnloopForTests,
  onChatLogRated, chatLogRatedListenerCount, type ChatLogRatedEvent,
} from "../src/engine/learnloop";
import { 기억성장_배선, approvedQaDocId, approvedQaContent, APPROVED_QA_ORIGIN, gradeForApprover, 반입못하는이유 } from "../src/engine/learnmemory";
// origin 잣대 한 곳(잎 모듈이라 LanceDB를 안 물고 그냥 불러 볼 수 있다 — 그게 이 파일에 둔 이유이기도 하다).
import { 제품이쌓은문서, 반입문서아님, 개인문서, 개인문서_제외SQL } from "../src/engine/docorigin";

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("★ 기억 성장 배선 — 등록이 없으면 승인해도 기억이 안 자란다", () => {
  it("app.ts가 기억성장_배선()을 부른다", () => {
    expect(read("src", "app.ts")).toContain("기억성장_배선()");
  });

  it("배선하면 청취자가 실제로 는다", () => {
    const 전 = chatLogRatedListenerCount();
    기억성장_배선();
    expect(chatLogRatedListenerCount()).toBe(전 + 1);
  });

  it("승인 입구 전부가 신호를 보낸다 — rateChatLog 하나만 후크하면 작업내역·시드가 샌다", () => {
    const ll = read("src", "engine", "learnloop.ts");
    const lc = read("src", "engine", "learncandidates.ts");
    const rateFn = ll.slice(ll.indexOf("export function rateChatLog"), ll.indexOf("export function deleteChatLog"));
    expect(rateFn).toContain('emitChatLogRated({ kind: "approved"');
    expect(rateFn).toContain('emitChatLogRated({ kind: "unapproved"');
    // rating에 1을 쓰는 자리는 rateLogStmt(rateChatLog)와 rating=1 INSERT(learncandidates) 뿐이어야 한다.
    expect((ll.match(/rateLogStmt\.run\(/g) || []).length).toBe(1);
    const wsBlock = lc.slice(lc.indexOf('id.startsWith("ws:")'), lc.indexOf("putDecisionStmt.run(id"));
    expect(wsBlock).toContain('emitChatLogRated({ kind: "approved"');
    const seedBlock = lc.slice(lc.indexOf('"/api/learnloop/seed"'), lc.indexOf('"/api/learnloop/distill/intake"'));
    expect(seedBlock).toContain('emitChatLogRated({ kind: "approved"');
  });

  it("삭제 입구 둘 다 해제 신호를 보낸다 — deleteChatLog와 pruneChatLogs(자동 정리)", () => {
    const ll = read("src", "engine", "learnloop.ts");
    const delFn = ll.slice(ll.indexOf("export function deleteChatLog"), ll.indexOf("export function deleteChatLog") + 600);
    expect(delFn).toContain('emitChatLogRated({ kind: "unapproved"');
    const pruneFn = ll.slice(ll.indexOf("export function pruneChatLogs"), ll.indexOf("export function pruneChatLogs") + 2600);
    expect(pruneFn, "prune가 승인 행을 신호 없이 지우면 승인문답 조각이 고아로 남는다").toContain('emitChatLogRated({ kind: "unapproved"');
  });
});

describe("승인·해제·삭제·정리 사건", () => {
  beforeEach(() => resetLearnloopForTests());

  it("👍 → approved(로그·승인자) · 해제 → unapproved · 승인된 것 삭제 → unapproved", () => {
    const got: ChatLogRatedEvent[] = [];
    onChatLogRated((e) => got.push(e));
    recordChatLog("orchestrator", "방화벽 월간 정기점검 절차를 알려줘", "정기점검은 정책 백업, 룰 검토, 로그 확인 순서로 진행합니다. 결과는 점검 대장에 남깁니다.");
    const id = listChatLogs(1, 0).logs[0].id;
    rateChatLog(id, 1, "user-7");
    expect(got.at(-1)).toMatchObject({ kind: "approved", log: { id, rating: 1, origin: "chat" }, approverId: "user-7" });
    rateChatLog(id, 0);
    expect(got.at(-1)).toEqual({ kind: "unapproved", id });
    rateChatLog(id, -1); // 승인이 아니었던 것의 👎는 신호가 없다
    expect(got.length).toBe(2);
    rateChatLog(id, 1);
    deleteChatLog(id);
    expect(got.at(-1)).toEqual({ kind: "unapproved", id });
  });

  it("자동 정리(prune)가 승인 행을 지우면 그 행마다 해제 신호가 난다", () => {
    const got: ChatLogRatedEvent[] = [];
    onChatLogRated((e) => got.push(e));
    for (let i = 0; i < 6; i++) recordChatLog("orchestrator", `질문 ${i} 취약점 조치 순서`, `답 ${i} 악용 여부와 노출을 함께 봅니다. 결과는 대장에 남깁니다.`);
    const ids = listChatLogs(10, 0).logs.map((l) => l.id);
    rateChatLog(ids[5], 1); // 가장 오래된 행을 승인 → 정리 1순위는 아니지만 상한 2로 잘리면 지워진다
    got.length = 0;
    const removed = pruneChatLogs(2);
    expect(removed).toBe(4);
    expect(got.filter((e) => e.kind === "unapproved").map((e) => (e as { id: string }).id)).toContain(ids[5]);
  });
});

describe("반입 모양 — scope는 global, 구분은 category, 등급은 승인자 등급, 문서 수 계열에서는 뺀다", () => {
  it("documentId는 승인문답:<id>, 본문에 주제·출처·질문·답이 있다", () => {
    const content = approvedQaContent({
      id: "x1", agentId: "orchestrator", question: "Q?", answer: "A.", rating: 1, usedInDataset: false, createdAt: 0,
      topic: "취약점", origin: "distill", teacher: "t", cites: ["k.md#ab"], promptHash: null,
    });
    expect(approvedQaDocId("x1")).toBe("승인문답:x1");
    expect(content).toContain("주제 취약점");
    expect(content).toContain("교사 모델 증류(승인됨)");
    expect(content).toContain("질문: Q?");
    // ★ 2026-09-06 — 꼬리 메타(「근거 조각: …」·「교사 모델: …」)는 **본문에서 뺐다.**
    //   그 두 줄이 조각으로 검색돼 고객 답 끝에 내부 저장소 경로·교사 모델 파일명으로 나갔다(라이브 실측).
    //   메타는 원천(chat_logs)에 그대로 있고 approvedQaMeta가 가리킨다 — 자세한 계약은 metaleak.test.ts.
    expect(content).not.toContain("근거 조각");
    expect(content).not.toContain("교사 모델:");
  });

  it("learnmemory는 GLOBAL_SCOPE로 넣고 origin=approved-qa를 달며 등급을 잠근다", () => {
    const src = read("src", "engine", "learnmemory.ts");
    expect(src).toMatch(/ingestText\([^;]*m\.GLOBAL_SCOPE[^;]*APPROVED_QA_ORIGIN\)/);
    expect(src).toContain("setGradeStmt.run(grade, docId)");
    expect(APPROVED_QA_ORIGIN).toBe("approved-qa");
  });

  it("등급 = 승인자의 열람 등급, 모르면 기밀(C)로 닫는다", () => {
    expect(gradeForApprover(null)).toBe("C");
    expect(gradeForApprover("없는-계정")).toBe("C");
  });

  it("폴백·회피 답변은 기억이 되지 않는다(위생)", () => {
    const base = { id: "x", agentId: "orchestrator", rating: 1, usedInDataset: false, createdAt: 0, topic: "취약점", origin: "chat" as const, teacher: null, cites: [], promptHash: null };
    expect(반입못하는이유({ ...base, question: "KEV가 뭐야?", answer: "관련 정보를 찾지 못했습니다. 문서를 올려 주세요." })).toBeTruthy();
    expect(반입못하는이유({ ...base, question: "KEV가 뭐야?", answer: "KEV는 실제 악용이 확인된 취약점 목록으로, 심각도와 무관하게 최우선 조치 대상입니다. 조치 우선순위는 노출과 자산 중요도를 함께 봅니다." })).toBeNull();
  });

  // ★ 2026-09-04: 서버 네 자리(대장·중복·배지·위생)의 origin 목록을 **engine/docorigin.ts 한 곳**으로 모았다.
  //   그전에는 같은 결정을 자리마다 손으로 적어 다섯 벌이었고, 실제로 클라 두 곳을 잊어 화면이 깨졌다.
  //   그래서 감시도 「자리마다 문자열이 있나」에서 「자리마다 **그 술어를 부르나** + 목록은 한 곳에 있나」로 바꾼다.
  it("문서 수 소비처가 승인 문답을 뺀다 — 잣대는 docorigin 한 곳, 자리들은 그것을 부른다", () => {
    const 잣대 = read("src", "engine", "docorigin.ts");
    expect(잣대).toMatch(/제품자동_ORIGIN\s*=\s*\["approved-qa",\s*"incident-case"\]/);
    expect(잣대).toMatch(/반입아님_ORIGIN[\s\S]{0,120}"builtin"/);
    expect(제품이쌓은문서("approved-qa")).toBe(true);
    expect(제품이쌓은문서(null)).toBe(false);          // 고객 업로드는 남는다(blacklist)
    expect(제품이쌓은문서(undefined)).toBe(false);     // origin 칸이 없는 옛 문서도 남는다
    expect(제품이쌓은문서("builtin")).toBe(false);     // 내장은 목록에 뜨고 지울 수 있다 — 여기선 안 뺀다
    expect(반입문서아님("builtin")).toBe(true);        // 「새로 들어온 문서」로는 안 센다
    expect(APPROVED_QA_ORIGIN).toBe("approved-qa");   // learnmemory 상수와 같은 값을 가리킨다

    expect(read("src", "engine", "docdigest.ts")).toContain("제품이쌓은문서_제외SQL");            // 새로 들어온 문서 대장
    expect(read("src", "engine", "docdupe.ts")).toContain("제품이쌓은문서_제외SQL");              // 중복 후보
    expect(read("src", "engine", "memory.ts")).toMatch(/recentDocCountStmt[\s\S]{0,600}반입문서아님_제외SQL/); // 사이드바 새 문서 배지
    expect(read("src", "engine", "kbhygiene.ts")).toContain("제품이쌓은문서(d.origin)");          // 지식 위생 점검 모집단(2026-09-04)
    expect(read("src", "engine", "teamview.ts")).toContain("<> 'approved-qa'");                  // 팀 구성 문서 수(뜻이 다름 — 사례는 든다)
    expect(read("src", "engine", "observability.ts")).toContain("<> 'approved-qa'");             // 자가진단 지식베이스(같음)
    const h = read("src", "engine", "agenttools", "handlers.ts");
    expect((h.match(/origin !== "approved-qa"/g) || []).length).toBeGreaterThanOrEqual(2);       // 지식 현황·인수인계 현황
    expect(read("..", "client", "src", "renderer", "pages", "memory.html")).toContain('d.origin !== "approved-qa"'); // AI 지식 화면
    expect(read("..", "client", "src", "renderer", "pages", "mydocs.html")).toContain('d.origin !== "approved-qa"'); // 문서 허브
  });

  // 침해사고 사례 문서(origin=incident-case, incidentcases 2026-09-03 결정 ① 「목록에서 뺀다」)도 **같은 자리들**이 빼야 한다.
  // ⚠ 왜 짝으로 감시하나: 결정은 하나인데 자리가 여럿이라, 서버 세 곳만 고치고 **클라 두 곳을 잊었다**(통합 검토에서 적발 —
  //   AI 지식·문서 허브에 사람이 못 읽는 「incident-case:ic-…」 20줄이 뜨고 「열람 등급 지정」 지표가 warn으로 뒤집혔다).
  //   승인 문답이 겪은 「두 곳만 고치고 초록」을 사례 문서가 그대로 반복했다 — 그래서 잣대를 한 시험에 나란히 둔다.
  // ⚠ 여기 없는 소비처(teamview·observability·handlers)는 아직 사례 문서를 안 뺀다 — 고칠 때 이 목록에 줄을 더한다.
  //   (지금 적으면 고치지도 않은 것을 지킨다고 말하는 거짓 감시가 된다.)
  it("사례 문서(origin=incident-case)도 문서 목록·중복·배지·위생 여섯 자리에서 빠진다", () => {
    expect(제품이쌓은문서("incident-case")).toBe(true);
    expect(반입문서아님("incident-case")).toBe(true);
    // 서버 네 자리는 위 술어를 부르는 것으로 지킨다(문자열이 자리마다 흩어지면 또 갈린다).
    expect(read("src", "engine", "docdigest.ts")).toContain("제품이쌓은문서_제외SQL");            // 새로 들어온 문서 대장
    expect(read("src", "engine", "docdupe.ts")).toContain("제품이쌓은문서_제외SQL");              // 중복 후보
    // 창은 600자 — 주석이 길어 400은 스쳐 지난다. 이 statement 하나만 들어오는 폭이다.
    expect(read("src", "engine", "memory.ts")).toMatch(/recentDocCountStmt[\s\S]{0,600}반입문서아님_제외SQL/); // 사이드바 새 문서 배지
    expect(read("src", "engine", "kbhygiene.ts")).toContain("제품이쌓은문서(d.origin)");          // 지식 위생 점검 모집단
    // 클라 두 곳은 아직 문자열이다(서버 술어를 못 부른다) — 그래서 여기서 문자열로 못 박는다.
    expect(read("..", "client", "src", "renderer", "pages", "memory.html")).toContain('d.origin !== "incident-case"'); // AI 지식 화면
    expect(read("..", "client", "src", "renderer", "pages", "mydocs.html")).toContain('d.origin !== "incident-case"'); // 문서 허브
  });

  // ★ 2026-09-04: 개인 문서(documentId가 "personal:<uuid>")도 **같은 결정**이다 — 회사 지식 목록에
  //   안 뜨는데 모집단엔 남아 있었다. 갈리는 칸이 origin이 아니라 documentId라 술어는 따로지만,
  //   결정이 하나라 감시도 여기 나란히 둔다. 접두 문자열이 자리마다 흩어지면 「한 곳만 고치고 초록」이
  //   그대로 재발한다(승인 문답이 겪은 그 사고 — 서버 세 곳만 고치고 클라 두 곳을 잊었다).
  it("개인 문서도 대장·중복·위생 세 자리에서 빠진다 — 접두는 docorigin 한 곳", () => {
    expect(개인문서("personal:9f3c0001")).toBe(true);
    expect(개인문서("지침.md")).toBe(false);
    expect(개인문서(null)).toBe(false);        // 접두가 없으면 회사 문서(blacklist — 옛 문서를 통째로 지우지 않는다)
    expect(개인문서_제외SQL("m.documentId")).toBe("m.documentId NOT LIKE 'personal:%'");

    expect(read("src", "engine", "docdigest.ts")).toContain("개인문서_제외SQL");            // 새로 들어온 문서 대장
    expect(read("src", "engine", "docdupe.ts")).toContain("개인문서_제외SQL");              // 중복 후보(2026-09-04 편입)
    expect(read("src", "engine", "kbhygiene.ts")).toContain("개인문서(d.documentId)");      // 지식 위생 점검 모집단(2026-09-04)

    // 접두를 자리마다 손으로 적지 않는다 — 주석은 설명이니 빼고, **도는 코드**만 본다.
    for (const f of ["docdigest.ts", "docdupe.ts", "kbhygiene.ts"]) {
      const 코드 = read("src", "engine", f).split("\n").filter((L) => !L.trim().startsWith("//")).join("\n");
      expect(코드, `${f}에 personal 접두를 손으로 적었다 — docorigin의 술어를 부를 것`).not.toContain("personal:%");
    }
  });

  it("미평가 포함 데이터셋 경로와 KPI(미사용)는 증류를 뺀다 — 「승인은 사람」의 우회로를 닫는다", () => {
    const ll = read("src", "engine", "learnloop.ts");
    expect(ll).toMatch(/pickLogsWithUnratedStmt = db\.prepare\([^;]*<> 'distill'/);
    expect(ll).toMatch(/pickAllWithUnratedByTopicStmt = db\.prepare\([^;]*<> 'distill'/);
    expect(ll).toMatch(/AS unused[\s\S]{0,0}/);
    expect(ll).toMatch(/COALESCE\(origin,'chat'\) <> 'distill' THEN 1 ELSE 0 END\) AS unused/);
  });

  it("일괄 승인은 증류를 건너뛴다(사람 눈을 한 번은 지난다)", () => {
    const lc = read("src", "engine", "learncandidates.ts");
    const fn = lc.slice(lc.indexOf("export function acceptStrongCandidates"), lc.indexOf("export function acceptStrongCandidates") + 900);
    expect(fn).toContain('if (c.source === "distill") continue;');
    expect(fn).toContain("listLearnCandidates(30, 100_000)");
  });
});
