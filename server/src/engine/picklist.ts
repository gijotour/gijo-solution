// engine/picklist.ts — 답에 나온 취약점 목록을 **골라서 조치**할 수 있게 만든다.
// (2026-07-31 사용자 질문 "미조치 취약점에 리스트를 보고 선택도 가능한거지?")
//
// ■ 왜 필요한가
//   지금은 "Critical 전부 정요한한테" 같은 **조건**으로만 다건 처리가 된다. 조건은 담당자가
//   머릿속 범위를 말로 옮긴 것이라 실제 대상과 어긋날 수 있다 — 눌러 보기 전엔 뭐가 걸리는지 모른다.
//   눈으로 보고 고른 것은 어긋나지 않는다.
//
// ■ 설계에서 지킨 것
//   ① **보이는 것만 고를 수 있다.** 답 본문에 실제로 나온 건만 체크칸을 만든다.
//      화면에 없는 걸 고르게 하면 "내가 뭘 고른 거지"가 된다.
//   ② **신원은 findingKey(sha1 16자).** LLM이 지어낼 수 없는 값이라 오조작이 원천 차단된다.
//   ③ **골라도 바로 실행되지 않는다.** 고른 뒤에도 결재판(승인)을 거친다 — 쓰기는 전부 사람 승인.

import { prioritizedReviews } from "./approvals";

export interface PickItem {
  id: string; // "assetId::findingKey" — 조치할 때 그대로 돌려보낸다
  label: string; // 담당자가 읽는 한 줄
  severity: string;
  assignee?: string;
  dueDate?: string;
}

export interface PickList {
  kind: "finding";
  items: PickItem[];
  /** 고른 뒤 누를 수 있는 조치들. 화면이 이 목록으로 버튼을 그린다. */
  actions: { key: string; label: string; needs?: "assignee" | "dueDate" }[];
}

/** 취약점 목록을 답으로 낸 도구들 — 이 중 하나라도 돌았을 때만 체크칸을 붙인다. */
const LIST_TOOLS = new Set(["finding_status", "today", "briefing", "scan_status", "threats"]);

const MAX_PICK = 20; // 스무 개가 넘으면 고르는 것보다 조건이 낫다

/** 고른 뒤 누를 수 있는 조치. 화면이 이 목록으로 버튼을 그린다. */
const PICK_ACTIONS: PickList["actions"] = [
  { key: "assign", label: "담당자 배정", needs: "assignee" },
  { key: "due", label: "기한 정하기", needs: "dueDate" },
  { key: "done", label: "조치완료로" },
  { key: "false", label: "오탐으로" },
];

type Review = ReturnType<typeof prioritizedReviews>[number];

function toPickItem(r: Review): PickItem {
  return {
    id: `${r.assetId}::${r.findingKey}`,
    label: `[${r.finding.severity}] ${r.finding.finding_type} @ ${r.assetName}`,
    severity: r.finding.severity,
    ...(r.assignee ? { assignee: r.assignee } : {}),
    ...(r.dueDate ? { dueDate: r.dueDate } : {}),
  };
}

/**
 * 답 본문에 실제로 등장한 취약점만 골라 체크 목록을 만든다.
 *
 * @param output    담당자가 화면에서 읽는 답 본문
 * @param toolNames 이번 답을 만들며 실행된 도구 이름들
 */
export function buildFindingPicks(output: string, toolNames: string[]): PickList | null {
  if (!toolNames.some((n) => LIST_TOOLS.has(n))) return null;
  const text = String(output ?? "");
  if (!text.trim()) return null;

  const items: PickItem[] = [];
  for (const r of prioritizedReviews(200)) {
    if (items.length >= MAX_PICK) break;
    // 자산(아이디든 이름이든)과 취약점 유형이 **둘 다** 본문에 있어야 한다.
    // 자산만 보고 넣으면 같은 자산의 다른 취약점까지 딸려 들어와, 화면에 없는 것이 체크칸에 나타난다.
    if (!text.includes(r.assetId) && !text.includes(r.assetName)) continue;
    if (!text.includes(r.finding.finding_type)) continue;
    items.push(toPickItem(r));
  }
  if (items.length === 0) return null;
  return { kind: "finding", items, actions: PICK_ACTIONS };
}

// ── "미조치 취약점 뭐 있어?" — 결정적 목록 ──────────────────────────────
// 사용자가 콕 집어 물은 질문이다("미조치 취약점에 리스트를 보고 선택도 가능한거지?").
// LLM 루프에 맡기면 모델이 목록 도구를 고를 때만 체크칸이 생긴다 — 어떤 날은 되고 어떤 날은
// 안 되는 기능은 없는 것만 못하다. 이 질문만은 규칙으로 답해 **항상** 고를 수 있게 한다.
// (지식베이스 정리·공격경로·Shadow AI도 같은 이유로 결정적 경로다)
//
// ⚠ 좁게 잡는다. "가장 급한 취약점에 담당자 배정해줘"는 **시키는 말**이라 여기서 가로채면
//   잘 되던 배정 기능이 죽는다 — 아래 금지어로 막고 시험이 지킨다.
const LIST_ASK_RE = /(취약점|미조치|조치\s*안|미해결)/;
const LIST_VERB_RE = /(목록|리스트|보여|뭐\s*있|무엇이?\s*있|어떤\s*게?\s*있|현황|남았)/;
const LIST_BLOCK_RE = /(배정|기한|처리해|조치해|오탐|완료로|잡아|스캔|보고서|리포트|방법|어떻게|절차)/;

export function isFindingListAsk(text: string): boolean {
  const t = String(text ?? "");
  if (LIST_BLOCK_RE.test(t)) return false;
  return LIST_ASK_RE.test(t) && LIST_VERB_RE.test(t);
}

/** 규칙으로 만든 취약점 목록 답 + 그 자리에서 고를 수 있는 체크칸. */
export function findingListAnswer(): { output: string; picklist: PickList | null } {
  // ⚠ 상한을 걸고 그 수를 "총 N건"이라 말하면 거짓이 된다(실측: 상한 200에 걸려 늘 "200건"이었다).
  //   담당자는 그 수를 보고 일의 크기를 가늠하므로, 총계는 상한 없이 센다.
  const rows = prioritizedReviews(100000);
  if (rows.length === 0) {
    return { output: "지금 조치할 취약점이 없습니다. 새 점검 결과가 들어오면 여기에 뜹니다.", picklist: null };
  }
  const 미배정 = rows.filter((r) => !r.assignee).length;
  const 초과 = rows.filter((r) => r.overdue).length;
  const 보여줄 = rows.slice(0, MAX_PICK);
  const lines = 보여줄.map((r) => {
    const who = r.assignee ? `담당 ${r.assignee}` : "담당 미배정";
    const due = r.dueDate ? `기한 ${r.dueDate}` : "기한 없음";
    return `- **[${r.finding.severity}]** ${r.finding.finding_type} @ ${r.assetName} — ${who} · ${due}`;
  });
  const 머리 = `조치할 취약점 **${rows.length}건** — 담당자 미배정 ${미배정}건 · 기한 초과 ${초과}건`;
  const 꼬리 = rows.length > 보여줄.length ? `\n\n(급한 순으로 ${보여줄.length}건만 보여드립니다)` : "";
  const output = `${머리}\n\n${lines.join("\n")}${꼬리}`;
  // 체크칸은 **방금 그린 그 줄들**에서 직접 만든다. 글자 대조로 되찾으면 같은 자산에 같은 유형이
  // 둘 있을 때 화면에 없는 것이 딸려 들어온다(글자만으로는 둘을 구별할 수 없다).
  return { output, picklist: { kind: "finding", items: 보여줄.map(toPickItem), actions: PICK_ACTIONS } };
}

// ── 고른 것을 조치로 잇기 ───────────────────────────────────────────────
// 대화창이 체크한 건들을 **표식**으로 실어 보낸다. 서버는 그 표식을 규칙으로 읽는다 —
// LLM에게 "이 중 3번, 5번을 처리해"라고 시키지 않는다. 7B가 번호를 하나 잘못 읽으면
// 엉뚱한 취약점이 오탐 처리된다(모델에 프롬프트를 더해 고칠 문제가 아니라 코드로 막을 문제다).
export const PICK_MARK = "#고른건";
const ACTION_MARK = "#조치";
const VALUE_MARK = "#값";

export interface PickCommand {
  ids: string[];
  action: "assign" | "due" | "done" | "false";
  value: string;
}

function markLine(text: string, mark: string): string {
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith(mark + " ")) return line.slice(mark.length + 1).trim();
  }
  return "";
}

/** 대화창이 보낸 "고른 것 조치" 지시를 읽는다. 표식이 없거나 망가졌으면 null(평소대로 처리). */
export function parsePickCommand(text: string): PickCommand | null {
  const idsRaw = markLine(text, PICK_MARK);
  if (!idsRaw) return null;
  const ids = idsRaw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return null;
  const action = markLine(text, ACTION_MARK);
  if (action !== "assign" && action !== "due" && action !== "done" && action !== "false") return null;
  const value = markLine(text, VALUE_MARK);
  // 담당자·기한은 값이 있어야 뜻이 통한다. 값 없이 넘어오면 처리하지 않는다 —
  // 빈 값으로 결재판을 만들면 "담당 (없음)으로 배정"이라는 뜻 모를 승인이 뜬다.
  if ((action === "assign" || action === "due") && !value) return null;
  return { ids, action, value };
}

/**
 * 기록·표시에 쓸 사람 말만 남긴다.
 * ⚠ 표식은 기계용이다. 그대로 저장하면 작업 내역과 이어보기에 sha1 해시가 줄줄이 남아
 *   담당자가 자기 대화를 못 알아본다(2026-07-31 실화면에서 발견).
 */
export function stripPickMarks(text: string): string {
  const kept = String(text ?? "")
    .split("\n")
    .filter((raw) => {
      const line = raw.trim();
      return !(line.startsWith(PICK_MARK + " ") || line.startsWith(ACTION_MARK + " ") || line.startsWith(VALUE_MARK + " "));
    });
  return kept.join("\n").trim();
}

/** 고른 조치를 bulk_update 인자로 바꾼다. */
export function pickToolArgs(cmd: PickCommand): Record<string, string> {
  const args: Record<string, string> = { ids: cmd.ids.join(",") };
  if (cmd.action === "assign") args.assignee = cmd.value;
  else if (cmd.action === "due") args.dueDate = cmd.value;
  else if (cmd.action === "done") args.status = "조치완료";
  else args.status = "오탐";
  return args;
}
