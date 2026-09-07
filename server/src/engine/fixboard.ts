// engine/fixboard.ts — 「고칠 것」의 **잣대 한 곳**. 지적 하나가 어느 갈래인지, 기간별로 몇 건인지.
// (계획서 중-1 「파일럿 실사용 피드백 루프」의 두 번째 원장 — 2026-09-07 통합 설계관 S-A V1)
//
// ■ 왜 answerfeedback.ts가 아니라 별도 잎인가
//   answerfeedback.ts는 표·라우트를 갖는다. 갈래 잣대는 **결재판·감독 화면·대화 도구 셋**이 같이 쓴다.
//   셋이 각자 판정하면 반드시 어긋난다(이 저장소 반복 유형) — 그래서 docorigin.ts처럼 잎으로 뺀다.
//   import는 `../db`(집계에 필요)와 noevidence의 **타입**뿐이다. 배너 문장 상수는 **베끼지 않는다.**
//
// ■ 이 파일이 절대 안 하는 것 — **답 글자를 다시 판정하지 않는다.**
//   근거 없음은 dispatcher 출구(:760~767)가 이미 판정해 답에 실어 보낸 값이다. 저장된 답으로
//   다시 판정하면 **배너억제 갈래를 원리상 재현 못 한다**(그 갈래는 배너가 아예 없는 답이다).
//   그래서 여기는 「그때 실려 나간 값(noev)」을 받아 갈래로 옮기기만 한다.
//
// ■ rule·prod은 **어떤 입력으로도 자동으로 안 나온다**(사람만 정한다).
//   옛 설계는 「배너가 없으면 제품 잘못」으로 굳혔는데, 실측하면 지적의 98%가 배너 없는 답이라
//   전부 개발팀으로 쏟아진다. 모르면 **미분류(null)**로 둔다 — 모르는 것을 아는 척하지 않는다.
import { db } from "../db";
import type { 근거없음종류 } from "./noevidence";

/** 고칠 것의 갈래 — 담당자가 **무엇을 해야 닫히는가**로 가른다. */
export type 고칠것갈래값 = "doc" | "rule" | "prod";

/** 화면·챗봇이 쓰는 한글 이름. 갈래 이름을 두 곳에 적지 않는다. */
export const 고칠것갈래라벨: Record<고칠것갈래값 | "unclassified", string> = {
  doc: "자료 부족",
  rule: "사내 규정",
  prod: "제품",
  unclassified: "미분류",
};

/**
 * 근거없음 값 집합 — **글자를 베끼는 것이 아니라 타입으로 못 박는다.**
 *
 * `Record<근거없음종류, true>`라서 noevidence.ts가 배너를 6종으로 늘리는 순간 **여기서 tsc가
 * 빨개진다**(빠진 키). 값 하나를 오타 내도 빨개진다. 배열을 손으로 적어 두면 조용히 늙는데,
 * 이 꼴은 컴파일이 막는다 — 「같은 것을 여러 곳에 적으면 어긋난다」를 코드로 막은 자리.
 */
const 근거없음종류표: Record<근거없음종류, true> = {
  자료없음: true,
  자료요청: true,
  지정범위: true,
  근거약함: true,
  숫자무근거: true,
};
export const 근거없음종류값들: readonly 근거없음종류[] = Object.keys(근거없음종류표) as 근거없음종류[];

/** 클라가 보낸 noev가 진짜 값인가 — 밖이면 null. **클라 값을 그대로 믿지 않는다.** */
export function 근거없음값검증(v: unknown): 근거없음종류 | null {
  return typeof v === "string" && (근거없음종류값들 as readonly string[]).includes(v)
    ? (v as 근거없음종류)
    : null;
}

/** 지적 하나의 갈래 판정 입력. kind는 **후보 제시**에만 쓰고 자동 판정에는 안 쓴다(아래 주석). */
export interface 고칠것판정입력 {
  /** 담당자가 고른 지적 종류(wrong·missing·style) — 자동 판정에는 안 쓴다. */
  kind?: string;
  /** 그 답에 실려 나간 근거없음 종류(dispatcher 출구 값). 없으면 undefined·null. */
  noev?: unknown;
}

/**
 * 자동 갈래 — **noev 하나만 본다.**
 *
 * 배너가 붙어 있었다는 것은 「가리킬 사내 근거가 없다」를 제품이 **이미 담당자에게 말했다**는 뜻이라,
 * 그 지적은 자료를 넣으면 닫힌다(doc). 그 밖은 전부 **미분류**다 — 규정 문제인지 제품 결함인지는
 * 답만 봐서는 못 가른다(사내 규정을 아는 사람만 안다). 그래서 rule·prod은 사람이 손으로 고른다.
 *
 * ⚠ kind로는 판정하지 않는다: 「틀림(wrong)」이 규정 문제일 수도 제품 결함일 수도 있어서다.
 *   kind가 주는 것은 **후보**뿐이고 그건 아래 고칠것후보()가 따로 답한다.
 */
export function 고칠것갈래(입력: 고칠것판정입력): 고칠것갈래값 | null {
  return 근거없음값검증(입력.noev) ? "doc" : null;
}

/**
 * 담당자에게 **먼저 보여 줄 후보** — 고르는 것은 사람이다(저장 값이 아니다).
 * 못 찾음(missing)은 자료를 넣으면 닫힐 때가 많고, 말투(style)는 제품이 고칠 일이다.
 * 틀림(wrong)은 후보를 안 낸다 — 셋 중 어디로든 가는 갈래라 찍어 주면 사람이 그대로 누른다.
 */
export function 고칠것후보(kind: string | undefined): 고칠것갈래값 | null {
  if (kind === "missing") return "doc";
  if (kind === "style") return "prod";
  return null;
}

/** 갈래 값이 허용 집합 안인가 — 라우트 400 판정과 저장 판정이 **같은 함수**를 쓴다. */
export function 고칠것갈래검증(v: unknown): 고칠것갈래값 | null {
  return v === "doc" || v === "rule" || v === "prod" ? v : null;
}

// ── 인용 조각(초안 재료) ────────────────────────────────────────────────
// 접수할 때 **본문 그대로** 얼려 저장한다. 조각 id 포인터는 안 된다 —
// 재인입(reingest_document)이 옛 조각을 지우고 다시 넣으면 포인터가 끊긴다(통합 설계관 ⑧).

/** 답이 인용한 조각 한 개. dispatcher SourceQuote와 같은 꼴이되 여기서 다시 선언한다(잎 유지). */
export interface 인용조각 {
  documentId: string;
  text: string;
  title?: string;
}

/** 상한 — 표에 사내 문서 원문이 통째로 실리지 않게 한다(무게·유출 둘 다). */
export const 인용상한 = { 조각: 3, 조각글자: 600, 총글자: 2000 } as const;

/**
 * 클라가 보낸 인용을 **서버가 자른다.** 상한 밖이면 잘라서 넣지 버리지 않는다 —
 * 초안 재료가 통째로 사라지면 「초안 없음」이 되어 담당자가 이유를 못 찾는다.
 * 값이 아예 인용 꼴이 아니면 null(=재료 없음).
 */
export function 인용정제(v: unknown): 인용조각[] | null {
  if (!Array.isArray(v)) return null;
  const out: 인용조각[] = [];
  let 총 = 0;
  for (const raw of v) {
    if (out.length >= 인용상한.조각) break;
    if (!raw || typeof raw !== "object") continue;
    const q = raw as { documentId?: unknown; text?: unknown; title?: unknown };
    const documentId = typeof q.documentId === "string" ? q.documentId : "";
    const 본문 = typeof q.text === "string" ? q.text : "";
    if (!documentId || !본문.trim()) continue;
    const 남은 = 인용상한.총글자 - 총;
    if (남은 <= 0) break;
    const text = 본문.slice(0, Math.min(인용상한.조각글자, 남은));
    총 += text.length;
    out.push({ documentId, text, ...(typeof q.title === "string" && q.title ? { title: q.title.slice(0, 200) } : {}) });
  }
  return out.length ? out : null;
}

/** 저장된 인용 JSON을 되읽는다 — 깨져 있으면 null(옛 행·손댄 행에서 라우트가 죽지 않게). */
export function 인용읽기(json: string | null | undefined): 인용조각[] | null {
  if (!json) return null;
  try {
    return 인용정제(JSON.parse(json));
  } catch {
    return null;
  }
}

// ── 집계 ────────────────────────────────────────────────────────────────

/** 미처리(open)만 「열림」이다. promoted·dismissed·resolved는 전부 닫힌 것으로 센다. */
const 열린상태 = "open";

export interface 고칠것갈래집계 {
  fixkind: 고칠것갈래값 | "unclassified";
  open: number;
  closed: number;
  total: number;
}

export interface 고칠것요약값 {
  days: number;
  total: number;
  open: number;
  closed: number;
  /** 네 갈래를 **늘 전부** 싣는다 — 0건이어도 회색으로 그려야 「사라지는 조작」이 안 생긴다. */
  kinds: 고칠것갈래집계[];
  /** 지적 종류(wrong·missing·style)별 건수 — 주간 요약이 쓰던 그 숫자를 같은 질의에서 낸다. */
  byKind: Record<string, number>;
}

const 갈래순서: (고칠것갈래값 | "unclassified")[] = ["doc", "rule", "prod", "unclassified"];

/**
 * 기간별 집계 — **listFeedback을 쓰지 않는다.**
 *
 * ⚠ listFeedback은 LIMIT 200이다. 그걸로 세면 201건째부터 숫자가 굳는다
 *   (「200 포화, 실제 1578」이 이 저장소에서 실제로 난 사고다). 세는 일은 SQL이 한다.
 * ⚠ 한 질의로 fixkind·status·kind를 **함께** 뽑는다 — 세는 곳이 둘이 되면 두 숫자가 어긋난다.
 */
export function 고칠것요약(days = 7): 고칠것요약값 {
  const since = Date.now() - Math.max(0, days) * 86400000;
  const rows = db
    .prepare(
      `SELECT kind, COALESCE(fixkind, 'unclassified') AS fixkind, status, COUNT(*) AS n
         FROM answer_feedback WHERE at >= ? GROUP BY kind, fixkind, status`
    )
    .all(since) as { kind: string; fixkind: string; status: string; n: number }[];

  const 통 = new Map<string, 고칠것갈래집계>();
  for (const k of 갈래순서) 통.set(k, { fixkind: k, open: 0, closed: 0, total: 0 });
  const byKind: Record<string, number> = {};
  let total = 0;
  let open = 0;
  for (const r of rows) {
    const 키 = (고칠것갈래검증(r.fixkind) ?? "unclassified") as 고칠것갈래값 | "unclassified";
    const 칸 = 통.get(키)!;
    const 열림 = r.status === 열린상태;
    칸.total += r.n;
    if (열림) 칸.open += r.n; else 칸.closed += r.n;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.n;
    total += r.n;
    if (열림) open += r.n;
  }
  return { days, total, open, closed: total - open, kinds: 갈래순서.map((k) => 통.get(k)!), byKind };
}

export interface 고칠것최근줄 {
  id: number;
  at: number;
  kind: string;
  fixkind: 고칠것갈래값 | null;
  status: string;
  /** 질문 앞 40자 — 감독 화면은 목록이 아니라 **신호**다. 전체는 결재판에서 본다. */
  q: string;
}

/** 최근 N건 — 감독 화면의 5줄. 본문·인용은 **안 싣는다**(감독 화면은 등급 게이트 밖이다). */
export function 고칠것최근(days = 7, limit = 5): 고칠것최근줄[] {
  const since = Date.now() - Math.max(0, days) * 86400000;
  const rows = db
    .prepare("SELECT id, at, kind, fixkind, status, question FROM answer_feedback WHERE at >= ? ORDER BY at DESC LIMIT ?")
    .all(since, Math.min(Math.max(limit, 1), 50)) as
    { id: number; at: number; kind: string; fixkind: string | null; status: string; question: string }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    fixkind: 고칠것갈래검증(r.fixkind),
    status: r.status,
    q: String(r.question ?? "").slice(0, 40),
  }));
}
