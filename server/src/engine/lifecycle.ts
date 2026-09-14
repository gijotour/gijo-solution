// engine/lifecycle.ts — 계약·생애주기(협력사·EOS/EOL·구독·유지보수) 잎 모듈
// 계획서: 중-7(보안제품 관리 확장) + 전-4(정직한 구현·시연 시나리오). 2026-09-14 신설.
// 승인: 시안 mockups/asset-lifecycle/시안.html §1·§7·§13 + 설계관 차단 반영본(A안).
//
// ■ 무엇을 담나 — 소프트웨어 자산(assets)과 보안제품(security_products)이 **같은 표**를 쓴다.
//   대상 종류(targetType: "asset"|"product") + 대상 id로 가른다. 표를 둘로 나누면 이 저장소가
//   반복해 겪은 "사본 어긋남"(같은 값을 두 곳에 적어 서로 어긋나는 사고)이 또 생긴다.
//
// ■ 왜 잎 모듈인가 — db·express·authMiddleware·recordAudit 말고 **다른 engine 모듈을
//   import하지 않는다**(순환 금지, 계획서 지시서 원문). 제품 이름·자산 이름 조회는 SQL로
//   여기서 직접 한다(securityproducts.ts·assets.ts를 부르지 않는다).
//
// ■ ⓜ 폴백 계약(2026-09-14, 반드시 지킬 것) — 날짜를 못 읽으면 그 칸은 **없는 것으로 본다**
//   (0일·만료로 읽지 않는다). 행은 있는데 읽힌 날짜가 하나도 없으면 "확인 필요"이고, 행 자체가
//   없으면 "등록된 계약이 없습니다"다. 이 둘을 뭉치면 "모른다"가 "괜찮다"로 읽힌다.
//
// ■ 잣대 단일 출처 — 임박/주의 30·90일은 아래 두 상수가 **유일한 출처**다. 화면·도구·
//   오늘의 할 일이 전부 이 모듈의 함수(생애주기배지·listLifecycleDueSoon)를 불러 쓴다 —
//   30/90을 다른 파일에 다시 적지 않는다(server/test/lifecycle.test.ts ⓗ이 소스 감시로 지킨다).
import { randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { authMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";

export const 임박일 = 30;
export const 주의일 = 90;

export type LifecycleTargetType = "asset" | "product";

export interface LifecycleRow {
  id: string;
  targetType: LifecycleTargetType;
  targetId: string;
  vendorContact: string | null;
  licenseType: string | null;
  subStart: string | null;
  subEnd: string | null;
  maintenanceEnd: string | null;
  eos: string | null;
  eol: string | null;
  extName: string | null;
  extEnd: string | null;
  evidence: string | null;
  note: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LifecycleDue {
  targetType: LifecycleTargetType;
  targetId: string;
  이름: string;
  날짜: string;
  종류: string;
  dday: number;
  상태: "종료" | "임박" | "주의";
  안내: string | null;
}

/**
 * 등록된 대상 **전부**의 배지 — "만료 임박"만 담는 LifecycleDue와 달리 여유·확인필요도 담는다.
 *
 * ⚠ 2026-09-14 검토관 [상] — 화면(자산 목록 「만료」 열·자산 상세·지도 상세판)이 만료 임박
 *   목록 하나만 보고 그렸더니, **90일 밖(여유)·날짜를 못 읽는 행(확인필요)이 전부
 *   「등록된 계약이 없습니다」**가 됐다. 방금 등록한 담당자에게 제품이 스스로를 부정한 것이다.
 *   「모른다」·「여유 있다」·「등록 안 했다」는 서로 다른 셋이라 **원천에서 갈라 내보낸다.**
 */
export interface LifecycleBadgeEntry {
  targetType: LifecycleTargetType;
  targetId: string;
  이름: string;
  상태: 생애주기배지결과["상태"];
  글: string;
  날짜: string | null;
  종류: string | null;
  dday: number | null;
  안내: string | null;
}

export type LifecycleFieldKind = "text" | "select" | "date" | "daterange" | "namedate";

export interface LifecycleFieldSchemaEntry {
  key: string;
  label: string;
  kind: LifecycleFieldKind;
  /** kind가 select일 때만 — 화면 <select> 선택지 */
  options?: string[];
}

// 9칸 — 시안 §3·§13, products.html field-row(1열 44.5px/개) CSS를 그대로 재사용하는 화면이
// 이 배열 길이를 그대로 그린다(게시 관문 후보 "칸 수 검사"의 잣대가 이 length다).
export const LIFECYCLE_FIELD_SCHEMA: LifecycleFieldSchemaEntry[] = [
  { key: "vendorContact", label: "협력사·담당자 연락처", kind: "text" },
  { key: "licenseType", label: "라이선스 종류", kind: "select", options: ["영구", "구독", "오픈소스·번들", "기타"] },
  { key: "subscription", label: "구독 기간", kind: "daterange" }, // 칸 둘 → subStart·subEnd
  { key: "maintenanceEnd", label: "유지보수 종료일(영구)", kind: "date" },
  { key: "eos", label: "EOS(판매 종료일)", kind: "date" },
  { key: "eol", label: "EOL(지원 종료일)", kind: "date" },
  { key: "extension", label: "유상 연장", kind: "namedate" }, // 칸 둘 → extName·extEnd
  { key: "evidence", label: "근거·확인일", kind: "text" },
  { key: "note", label: "비고", kind: "text" },
];

export type PatchableFieldKey = Exclude<keyof LifecycleRow, "id" | "targetType" | "targetId" | "createdAt" | "updatedAt" | "updatedBy">;
const DATE_COLUMNS = new Set<PatchableFieldKey>(["subStart", "subEnd", "maintenanceEnd", "eos", "eol", "extEnd"]);

export interface LifecycleFieldMatch {
  column: PatchableFieldKey;
  label: string;
  isDate: boolean;
}

/**
 * 담당자·모델이 자연스럽게 쓰는 낱말("유지보수", "EOL", "구독 종료일" …)을 실제 칼럼으로 잇는다.
 * `set_lifecycle`의 validate()와 handlers.runSetLifecycle이 **같은 함수 하나**를 쓴다
 * (잣대 두 벌 두지 않는다 — registry.ts validate 주석과 같은 원칙).
 *
 * ⚠ LIFECYCLE_FIELD_SCHEMA의 key/label 정확 일치를 **먼저** 보고, 못 찾으면 별칭으로 넓힌다 —
 *   담당자 지시문은 "구독 종료일"처럼 스키마 라벨("구독 기간")보다 더 구체적인 낱말을 쓴다
 *   (2026-09-14 실측: 예문 "FW-01 구독 종료일 2027-03-31로 설정해줘"). 별칭 없이 정확 일치만
 *   보면 이 실제 문장이 전부 "항목 이름을 못 알아봤습니다"로 막힌다.
 */
export function resolveLifecycleField(raw: string): LifecycleFieldMatch | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const bySchema = LIFECYCLE_FIELD_SCHEMA.find((f) => f.key === t || f.label === t);
  if (bySchema) {
    // daterange·namedate는 두 칼럼짜리라 "값 하나"를 받는 이 도구에서는 **종료일 쪽**을 기본으로 잡는다
    // (담당자가 실제로 궁금한 건 "언제 끝나나"다 — §7 배지 잣대와 같은 무게).
    if (bySchema.key === "subscription") return { column: "subEnd", label: "구독 종료일", isDate: true };
    if (bySchema.key === "extension") return { column: "extEnd", label: "유상 연장 종료일", isDate: true };
    return { column: bySchema.key as PatchableFieldKey, label: bySchema.label, isDate: DATE_COLUMNS.has(bySchema.key as PatchableFieldKey) };
  }
  if (/협력사|담당자|연락처|공급\s*업체/.test(t)) return { column: "vendorContact", label: "협력사·담당자 연락처", isDate: false };
  if (/구독.*시작/.test(t)) return { column: "subStart", label: "구독 시작일", isDate: true };
  if (/구독/.test(t)) return { column: "subEnd", label: "구독 종료일", isDate: true };
  if (/유지\s*보수/.test(t)) return { column: "maintenanceEnd", label: "유지보수 종료일(영구)", isDate: true };
  if (/EOS/i.test(t) || /판매\s*종료/.test(t)) return { column: "eos", label: "EOS(판매 종료일)", isDate: true };
  if (/EOL/i.test(t) || /지원\s*종료/.test(t)) return { column: "eol", label: "EOL(지원 종료일)", isDate: true };
  if (/연장.*(이름|업체|명)/.test(t)) return { column: "extName", label: "유상 연장 이름", isDate: false };
  if (/연장/.test(t)) return { column: "extEnd", label: "유상 연장 종료일", isDate: true };
  if (/근거|확인일/.test(t)) return { column: "evidence", label: "근거·확인일", isDate: false };
  if (/비고/.test(t)) return { column: "note", label: "비고", isDate: false };
  if (/계약.*(만료|종료)/.test(t)) return { column: "eol", label: "EOL(지원 종료일)", isDate: true }; // 일반 "계약 만료일"은 지원종료(EOL)로 본다
  if (/라이선스|라이센스/.test(t)) return { column: "licenseType", label: "라이선스 종류", isDate: false };
  return null;
}

// ── 날짜 함수(문자열 비교 — 표준시 흔들림 없음) ────────────────────────────────
export function 오늘글(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const 날짜꼴 = /^\d{4}-\d{2}-\d{2}$/;

export function 남은일수(날짜글: string, 오늘: string = 오늘글()): number | null {
  const raw = (날짜글 ?? "").trim();
  if (!날짜꼴.test(raw)) return null;
  const a = Date.parse(`${raw}T00:00:00`);
  const b = Date.parse(`${오늘}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

export interface 생애주기배지결과 {
  상태: "없음" | "확인필요" | "종료" | "임박" | "주의" | "여유";
  글: string;
  날짜: string | null;
  종류: string | null;
  dday: number | null;
  /** EOL이 없어 EOS로 대체했을 때만 채워진다 — 답·툴팁에 그대로 적는다(아래 상수 참조). */
  안내: string | null;
}

/**
 * EOL이 없어 EOS(판매 종료일)로 대신 판정했을 때 **사람에게 반드시 함께 말하는 문장**.
 *
 * ⚠ 2026-09-14 검토관 [중] — 이 문장은 GIJO_AS_용어사전.md가 「답에 함께 적습니다」라고
 *   약속해 놓고 실제로는 **어느 답에도 안 나왔다**(주석 한 줄에만 있었다). 용어사전은 RAG
 *   코퍼스에 실려 고객 답변 근거로 인용되므로, 없는 동작이 근거로 나가는 부류였다.
 *   판매 종료일과 지원 종료일은 뜻이 다른 날짜다 — 말없이 섞으면 담당자가 오해한다.
 */
export const EOS대체안내 = "EOL이 없어 EOS로 봤습니다";

/**
 * 계약·생애주기 배지 — 등록된 날짜 중 **가장 이른 것**을 "얼마나 급한가"로 본다.
 *
 * 유효지원종료 = extEnd ?? eol ?? eos (eos로 대체했으면 종류에 "EOS"를 적고, 답에도
 *   "EOL이 없어 EOS로 봤습니다"를 함께 적게 한다 — eol-seed.ts 우선순위 계승, §7).
 * 후보 = [subEnd, maintenanceEnd, 유효지원종료] 중 **남은일수가 null이 아닌 것만**.
 *
 * ⓜ 폴백 — 행 자체가 없으면 "없음"("등록된 계약이 없습니다"), 행은 있는데 후보가 0개면
 *   "확인필요"("⚠ 확인 필요") — **절대 0일·종료로 치지 않는다.**
 */
export function 생애주기배지(row: LifecycleRow | null, 오늘: string = 오늘글()): 생애주기배지결과 {
  if (!row) return { 상태: "없음", 글: "등록된 계약이 없습니다", 날짜: null, 종류: null, dday: null, 안내: null };

  const 후보: { 날짜: string; 종류: string; dday: number }[] = [];
  const 담기 = (날짜: string | null, 종류: string) => {
    const d = 남은일수(날짜 ?? "", 오늘);
    if (d !== null) 후보.push({ 날짜: 날짜 as string, 종류, dday: d });
  };
  담기(row.subEnd, "구독");
  담기(row.maintenanceEnd, "유지보수");
  // 유효지원종료 = extEnd ?? eol ?? eos(대체 시 종류에 EOS 표기)
  if (남은일수(row.extEnd ?? "", 오늘) !== null) 담기(row.extEnd, "지원종료");
  else if (남은일수(row.eol ?? "", 오늘) !== null) 담기(row.eol, "지원종료");
  else if (남은일수(row.eos ?? "", 오늘) !== null) 담기(row.eos, "EOS");

  if (후보.length === 0) return { 상태: "확인필요", 글: "⚠ 확인 필요", 날짜: null, 종류: null, dday: null, 안내: null };

  후보.sort((a, b) => a.dday - b.dday);
  const 이른것 = 후보[0];
  // EOS로 대체해 판정했으면 **그 사실을 답에 실어 보낸다**(2026-09-14 검토관 [중] 수리).
  const 안내 = 이른것.종류 === "EOS" ? EOS대체안내 : null;
  const 공통 = { 날짜: 이른것.날짜, 종류: 이른것.종류, dday: 이른것.dday, 안내 };
  if (이른것.dday < 0) return { 상태: "종료", 글: "지원 종료", ...공통 };
  if (이른것.dday <= 임박일) return { 상태: "임박", 글: `D-${이른것.dday}`, ...공통 };
  if (이른것.dday <= 주의일) return { 상태: "주의", 글: `D-${이른것.dday}`, ...공통 };
  return { 상태: "여유", 글: "", ...공통 };
}

const ROW_COLUMNS = [
  "id", "targetType", "targetId", "vendorContact", "licenseType", "subStart", "subEnd",
  "maintenanceEnd", "eos", "eol", "extName", "extEnd", "evidence", "note", "updatedBy",
  "createdAt", "updatedAt",
] as const;

const getStmt = db.prepare(`SELECT ${ROW_COLUMNS.join(", ")} FROM asset_lifecycle WHERE targetType = ? AND targetId = ?`);

export function getLifecycle(targetType: LifecycleTargetType, targetId: string): LifecycleRow | null {
  const row = getStmt.get(targetType, targetId) as LifecycleRow | undefined;
  return row ?? null;
}

const allRowsStmt = db.prepare(`SELECT ${ROW_COLUMNS.join(", ")} FROM asset_lifecycle`);

/** 등록된 계약 전부(대상 종류·dday 상관없이) — "몇 건 등록됐나" 같은 전체 집계에 쓴다. */
export function listAllLifecycle(): LifecycleRow[] {
  return allRowsStmt.all() as LifecycleRow[];
}

const upsertStmt = db.prepare(`
  INSERT INTO asset_lifecycle (id, targetType, targetId, vendorContact, licenseType, subStart, subEnd,
    maintenanceEnd, eos, eol, extName, extEnd, evidence, note, updatedBy, createdAt, updatedAt)
  VALUES (@id, @targetType, @targetId, @vendorContact, @licenseType, @subStart, @subEnd,
    @maintenanceEnd, @eos, @eol, @extName, @extEnd, @evidence, @note, @updatedBy, @createdAt, @updatedAt)
  ON CONFLICT(targetType, targetId) DO UPDATE SET
    vendorContact = excluded.vendorContact, licenseType = excluded.licenseType,
    subStart = excluded.subStart, subEnd = excluded.subEnd, maintenanceEnd = excluded.maintenanceEnd,
    eos = excluded.eos, eol = excluded.eol, extName = excluded.extName, extEnd = excluded.extEnd,
    evidence = excluded.evidence, note = excluded.note, updatedBy = excluded.updatedBy,
    updatedAt = excluded.updatedAt
`);

const PATCHABLE_KEYS: PatchableFieldKey[] = [
  "vendorContact", "licenseType", "subStart", "subEnd", "maintenanceEnd", "eos", "eol",
  "extName", "extEnd", "evidence", "note",
];

/** patch에 키가 없으면 기존 값을 유지, 있으면 빈 문자열은 NULL로 정규화한다(계약 표 ①). */
function 정규화(v: string | undefined, 기존: string | null): string | null {
  if (v === undefined) return 기존;
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/** upsert — 대상당 1행(v1, 이력은 감사로그가 대신한다·§13). */
export function saveLifecycle(
  targetType: LifecycleTargetType,
  targetId: string,
  patch: Partial<LifecycleRow>,
  actor?: string
): LifecycleRow {
  const 기존 = getLifecycle(targetType, targetId);
  const now = Date.now();
  const row: LifecycleRow = {
    id: 기존?.id ?? randomUUID(),
    targetType,
    targetId,
    vendorContact: null, licenseType: null, subStart: null, subEnd: null, maintenanceEnd: null,
    eos: null, eol: null, extName: null, extEnd: null, evidence: null, note: null,
    updatedBy: actor ?? 기존?.updatedBy ?? null,
    createdAt: 기존?.createdAt ?? now,
    updatedAt: now,
  };
  for (const k of PATCHABLE_KEYS) row[k] = 정규화(patch[k] as string | undefined, 기존?.[k] ?? null);
  upsertStmt.run(row);
  return row;
}

interface DueRawRow {
  targetType: LifecycleTargetType;
  targetId: string;
  이름: string | null;
  subEnd: string | null;
  maintenanceEnd: string | null;
  eos: string | null;
  eol: string | null;
  extEnd: string | null;
}

// 이름 조회 — securityproducts.ts·assets.ts를 부르지 않고(순환 금지) 여기서 직접 SQL로 한다.
const dueRowsStmt = db.prepare(`
  SELECT l.targetType AS targetType, l.targetId AS targetId,
    CASE WHEN l.targetType = 'product' THEN (SELECT name FROM security_products WHERE id = l.targetId)
         ELSE (SELECT COALESCE(displayName, name) FROM assets WHERE id = l.targetId) END AS 이름,
    l.subEnd AS subEnd, l.maintenanceEnd AS maintenanceEnd, l.eos AS eos, l.eol AS eol, l.extEnd AS extEnd
  FROM asset_lifecycle l
`);

/**
 * 만료 임박 목록 — **만료 임박 수를 세는 유일한 자리**. 화면 열·KPI·오늘의 할 일·도구가
 * 전부 이 함수 하나를 부른다(사본 방지, eol-seed guessCategory export 주석과 같은 원칙).
 * 정렬: dday 오름차순(종료가 먼저).
 */
export function listLifecycleDueSoon(days: number = 주의일): LifecycleDue[] {
  const 오늘 = 오늘글();
  const rows = dueRowsStmt.all() as DueRawRow[];
  const out: LifecycleDue[] = [];
  for (const r of rows) {
    const badge = 생애주기배지(배지용행(r), 오늘);
    if (badge.dday === null || badge.날짜 === null || badge.종류 === null) continue; // 확인필요·없음은 이 목록엔 안 낸다(dday가 없어 정렬·비교가 안 된다)
    if (badge.상태 !== "종료" && badge.상태 !== "임박" && badge.상태 !== "주의") continue; // "여유"는 이 목록엔 안 낸다(days를 크게 준 호출도 방어)
    if (badge.dday > days) continue;
    out.push({
      targetType: r.targetType,
      targetId: r.targetId,
      이름: r.이름 ?? r.targetId,
      날짜: badge.날짜,
      종류: badge.종류,
      dday: badge.dday,
      상태: badge.상태 as "종료" | "임박" | "주의",
      안내: badge.안내,
    });
  }
  out.sort((a, b) => a.dday - b.dday);
  return out;
}

/** DueRawRow(날짜 칸만 뽑은 행) → 배지 계산용 LifecycleRow. 두 목록 함수가 같은 잣대를 쓴다. */
function 배지용행(r: DueRawRow): LifecycleRow {
  return {
    id: "", targetType: r.targetType, targetId: r.targetId,
    vendorContact: null, licenseType: null, subStart: null, subEnd: r.subEnd,
    maintenanceEnd: r.maintenanceEnd, eos: r.eos, eol: r.eol, extName: null, extEnd: r.extEnd,
    evidence: null, note: null, updatedBy: null, createdAt: 0, updatedAt: 0,
  };
}

/**
 * 등록된 대상 **전부**의 배지(여유·확인필요 포함) — 화면이 「없음·확인필요·여유·임박」을
 * 갈라 그리는 유일한 원천이다(2026-09-14 검토관 [상] 수리).
 * ⚠ 판정 자체는 `생애주기배지` 하나가 한다 — 여기서 30·90을 다시 세지 않는다.
 */
export function listLifecycleBadges(): LifecycleBadgeEntry[] {
  const 오늘 = 오늘글();
  return (dueRowsStmt.all() as DueRawRow[]).map((r) => {
    const badge = 생애주기배지(배지용행(r), 오늘);
    return {
      targetType: r.targetType,
      targetId: r.targetId,
      이름: r.이름 ?? r.targetId,
      상태: badge.상태,
      글: badge.글,
      날짜: badge.날짜,
      종류: badge.종류,
      dday: badge.dday,
      안내: badge.안내,
    };
  });
}

// ── REST 경로 (계약 표 ③) ────────────────────────────────────────────────────
function isTargetType(v: unknown): v is LifecycleTargetType {
  return v === "asset" || v === "product";
}

function fieldsFromRow(row: LifecycleRow | null): { key: string; label: string; value: string }[] {
  return LIFECYCLE_FIELD_SCHEMA.map((f) => {
    let value = "";
    if (row) {
      switch (f.key) {
        case "subscription":
          value = row.subStart || row.subEnd ? `${row.subStart ?? ""}~${row.subEnd ?? ""}` : "";
          break;
        case "extension":
          value = row.extName || row.extEnd ? `${row.extName ?? ""}|${row.extEnd ?? ""}` : "";
          break;
        default:
          value = (row as unknown as Record<string, string | null>)[f.key] ?? "";
      }
    }
    return { key: f.key, label: f.label, value };
  });
}

// 대상 이름 조회 — 없으면 null(=그런 대상이 없다). POST 방어와 감사 로그 두 곳이 쓴다.
const 제품이름Stmt = db.prepare("SELECT name FROM security_products WHERE id = ?");
const 자산이름Stmt = db.prepare("SELECT COALESCE(displayName, name) AS name FROM assets WHERE id = ?");

/**
 * ⚠ 2026-09-14 검토관 [하] 수리 — 형제 창구(securityproducts.ts 정형 정보)는 없는 id면 404로
 *   막는데 여기는 안 막아, 오타·삭제된 id로도 행이 생겼다. 그 고아 행은 이름을 못 찾아
 *   `이름 ?? targetId`로 살아남아 **오늘의 할 일·KPI·도구 답에 내부 id를 그대로 노출**했다.
 */
function 대상이름(targetType: LifecycleTargetType, targetId: string): string | null {
  const stmt = targetType === "product" ? 제품이름Stmt : 자산이름Stmt;
  const row = stmt.get(targetId) as { name?: string | null } | undefined;
  return row?.name ?? null;
}

export function registerLifecycleRoutes(app: Express): void {
  app.get("/api/lifecycle/:targetType/:targetId", authMiddleware, (req: Request, res: Response) => {
    const targetType = req.params.targetType;
    if (!isTargetType(targetType)) {
      res.status(400).json({ error: "대상 종류는 asset 또는 product입니다" });
      return;
    }
    const row = getLifecycle(targetType, String(req.params.targetId));
    res.json({ row, fields: fieldsFromRow(row), badge: 생애주기배지(row) });
  });

  app.post("/api/lifecycle/:targetType/:targetId", authMiddleware, (req: Request, res: Response) => {
    const targetType = req.params.targetType;
    if (!isTargetType(targetType)) {
      res.status(400).json({ error: "대상 종류는 asset 또는 product입니다" });
      return;
    }
    const targetId = String(req.params.targetId);
    const 이름 = 대상이름(targetType, targetId);
    if (!이름) {
      res.status(404).json({ error: `그런 ${targetType === "product" ? "보안제품" : "자산"}이 없습니다: ${targetId}` });
      return;
    }
    const fields = Array.isArray(req.body?.fields) ? (req.body.fields as { key: string; value: string }[]) : [];
    const patch: Partial<LifecycleRow> = {};
    for (const f of fields) {
      const key = String(f?.key ?? "");
      const value = String(f?.value ?? "");
      if (key === "subscription") {
        const [subStart, subEnd] = value.split("~");
        patch.subStart = subStart ?? "";
        patch.subEnd = subEnd ?? "";
      } else if (key === "extension") {
        const [extName, extEnd] = value.split("|");
        patch.extName = extName ?? "";
        patch.extEnd = extEnd ?? "";
      } else if (PATCHABLE_KEYS.includes(key as PatchableFieldKey)) {
        (patch as Record<string, string>)[key] = value;
      }
    }
    const actor = (req as Request & { user?: { displayName?: string; username?: string } }).user;
    const row = saveLifecycle(targetType, targetId, patch, actor?.displayName ?? actor?.username);
    // ⚠ target은 **사람이 읽는 이름**이다(계약 표 ③). 내부 id로 남기면 작업 기록에서
    //   「product:9f3c-…의 계약·생애주기 저장」이 돼 무엇을 고쳤는지 추적이 안 된다
    //   (2026-09-14 검토관 [하]). 이름을 못 찾는 경우는 위에서 404로 이미 막았다.
    recordAudit({ kind: "write", action: "계약·생애주기 저장", actor: actor?.displayName ?? actor?.username ?? null, target: 이름 });
    res.json({ row, fields: fieldsFromRow(row), badge: 생애주기배지(row) });
  });

  app.get("/api/lifecycle/due", authMiddleware, (req: Request, res: Response) => {
    const days = Number(req.query.days) || 주의일;
    const items = listLifecycleDueSoon(days);
    const counts = {
      임박: items.filter((i) => i.상태 === "임박" || i.상태 === "종료").length,
      주의: items.filter((i) => i.상태 === "주의").length,
    };
    // ⚠ `등록`은 **등록된 대상 전부**(여유·확인필요 포함)다 — 화면이 items만 보고 그리면
    //   90일 밖·날짜 못 읽는 계약을 「등록된 계약이 없습니다」로 말한다(검토관 [상] 수리).
    res.json({ items, counts, 등록: listLifecycleBadges() });
  });
}
