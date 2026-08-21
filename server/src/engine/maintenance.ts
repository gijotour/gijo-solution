// engine/maintenance.ts — 보안제품 유지보수 일정 · 점검서 · 승인(거버넌스 검증)
// tasks.ts와 같은 패턴(SQLite 직접 statement). 흐름: 일정 등록(scheduled) → 점검 결과 보고
// (reported) → admin 승인(approved, intervalDays가 있으면 다음 회차를 자동으로 새로 만든다) 또는
// 반려(rejected). 점검 결과에 파일을 첨부하면 dataset.ts로 텍스트를 추출해 memory.ts(RAG)에도
// 수집한다 — 점검서 자체가 대시보드의 "올린 문서 검색"에서 바로 찾아지는 문서가 된다.

import pathMod from "path";
import { 라이브모드 } from "./datacleanup";
import type { Express, Request } from "express";
import { recordAudit } from "./audit";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { todayLocal } from "../util/date";
import { db, assertTestDb } from "../db";
import type { GijoUser } from "../auth/users";
import { sendMail } from "./email";
import { syncDocTriples, maintenanceReportTriples } from "./docgraph";

export type MaintenanceStatus = "scheduled" | "reported" | "approved" | "rejected";

export interface MaintenanceItem {
  id: string;
  title: string;
  productName: string;
  scheduleDate: string; // "YYYY-MM-DD"
  intervalDays?: number; // 있으면 승인 시 같은 title로 다음 회차를 자동 생성(반복 점검)
  status: MaintenanceStatus;
  assetId?: string; // 연결된 AI 자산(assets.ts) — 선택
  assetName?: string; // assetId의 현재 자산명(읽을 때 조회, 저장 안 함)
  productId?: string; // 연결된 보안제품(security_products) — 미지정 시 productName 유사 매칭으로 자동 해석
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
  assetId: string | null;
  productId: string | null;
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

// 연결된 자산의 현재 이름만 가볍게 조회한다(전체 Asset를 끌어오지 않음). 자산이 삭제됐으면 undefined.
const assetNameStmt = db.prepare("SELECT name FROM assets WHERE id = ?");
function resolveAssetName(assetId: string | null): string | undefined {
  if (!assetId) return undefined;
  const row = assetNameStmt.get(assetId) as { name: string } | undefined;
  return row?.name;
}

// 점검 등록 시 productId를 안 주면 productName으로 보안제품 등록부에서 찾아 연결한다.
// 구분자·공백 차이를 흡수하는 스쿼시 비교("경계 방화벽(FW-01)" ↔ "경계 방화벽 (FW-01)").
// securityproducts.ts를 import하지 않고 테이블을 직접 읽어 순환 참조를 피한다(assets 조회와 같은 패턴).
const listProductNamesStmt = db.prepare("SELECT id, name FROM security_products");
const squashName = (s: string): string => (s.toLowerCase().match(/[a-z0-9가-힣]+/g) ?? []).join("");
function resolveProductIdByName(productName: string): string | undefined {
  const target = squashName(productName);
  if (!target) return undefined;
  const rows = listProductNamesStmt.all() as { id: string; name: string }[];
  return rows.find((r) => squashName(r.name) === target)?.id;
}

function fromRow(row: MaintenanceRow): MaintenanceItem {
  return {
    id: row.id,
    title: row.title,
    productName: row.productName,
    scheduleDate: row.scheduleDate,
    intervalDays: row.intervalDays ?? undefined,
    status: row.status,
    assetId: row.assetId ?? undefined,
    assetName: resolveAssetName(row.assetId),
    productId: row.productId ?? undefined,
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

const today = todayLocal;

// insert/update를 하나로 — compliance.ts의 ON CONFLICT...DO UPDATE 패턴을 그대로 따른다.
const upsertStmt = db.prepare(`
  INSERT INTO maintenance_items
    (id, title, productName, scheduleDate, intervalDays, status, assetId, productId, reportNote, reportDocName,
     reportedBy, reportedAt, reviewedBy, reviewedAt, reviewNote, createdAt, updatedAt)
  VALUES (@id, @title, @productName, @scheduleDate, @intervalDays, @status, @assetId, @productId, @reportNote, @reportDocName,
     @reportedBy, @reportedAt, @reviewedBy, @reviewedAt, @reviewNote, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    status=excluded.status, assetId=excluded.assetId, productId=excluded.productId, reportNote=excluded.reportNote, reportDocName=excluded.reportDocName,
    reportedBy=excluded.reportedBy, reportedAt=excluded.reportedAt, reviewedBy=excluded.reviewedBy,
    reviewedAt=excluded.reviewedAt, reviewNote=excluded.reviewNote, updatedAt=excluded.updatedAt
`);
const getStmt = db.prepare("SELECT * FROM maintenance_items WHERE id = ?");
const listStmt = db.prepare("SELECT * FROM maintenance_items ORDER BY scheduleDate ASC");
const dueStmt = db.prepare(
  "SELECT * FROM maintenance_items WHERE status = 'scheduled' AND scheduleDate <= ? ORDER BY scheduleDate ASC"
);
const byAssetStmt = db.prepare("SELECT * FROM maintenance_items WHERE assetId = ? ORDER BY scheduleDate ASC");
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

// 바인딩은 명시적으로 — MaintenanceItem에는 컬럼이 아닌 assetName도 있어(읽기 전용) 그대로
// 넘기면 better-sqlite3가 "알 수 없는 named parameter"로 거부한다.
function save(item: MaintenanceItem): MaintenanceItem {
  upsertStmt.run({
    id: item.id,
    title: item.title,
    productName: item.productName,
    scheduleDate: item.scheduleDate,
    intervalDays: item.intervalDays ?? null,
    status: item.status,
    assetId: item.assetId ?? null,
    productId: item.productId ?? null,
    reportNote: item.reportNote ?? null,
    reportDocName: item.reportDocName ?? null,
    reportedBy: item.reportedBy ?? null,
    reportedAt: item.reportedAt ?? null,
    reviewedBy: item.reviewedBy ?? null,
    reviewedAt: item.reviewedAt ?? null,
    reviewNote: item.reviewNote ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
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
    assetId?: string;
    productId?: string;
  },
  actor?: string,
  createdNote?: string
): MaintenanceItem {
  if (!args.title || !args.productName || !args.scheduleDate) {
    throw new Error("title, productName, scheduleDate가 필요합니다");
  }
  const now = Date.now();
  const created = save({
    id: newId(),
    title: args.title,
    productName: args.productName,
    scheduleDate: args.scheduleDate,
    intervalDays: args.intervalDays,
    assetId: args.assetId,
    // 명시된 productId가 우선, 없으면 제품명으로 등록부에서 찾아 자동 연결.
    productId: args.productId ?? resolveProductIdByName(args.productName),
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
  });
  recordEvent(created.id, "created", actor, createdNote);
  return getItem(created.id); // assetName까지 채워 돌려준다
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
  // 온톨로지 연결(GraphRAG-lite) — (제품명)-[점검 리포트]->(점검서 파일명). 제품명으로 물으면
  // 최근 점검서가 관계 근거로 붙는다. 실패해도 보고 처리는 계속(내부 삼킴).
  if (args.reportDocName) {
    syncDocTriples(args.reportDocName, maintenanceReportTriples(args.reportDocName, item.productName));
  }
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

// 특정 AI 자산에 연결된 점검 — 인벤토리/자산 상세 연동용.
export function listMaintenanceByAsset(assetId: string): MaintenanceItem[] {
  return (byAssetStmt.all(assetId) as MaintenanceRow[]).map(fromRow);
}

// ── 점검 지연/마감 이메일 알림 ────────────────────────────────────────
// 기존 SMTP 설정(email.ts)을 그대로 재사용한다. 알림 수신자는 app_state에 저장해 다음에 미리 채운다.
const getMailStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setMailStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const RECIPIENTS_KEY = "maintenance:notifyEmails";

export function getNotifyRecipients(): string[] {
  const raw = (getMailStateStmt.get(RECIPIENTS_KEY) as { value: string } | undefined)?.value;
  return raw ? JSON.parse(raw) : [];
}

function saveNotifyRecipients(emails: string[]): void {
  setMailStateStmt.run(RECIPIENTS_KEY, JSON.stringify(emails));
}

// 지연/마감 점검 목록으로 알림 메일 본문을 만든다(순수 함수 — 테스트 용이). 마감 지난 일수를 계산.
export function buildDueMaintenanceEmail(items: MaintenanceItem[]): { subject: string; text: string } {
  const todayStr = today();
  const lines = items.map((m) => {
    const daysOver = Math.round((Date.parse(todayStr) - Date.parse(m.scheduleDate)) / (24 * 60 * 60 * 1000));
    const when = daysOver > 0 ? `${daysOver}일 지연` : "오늘 마감";
    return `• [${when}] ${m.title} — ${m.productName}${m.assetName ? ` (자산: ${m.assetName})` : ""} · 예정일 ${m.scheduleDate}`;
  });
  const subject = `[GIJO AS] 유지보수 점검 ${items.length}건 마감/지연 알림`;
  const text =
    `아래 보안제품 점검이 마감되었거나 지연되었습니다. GIJO AS 운영 가이드에서 점검 결과를 등록해주세요.\n\n` +
    lines.join("\n") +
    `\n\n— GIJO AS 자동 알림`;
  return { subject, text };
}

// 지연/마감 점검을 수신자에게 메일로 알린다. 대상이 없으면 발송하지 않는다(빈 알림 방지).
export async function notifyDueMaintenance(to: string[]): Promise<{ sent: boolean; count: number }> {
  const recipients = to.map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error("수신자 이메일이 필요합니다");
  saveNotifyRecipients(recipients);
  const due = listDueMaintenance();
  if (due.length === 0) return { sent: false, count: 0 };
  const { subject, text } = buildDueMaintenanceEmail(due);
  await sendMail({ to: recipients, subject, text });
  return { sent: true, count: due.length };
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetMaintenanceForTests(): void {
  assertTestDb("resetMaintenanceForTests");
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

const dstr = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// 최초 기동 시(테이블이 비어 있을 때) 모든 상태(예정/지연/승인대기/승인/반려)와 자산 연결·
// 반려→재점검→승인 사이클까지 보여주는 샘플 6건을 시드한다 — users.ts의 seedDefaultAdminIfEmpty()와
// 같은 패턴. 빈 화면 대신 바로 감을 잡게 한다. AI 자산 연결 건은 assets.ts의 SAMPLE_ASSET_IDS를
// 가리킨다(자산 시드가 먼저 돌아 존재함). 각 샘플에 상태 변경 이력도 함께 심어 타임라인을 바로 본다.
function seedSamplesIfEmpty(): void {
  // 실사용 전환 뒤에는 샘플을 되살리지 않는다(2026-08-19 사장님 「진짜 빈 상태」 —
  // 리셋 후 재기동 때 시드가 데모를 복원하던 함정을 datacleanup의 라이브 모드가 막는다).
  if (라이브모드()) return;
  if (listStmt.all().length > 0) return;
  const now = Date.now();

  // 1) 방화벽(어플라이언스, 미연결) — 예정·오늘 마감(지연)
  const fw = save({
    id: newId(), title: "방화벽 정책 정기 점검", productName: "경계 방화벽(FW-01)",
    scheduleDate: today(), intervalDays: 90, status: "scheduled", createdAt: now, updatedAt: now,
  });
  seedEvent(fw.id, "created", "정요한", now - 7 * DAY);

  // 2) VPN(어플라이언스, 미연결) — 예정·향후(지연 아님)
  const vpn = save({
    id: newId(), title: "VPN 게이트웨이 인증서 점검", productName: "VPN 게이트웨이(VPN-03)",
    scheduleDate: dstr(now + 10 * DAY), intervalDays: 365, status: "scheduled", createdAt: now, updatedAt: now,
  });
  seedEvent(vpn.id, "created", "정요한", now - 2 * DAY);

  // 3) 보안 챗봇(AI 자산 연결) — 승인 대기
  const bot = save({
    id: newId(), title: "프롬프트 가드레일 점검", productName: "보안 상담 챗봇",
    assetId: "ai-secbot-01", scheduleDate: today(), intervalDays: 30, status: "reported",
    reportNote: "프롬프트 인젝션 테스트 12종 통과, 시스템 프롬프트 노출 없음", reportedBy: "정요한", reportedAt: now - 1 * DAY,
    createdAt: now, updatedAt: now,
  });
  seedEvent(bot.id, "created", "정요한", now - 5 * DAY);
  seedEvent(bot.id, "reported", "정요한", now - 1 * DAY, "프롬프트 인젝션 테스트 12종 통과, 시스템 프롬프트 노출 없음");

  // 4) WAF(어플라이언스, 미연결) — 승인 완료(지난달)
  const wafBase = now - 30 * DAY;
  const waf = save({
    id: newId(), title: "WAF 룰셋 점검", productName: "웹방화벽(WAF-01)",
    scheduleDate: dstr(wafBase), intervalDays: 90, status: "approved",
    reportNote: "룰셋 최신화 및 예외 처리 재검토 완료", reportedBy: "정요한", reportedAt: wafBase + 2 * DAY,
    reviewedBy: "정요한", reviewedAt: wafBase + 3 * DAY, createdAt: wafBase, updatedAt: wafBase + 3 * DAY,
  });
  seedEvent(waf.id, "created", "정요한", wafBase);
  seedEvent(waf.id, "reported", "정요한", wafBase + 2 * DAY, "룰셋 최신화 및 예외 처리 재검토 완료");
  seedEvent(waf.id, "approved", "정요한", wafBase + 3 * DAY);

  // 5) 문서분류 AI(AI 자산 연결) — 반려→재점검→승인 전체 사이클(타임라인 시연용)
  const dcBase = now - 14 * DAY;
  const doc = save({
    id: newId(), title: "학습데이터 접근권한 점검", productName: "샘플-문서 민감도 분류 AI",
    assetId: "ai-doccls-02", scheduleDate: dstr(dcBase), intervalDays: 30, status: "approved",
    reportNote: "2차 재점검 — 접근권한 최소화 적용 완료", reportedBy: "정요한", reportedAt: dcBase + 4 * DAY,
    reviewedBy: "정요한", reviewedAt: dcBase + 5 * DAY, createdAt: dcBase, updatedAt: dcBase + 5 * DAY,
  });
  seedEvent(doc.id, "created", "정요한", dcBase);
  seedEvent(doc.id, "reported", "정요한", dcBase + 1 * DAY, "1차 점검 — 광범위 접근권한 발견");
  seedEvent(doc.id, "rejected", "정요한", dcBase + 2 * DAY, "접근권한 과다 — 최소권한 재적용 필요");
  seedEvent(doc.id, "reported", "정요한", dcBase + 4 * DAY, "2차 재점검 — 접근권한 최소화 적용 완료");
  seedEvent(doc.id, "approved", "정요한", dcBase + 5 * DAY);

  // 6) 이상탐지 엔진(AI 자산 연결) — 반려(재보고 대기)
  const an = save({
    id: newId(), title: "오탐 룰 점검", productName: "샘플-이상행위 탐지 엔진",
    assetId: "ai-anomaly-03", scheduleDate: dstr(now - 3 * DAY), intervalDays: 90, status: "rejected",
    reportNote: "오탐 룰 검토, 일부 임계값만 조정", reportedBy: "정요한", reportedAt: now - 4 * DAY,
    reviewedBy: "정요한", reviewedAt: now - 3 * DAY, reviewNote: "오탐률 여전히 높음 — 임계값 재산정 후 재보고",
    createdAt: now - 6 * DAY, updatedAt: now - 3 * DAY,
  });
  seedEvent(an.id, "created", "정요한", now - 6 * DAY);
  seedEvent(an.id, "reported", "정요한", now - 4 * DAY, "오탐 룰 검토, 일부 임계값만 조정");
  seedEvent(an.id, "rejected", "정요한", now - 3 * DAY, "오탐률 여전히 높음 — 임계값 재산정 후 재보고");
}
seedSamplesIfEmpty();

export function registerMaintenanceRoutes(app: Express): void {
  app.get("/api/maintenance", authMiddleware, (_req, res) => res.json(listMaintenanceItems()));
  app.get("/api/maintenance/due", authMiddleware, (_req, res) => res.json(listDueMaintenance()));

  // 지연/마감 점검 이메일 알림. GET은 저장된 수신자·현재 지연 건수(미리 보기)를, POST는 발송.
  app.get("/api/maintenance/notify", authMiddleware, (_req, res) => {
    res.json({ recipients: getNotifyRecipients(), dueCount: listDueMaintenance().length });
  });
  app.post(
    "/api/maintenance/notify",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const to = (Array.isArray(req.body?.to) ? (req.body.to as string[]) : String(req.body?.to ?? "").split(/[,\s]+/))
        .map((s) => s.trim())
        .filter(Boolean);
      if (to.length === 0) {
        res.status(400).json({ error: "수신자 이메일이 필요합니다" });
        return;
      }
      // SMTP 미설정 등 발송 오류는 asyncRoute가 500으로 격리한다(email.ts sendReport와 같은 패턴).
      res.json(await notifyDueMaintenance(to));
    })
  );

  app.post("/api/maintenance", authMiddleware, (req, res) => {
    const user = (req as Request & { user?: GijoUser }).user;
    const { title, productName, scheduleDate, intervalDays, assetId, productId } = req.body ?? {};
    try {
      res.json(createMaintenanceItem({ title, productName, scheduleDate, intervalDays, assetId, productId }, user?.displayName));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 한 점검 항목의 상태 변경 이력(등록→보고→승인/반려) 타임라인.
  app.get("/api/maintenance/:id/history", authMiddleware, (req, res) => {
    res.json(listItemEvents(String(req.params.id)));
  });

  // 특정 AI 자산에 연결된 점검 목록 — 인벤토리 화면에서 자산별 점검 현황을 보여준다.
  app.get("/api/assets/:id/maintenance", authMiddleware, (req, res) => {
    res.json(listMaintenanceByAsset(String(req.params.id)));
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
        // ⚠ 업로드 창구와 같은 잣대 — basename 접기 + 「볼 수 없으면 덮어쓸 수도 없다」.
        //   인입은 같은 documentId면 옛 조각을 지우고 새로 넣는데 등급 칸은 그대로 남는다
        //   (재검토관 2026-08-22: 덮어쓰기 문이 둘이 아니라 다섯이었다).
        const 문서이름 = pathMod.basename(String(filename).trim());
        const { 열람불가공용 } = await import("./memory.js");
        if (!문서이름 || 문서이름 === "." || 문서이름 === ".." || 열람불가공용(문서이름, req)) {
          res.status(403).json({ error: "같은 이름의 문서가 이미 있고, 그 문서를 열람할 권한이 없습니다 — 다른 이름으로 올리세요" });
          return;
        }
        const { extractDocumentText } = await import("./dataset.js");
        const text = await extractDocumentText(문서이름, content);
        if (text.trim()) {
          const { ingestText, GLOBAL_SCOPE } = await import("./memory.js");
          // 유지보수 점검 리포트는 업무영역이 자명하다 — 장비운영으로 확정 인입(화면 맥락 검색용).
          await ingestText(문서이름, text, GLOBAL_SCOPE, undefined, false, undefined, "장비운영");
          reportDocName = 문서이름;
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

  // 삭제(2026-08-19 삭제 일관화 ①) — 일정과 그 이력(maintenance_events)을 함께 지운다
  // (이력만 남기면 고아 — datacleanup FK 교훈과 같은 결: 자식 먼저).
  app.delete("/api/maintenance/:id", authMiddleware, (req, res) => {
    const id = String(req.params.id);
    const row = db.prepare("SELECT id, title FROM maintenance_items WHERE id = ?").get(id) as { id: string; title?: string } | undefined;
    if (!row) return res.status(404).json({ error: "해당 점검 일정을 찾을 수 없습니다" });
    const user = (req as Request & { user?: GijoUser }).user;
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM maintenance_events WHERE itemId = ?").run(id);
      db.prepare("DELETE FROM maintenance_items WHERE id = ?").run(id);
    });
    tx();
    recordAudit({
      kind: "write", actor: user?.displayName ?? null, action: "유지보수 일정 삭제",
      target: row.title ?? id, detail: id, result: "ok",
    });
    res.json({ ok: true });
  });
}
