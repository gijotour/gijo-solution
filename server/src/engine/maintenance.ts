// engine/maintenance.ts — 보안제품 유지보수 일정 · 점검서 · 승인(거버넌스 검증)
// tasks.ts와 같은 패턴(SQLite 직접 statement). 흐름: 일정 등록(scheduled) → 점검 결과 보고
// (reported) → admin 승인(approved, intervalDays가 있으면 다음 회차를 자동으로 새로 만든다) 또는
// 반려(rejected). 점검 결과에 파일을 첨부하면 dataset.ts로 텍스트를 추출해 memory.ts(RAG)에도
// 수집한다 — 점검서 자체가 대시보드의 "올린 문서 검색"에서 바로 찾아지는 문서가 된다.

import type { Express, Request } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import type { GijoUser } from "../auth/users";

export type MaintenanceStatus = "scheduled" | "reported" | "approved" | "rejected";

export interface MaintenanceItem {
  id: string;
  title: string;
  productName: string;
  scheduleDate: string; // "YYYY-MM-DD"
  intervalDays?: number; // 있으면 승인 시 같은 title로 다음 회차를 자동 생성(반복 점검)
  status: MaintenanceStatus;
  reportNote?: string;
  reportDocName?: string; // 첨부된 점검서가 지식베이스에 수집됐으면 그 문서명
  reportedBy?: string;
  reportedAt?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
  createdAt: number;
  updatedAt: number;
}

interface MaintenanceRow {
  id: string;
  title: string;
  productName: string;
  scheduleDate: string;
  intervalDays: number | null;
  status: MaintenanceStatus;
  reportNote: string | null;
  reportDocName: string | null;
  reportedBy: string | null;
  reportedAt: number | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  reviewNote: string | null;
  createdAt: number;
  updatedAt: number;
}

function fromRow(row: MaintenanceRow): MaintenanceItem {
  return {
    id: row.id,
    title: row.title,
    productName: row.productName,
    scheduleDate: row.scheduleDate,
    intervalDays: row.intervalDays ?? undefined,
    status: row.status,
    reportNote: row.reportNote ?? undefined,
    reportDocName: row.reportDocName ?? undefined,
    reportedBy: row.reportedBy ?? undefined,
    reportedAt: row.reportedAt ?? undefined,
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt ?? undefined,
    reviewNote: row.reviewNote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// 상태 변경 이력 한 줄(감사 추적). append-only.
export type MaintenanceEventType = "created" | "reported" | "approved" | "rejected";

export interface MaintenanceEvent {
  id: string;
  itemId: string;
  event: MaintenanceEventType;
  actor?: string;
  note?: string;
  at: number;
}

interface MaintenanceEventRow {
  id: string;
  itemId: string;
  event: MaintenanceEventType;
  actor: string | null;
  note: string | null;
  at: number;
}

function newId(): string {
  return "mnt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// insert/update를 하나로 — compliance.ts의 ON CONFLICT...DO UPDATE 패턴을 그대로 따른다.
const upsertStmt = db.prepare(`
  INSERT INTO maintenance_items
    (id, title, productName, scheduleDate, intervalDays, status, reportNote, reportDocName,
     reportedBy, reportedAt, reviewedBy, reviewedAt, reviewNote, createdAt, updatedAt)
  VALUES (@id, @title, @productName, @scheduleDate, @intervalDays, @status, @reportNote, @reportDocName,
     @reportedBy, @reportedAt, @reviewedBy, @reviewedAt, @reviewNote, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    status=excluded.status, reportNote=excluded.reportNote, reportDocName=excluded.reportDocName,
    reportedBy=excluded.reportedBy, reportedAt=excluded.reportedAt, reviewedBy=excluded.reviewedBy,
    reviewedAt=excluded.reviewedAt, reviewNote=excluded.reviewNote, updatedAt=excluded.updatedAt
`);
const getStmt = db.prepare("SELECT * FROM maintenance_items WHERE id = ?");
const listStmt = db.prepare("SELECT * FROM maintenance_items ORDER BY scheduleDate ASC");
const dueStmt = db.prepare(
  "SELECT * FROM maintenance_items WHERE status = 'scheduled' AND scheduleDate <= ? ORDER BY scheduleDate ASC"
);
const insertEventStmt = db.prepare(
  "INSERT INTO maintenance_events (id, itemId, event, actor, note, at) VALUES (@id, @itemId, @event, @actor, @note, @at)"
);
const listEventsStmt = db.prepare("SELECT * FROM maintenance_events WHERE itemId = ? ORDER BY at ASC, id ASC");

// 상태 전이가 일어날 때마다 한 줄씩 남긴다(감사 추적). 여러 이벤트가 같은 ms에 찍혀도 순서가
// 뒤집히지 않도록 id에 순증 카운터를 붙이고, 조회도 at 다음 id로 2차 정렬한다.
let eventSeq = 0;
function recordEvent(itemId: string, event: MaintenanceEventType, actor?: string, note?: string): void {
  insertEventStmt.run({
    id: `evt${Date.now().toString(36)}${(eventSeq++).toString(36).padStart(4, "0")}`,
    itemId,
    event,
    actor: actor ?? null,
    note: note && note.trim() ? note : null,
    at: Date.now(),
  });
}

export function listItemEvents(itemId: string): MaintenanceEvent[] {
  return (listEventsStmt.all(itemId) as MaintenanceEventRow[]).map((r) => ({
    id: r.id,
    itemId: r.itemId,
    event: r.event,
    actor: r.actor ?? undefined,
    note: r.note ?? undefined,
    at: r.at,
  }));
}

function save(item: MaintenanceItem): MaintenanceItem {
  upsertStmt.run({
    ...item,
    intervalDays: item.intervalDays ?? null,
    reportNote: item.reportNote ?? null,
    reportDocName: item.reportDocName ?? null,
    reportedBy: item.reportedBy ?? null,
    reportedAt: item.reportedAt ?? null,
    reviewedBy: item.reviewedBy ?? null,
    reviewedAt: item.reviewedAt ?? null,
    reviewNote: item.reviewNote ?? null,
  });
  return item;
}

function getItem(id: string): MaintenanceItem {
  const row = getStmt.get(id) as MaintenanceRow | undefined;
  if (!row) throw new Error("존재하지 않는 점검 일정입니다");
  return fromRow(row);
}

export function createMaintenanceItem(
  args: {
    title: string;
    productName: string;
    scheduleDate: string;
    intervalDays?: number;
  },
  actor?: string,
  createdNote?: string
): MaintenanceItem {
  if (!args.title || !args.productName || !args.scheduleDate) {
    throw new Error("title, productName, scheduleDate가 필요합니다");
  }
  const now = Date.now();
  const item = save({
    id: newId(),
    title: args.title,
    productName: args.productName,
    scheduleDate: args.scheduleDate,
    intervalDays: args.intervalDays,
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
  });
  recordEvent(item.id, "created", actor, createdNote);
  return item;
}

// 담당자가 점검을 마치고 결과를 보고한다 — 승인 대기 상태로 전환. 반려된 점검은 문제를 고친 뒤
// 다시 보고할 수 있다(재점검). 재보고 시 이전 반려 검토 기록은 지워 "최신" 필드가 새 보고를
// 가리키게 한다(전체 흐름은 이력 타임라인에 남는다).
export function submitReport(
  id: string,
  args: { note: string; reportDocName?: string },
  reportedBy: string
): MaintenanceItem {
  const item = getItem(id);
  if (item.status !== "scheduled" && item.status !== "rejected") {
    throw new Error("이미 보고되었거나 승인된 점검입니다");
  }
  const now = Date.now();
  const saved = save({
    ...item,
    status: "reported",
    reportNote: args.note,
    reportDocName: args.reportDocName,
    reportedBy,
    reportedAt: now,
    reviewedBy: undefined,
    reviewedAt: undefined,
    reviewNote: undefined,
    updatedAt: now,
  });
  recordEvent(id, "reported", reportedBy, args.note);
  return saved;
}

// admin 승인 — intervalDays가 있으면(반복 점검) 다음 회차를 자동으로 예정 등록한다.
export function approveItem(id: string, reviewedBy: string): MaintenanceItem {
  const item = getItem(id);
  if (item.status !== "reported") throw new Error("승인 대기 상태가 아닙니다");
  const now = Date.now();
  const approved = save({ ...item, status: "approved", reviewedBy, reviewedAt: now, updatedAt: now });
  recordEvent(id, "approved", reviewedBy);
  if (item.intervalDays) {
    const next = new Date(item.scheduleDate);
    next.setDate(next.getDate() + item.intervalDays);
    createMaintenanceItem(
      {
        title: item.title,
        productName: item.productName,
        scheduleDate: next.toISOString().slice(0, 10),
        intervalDays: item.intervalDays,
      },
      reviewedBy,
      "직전 회차 승인으로 자동 생성(반복 점검)"
    );
  }
  return approved;
}

export function rejectItem(id: string, reviewedBy: string, reason: string): MaintenanceItem {
  const item = getItem(id);
  if (item.status !== "reported") throw new Error("승인 대기 상태가 아닙니다");
  const now = Date.now();
  const rejected = save({ ...item, status: "rejected", reviewedBy, reviewedAt: now, reviewNote: reason, updatedAt: now });
  recordEvent(id, "rejected", reviewedBy, reason);
  return rejected;
}

export function listMaintenanceItems(): MaintenanceItem[] {
  return (listStmt.all() as MaintenanceRow[]).map(fromRow);
}

// 오늘 마감이거나 이미 지난 예정 건 — 대시보드 "오늘 할일" 연동용.
export function listDueMaintenance(): MaintenanceItem[] {
  return (dueStmt.all(today()) as MaintenanceRow[]).map(fromRow);
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetMaintenanceForTests(): void {
  db.exec("DELETE FROM maintenance_events");
  db.exec("DELETE FROM maintenance_items");
}

// 시드 전용: 이력 이벤트를 명시적 시각으로 넣어 타임라인이 그럴듯하게 흐르도록 한다
// (recordEvent는 항상 지금 시각을 쓰므로 시드에는 부적합).
function seedEvent(itemId: string, event: MaintenanceEventType, actor: string, at: number, note?: string): void {
  insertEventStmt.run({
    id: `evt${at.toString(36)}${(eventSeq++).toString(36).padStart(4, "0")}`,
    itemId,
    event,
    actor,
    note: note ?? null,
    at,
  });
}
const DAY = 24 * 60 * 60 * 1000;

// 최초 기동 시(테이블이 비어 있을 때) 전체 흐름(예정→승인대기→승인됨)을 보여주는 샘플 3건을
// 시드한다 — users.ts의 seedDefaultAdminIfEmpty()와 같은 패턴. 빈 화면 대신 바로 감을 잡게 한다.
// 각 샘플에 상태 변경 이력도 함께 심어 타임라인 화면을 바로 확인할 수 있게 한다.
function seedSamplesIfEmpty(): void {
  if (listStmt.all().length > 0) return;
  const now = Date.now();
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const fw = save({
    id: newId(),
    title: "방화벽 정책 정기 점검",
    productName: "경계 방화벽(FW-01)",
    scheduleDate: today(),
    intervalDays: 90,
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
  });
  seedEvent(fw.id, "created", "정요한", now - 7 * DAY);

  const ips = save({
    id: newId(),
    title: "IPS 시그니처 업데이트 점검",
    productName: "침입방지시스템(IPS-02)",
    scheduleDate: today(),
    intervalDays: 30,
    status: "reported",
    reportNote: "최신 시그니처로 업데이트 완료, 오탐 3건 튜닝함",
    reportedBy: "정요한",
    reportedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  seedEvent(ips.id, "created", "정요한", now - 5 * DAY);
  seedEvent(ips.id, "reported", "정요한", now - 1 * DAY, "최신 시그니처로 업데이트 완료, 오탐 3건 튜닝함");

  const wafCreated = lastMonth.getTime();
  const waf = save({
    id: newId(),
    title: "WAF 룰셋 점검",
    productName: "웹방화벽(WAF-01)",
    scheduleDate: lastMonth.toISOString().slice(0, 10),
    intervalDays: 90,
    status: "approved",
    reportNote: "룰셋 최신화 및 예외 처리 재검토 완료",
    reportedBy: "정요한",
    reportedAt: wafCreated + 2 * DAY,
    reviewedBy: "정요한",
    reviewedAt: wafCreated + 3 * DAY,
    createdAt: wafCreated,
    updatedAt: wafCreated + 3 * DAY,
  });
  seedEvent(waf.id, "created", "정요한", wafCreated);
  seedEvent(waf.id, "reported", "정요한", wafCreated + 2 * DAY, "룰셋 최신화 및 예외 처리 재검토 완료");
  seedEvent(waf.id, "approved", "정요한", wafCreated + 3 * DAY);
}
seedSamplesIfEmpty();

export function registerMaintenanceRoutes(app: Express): void {
  app.get("/api/maintenance", authMiddleware, (_req, res) => res.json(listMaintenanceItems()));
  app.get("/api/maintenance/due", authMiddleware, (_req, res) => res.json(listDueMaintenance()));

  app.post("/api/maintenance", authMiddleware, (req, res) => {
    const user = (req as Request & { user?: GijoUser }).user;
    try {
      res.json(createMaintenanceItem(req.body, user?.displayName));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 한 점검 항목의 상태 변경 이력(등록→보고→승인/반려) 타임라인.
  app.get("/api/maintenance/:id/history", authMiddleware, (req, res) => {
    res.json(listItemEvents(String(req.params.id)));
  });

  // 점검 결과 보고. filename+content(base64)가 함께 오면 텍스트를 추출해 지식베이스(RAG)에도
  // 수집한다 — 점검서가 곧 대시보드 문서 검색에서 찾아지는 문서가 된다.
  app.post(
    "/api/maintenance/:id/report",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { note, filename, content } = req.body as { note?: string; filename?: string; content?: string };
      const user = (req as Request & { user?: GijoUser }).user;
      let reportDocName: string | undefined;
      if (filename && content) {
        const { extractDocumentText } = await import("./dataset.js");
        const text = await extractDocumentText(filename, content);
        if (text.trim()) {
          const { ingestText, GLOBAL_SCOPE } = await import("./memory.js");
          await ingestText(filename, text, GLOBAL_SCOPE);
          reportDocName = filename;
        }
      }
      try {
        res.json(submitReport(String(req.params.id), { note: note ?? "", reportDocName }, user?.displayName ?? "알 수 없음"));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  app.post("/api/maintenance/:id/approve", authMiddleware, adminMiddleware, (req, res) => {
    const user = (req as Request & { user?: GijoUser }).user;
    try {
      res.json(approveItem(String(req.params.id), user?.displayName ?? "관리자"));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/maintenance/:id/reject", authMiddleware, adminMiddleware, (req, res) => {
    const user = (req as Request & { user?: GijoUser }).user;
    try {
      res.json(rejectItem(String(req.params.id), user?.displayName ?? "관리자", String(req.body?.reason ?? "")));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
