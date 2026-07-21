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

// 한 건의 "오늘 할 일". 화면은 이걸 그대로 렌더한다(추가 판단 없이).
export interface TodayItem {
  id: string;
  axis: "vuln" | "device"; // 취약점(이벤트) / 보안장비 운영(주기)
  urgency: "now" | "today"; // 🔴 지금 / 🟡 오늘
  title: string;
  subtitle: string; // 자산·제품 등 대상
  why: string; // 왜 지금인지 — 근거(규칙으로 계산된 사실만)
  action: string; // 무엇을 하면 되는지 — 추천 조치
  badges: string[]; // KEV, 2일 초과, 분기 도래 …
  ref?: string; // 클릭 시 이동 대상(assetId 등)
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

interface VulnGroup {
  assetId: string;
  assetName: string;
  name: string;
  count: number;
  kev: boolean;
  maxEpss: number | null;
  worstSeverity: string;
  earliestDue: number | null;
  assignee?: string;
}

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function vulnItems(now: number): TodayItem[] {
  const groups = new Map<string, VulnGroup>();

  for (const r of prioritizedReviews(500)) {
    if (r.status === "approved") continue; // 이미 조치 승인된 건 오늘 할 일이 아니다
    const f = r.finding;
    const name = groupNameFor(f.finding_type);
    const key = `${r.assetId}||${name}`;
    const g =
      groups.get(key) ??
      ({
        assetId: r.assetId,
        assetName: r.assetName || r.assetId,
        name,
        count: 0,
        kev: false,
        maxEpss: null,
        worstSeverity: "",
        earliestDue: null,
      } as VulnGroup);

    g.count++;
    if ((f as { kev?: boolean }).kev) g.kev = true;
    const epss = (f as { epss?: number }).epss;
    if (typeof epss === "number") g.maxEpss = Math.max(g.maxEpss ?? 0, epss);
    if (f.severity && (SEV_RANK[f.severity] ?? 0) > (SEV_RANK[g.worstSeverity] ?? 0)) g.worstSeverity = f.severity;
    const dueAt = r.dueDate ? endOfDay(r.dueDate) : null;
    if (dueAt != null) g.earliestDue = g.earliestDue == null ? dueAt : Math.min(g.earliestDue, dueAt);
    if (r.assignee && !g.assignee) g.assignee = r.assignee;

    groups.set(key, g);
  }

  const out: TodayItem[] = [];
  for (const g of groups.values()) {
    const due = g.earliestDue != null ? dueLabel(g.earliestDue, now) : null;
    const overdue = due != null && due.overdueDays > 0;
    const dueToday = g.earliestDue != null && !overdue && g.earliestDue <= endOfToday();

    // KEV는 기한 무관 항상 노출(③). 그 외는 기한이 걸린 것만.
    if (!g.kev && !overdue && !dueToday) continue;

    const badges: string[] = [];
    if (g.kev) badges.push("KEV");
    if (g.count > 1) badges.push(`${g.count}건`);
    if (due) badges.push(due.label);

    // 근거는 계산된 사실만 — 모델이 지어낼 여지를 주지 않는다.
    const facts = [
      g.kev ? "실제 악용 확인(CISA KEV)" : "",
      g.maxEpss != null ? `최고 악용예측 ${Math.round(g.maxEpss * 100)}%` : "",
      g.worstSeverity ? `최고 심각도 ${g.worstSeverity}` : "",
      due ? due.label : "",
    ].filter(Boolean);

    out.push({
      id: `vulngroup:${g.assetId}:${g.name}`,
      axis: "vuln",
      urgency: g.kev || overdue ? "now" : "today",
      title: g.count > 1 ? `${g.name} 패치 (${g.count}건)` : g.name,
      subtitle: g.assetName,
      why: facts.join(" · "),
      action: g.assignee
        ? `담당 ${g.assignee} 배정됨 — 조치 확인 필요`
        : g.count > 1
          ? `${g.count}건을 한 번에 조치할 수 있습니다 — AI 팀에 맡기거나 담당자를 지정하세요`
          : "AI 팀에 조치를 맡기거나 담당자를 지정하세요",
      badges,
      ref: g.assetId,
    });
  }

  // 그룹 내 정렬: KEV → 악용예측 → 심각도 → 건수
  out.sort((a, b) => {
    const ak = a.badges.includes("KEV") ? 1 : 0;
    const bk = b.badges.includes("KEV") ? 1 : 0;
    if (ak !== bk) return bk - ak;
    const num = (s: string) => Number(/(\d+)%/.exec(s)?.[1] ?? 0);
    return num(b.why) - num(a.why);
  });
  return out;
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
      title: `${s.targetLabel} 하드닝 점검`,
      subtitle: `${s.standard.toUpperCase()} 기준 · ${lastLabel}`,
      why: overdueDays > 0 ? `점검 주기 ${overdueDays}일 초과` : "점검 주기 도래",
      action: "지금 점검을 실행하면 결과가 리포트에 남습니다",
      badges: [overdueDays > 0 ? `${overdueDays}일 초과` : "주기 도래"],
      ref: s.targetId,
    });
  }

  // ② 유지보수 점검 — 예정일이 지났는데 아직 보고 안 됨 / 승인 대기
  for (const m of listMaintenanceItems()) {
    const dueAt = endOfDay(m.scheduleDate);
    if (m.status === "scheduled" && dueAt != null && dueAt <= endOfToday()) {
      const d = dueLabel(dueAt, now);
      out.push({
        id: `maint:${m.id}`,
        axis: "device",
        urgency: "today",
        title: m.title,
        subtitle: m.productName,
        why: d.overdueDays > 0 ? `점검 예정일 ${d.overdueDays}일 지남` : "오늘 점검 예정",
        action: "점검 후 결과를 등록하세요",
        badges: [d.label],
      });
    } else if (m.status === "reported") {
      out.push({
        id: `maint:${m.id}`,
        axis: "device",
        urgency: "today",
        title: `${m.title} — 승인 대기`,
        subtitle: m.productName,
        why: "점검 보고가 올라왔고 승인이 남았습니다",
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
    const kev = now.filter((i) => i.badges.includes("KEV")).length;
    parts.push(
      `오늘 급한 건 ${now.length}건입니다.` +
        (kev ? ` 그중 ${kev}건은 실제 악용이 확인된 취약점(KEV)이라 먼저 처리하시길 권합니다.` : "")
    );
    parts.push(`가장 급한 것은 "${now[0].title}"(${now[0].subtitle})이고, ${now[0].why}입니다.`);
  }
  if (today.length) {
    const device = today.filter((i) => i.axis === "device");
    parts.push(
      device.length
        ? `그 외에 점검 주기가 도래한 항목이 ${device.length}건 있습니다.`
        : `오늘 기한인 항목이 ${today.length}건 있습니다.`
    );
  }
  return parts.join(" ");
}

/** 브리핑 프롬프트 — 모델에게 **사실을 주고 문장만** 쓰게 한다(숫자 창작 차단). */
export function buildBriefPrompt(items: TodayItem[]): string {
  const lines = items
    .slice(0, 8)
    .map((i, n) => `${n + 1}. [${i.urgency === "now" ? "급함" : "오늘"}] ${i.title} (${i.subtitle}) — ${i.why}`);
  return [
    "보안담당자에게 오늘 아침 브리핑을 2~3문장으로 써라. 아래는 시스템이 계산한 사실이다.",
    "",
    ...lines,
    "",
    "규칙:",
    "- 위에 제시된 사실만 쓴다. 건수·일수·비율을 새로 만들지 마라.",
    "- 무엇부터 처리하면 좋은지 한 가지를 권한다.",
    "- 목록을 다시 나열하지 마라(화면에 이미 목록이 있다). 상황 요약과 권고만.",
    "- 인사말·서두 없이 본론부터. 3문장 이내.",
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

  const items = all.slice(0, 6); // 화면(280px)에 담기는 만큼만. 나머지는 later로 센다.
  const counts = {
    now: all.filter((i) => i.urgency === "now").length,
    today: all.filter((i) => i.urgency === "today").length,
    later: Math.max(0, all.length - items.length),
  };

  const fallback = ruleBrief(all);
  if (!withBrief || all.length === 0) {
    return { items, counts, brief: fallback, briefBy: "rule", generatedAt: now };
  }

  // LLM은 문장만. 실패·타임아웃이면 규칙 문장으로 떨어진다 — 화면은 언제나 뜬다.
  try {
    const { chat } = await import("./llm.js");
    const reply = await chat({
      agentId: "orchestrator",
      message: buildBriefPrompt(all),
      remember: false,
      maxTokens: 300,
    });
    const text = (reply ?? "").trim();
    // 연결 실패 안내문(⚠로 시작)이나 빈 응답이면 규칙 문장을 쓴다.
    if (!text || text.startsWith("⚠")) return { items, counts, brief: fallback, briefBy: "rule", generatedAt: now };
    return { items, counts, brief: text, briefBy: "llm", generatedAt: now };
  } catch {
    return { items, counts, brief: fallback, briefBy: "rule", generatedAt: now };
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
