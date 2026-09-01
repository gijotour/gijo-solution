// engine/remrequest.ts — 조치·수정 요청(외부 발송) 등록부 (2026-08-21, 시안 remediation-request 확정)
//
// ■ 왜: 보안담당자의 조치 실무는 「우리가 고친다」보다 **담당자·보안제품(벤더)에 수정을 요청**하는
//   것인데, 제품엔 배정까지만 있고 밖으로 나간 요청(수신처·발송·회신)을 적는 자리가 없었다.
// ■ 경계(설계관 2026-08-21 — 같은 것을 두 곳에 적지 않는다):
//   · 이 등록부는 **밖으로 나간 요청**만 적는다. 직접 조치 내역은 finding_approvals가 이미
//     대장이다(6상태·담당·기한) — 새로 적으면 다섯 번째 사본이라 **여기 안 담는다**.
//   · doc_requests(우리 제품에 대한 개선 요청)와 다르다 — 이건 사내·벤더로 나가는 요청이다.
//   · maintenance_items(반복 점검)와의 경계 = 반복 주기가 있으면 점검, 없으면 요청.
// ■ 초안은 내 문서(personaldocs)에 md로 생긴다 — 문서함에서 다듬고 내보내는 것이 마감 자리
//   (사장님 확정: 「우리 문서함에서 최종적으로 수정해서 보내는 걸로」). 수신처는 자동으로 채우지
//   않는다 — 초안에 빈 칸으로 넣고 사람이 적는다(사장님 확정 ②).
// ■ 상태: draft(초안) → sent(보냄) → replied(회신) / noreply(무응답). 전환은 사람이 화면에서
//   확인하고 누른다. 미회신 재촉은 다음날 브리핑이 안내한다(자동 재발송 아님 — 사장님 확정 ①).
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { authMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";
import { listAssets } from "./assets";
import { findingKey } from "./approvals";
import { remediationFor } from "./playbook";
import { 한줄풀이글 } from "./findingplain";

db.exec(`CREATE TABLE IF NOT EXISTS outbound_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- vuln-fix | patch | policy | bug
  targetKind TEXT,               -- asset | product | none
  targetId TEXT,
  targetName TEXT,
  recipient TEXT,                -- 수신처 — 빈 값 허용(문서함에서 적는다)
  dueDate TEXT,
  recheck TEXT,                  -- 재점검 조건
  status TEXT NOT NULL DEFAULT 'draft',
  docId TEXT,                    -- 내 문서 초안 id
  findingKeys TEXT,              -- JSON ["assetId::findingKey", ...]
  createdBy TEXT,
  createdAt INTEGER NOT NULL,
  sentAt INTEGER,
  repliedAt INTEGER,
  note TEXT
)`);

export type OutboundKind = "vuln-fix" | "patch" | "policy" | "bug";
export const KIND_KO: Record<OutboundKind, string> = {
  "vuln-fix": "취약점 조치", patch: "보안패치", policy: "보안정책 수정", bug: "버그 수정",
};
export type OutboundStatus = "draft" | "sent" | "replied" | "noreply";
export const STATUS_KO: Record<OutboundStatus, string> = { draft: "초안", sent: "보냄", replied: "회신", noreply: "무응답" };

export interface OutboundRequest {
  id: string; kind: OutboundKind; targetKind?: string; targetId?: string; targetName?: string;
  recipient?: string; dueDate?: string; recheck?: string; status: OutboundStatus;
  docId?: string; findingKeys: string[]; createdBy?: string; createdAt: number;
  sentAt?: number; repliedAt?: number; note?: string;
}

function rowToReq(r: Record<string, unknown>): OutboundRequest {
  return { ...(r as unknown as OutboundRequest), findingKeys: JSON.parse(String(r.findingKeys ?? "[]")) };
}

export function listOutboundRequests(filter?: { productId?: string; status?: OutboundStatus; createdBy?: string }): OutboundRequest[] {
  let sql = "SELECT * FROM outbound_requests"; const args: unknown[] = []; const w: string[] = [];
  if (filter?.productId) { w.push("targetKind='product' AND targetId=?"); args.push(filter.productId); }
  if (filter?.status) { w.push("status=?"); args.push(filter.status); }
  // ★ 소유 잣대(2026-08-31 조사 지적) — 제품별 접기에서는 티가 안 났지만 **전역 목록**을
  //   만들면 전원의 요청이 보인다(「직접-열람 등급 누출」 계보). 창구가 사람을 넘기면
  //   그 사람 것만 준다. 주인을 모르는 옛 줄(createdBy NULL)은 **안 준다**(fail-closed).
  if (filter?.createdBy) { w.push("createdBy=?"); args.push(filter.createdBy); }
  if (w.length) sql += " WHERE " + w.join(" AND ");
  sql += " ORDER BY createdAt DESC";
  return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map(rowToReq);
}

/** 미회신 = 보냈는데 다음날(자정 경과)까지 회신 표시가 없는 것 — 브리핑 재촉의 잣대. */
export function unansweredRequests(now = Date.now()): OutboundRequest[] {
  const 오늘0시 = new Date(now); 오늘0시.setHours(0, 0, 0, 0);
  return listOutboundRequests({ status: "sent" }).filter((r) => (r.sentAt ?? r.createdAt) < 오늘0시.getTime());
}

/** 픽 id("assetId::findingKey") 목록을 실제 취약점으로 푼다 — 못 찾은 id는 정직하게 따로 센다. */
function resolveFindings(ids: string[]): { found: { assetId: string; assetName: string; f: { finding_type: string; severity?: string; kev?: boolean } }[]; missing: number } {
  const found: { assetId: string; assetName: string; f: { finding_type: string; severity?: string; kev?: boolean } }[] = [];
  let missing = 0;
  const assets = listAssets();
  for (const id of ids) {
    const [assetId, fk] = id.split("::");
    const a = assets.find((x) => x.id === assetId);
    const f = a?.findings?.find((x) => findingKey(assetId, x) === fk);
    if (a && f) found.push({ assetId, assetName: a.name, f });
    else missing++;
  }
  return { found, missing };
}

/** md 초안 조립 — 서버가 조립한다(클라 TEMPLATES는 서버가 모른다 — 설계관 ①).
 *  쉬운 설명은 있을 때만 절을 그린다(findingplain 원칙 「모르면 모른다고 한다」 — 빈 절 금지). */
export function buildRequestDraft(input: {
  kind: OutboundKind; recipient?: string; dueDate?: string; recheck?: string;
  targetName?: string; findings?: { assetName: string; f: { finding_type: string; severity?: string; kev?: boolean } }[];
}): { title: string; body: string } {
  const 오늘 = new Date().toISOString().slice(0, 10);
  const title = `조치 요청서 — ${KIND_KO[input.kind]}${input.targetName ? ` (${input.targetName})` : ""} ${오늘}`;
  const L: string[] = [
    `# ${title}`, "",
    `- 요청 유형: ${KIND_KO[input.kind]}`,
    `- 수신처: ${input.recipient?.trim() || "(여기에 받는 곳을 적어 주세요 — 담당 부서·벤더 창구)"}`,
    `- 요청일: ${오늘}`,
    `- 조치 기한: ${input.dueDate || "(기한을 적어 주세요)"}`,
    `- 재점검 조건: ${input.recheck?.trim() || "(조치 완료 통보 후 재스캔으로 확인)"}`,
    "",
  ];
  if (input.findings?.length) {
    L.push(`## 대상 취약점 (${input.findings.length}건)`, "");
    for (const { assetName, f } of input.findings) {
      L.push(`### ${f.finding_type} — ${assetName}`);
      L.push(`- 심각도: ${f.severity ?? "-"}${f.kev ? " · **실제 악용(KEV)**" : ""}`);
      const 풀이 = 한줄풀이글(f.finding_type);
      if (풀이) L.push(`- 쉬운 설명${풀이}`); // 한줄풀이글은 「 — 」로 시작한다
      L.push("");
    }
  }
  L.push("## 요청 사항", "", "(구체 조치 내용을 적어 주세요 — 패치 적용·설정 변경·정책 반영 등)", "");
  return { title, body: L.join("\n") };
}

/** 기한 기본값 — SLA 단일 출처(playbook.remediationFor)를 그대로 쓴다(설계관 ③ — 3중화 금지). */
export function defaultDueDate(findings: { f: { finding_type: string; severity?: string; kev?: boolean } }[]): string {
  let best: string | null = null;
  for (const { f } of findings) {
    const d = remediationFor({ findingType: f.finding_type, severity: f.severity as never, kev: f.kev }).dueDate;
    if (!best || d < best) best = d; // 가장 급한 것 기준
  }
  return best ?? remediationFor({ findingType: "" }).dueDate;
}

export function createOutboundRequest(input: {
  kind: OutboundKind; findingIds?: string[]; recipient?: string; dueDate?: string; recheck?: string;
  targetKind?: string; targetId?: string; targetName?: string; docId?: string; createdBy?: string;
}): { req: OutboundRequest; missing: number } {
  const ids = input.findingIds ?? [];
  const { missing } = ids.length ? resolveFindings(ids) : { missing: 0 };
  const req: OutboundRequest = {
    id: randomUUID(), kind: input.kind, targetKind: input.targetKind, targetId: input.targetId,
    targetName: input.targetName, recipient: input.recipient, dueDate: input.dueDate, recheck: input.recheck,
    status: "draft", docId: input.docId, findingKeys: ids, createdBy: input.createdBy, createdAt: Date.now(),
  };
  db.prepare(`INSERT INTO outbound_requests (id,kind,targetKind,targetId,targetName,recipient,dueDate,recheck,status,docId,findingKeys,createdBy,createdAt)
    VALUES (@id,@kind,@targetKind,@targetId,@targetName,@recipient,@dueDate,@recheck,@status,@docId,@findingKeys,@createdBy,@createdAt)`)
    .run({ ...req, findingKeys: JSON.stringify(req.findingKeys) });
  recordAudit({ kind: "write", actor: input.createdBy ?? "-", action: `조치 요청서 초안(${KIND_KO[input.kind]})`, target: req.id, detail: input.targetName ?? `${ids.length}건`, result: "ok" });
  return { req, missing };
}

export { resolveFindings };

/** 고른 취약점들의 자산에 연결된 보안제품을 찾는다 — 요청서를 그 제품 이력에 걸기 위해서다
 *  (검토관 상1 — target 미채움으로 제품 판이 영영 0건이던 것). 한 제품으로 모이면 그것을,
 *  여러 제품이면 첫 제품을 대표로(초안은 사람이 문서함에서 정정할 수 있다). 없으면 undefined. */
export function resolveTargetProduct(assetIds: string[]): { targetKind: "product"; targetId: string; targetName: string } | undefined {
  if (!assetIds.length) return undefined;
  try {
    const { listProducts } = require("./securityproducts") as typeof import("./securityproducts");
    const set = new Set(assetIds);
    const hit = listProducts().find((p) => (p as { assetId?: string }).assetId && set.has((p as { assetId?: string }).assetId!));
    if (hit) return { targetKind: "product", targetId: hit.id, targetName: hit.name };
  } catch { /* 제품을 못 읽어도 요청서는 만든다 */ }
  return undefined;
}

export function registerRemRequestRoutes(app: Express): void {
  app.get("/api/outbound-requests", authMiddleware, (req, res) => {
    const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
    // ★ mine=1 — **내가 만든 것만**(2026-08-31). 내 문서 📨 판이 이 꼴로 부른다.
    //   제품별 조회(productId)는 팀이 함께 보는 자리라 종전대로 두고, **전역 목록**만
    //   소유로 좁힌다 — 좁히지 않으면 화면 하나가 전원의 요청서를 펼치는 창구가 된다.
    const me = (req as typeof req & { user?: { id?: string | number; username?: string } }).user;
    const uid = me?.id != null ? String(me.id) : (me?.username ?? "");
    const mine = String(req.query.mine ?? "") === "1";
    if (mine && !uid) { res.json({ requests: [], scope: "mine" }); return; } // 주인을 모르면 안 준다
    // ★ scope를 함께 준다 — 화면이 **이 서버가 좁혀 줄 줄 아는지** 알 수 있어야 한다.
    //   안 주면 mine=1을 모르는 옛 서버가 조용히 **전원 목록**으로 답하고, 새 화면은 그것을
    //   「내 것」이라 믿고 그린다(클라 게시가 서버 배포를 앞지르면 실제로 그렇게 된다 —
    //   기준서 「의존 시 서버 먼저 배포」가 지켜지지 않는 순간 곧바로 누출이다).
    res.json({ requests: listOutboundRequests(mine ? { createdBy: uid } : { productId }), scope: mine ? "mine" : "all" });
  });
  // 상태 전환 — 사람이 화면에서 확인하고 누른다(사장님 확정 ①). 전환은 전부 감사에 남는다.
  app.patch("/api/outbound-requests/:id", authMiddleware, (req, res) => {
    const id = String(req.params.id);
    const status = String((req.body as { status?: string })?.status ?? "") as OutboundStatus;
    if (!["draft", "sent", "replied", "noreply"].includes(status)) { res.status(400).json({ error: "상태는 초안·보냄·회신·무응답 중 하나입니다" }); return; }
    const cur = (db.prepare("SELECT * FROM outbound_requests WHERE id=?").get(id) as Record<string, unknown>) || null;
    if (!cur) { res.status(404).json({ error: "그런 요청이 없습니다" }); return; }
    const now = Date.now();
    db.prepare("UPDATE outbound_requests SET status=?, sentAt=CASE WHEN ?='sent' THEN ? ELSE sentAt END, repliedAt=CASE WHEN ? IN ('replied','noreply') THEN ? ELSE repliedAt END WHERE id=?")
      .run(status, status, now, status, now, id);
    const actor = (req as unknown as { user?: { name?: string } }).user?.name ?? "-";
    recordAudit({ kind: "write", actor, action: `요청 상태 전환(${STATUS_KO[(cur.status as OutboundStatus)] ?? cur.status}→${STATUS_KO[status]})`, target: id, detail: String(cur.targetName ?? ""), result: "ok" });
    res.json({ ok: true });
  });
}
