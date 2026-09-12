// engine/today.ts — "오늘의 할일" 가이드형 집계 (사무실 창 시안 C, 2026-07-21 확정)
//
// 목적: 1인 보안담당자가 아침에 이 화면만 보면 오늘 할 일을 안다. 목록을 읽고 판단하는 게 아니라,
//       무엇이 문제이고 왜 지금이며 무엇을 하면 되는지까지 화면이 제시하고 담당자는 **고르기만** 한다.
//
// 설계 원칙(사용자 확정 — 어기면 안 됨):
//  ① 숫자·기한·우선순위는 전부 여기서 **규칙으로 계산**한다. LLM은 문장만 쓴다.
//     (실측 2026-07-21: 7B가 "KEV는 Common Vulnerabilities and Exposures의 약자"라고 3/3 오답.
//      사실 판단을 모델에 맡기면 안 된다. 계산된 값을 문장에 끼워 넣는다.)
//  ② 원천을 복제하지 않는다. tasks 테이블에 복사하면 조치 완료 후에도 할일이 남는다.
//     세 원천을 호출 시점에 조회해 합친다 — 원천이 진실이고 이 응답은 뷰다.
//  ③ KEV는 기한과 무관하게 항상 최상단. CISA 관행(KEV는 기존 패치 큐를 건너뛴다)을 그대로 따른다.
//  ④ 두 축(취약점=이벤트 / 장비운영=주기)을 한 목록에 섞지 않는다. 매일 반복되는 점검이
//     급한 KEV를 밀어내면 안 된다.
//
// 데이터가 없는 축은 조용히 생략한다 — 정기점검 예약(hardening_schedules)이 아직 0건이라
// 장비 축이 비어 있어도 화면은 취약점 축만으로 정상 동작해야 한다(사용자 결정: 단계적 도입).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { prioritizedReviews } from "./approvals";
import { listSchedules } from "./hardeningtargets";
import { listMaintenanceItems } from "./maintenance";
import { epss값표기 } from "./tone";

// 한 건의 "오늘 할 일". 화면은 이걸 그대로 렌더한다(추가 판단 없이).
export interface TodayItem {
  id: string;
  axis: "vuln" | "device"; // 취약점(이벤트) / 보안장비 운영(주기)
  urgency: "now" | "today"; // 🔴 지금 / 🟡 오늘
  title: string;
  subtitle: string; // 자산·제품 등 대상
  why: string; // 왜 지금인지 — 근거(규칙으로 계산된 사실만). 화면 표시용 불릿 문자열.
  action: string; // 무엇을 하면 되는지 — 추천 조치
  badges: string[]; // KEV, 2일 초과, 분기 도래 …
  ref?: string; // 클릭 시 이동 대상(assetId 등)
  // 아래는 문장 조립용 구조화 값 — why(불릿)를 문장에 그대로 박으면 어색해서 따로 둔다.
  kev?: boolean;
  epssLabel?: string; // tone.epss값표기 산출물 그대로("97%"·"1% 미만"·"0%") — 반올림은 여기서 안 한다
}

export interface TodayBrief {
  items: TodayItem[];
  counts: { now: number; today: number; later: number };
  // 화면 상단 브리핑 문장. LLM이 쓰지만 숫자는 여기서 계산해 넘긴 값만 쓴다.
  // LLM 실패 시 fallback 문장이 들어간다(화면이 LLM에 인질이 되면 안 된다).
  brief: string;
  briefBy: "llm" | "rule"; // 정직하게 표시 — 규칙 폴백이면 화면도 그렇게 알 수 있다
  generatedAt: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" → epoch(그 날 23:59:59). 파싱 실패면 null. */
function endOfDay(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 기한 대비 며칠 지났는지/남았는지 — 사람이 읽는 문구로. */
function dueLabel(dueAt: number, now: number): { label: string; overdueDays: number } {
  const diff = dueAt - now;
  if (diff < 0) {
    const days = Math.max(1, Math.floor(-diff / DAY));
    return { label: `기한 ${days}일 초과`, overdueDays: days };
  }
  if (dueAt <= endOfToday()) return { label: "오늘 기한", overdueDays: 0 };
  return { label: `D-${Math.ceil(diff / DAY)}`, overdueDays: 0 };
}

// ── 취약점 축 ───────────────────────────────────────────────────────────────
// 개별 finding을 그대로 올리면 화면이 무너진다. 실측(2026-07-21 운영): Nessus 스캔 결과에서
// KEV만 20건이 떴고 그중 6건이 같은 자산의 Oracle CPU 패치였다 — 담당자가 실제로 하는 일은
// "Oracle DB에 분기 패치 한 번"인데 화면은 20줄을 들이밀었다. "선택만 하면 되는" 목표가 무너진다.
//
// 그래서 **자산 × 제품(조치 단위)**로 묶는다. 실데이터 514건 → 그룹 324개, 상위는
// Oracle Database Server 28건·RHEL 154건·Apache Log4j 7건이 각각 한 줄로 접힌다.

// 제품/컴포넌트 이름만 남기는 정규화 — 버전·CVE·점검일자·취약점 유형어를 떼면 같은 조치로 묶인다.
// 규칙은 실제 finding_type 323종으로 검증했다(추측 아님).
const GROUP_CUTS: RegExp[] = [
  /\s*\(/, // 괄호부터 — (CVE-…), (Apr 2024 CPU), (Nix)
  /\s+[<>]=?\s/, // "< 2.15.0"
  /\s+\d+(\.\d+)*(\.x)?(\s|$)/, // "2.x", "1.x", "9.6"
  /\s+(Multiple Vulnerabilities|Remote Code Execution|RCE|Denial of Service|Buffer Overflow|Path Traversal|Information Disclosure|File Existence Disclosure|Out-of-Bounds Read|Container Escape|SEoL)/i,
  /\s+(원격 코드 실행|버전 정보 노출|사용자 열거|권한 상승|정보 노출)/,
];

/** finding 이름 → 조치 단위 이름(제품명). 너무 짧아지면 원문 유지(과도한 병합 방지). */
export function groupNameFor(findingType: string): string {
  const s = (findingType ?? "").trim();
  let cut = s.length;
  for (const re of GROUP_CUTS) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  const name = s.slice(0, cut).trim().replace(/[,\-–—:]+$/, "");
  return name.length >= 3 ? name : s;
}

// 대상 호스트 1대당 1줄로 묶는다(사용자 요청 2026-07-23): 브리핑은 "쉬운 내용"이 목표이므로
// 제품(패치) 단위보다 "이 호스트에 취약점 점검이 필요하다"가 담당자에게 더 직관적이다.
// 제품명들은 why의 "대상:"에 요약해 남긴다(상세는 취약점 화면).
interface HostVulnGroup {
  assetId: string;
  assetName: string;
  count: number;
  kev: boolean;
  kevCount: number;
  maxEpss: number | null;
  worstSeverity: string;
  earliestDue: number | null;
  assignee?: string;
}

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function vulnItems(now: number): TodayItem[] {
  const groups = new Map<string, HostVulnGroup>();

  for (const r of prioritizedReviews(500)) {
    if (r.status === "approved") continue; // 이미 조치 승인된 건 오늘 할 일이 아니다
    const f = r.finding;
    const key = r.assetId; // 대상 호스트 단위로 묶는다
    const g =
      groups.get(key) ??
      ({
        assetId: r.assetId,
        assetName: r.assetName || r.assetId,
        count: 0,
        kev: false,
        kevCount: 0,
        maxEpss: null,
        worstSeverity: "",
        earliestDue: null,
      } as HostVulnGroup);

    g.count++;
    if ((f as { kev?: boolean }).kev) { g.kev = true; g.kevCount++; }
    const epss = (f as { epss?: number }).epss;
    if (typeof epss === "number") g.maxEpss = Math.max(g.maxEpss ?? 0, epss);
    if (f.severity && (SEV_RANK[f.severity] ?? 0) > (SEV_RANK[g.worstSeverity] ?? 0)) g.worstSeverity = f.severity;
    const dueAt = r.dueDate ? endOfDay(r.dueDate) : null;
    if (dueAt != null) g.earliestDue = g.earliestDue == null ? dueAt : Math.min(g.earliestDue, dueAt);
    if (r.assignee && !g.assignee) g.assignee = r.assignee;

    groups.set(key, g);
  }

  // 정렬 키(KEV·EPSS 원값)를 항목과 함께 들고 다닌다 — 아래 정렬이 **표시 글자**에서 숫자를
  // 되파지 않게 하려는 것이다(2026-09-12 검토관 적발, 자세한 이유는 정렬 주석에).
  const rows: { item: TodayItem; kev: boolean; epss: number }[] = [];
  for (const g of groups.values()) {
    const due = g.earliestDue != null ? dueLabel(g.earliestDue, now) : null;
    const overdue = due != null && due.overdueDays > 0;
    const dueToday = g.earliestDue != null && !overdue && g.earliestDue <= endOfToday();

    // KEV는 기한 무관 항상 노출(③). 그 외는 기한이 걸린 것만.
    if (!g.kev && !overdue && !dueToday) continue;

    const badges: string[] = [];
    if (g.kev) badges.push("KEV");
    badges.push(`${g.count}건`);
    if (due) badges.push(due.label);

    // EPSS 표기는 tone.ts 한 곳(epss값표기)에서만 반올림한다 — 여기서 다시 Math.round를 적으면
    // "0.5% 미만은 1% 미만" 규칙이 두 곳에 생겨 어긋난다(2026-09-11 today.ts:178/285 실사고).
    // 낱말은 "EPSS"가 아니라 "악용예측"을 유지한다(브리핑은 쉬운 말 계약, 위 ①).
    const epssLabel = g.maxEpss != null ? epss값표기(g.maxEpss) : "";

    // 근거는 계산된 사실만(호스트 요약) — 제품·취약점 이름은 넣지 않는다: "쉬운 내용"이 목표이고,
    // 이 문장이 LLM 브리핑 프롬프트로도 가므로 이름을 주면 모델이 목록을 복창한다(실측). 상세는 취약점 화면.
    const facts = [
      g.kev ? `실제 악용(KEV) ${g.kevCount}건` : "",
      `취약점 ${g.count}건`,
      g.worstSeverity ? `최고 심각도 ${g.worstSeverity}` : "",
      epssLabel ? `최고 악용예측 ${epssLabel}` : "",
      due ? due.label : "",
    ].filter(Boolean);

    rows.push({
      kev: g.kev,
      // 정렬용 원값. 값이 없는 호스트는 종전대로 0과 같은 자리에 둔다(정렬 한정 — 표기에서는 위에서 뺀다).
      epss: g.maxEpss ?? 0,
      item: {
        id: `vulnhost:${g.assetId}`,
        axis: "vuln",
        urgency: g.kev || overdue ? "now" : "today",
        title: "취약점 점검",
        subtitle: g.assetName, // 대상 호스트
        why: facts.join(" · "),
        action: g.assignee
          ? `담당 ${g.assignee} 배정됨 — 조치 확인 필요`
          : "이 호스트의 취약점을 AI 팀에 맡기거나 담당자를 지정하세요",
        badges,
        ref: g.assetId,
        kev: g.kev,
        epssLabel: epssLabel || undefined,
      },
    });
  }

  // 호스트 정렬: KEV 먼저 → 악용예측(EPSS 원값) 내림차순. 동점은 넣은 순서를 그대로 둔다
  // (넣은 순서 = approvals.prioritizedReviews의 우선순위 점수순이고, Array.sort는 안정 정렬이다).
  //
  // ⚠ **표시 글자에서 숫자를 되파지 않는다**(2026-09-12 검토관 적발). 여기 있던
  //   `Number(/(\d+)%/.exec(why))`는 정렬 기준을 화면 문장에서 뽑고 있었다 — 표기를
  //   「1% 미만」으로 바꾸자 EPSS 0.004가 1로 읽혀 0.012(「1%」)와 동점이 됐다(순서가 조용히 섞인다).
  //   표기는 앞으로도 바뀐다(tone.epss값표기가 단일 출처다). 값은 원값 한 곳에서만 읽는다.
  rows.sort((a, b) => {
    if (a.kev !== b.kev) return a.kev ? -1 : 1;
    return b.epss - a.epss;
  });
  return rows.map((r) => r.item);
}

// ── 보안장비 운영 축(주기) ──────────────────────────────────────────────────
// 취약점과 성격이 다르다: 새로 터지는 게 아니라 주기가 돌아온다. 놓치면 뚫리는 게 아니라
// 감사에서 걸린다(ISMS-P 2.10). 그래서 urgency는 "today"로 고정하고 구획을 나눈다.
function deviceItems(now: number): TodayItem[] {
  const out: TodayItem[] = [];

  // ① 하드닝 정기점검 — 예약 주기가 도래한 것
  for (const s of listSchedules()) {
    if (!s.enabled || s.nextRunAt > endOfToday()) continue;
    const overdueDays = Math.max(0, Math.floor((now - s.nextRunAt) / DAY));
    const lastLabel = s.lastRunAt ? `마지막 점검 ${Math.floor((now - s.lastRunAt) / DAY)}일 전` : "첫 점검";
    out.push({
      id: `hardening:${s.id}`,
      axis: "device",
      urgency: "today",
      // ⚠ 로컬 대상은 장비 이름을 단독으로 쓰지 않는다(2026-09-01 4차 검토 [중]) —
      //   「웹서버-01 하드닝 점검」이라 적으면 그 장비에 붙는 일로 읽힌다.
      title: `${s.원격 ? s.targetLabel : `이 서버(이름표: ${s.targetLabel})`} 하드닝 점검`,
      subtitle: `${s.standard.toUpperCase()} 기준 · ${lastLabel}`,
      why: overdueDays > 0 ? `점검 주기 ${overdueDays}일 초과` : "점검 주기 도래",
      action: "지금 점검을 실행하면 결과가 리포트에 남습니다",
      badges: [overdueDays > 0 ? `${overdueDays}일 초과` : "주기 도래"],
      ref: s.targetId,
    });
  }

  // ② 유지보수 점검 → "보안제품 관리"(사용자 요청 2026-07-23): 방화벽 정책 정기점검 등은
  //    보안제품 등록부(제품) 기준으로 본다. 제목=보안제품 관리, 대상=등록부 제품명,
  //    원래 점검 항목명(m.title)은 근거에 남긴다.
  for (const m of listMaintenanceItems()) {
    const dueAt = endOfDay(m.scheduleDate);
    if (m.status === "scheduled" && dueAt != null && dueAt <= endOfToday()) {
      const d = dueLabel(dueAt, now);
      out.push({
        id: `maint:${m.id}`,
        axis: "device",
        urgency: "today",
        title: "보안제품 관리",
        subtitle: m.productName, // 등록부 제품명
        why: `${m.title} — ${d.overdueDays > 0 ? `점검 예정일 ${d.overdueDays}일 지남` : "오늘 점검 예정"}`,
        action: "점검 후 결과를 등록하세요",
        badges: [d.label],
      });
    } else if (m.status === "reported") {
      out.push({
        id: `maint:${m.id}`,
        axis: "device",
        urgency: "today",
        title: "보안제품 관리",
        subtitle: m.productName, // 등록부 제품명
        why: `${m.title} — 점검 보고가 올라왔고 승인이 남았습니다`,
        action: "보고 내용을 확인하고 승인하세요",
        badges: ["승인 대기"],
      });
    }
  }
  return out;
}

/** LLM 없이도 항상 성립하는 브리핑 문장 — 계산된 값만 쓴다(폴백 겸 LLM 입력 근거). */
export function ruleBrief(items: TodayItem[]): string {
  const now = items.filter((i) => i.urgency === "now");
  const today = items.filter((i) => i.urgency === "today");
  if (items.length === 0) return "오늘 급한 일은 없습니다. 기한이 걸린 취약점도, 도래한 점검 주기도 없습니다.";

  const parts: string[] = [];
  if (now.length) {
    const kev = now.filter((i) => i.kev).length;
    // 전부 KEV면 "그중 N건" 표현이 군더더기가 된다.
    const kevPhrase =
      kev === 0 ? "" : kev === now.length ? " 모두 실제 악용이 확인된 취약점(KEV)입니다." : ` 그중 ${kev}건은 실제 악용이 확인된 취약점(KEV)입니다.`;
    parts.push(`오늘 급한 건 ${now.length}건이고,${kevPhrase || " 기한이 걸려 있습니다."}`.replace(",  ", ", "));

    // 최우선 한 건은 근거를 문장으로 — why(불릿)를 그대로 박지 않는다.
    const top = now[0];
    // epssLabel은 이미 tone.epss값표기 산출물("1% 미만" 포함)이라 %를 다시 붙이지 않는다.
    const reason = [top.kev ? "실제 악용이 확인" : "", top.epssLabel ? `악용예측 ${top.epssLabel}` : ""]
      .filter(Boolean)
      .join("·");
    parts.push(`먼저 ${top.subtitle}의 ${top.title}부터 처리하시길 권합니다${reason ? ` (${reason})` : ""}.`);
  }
  if (today.length) {
    const device = today.filter((i) => i.axis === "device").length;
    parts.push(device ? `그 외 점검 주기가 도래한 항목이 ${device}건 있습니다.` : `오늘 기한인 항목이 ${today.length}건 있습니다.`);
  }
  return parts.join(" ");
}

// ── 브리핑 후처리 ───────────────────────────────────────────────────────────
// 프롬프트에 "목록을 다시 나열하지 마라"를 넣어도 7B는 지키지 않았다(실측 2026-07-21:
// 항목 7개를 그대로 나열). 화면 바로 아래에 목록이 있으니 중복이고, 브리핑의 존재 이유
// (읽으면 상황을 아는 것)가 사라진다. 프롬프트를 더 붙이는 대신 규칙으로 검사한다.

const MAX_BRIEF_SENTENCES = 3;

/** 제목에서 집계 접미사를 뗀 핵심 이름 — 브리핑이 이 이름을 몇 개나 읊었는지 세는 데 쓴다. */
function coreName(title: string): string {
  return title.replace(/\s*패치\s*\(\d+건\)\s*$/, "").trim();
}

/** 화면에 이미 있는 항목명을 3개 이상 나열하면 "목록 복창"으로 본다.
 *  호스트 단위 집계 이후 제목은 "취약점 점검" 등으로 일반화됐으므로, 대상(호스트·제품명=subtitle)도
 *  함께 센다 — 모델이 대상 목록을 그대로 읊는 것을 잡는다. 중복 이름은 한 번만 센다. */
export function tooEnumerative(text: string, items: TodayItem[]): boolean {
  const names = new Set<string>();
  for (const i of items) {
    const t = coreName(i.title);
    if (t.length >= 4) names.add(t);
    if (i.subtitle && i.subtitle.length >= 4) names.add(i.subtitle);
  }
  const hits = [...names].filter((n) => text.includes(n)).length;
  return hits >= 3;
}

/** 문장 수 상한 — 길어지면 아침에 안 읽힌다. */
export function trimSentences(text: string, max = MAX_BRIEF_SENTENCES): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  return parts.length <= max ? text.trim() : parts.slice(0, max).join(" ").trim();
}

/** 브리핑 프롬프트 — 모델에게 **사실을 주고 문장만** 쓰게 한다(숫자 창작 차단). */
export function buildBriefPrompt(items: TodayItem[]): string {
  // 항목을 많이 주면 모델이 그대로 나열한다(실측: 8건을 주니 7건을 읊었다).
  // 집계는 숫자로 주고 **개별 항목은 최우선 1건만** 노출해 나열할 거리를 없앤다.
  const now = items.filter((i) => i.urgency === "now");
  const device = items.filter((i) => i.axis === "device").length;
  const top = now[0] ?? items[0];
  const facts = [
    `급한 항목 ${now.length}건 (실제 악용 확인 ${now.filter((i) => i.kev).length}건)`,
    device ? `점검 주기 도래 ${device}건` : "",
    top ? `최우선: ${top.title} — ${top.subtitle} — ${top.why}` : "",
  ].filter(Boolean);

  return [
    "보안담당자에게 오늘 아침 브리핑을 2문장으로 써라. 아래는 시스템이 계산한 사실이다.",
    "",
    ...facts.map((f) => `- ${f}`),
    "",
    "규칙:",
    "- 위에 제시된 사실만 쓴다. 건수·일수·비율을 새로 만들지 마라.",
    "- 첫 문장: 오늘 상황 요약(건수 중심). 둘째 문장: 무엇부터 처리할지 권고.",
    "- 최우선 1건 외에 다른 취약점 이름을 나열하지 마라. 화면에 이미 목록이 있다.",
    "- 인사말·서두 없이 본론부터. 2문장.",
  ].join("\n");
}

/** 오늘의 할일 집계. withBrief=false면 LLM을 부르지 않는다(규칙 문장만). */
export async function buildToday(withBrief = true): Promise<TodayBrief> {
  const now = Date.now();
  const all = [...vulnItems(now), ...deviceItems(now)];
  // 정렬: 급한 것 먼저 → 취약점 먼저(장비 주기가 KEV를 밀어내지 않게) → 원래 우선순위 유지
  all.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "now" ? -1 : 1;
    if (a.axis !== b.axis) return a.axis === "vuln" ? -1 : 1;
    return 0;
  });

  // 화면(280px)에 담기는 만큼만 보여주되, **두 축에 각각 자리를 보장한다.**
  //
  // 왜 단순 slice가 아닌가(실측 2026-07-21): 급한 취약점이 12건이라 상위 6칸을 전부 먹어
  // 장비 점검이 화면에서 통째로 사라졌다(counts에는 있는데 목록엔 없음). 두 축은 성격이 달라서
  // — 취약점은 놓치면 뚫리고, 주기 점검은 놓치면 감사에서 걸린다 — 한쪽이 다른 쪽을 굶기면 안 된다.
  // 급한 쪽에 더 주되(4:2), 상대가 비면 남은 자리를 넘겨 낭비하지 않는다.
  // 슬롯 수는 280px 패널의 실측으로 정했다 — 6건이면 가이드 높이가 700px가 되어
  // 495px 패널에서 브리핑과 상위 항목이 한눈에 안 들어온다. 5건이면 대체로 들어간다.
  // 나머지는 "그 외 N건"으로 접어 취약점 화면으로 보낸다.
  const VULN_SLOTS = 3;
  const DEVICE_SLOTS = 2;
  const vulns = all.filter((i) => i.axis === "vuln");
  const devices = all.filter((i) => i.axis === "device");
  const vShown = vulns.slice(0, VULN_SLOTS + Math.max(0, DEVICE_SLOTS - devices.length));
  const dShown = devices.slice(0, DEVICE_SLOTS + Math.max(0, VULN_SLOTS - vulns.length));
  const items = [...vShown, ...dShown];
  const counts = {
    now: all.filter((i) => i.urgency === "now").length,
    today: all.filter((i) => i.urgency === "today").length,
    later: Math.max(0, all.length - items.length),
  };

  const fallback = ruleBrief(all);
  if (!withBrief || all.length === 0) {
    return { items, counts, brief: trimSentences(fallback), briefBy: "rule", generatedAt: now };
  }

  // LLM은 문장만. 실패·타임아웃이면 규칙 문장으로 떨어진다 — 화면은 언제나 뜬다.
  try {
    const { chat } = await import("./llm.js");
    const reply = await chat({
      agentId: "orchestrator",
      message: buildBriefPrompt(all),
      remember: false,
      maxTokens: 300,
      // trusted — 이 message는 사용자 입력이 아니라 우리가 조립한 내부 프롬프트다(gateway.ts 규칙).
      trusted: true,
    });
    const text = (reply ?? "").trim();
    // 연결 실패 안내문(⚠로 시작)이나 빈 응답이면 규칙 문장을 쓴다.
    if (!text || text.startsWith("⚠")) return { items, counts, brief: trimSentences(fallback), briefBy: "rule", generatedAt: now };
    // 목록을 그대로 읊었으면 브리핑 구실을 못 한다 — 규칙 문장이 더 낫다(짧고 정확).
    if (tooEnumerative(text, items)) return { items, counts, brief: trimSentences(fallback), briefBy: "rule", generatedAt: now };
    return { items, counts, brief: trimSentences(text), briefBy: "llm", generatedAt: now };
  } catch {
    return { items, counts, brief: trimSentences(fallback), briefBy: "rule", generatedAt: now };
  }
}

export function registerTodayRoutes(app: Express): void {
  app.get(
    "/api/today",
    authMiddleware,
    asyncRoute(async (req, res) => {
      // ?brief=0 이면 LLM 없이 즉답(화면 첫 렌더용 — 브리핑은 뒤이어 채운다).
      res.json(await buildToday(String(req.query.brief ?? "1") !== "0"));
    })
  );
}
