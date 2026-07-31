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

export interface PersonalDoc {
  id: string;
  title: string;
  body: string;
  ragOptIn: boolean;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string; userId: string; title: string; body: string;
  ragOptIn: number; createdAt: number; updatedAt: number;
}

const MAX_TITLE = 120;
const MAX_BODY = 200_000; // 20만 자 — 메모로 충분하고, 실수로 통째로 붙여넣는 것을 막는다
const MAX_DOCS_PER_USER = 200;

function fromRow(r: Row): PersonalDoc {
  return { id: r.id, title: r.title, body: r.body, ragOptIn: r.ragOptIn === 1, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

const listStmt = db.prepare("SELECT * FROM personal_docs WHERE userId = ? ORDER BY updatedAt DESC");
const getStmt = db.prepare("SELECT * FROM personal_docs WHERE id = ? AND userId = ?");
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM personal_docs WHERE userId = ?");
const insertStmt = db.prepare(
  "INSERT INTO personal_docs (id, userId, title, body, ragOptIn, createdAt, updatedAt) VALUES (@id, @userId, @title, @body, @ragOptIn, @createdAt, @updatedAt)"
);
const updateStmt = db.prepare("UPDATE personal_docs SET title = @title, body = @body, updatedAt = @updatedAt WHERE id = @id AND userId = @userId");
const ragStmt = db.prepare("UPDATE personal_docs SET ragOptIn = @on, updatedAt = @at WHERE id = @id AND userId = @userId");
const deleteStmt = db.prepare("DELETE FROM personal_docs WHERE id = ? AND userId = ?");

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

export function countPersonalDocs(userId: string): number {
  return (countStmt.get(userId) as { n: number }).n;
}

/** 지식베이스에 실을 때 쓰는 문서 id — 개인 것임이 드러나야 한다(근거 표시에 그대로 나온다). */
export function ragDocumentId(id: string): string {
  return `personal:${id}`;
}

/** 켜면 인입, 끄면 삭제. 끄기만 하고 안 지우면 "껐는데 계속 나온다"가 된다. */
async function syncRag(doc: PersonalDoc, userId: string): Promise<void> {
  const docId = ragDocumentId(doc.id);
  if (doc.ragOptIn) {
    const { ingestText, GLOBAL_SCOPE } = await import("./memory.js");
    await ingestText(docId, `# ${doc.title}\n\n${doc.body}`, GLOBAL_SCOPE, undefined, false, userId);
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

  app.post("/api/personaldocs", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const b = req.body as { title?: string; body?: string };
    const title = String(b.title ?? "").trim();
    const body = String(b.body ?? "");
    if (!title) { res.status(400).json({ error: "제목을 적어 주세요" }); return; }
    if (title.length > MAX_TITLE) { res.status(400).json({ error: `제목은 ${MAX_TITLE}자까지입니다` }); return; }
    if (body.length > MAX_BODY) { res.status(400).json({ error: `내용은 ${MAX_BODY}자까지입니다` }); return; }
    if (countPersonalDocs(u.id) >= MAX_DOCS_PER_USER) {
      res.status(400).json({ error: `개인 문서는 ${MAX_DOCS_PER_USER}건까지입니다 — 안 쓰는 것을 지워 주세요` }); return;
    }
    const now = Date.now();
    const doc: PersonalDoc = { id: randomUUID(), title, body, ragOptIn: false, createdAt: now, updatedAt: now };
    insertStmt.run({ ...doc, userId: u.id, ragOptIn: 0 });
    recordAudit({ kind: "config", actor: u.name, action: "개인 문서 작성", target: doc.id, detail: title, result: "ok" });
    res.json({ ...doc, warnings: secretWarning(body) });
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
    updateStmt.run({ id: cur.id, userId: u.id, title, body, updatedAt: Date.now() });
    const next = getPersonalDoc(cur.id, u.id)!;
    // 지식베이스에 실려 있던 문서면 **고친 내용으로 다시 실어야** 한다 — 안 그러면 옛 내용으로 답한다.
    if (next.ragOptIn) await syncRag(next, u.id);
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
      action: on ? "개인 문서를 AI 지식에 포함" : "개인 문서를 AI 지식에서 제외",
      target: cur.id,
      detail: on ? `${cur.title} — 이제 다른 담당자 질문에도 근거로 나올 수 있습니다` : cur.title,
      result: "ok",
    });
    res.json(next);
  }));

  app.delete("/api/personaldocs/:id", authMiddleware, asyncRoute(async (req, res) => {
    const u = who(req);
    const cur = getPersonalDoc(String(req.params.id), u.id);
    if (!cur) { res.status(404).json({ error: "그런 문서가 없습니다" }); return; }
    // 지식베이스에 실려 있으면 **거기서도 지운다** — 문서만 지우면 답변에는 계속 나온다.
    if (cur.ragOptIn) await syncRag({ ...cur, ragOptIn: false }, u.id);
    deleteStmt.run(cur.id, u.id);
    recordAudit({ kind: "config", actor: u.name, action: "개인 문서 삭제", target: cur.id, detail: cur.title, result: "ok" });
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
