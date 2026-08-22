// engine/personaldocs.ts — 개인 문서함. (2026-07-31 사용자 지시 "개인용 문서함")
//
// ■ 무엇인가
//   담당자가 자기 메모·연락처·자주 쓰는 절차를 넣어 두고 어디서든 꺼내 보는 자리다.
//   제품이 실어 보내는 문서(docbox.ts)와 **나란히** 문서함 창에 보이되, 성격이 정반대다:
//     · 제품 문서 — 우리가 만들어 모두에게 나가는 것. 담당자는 읽기만 한다.
//     · 개인 문서 — 담당자가 만들어 **자기만 보는 것**. 우리는 내용을 모른다.
//
// ■ 격리가 이 파일의 전부다
//   남의 문서는 **"없다"고 답한다**(403이 아니라 404). 403은 "있긴 있다"를 알려 주는 셈이라
//   제목을 모르는 사람에게 존재를 흘린다. 모든 조회·수정·삭제가 userId를 함께 건다.
//
// ■ AI가 읽게 할지는 문서마다 담당자가 정한다(ragOptIn, 기본 꺼짐)
//   켜면 "우리 방화벽 정책 바꿀 때 뭐부터 해?"에 내가 적어 둔 절차로 답한다 — 아주 유용하다.
//   다만 그 순간 **더 이상 개인용이 아니다**: 지식베이스는 전역이라 다른 담당자 질문에도
//   근거로 나온다. 그래서 기본을 끄고, 켤 때 그 사실을 화면이 분명히 말한다.
//   ⚠ 껐다 켜는 것이 곧 인입/삭제다 — 끄기만 하고 지우지 않으면 "껐는데 계속 나온다"가 된다.
import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import { recordAudit } from "./audit";
import { maskSecrets } from "./secretscan";
import {
  첨부저장, 첨부목록, 첨부읽기, 첨부삭제, 문서첨부정리, 첨부장수상한,
  판남기기, 판목록, 판본문, 문서판정리, 이력보존판수,
} from "./docattach";

export interface PersonalDoc {
  id: string;
  title: string;
  body: string;
  ragOptIn: boolean; // 내 AI가 읽게 — 격리 필터 덕에 **내 질문에만** 근거로 나온다(2026-08-20부터)
  shared: boolean;   // 회사에 공유 — 전 담당자의 근거가 될 수 있다(명시 옵트인·비밀 마스킹 후 인입)
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string; userId: string; title: string; body: string;
  ragOptIn: number; shared: number; createdAt: number; updatedAt: number;
}

const MAX_TITLE = 120;
const MAX_BODY = 200_000; // 20만 자 — 메모로 충분하고, 실수로 통째로 붙여넣는 것을 막는다
const MAX_DOCS_PER_USER = 200;

function fromRow(r: Row): PersonalDoc {
  return { id: r.id, title: r.title, body: r.body, ragOptIn: r.ragOptIn === 1, shared: r.shared === 1, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

const listStmt = db.prepare("SELECT * FROM personal_docs WHERE userId = ? ORDER BY updatedAt DESC");
const getStmt = db.prepare("SELECT * FROM personal_docs WHERE id = ? AND userId = ?");
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM personal_docs WHERE userId = ?");
const insertStmt = db.prepare(
  "INSERT INTO personal_docs (id, userId, title, body, ragOptIn, shared, createdAt, updatedAt) VALUES (@id, @userId, @title, @body, @ragOptIn, @shared, @createdAt, @updatedAt)"
);
const updateStmt = db.prepare("UPDATE personal_docs SET title = @title, body = @body, updatedAt = @updatedAt WHERE id = @id AND userId = @userId");
const ragStmt = db.prepare("UPDATE personal_docs SET ragOptIn = @on, updatedAt = @at WHERE id = @id AND userId = @userId");
const deleteStmt = db.prepare("DELETE FROM personal_docs WHERE id = ? AND userId = ?");
const shareStmt = db.prepare("UPDATE personal_docs SET shared = @on, updatedAt = @at WHERE id = @id AND userId = @userId");
// (공유 id 목록 함수는 두지 않는다 — 검색 격리 필터(memory.hiddenDocIds)가 personal_docs를
//  직접 조회한다. 같은 규칙을 두 곳에 적으면 한쪽만 고쳐 어긋난다 — 검토관 하11.)

/** 목록 — **자기 것만**. 본문은 빼고 준다(목록에 20만 자를 실을 이유가 없다). */
export function listPersonalDocs(userId: string): Omit<PersonalDoc, "body">[] {
  return (listStmt.all(userId) as Row[]).map((r) => {
    const { body, ...rest } = fromRow(r);
    void body;
    return rest;
  });
}

/** 한 건 — 남의 것이면 null. 호출자는 이것을 404로 바꾼다(403이 아니다). */
export function getPersonalDoc(id: string, userId: string): PersonalDoc | null {
  const r = getStmt.get(id, userId) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** 개인 문서 생성 — 라우트와 서버 내부(조치 요청서 초안 등)가 같은 규칙을 쓴다(2026-08-21 추출).
 *  상한·길이 검사 포함 — 위반은 throw(라우트가 400으로 옮긴다). 생성은 항상 개인·비공유다. */
export function createPersonalDocFor(userId: string, userName: string, titleRaw: string, body: string): PersonalDoc {
  const title = titleRaw.trim();
  if (!title) throw new Error("제목을 적어 주세요");
  if (title.length > MAX_TITLE) throw new Error(`제목은 ${MAX_TITLE}자까지입니다`);
  if (body.length > MAX_BODY) throw new Error(`내용은 ${MAX_BODY}자까지입니다`);
  if (countPersonalDocs(userId) >= MAX_DOCS_PER_USER) throw new Error(`개인 문서는 ${MAX_DOCS_PER_USER}건까지입니다 — 안 쓰는 것을 지워 주세요`);
  const now = Date.now();
  const doc: PersonalDoc = { id: randomUUID(), title, body, ragOptIn: false, shared: false, createdAt: now, updatedAt: now };
  insertStmt.run({ ...doc, userId, ragOptIn: 0, shared: 0 });
  recordAudit({ kind: "config", actor: userName, action: "개인 문서 작성", target: doc.id, detail: title, result: "ok" });
  return doc;
}

export function countPersonalDocs(userId: string): number {
  return (countStmt.get(userId) as { n: number }).n;
}

/** 지식베이스에 실을 때 쓰는 문서 id — 개인 것임이 드러나야 한다(근거 표시에 그대로 나온다). */
export function ragDocumentId(id: string): string {
  return `personal:${id}`;
}

/** 인입할 본문을 정한다 — null이면 지식에서 뺀다(삭제). 순수 함수라 시험이 직접 잰다
 *  (검토관 하13 — hiddenDocIds만 재던 시험이 syncRag 무동작(상1)·마스킹 부재(상2)를 못 잡았다). */
export function 인입본문(doc: Pick<PersonalDoc, "title" | "body" | "ragOptIn" | "shared">): string | null {
  if (!doc.ragOptIn && !doc.shared) return null;
  // 공유본은 비밀 마스킹 후 인입 — 개인 메모의 비밀번호·계정이 회사 답변에 새지 않게(시안 약속).
  // 옵트인(나만)은 원문 그대로 — 격리 필터(memory.hiddenDocIds)가 남에게 안 보이게 막는다.
  const 본문 = doc.shared ? maskSecrets(doc.body).text : doc.body;
  return `# ${doc.title}\n\n${본문}`;
}

/** 켜면 인입, 끄면 삭제. 끄기만 하고 안 지우면 "껐는데 계속 나온다"가 된다.
 *  ⚠ ragOptIn(나만)·shared(회사) **둘 다 꺼졌을 때만** 삭제 — 한쪽만 보고 지우면
 *    「AI 포함을 껐더니 공유도 조용히 깨진다」(검토관 중5)가 된다. */
async function syncRag(doc: PersonalDoc, userId: string): Promise<void> {
  const docId = ragDocumentId(doc.id);
  const text = 인입본문(doc);
  if (text !== null) {
    const { ingestText, GLOBAL_SCOPE } = await import("./memory.js");
    // sourcePath에 사람이 읽을 이름을 — 근거 표시가 personal:<uuid>면 출처를 못 읽는다(검토관 하14).
    await ingestText(docId, text, GLOBAL_SCOPE, `내 문서 · ${doc.title}`, false, userId);
  } else {
    const { deleteDocument } = await import("./memory.js");
    await deleteDocument(docId, false).catch(() => undefined); // 없어도 정상(한 번도 안 켰던 문서)
  }
}

export function registerPersonalDocsRoutes(app: Express): void {
  const who = (req: Request): { id: string; name: string } => {
    const u = (req as Request & { user?: GijoUser }).user;
    return { id: String(u?.id ?? u?.username ?? "unknown"), name: u?.displayName ?? u?.username ?? "담당자" };
  };

  app.get("/api/personaldocs", authMiddleware, (req, res) => {
    res.json({ documents: listPersonalDocs(who(req).id) });
  });

  app.get("/api/personaldocs/:id", authMiddleware, (req, res) => {
    const d = getPersonalDoc(String(req.params.id), who(req).id);
    // ⚠ 남의 문서도 404다 — 403이면 "있긴 하다"를 알려 주는 셈이다.
    if (!d) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    res.json(d);
  });

  // 내보내기(2026-08-21) — md를 PDF·Word로. 문서 핵심 요건④와 조치 요청서의 공용 부품이다
  //   (요청서 전용으로 만들지 않는다 — 어떤 내 문서든 다듬어 내보낸다). 리포트 엔진 재사용.
  app.get("/api/personaldocs/:id/export", authMiddleware, asyncRoute(async (req, res) => {
    const d = getPersonalDoc(String(req.params.id), who(req).id);
    if (!d) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    const fmt = String(req.query.fmt ?? "docx").toLowerCase();
    const safe = (d.title || "문서").replace(/[^\w가-힣.-]+/g, "_").slice(0, 60);
    const { inspectionDocx, inspectionHtml } = await import("./inspectionreport.js");
    // 클라 request 헬퍼가 토큰을 붙여 부르므로 base64 JSON으로 돌려준다(reports-admin 관례) —
    // 렌더러가 blob으로 만들어 저장한다(브라우저 다운로드는 클라 몫).
    if (fmt === "docx") {
      const buf = await inspectionDocx(d.body);
      res.json({ fileName: `${safe}.docx`, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: buf.toString("base64") });
    } else if (fmt === "pdf") {
      const { renderPdf } = await import("./report.js");
      const os = await import("node:os"); const path = await import("node:path"); const fsp = await import("node:fs/promises");
      const tmp = path.join(os.tmpdir(), `gijo-pdoc-${Date.now()}.pdf`);
      const ok = await renderPdf(inspectionHtml(d.body), tmp);
      if (!ok) { res.status(503).json({ error: "PDF 변환기(브라우저 엔진)가 이 환경에 없어 PDF를 못 만듭니다 — Word로 내려받아 열어 주세요." }); return; }
      const buf = await fsp.readFile(tmp); await fsp.unlink(tmp).catch(() => {});
      res.json({ fileName: `${safe}.pdf`, mime: "application/pdf", base64: buf.toString("base64") });
    } else if (fmt === "html") {
      // ★ **약속한 4형식 중 빠져 있던 것**(2026-08-22). 라이트 설치안내서·용어사전·챗봇 안내가
      //   똑같이 「.md/HTML/PDF/워드로 내보냅니다」라고 적어 뒀는데 HTML만 없었다.
      //   PDF가 쓰는 그 조립기를 그대로 돌려준다 — 새 부품을 만들지 않는다.
      //   ⚠ PDF와 달리 **브라우저 엔진이 필요 없다** — 변환기가 없는 환경에서도 이건 된다.
      const html = inspectionHtml(d.body);
      res.json({ fileName: `${safe}.html`, mime: "text/html", base64: Buffer.from(html, "utf8").toString("base64") });
    } else { res.status(400).json({ error: "fmt는 docx · pdf · html 중 하나입니다" }); }
  }));

  app.post("/api/personaldocs", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const b = req.body as { title?: string; body?: string };
    try {
      const doc = createPersonalDocFor(u.id, u.name, String(b.title ?? ""), String(b.body ?? ""));
      res.json({ ...doc, warnings: secretWarning(doc.body) });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  }));

  app.put("/api/personaldocs/:id", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const cur = getPersonalDoc(String(req.params.id), u.id);
    if (!cur) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    const b = req.body as { title?: string; body?: string };
    const title = String(b.title ?? cur.title).trim();
    const body = String(b.body ?? cur.body);
    if (!title) { res.status(400).json({ error: "제목을 적어 주세요" }); return; }
    if (body.length > MAX_BODY) { res.status(400).json({ error: `내용은 ${MAX_BODY}자까지입니다` }); return; }
    // ★ **고치기 전의 판을 남긴다**(2026-08-22 — 우리가 약속한 「문서 이력」).
    //   ⚠ 저장 **전**에 남겨야 옛 내용이 잡힌다. 뒤에 남기면 새 내용을 두 번 적는 셈이다.
    //   ⚠ 내용이 안 바뀌었으면 안 남긴다 — 제목만 눌러도 판이 쌓이면 이력이 소음이 된다.
    if (cur.body !== body || cur.title !== title) {
      판남기기({ docId: cur.id, userId: u.id, title: cur.title, body: cur.body, savedBy: u.name });
    }
    updateStmt.run({ id: cur.id, userId: u.id, title, body, updatedAt: Date.now() });
    const next = getPersonalDoc(cur.id, u.id)!;
    // 지식베이스에 실려 있던 문서면 **고친 내용으로 다시 실어야** 한다 — 안 그러면 옛 내용으로 답한다.
    if (next.ragOptIn || next.shared) await syncRag(next, u.id);
    recordAudit({ kind: "config", actor: u.name, action: "개인 문서 수정", target: cur.id, detail: title, result: "ok" });
    res.json({ ...next, warnings: secretWarning(body) });
  }));

  app.post("/api/personaldocs/:id/rag", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const cur = getPersonalDoc(String(req.params.id), u.id);
    if (!cur) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    const on = (req.body as { on?: boolean }).on === true;
    ragStmt.run({ id: cur.id, userId: u.id, on: on ? 1 : 0, at: Date.now() });
    const next = getPersonalDoc(cur.id, u.id)!;
    await syncRag(next, u.id);
    recordAudit({
      kind: "config", actor: u.name,
      action: on ? "개인 문서를 내 AI 지식에 포함" : "개인 문서를 AI 지식에서 제외",
      target: cur.id,
      // 2026-08-20 격리 축 도입 — 옵트인은 이제 **내 질문에만** 근거로 나온다(전 담당자 공개는 공유가 담당).
      detail: on ? `${cur.title} — 내 질문에만 근거로 나옵니다(회사 공유는 별도)` : cur.title,
      result: "ok",
    });
    res.json(next);
  }));

  // 회사에 공유(2026-08-20 LLM 위키) — 켜면 전 담당자의 답변 근거가 될 수 있다.
  // 비밀 마스킹본으로 인입되고, 끄면 즉시 회수(재인입 — 옵트인이 남아 있으면 원문으로 나만).
  app.post("/api/personaldocs/:id/share", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const cur = getPersonalDoc(String(req.params.id), u.id);
    if (!cur) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    const on = (req.body as { on?: boolean }).on === true;
    shareStmt.run({ id: cur.id, userId: u.id, on: on ? 1 : 0, at: Date.now() });
    const next = getPersonalDoc(cur.id, u.id)!;
    await syncRag(next, u.id);
    recordAudit({
      kind: "config", actor: u.name,
      action: on ? "개인 문서를 회사에 공유" : "개인 문서 공유 해제",
      target: cur.id,
      detail: on ? `${cur.title} — 이제 다른 담당자 질문에도 근거로 나올 수 있습니다(비밀 마스킹 적용)` : cur.title,
      result: "ok",
    });
    res.json(next);
  }));

  // ── 첨부(캡처) ─────────────────────────────────────────────────────────────
  // ★ 우리가 약속한 「화면 캡처 Ctrl+V 삽입」의 서버 쪽. 본문에는 표기만 들어가고 파일은 디스크에.
  // ⚠ 모든 창구가 **내 것인지**를 함께 건다 — 남의 첨부는 원리상 안 열린다.
  app.get("/api/personaldocs/:id/files", authMiddleware, (req, res) => {
    const u = who(req);
    if (!getPersonalDoc(String(req.params.id), u.id)) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    res.json({ files: 첨부목록(String(req.params.id), u.id), 장수상한: 첨부장수상한 });
  });

  app.post("/api/personaldocs/:id/files", authMiddleware, (req, res) => {
    const u = who(req);
    if (!getPersonalDoc(String(req.params.id), u.id)) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    const b = req.body as { name?: string; mime?: string; content?: string };
    if (!b.content) { res.status(400).json({ error: "그림 내용이 없습니다" }); return; }
    const r = 첨부저장({
      docId: String(req.params.id), userId: u.id,
      name: String(b.name || "캡처"), mime: String(b.mime || "image/png"), base64: String(b.content),
    });
    if (!r.ok) { res.status(400).json({ error: r.사유 }); return; }
    recordAudit({ kind: "config", actor: u.name, action: "문서 그림 첨부", target: String(req.params.id), detail: r.첨부.name, result: "ok" });
    res.json({ ok: true, file: r.첨부, 표기: r.표기 });
  });

  // 그림 바이트 — 렌더러의 <img>가 토큰을 못 붙이므로 preload가 받아서 넘긴다.
  app.get("/api/personaldocs/file/:fileId", authMiddleware, (req, res) => {
    const u = who(req);
    const r = 첨부읽기(String(req.params.fileId), u.id);
    if (!r) { res.status(404).json({ error: "그런 그림이 없습니다" }); return; }
    res.json({ mime: r.첨부.mime, name: r.첨부.name, content: r.buf.toString("base64") });
  });

  app.delete("/api/personaldocs/file/:fileId", authMiddleware, (req, res) => {
    const u = who(req);
    if (!첨부삭제(String(req.params.fileId), u.id)) { res.status(404).json({ error: "그런 그림이 없습니다" }); return; }
    res.json({ ok: true });
  });

  // ── 버전 이력 ──────────────────────────────────────────────────────────────
  // ★ 약속 목록의 「문서 이력」. 고치다 날린 글을 되찾는 자리다.
  app.get("/api/personaldocs/:id/versions", authMiddleware, (req, res) => {
    const u = who(req);
    if (!getPersonalDoc(String(req.params.id), u.id)) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    res.json({ versions: 판목록(String(req.params.id), u.id), 보존판수: 이력보존판수 });
  });

  app.get("/api/personaldocs/version/:versionId", authMiddleware, (req, res) => {
    const u = who(req);
    const v = 판본문(Number(req.params.versionId), u.id);
    if (!v) { res.status(404).json({ error: "그런 판이 없습니다" }); return; }
    res.json(v);
  });

  app.delete("/api/personaldocs/:id", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const cur = getPersonalDoc(String(req.params.id), u.id);
    if (!cur) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    // 지식베이스에 실려 있으면 **거기서도 지운다** — 문서만 지우면 답변에는 계속 나온다.
    if (cur.ragOptIn || cur.shared) await syncRag({ ...cur, ragOptIn: false, shared: false }, u.id);
    deleteStmt.run(cur.id, u.id);
    // ⚠ **첨부와 이력도 함께 지운다.** 안 지우면 디스크에 고아 그림 파일이 영원히 남고,
    //   지운 문서의 옛 본문이 이력 표에 계속 살아 있다(지운 줄 알았는데 안 지워진 것).
    const 지운첨부 = 문서첨부정리(cur.id, u.id);
    문서판정리(cur.id, u.id);
    recordAudit({
      kind: "config", actor: u.name, action: "개인 문서 삭제", target: cur.id,
      detail: cur.title + (지운첨부 ? ` · 첨부 ${지운첨부}장 함께 삭제` : ""), result: "ok",
    });
    res.json({ ok: true });
  }));
}

/**
 * 비밀번호·계정 정보가 보이면 알린다.
 *
 * ⚠ **막지는 않는다.** 오탐이 있을 수 있고, 막으면 담당자는 포스트잇에 적는다 — 그게 더 나쁘다.
 *   대신 무엇이 보였는지 분명히 말하고 제대로 된 자리(보안제품 등록부)로 안내한다.
 *
 * ⚠⚠ **maskSecrets를 쓴다. findSecrets가 아니다**(2026-07-31 시험이 잡음).
 *   findSecrets는 탐지용 내부 함수라 `match`에 **원본 값을 그대로 담는다.** 그걸 응답에 실으면
 *   담당자의 비밀번호를 API로 되돌려 보내고 화면·로그에까지 남긴다 — 경고하려다 유출하는 셈이다.
 *   밖으로 나가는 자리에는 **가려진 값(masked)** 만 쓴다.
 */
function secretWarning(body: string): { kind: string; masked: string; hint: string }[] {
  return maskSecrets(body).hits.map((h) => ({
    kind: h.kind,
    masked: h.masked, // 앞 2자만 남은 형태 — 어느 줄인지 알아보되 값은 안 새게
    hint: "비밀번호·계정 정보로 보입니다. 장비 접속 정보는 보안제품 등록부에 두세요 — 거기는 암호화되어 보관됩니다.",
  }));
}
