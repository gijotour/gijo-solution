// engine/docattach.ts — 개인 문서의 **첨부(캡처)와 버전 이력**.
//
// ■ 왜 생겼나 (2026-08-22 사장님 「내 문서가 Smart MD 기능을 충분히 했으면 해」)
//   Smart MD Studio(별도 창)를 없애기로 했는데, 우리가 고객에게 **약속해 둔 목록**이 있다
//   (라이트 설치안내서 · 용어사전 · 챗봇 안내 세 곳이 똑같이 적고 있다):
//     화면 캡처 Ctrl+V 삽입 · md/HTML/PDF/워드 4형식 · 템플릿 · **문서 이력** · 인터넷 불필요
//   그중 **캡처**와 **이력**이 내 문서에 없었다. 없앤 뒤에 없으면 「말은 했는데 안 되더라」가 된다.
//
// ■ ★ 캡처를 본문에 안 박는 이유 (실측)
//   본문 상한 20만 자 · 화면 캡처 1장이 base64로 **약 16만 자** → 1장이 한계.
//   그대로 넣으면 지식 인입기가 「글자가 아니다」로 거절해 **저장이 500인데 본문은 이미 저장된 뒤**다.
//   → 파일은 디스크, 표에는 참조만. 본문에는 `![캡처](gijo-att:<id>)` 표기만 남는다.
//
// ⚠ **uuid로 저장한다**(원본 이름이 아니다). basename 키잉이 같은 이름끼리 덮어 기밀이 샌 사고가
//   2026-08-22에 있었다(커밋 132f19c6). 그 계보를 반복하지 않는다.
// ⚠ **`data/docs/` 안**에 둔다 — 백업이 그 폴더를 통째로 복사한다. 밖에 두면 조용히 빠진다.
// ⚠ 격리: 모든 읽기·쓰기가 `userId`를 함께 건다. 남의 첨부는 **원리상** 못 연다.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "../db";

/** 첨부가 사는 곳 — `data/docs/attach/`. 백업·정리가 아는 자리 안이다. */
const ATTACH_DIR = path.resolve(process.env.GIJO_INGEST_ROOT ?? "data", "docs", "attach");

/** 한 문서에 붙일 수 있는 첨부 수 — 같은 화면의 「요청 만들기」가 이미 10장이라 맞춘다.
 *  두 자리가 다른 말을 하면 담당자가 어느 쪽이 참인지 모른다. */
export const 첨부장수상한 = 10;
/** 한 장 상한 — 압축을 거친 캡처는 보통 100~200KB다. 8MB면 원본 사진도 받는다. */
export const 첨부크기상한 = 8 * 1024 * 1024;

const 허용MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface 첨부 {
  id: string;
  docId: string;
  name: string;
  mime: string;
  bytes: number;
  createdAt: string;
}

const 첨부넣기 = db.prepare(
  `INSERT INTO personal_doc_files (id,docId,userId,name,mime,bytes,createdAt)
   VALUES (@id,@docId,@userId,@name,@mime,@bytes,@createdAt)`
);
const 첨부목록읽기 = db.prepare(`SELECT * FROM personal_doc_files WHERE docId=? AND userId=? ORDER BY createdAt`);
const 첨부하나읽기 = db.prepare(`SELECT * FROM personal_doc_files WHERE id=? AND userId=?`);
const 첨부지우기 = db.prepare(`DELETE FROM personal_doc_files WHERE id=? AND userId=?`);
const 첨부세기 = db.prepare(`SELECT COUNT(*) AS n FROM personal_doc_files WHERE docId=? AND userId=?`);
const 문서첨부전부 = db.prepare(`SELECT id FROM personal_doc_files WHERE docId=? AND userId=?`);

function 줄로(r: Record<string, unknown>): 첨부 {
  return {
    id: String(r.id), docId: String(r.docId), name: String(r.name),
    mime: String(r.mime), bytes: Number(r.bytes), createdAt: String(r.createdAt),
  };
}

/** 첨부를 저장하고 **본문에 넣을 표기**를 돌려준다. */
export function 첨부저장(옵션: {
  docId: string; userId: string; name: string; mime: string; base64: string;
}): { ok: true; 첨부: 첨부; 표기: string } | { ok: false; 사유: string } {
  if (!허용MIME.has(옵션.mime)) {
    return { ok: false, 사유: `그림 파일만 붙일 수 있습니다(받는 형식: PNG·JPEG·WebP·GIF).` };
  }
  const 현재 = Number((첨부세기.get(옵션.docId, 옵션.userId) as { n: number }).n ?? 0);
  if (현재 >= 첨부장수상한) {
    return { ok: false, 사유: `한 문서에 그림은 ${첨부장수상한}장까지입니다 — 지금 ${현재}장입니다.` };
  }
  const buf = Buffer.from(옵션.base64, "base64");
  if (buf.length > 첨부크기상한) {
    return { ok: false, 사유: `그림 한 장은 ${Math.round(첨부크기상한 / 1024 / 1024)}MB까지입니다(지금 ${Math.round(buf.length / 1024)}KB).` };
  }
  const id = randomUUID();
  fs.mkdirSync(ATTACH_DIR, { recursive: true });
  // ⚠ 확장자를 원본 이름에서 가져오지 않는다 — 이름은 사람이 준 값이라 경로 조작이 섞일 수 있다.
  fs.writeFileSync(path.join(ATTACH_DIR, id), buf);
  const 행 = {
    id, docId: 옵션.docId, userId: 옵션.userId,
    name: String(옵션.name || "캡처").slice(0, 120),
    mime: 옵션.mime, bytes: buf.length, createdAt: new Date().toISOString(),
  };
  첨부넣기.run(행);
  // 본문 표기 — 자체 스킴을 쓴다. 화면이 이 표기를 보고 미리보기를 붙인다.
  // ⚠ `data:`도 `http:`도 아니라, 이 표기가 그대로 밖으로 나가도 **아무것도 새지 않는다.**
  return { ok: true, 첨부: 줄로(행 as unknown as Record<string, unknown>), 표기: `![${행.name}](gijo-att:${id})` };
}

export function 첨부목록(docId: string, userId: string): 첨부[] {
  return (첨부목록읽기.all(docId, userId) as Record<string, unknown>[]).map(줄로);
}

/** 첨부 바이트를 읽는다 — **userId가 안 맞으면 null.** 남의 것은 원리상 안 열린다. */
export function 첨부읽기(id: string, userId: string): { 첨부: 첨부; buf: Buffer } | null {
  const r = 첨부하나읽기.get(id, userId) as Record<string, unknown> | undefined;
  if (!r) return null;
  // ⚠ id는 uuid라 경로 조작이 원리상 안 되지만, 그래도 파일 이름으로 쓰기 전에 확인한다.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const p = path.join(ATTACH_DIR, id);
  if (!fs.existsSync(p)) return null;
  return { 첨부: 줄로(r), buf: fs.readFileSync(p) };
}

export function 첨부삭제(id: string, userId: string): boolean {
  const r = 첨부하나읽기.get(id, userId) as Record<string, unknown> | undefined;
  if (!r) return false;
  첨부지우기.run(id, userId);
  try { fs.unlinkSync(path.join(ATTACH_DIR, id)); } catch { /* 파일이 이미 없어도 표에서는 지운다 */ }
  return true;
}

/** 문서를 지울 때 첨부도 함께 — **안 지우면 고아 파일이 디스크에 영원히 남는다.** */
export function 문서첨부정리(docId: string, userId: string): number {
  const 것들 = 문서첨부전부.all(docId, userId) as { id: string }[];
  let n = 0;
  for (const { id } of 것들) if (첨부삭제(id, userId)) n++;
  return n;
}

// ── 버전 이력 ───────────────────────────────────────────────────────────────
//
// ⚠ **약속 목록에 있는 기능**이다(「문서 이력」). Smart MD는 문서당 20판을 브라우저에 뒀는데,
//   그건 가져올 수 없다(브라우저 저장소라 서버가 못 읽는다). 그래서 새로 만든다.
// ⚠ 보존 개수를 둔다 — 안 두면 긴 문서를 자주 고치는 사람의 DB가 계속 부푼다.
export const 이력보존판수 = 20;   // Smart MD와 같은 수 — 사람이 기대하는 값을 바꾸지 않는다

export interface 판 {
  id: number;
  docId: string;
  title: string;
  savedAt: string;
  savedBy?: string;
  /** 본문 길이 — 목록에서 「얼마나 바뀌었나」를 가늠하는 값. 본문 전체는 열 때만 준다. */
  글자수: number;
}

const 판넣기 = db.prepare(
  `INSERT INTO personal_doc_versions (docId,userId,title,body,savedAt,savedBy)
   VALUES (@docId,@userId,@title,@body,@savedAt,@savedBy)`
);
const 판목록읽기 = db.prepare(
  `SELECT id,docId,title,savedAt,savedBy,LENGTH(body) AS 글자수
     FROM personal_doc_versions WHERE docId=? AND userId=? ORDER BY savedAt DESC, id DESC LIMIT ?`
);
const 판하나읽기 = db.prepare(`SELECT * FROM personal_doc_versions WHERE id=? AND userId=?`);
const 오래된판지우기 = db.prepare(
  `DELETE FROM personal_doc_versions
    WHERE docId=@docId AND userId=@userId
      AND id NOT IN (SELECT id FROM personal_doc_versions
                      WHERE docId=@docId AND userId=@userId
                      ORDER BY savedAt DESC, id DESC LIMIT @keep)`
);
const 문서판전부지우기 = db.prepare(`DELETE FROM personal_doc_versions WHERE docId=? AND userId=?`);

/** 고치기 **전**의 판을 남긴다.
 *  ⚠ **던지지 않는다** — 이력을 못 남겼다고 저장 자체가 실패하면 안 된다.
 *    이 저장소 원칙: 가드가 본체를 죽이면 안 된다. */
export function 판남기기(옵션: { docId: string; userId: string; title: string; body: string; savedBy?: string }): void {
  try {
    판넣기.run({
      docId: 옵션.docId, userId: 옵션.userId,
      title: String(옵션.title ?? "").slice(0, 300),
      body: String(옵션.body ?? ""),
      savedAt: new Date().toISOString(), savedBy: 옵션.savedBy ?? null,
    });
    오래된판지우기.run({ docId: 옵션.docId, userId: 옵션.userId, keep: 이력보존판수 });
  } catch (e) {
    console.warn(`[docattach] 이력 저장 실패(저장은 계속): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function 판목록(docId: string, userId: string, 상한 = 이력보존판수): 판[] {
  return (판목록읽기.all(docId, userId, 상한) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id), docId: String(r.docId), title: String(r.title),
    savedAt: String(r.savedAt), savedBy: (r.savedBy as string) ?? undefined,
    글자수: Number(r.글자수 ?? 0),
  }));
}

/** 한 판의 본문 — 되돌리기·미리보기용. userId가 안 맞으면 null. */
export function 판본문(id: number, userId: string): { title: string; body: string; savedAt: string } | null {
  const r = 판하나읽기.get(id, userId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return { title: String(r.title), body: String(r.body), savedAt: String(r.savedAt) };
}

export function 문서판정리(docId: string, userId: string): void {
  try { 문서판전부지우기.run(docId, userId); } catch { /* 정리 실패가 삭제를 막지 않는다 */ }
}
