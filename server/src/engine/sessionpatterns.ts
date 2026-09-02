// engine/sessionpatterns.ts — 작업 내역에서 업무 패턴을 뽑는다.
//
// 왜 만들었나
// ───────────
// 작업 내역에는 담당자가 AI에게 내린 지시와 그 답이 그대로 쌓인다. 그런데 지금까지는 쌓이기만
// 하고 아무 데도 쓰이지 않았다 — 유일한 예외가 "같은 세션 안 직전 6턴을 맥락으로 싣는 것"
// (worksessions.recentTurnsText)이라, 어제 다른 세션에서 한 일은 오늘 아무 도움이 안 됐다.
//
// 이 모듈은 쌓인 글을 읽어 **사람이 나중에 참고할 요약**을 만든다(2026-07-28 사용자 결정).
//   · 무엇을 반복해서 묻는가 → 자동화·FAQ 후보
//   · 무엇에 답을 못 했는가   → 지식베이스의 구멍
//   · 어떤 주제에 시간을 쓰는가
//
// ⚠ 설계 원칙 — **여기서 나온 결과를 자동으로 어디에 먹이지 않는다.**
//   RAG에 대화를 그대로 넣거나 라우팅에 반영하는 길도 있었지만 택하지 않았다(사용자 결정).
//   근거: 잡담·오답까지 지식이 되면 멀쩡한 문서를 밀어낸다 — 데모 문서 하나가 실제 문서를
//   검색 1위에서 밀어낸 사고(QA-M04)를 이미 겪었다. 사람이 읽고 판단할 자료로만 둔다.
//
// ⚠ 판정은 전부 **코드로** 한다(집계·정규화·분류). LLM은 쓰지 않는다 —
//   같은 입력에 매번 다른 요약이 나오면 "지난주와 비교"가 불가능해 참고자료가 못 된다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { db } from "../db";

export interface RepeatedInstruction {
  대표문장: string;
  횟수: number;
  마지막: number;
}

export interface KnowledgeGap {
  질문: string;
  이유: string;
  when: number;
}

export interface SessionPatternReport {
  기간일수: number;
  집계시각: number;
  총계: { 세션: number; 지시: number; 답변: number };
  반복지시: RepeatedInstruction[];
  주제분포: { 주제: string; 건수: number }[];
  지식공백: KnowledgeGap[];
  잡담: { 건수: number; 비율: number };
  비고: string[];
}

interface TurnRow {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tool: string | null;
  at: number;
}

// ── 분류 기준 ────────────────────────────────────────────────────────────
// 주제는 키워드로 가른다. 완벽한 분류가 목적이 아니라 "어디에 시간을 쓰는가"를 보는 것이라,
// 애매하면 '기타'로 두고 넘어간다 — 억지로 분류하면 숫자만 그럴듯해지고 뜻이 없어진다.
const TOPICS: { 주제: string; re: RegExp }[] = [
  { 주제: "취약점·조치", re: /취약점|CVE|KEV|EPSS|VPR|패치|조치|스캔|finding/i },
  { 주제: "자산·구성", re: /자산|인벤토리|서버|호스트|AI-?BOM|SBOM|구성요소/i },
  { 주제: "점검·거버넌스", re: /점검|하드닝|CCE|CIS|승인|결재|유지보수|정기/i },
  { 주제: "법령·규정", re: /법령|규정|근거|ISMS|개인정보|망분리|보관|의무|지침/i },
  { 주제: "로그·탐지", re: /로그|CEF|Snort|SIEM|탐지|알림|시그니처|헤더/i },
  { 주제: "AI·모델", re: /모델|LLM|에이전트|학습|RAG|임베딩|파인튜닝|온톨로지/i },
  { 주제: "리포트", re: /리포트|보고서|KPI|컴플라이언스|추세/i },
];

// 잡담·인사 — 업무 패턴에서 빼야 반복지시 목록이 쓸모 있어진다.
// ("고마워 수고했어"가 최다 반복으로 뜨면 그 목록은 아무도 안 본다.)
// export: 학습 후보함(learncandidates)도 같은 기준을 쓴다 — 기준이 갈리면 한쪽이 낡는다(2026-07-29).
export const SMALLTALK = /^(고마워|감사|수고|안녕|ㅎㅎ|ㅋㅋ|테스트|test)|수도가 어디|점심|날씨/i;

// 답을 못 준 신호 — 화면·모델이 내놓는 정직한 회피 문구들. 이게 남았다는 건
// 지식베이스에 그 주제가 없다는 뜻이라, 무엇을 채워야 하는지 알려주는 가장 값진 신호다.
// export: 학습 후보함도 같은 기준으로 "회피 답변은 학습감이 아니라 지식 구멍"을 가른다(2026-07-29).
export const NO_ANSWER = [
  // ⚠ 조사를 박아 두면 **한 글자 차이로 샌다**(2026-08-05 검토 지적): 「자료가 없」만 보다가
  //   「사내 자료**는** 없습니다」(근거 약함 배너)를 놓쳤다. 조사 자리를 열어 둔다.
  // 「찾지 못했습니다」는 제품의 빈 결과 표준 문구다(agentloop EMPTY_RESULT_RE) — 없으면 그 폴백이 승인 경로로
  //   지식이 된다(2026-09-03 겹 1 위생 시험이 잡음).
  { re: /찾을 수 없|찾지 못|정보(가|는|이) 없|해당 내용(이|은) 없|자료(가|는|도) 없|근거 약함/, 이유: "사내 자료에서 못 찾음" },
  { re: /모델이 아직 준비|실행 실패|요청이 차단/, 이유: "모델·권한 문제" },
  { re: /무엇을 도와드릴까요/, 이유: "지시를 못 알아들음" },
];

// 시스템이 화면에서 자동으로 남긴 글 — 사람이 친 지시가 아니라 패턴 집계에서 뺀다.
const MACHINE_ORIGIN = /^대상 \d+건 —|^\[운영리포트\]|^\[조치\]/;

/** 같은 지시를 묶기 위한 정규화 — 공백·문장부호·높임만 다른 것은 같은 말로 본다. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[?!.,·…]/g, "")
    .replace(/(해줘|해 줘|알려줘|알려 줘|주세요|해주세요)$/, "")
    .trim()
    .toLowerCase();
}

export function analyzeSessionPatterns(days = 30): SessionPatternReport {
  const since = Date.now() - days * 86400000;
  const rows = db
    .prepare("SELECT sessionId, role, content, tool, at FROM work_session_turns WHERE at >= ? ORDER BY at ASC")
    .all(since) as TurnRow[];

  const 세션 = new Set(rows.map((r) => r.sessionId)).size;
  const users = rows.filter((r) => r.role === "user");
  const bots = rows.filter((r) => r.role === "assistant");

  // ── 반복 지시 ──────────────────────────────────────────────────────────
  const bucket = new Map<string, { 대표문장: string; 횟수: number; 마지막: number }>();
  let 잡담 = 0;
  for (const r of users) {
    const raw = r.content.replace(/\s+/g, " ").trim();
    if (!raw) continue;
    if (SMALLTALK.test(raw)) { 잡담++; continue; }
    if (MACHINE_ORIGIN.test(raw)) continue;
    const key = normalize(raw);
    if (key.length < 4) continue; // 한두 글자는 뜻을 알 수 없다
    const cur = bucket.get(key);
    if (cur) { cur.횟수++; cur.마지막 = Math.max(cur.마지막, r.at); }
    else bucket.set(key, { 대표문장: raw.slice(0, 80), 횟수: 1, 마지막: r.at });
  }
  const 반복지시 = [...bucket.values()]
    .filter((x) => x.횟수 >= 2) // 한 번뿐인 건 '패턴'이 아니다
    .sort((a, b) => b.횟수 - a.횟수 || b.마지막 - a.마지막)
    .slice(0, 15);

  // ── 주제 분포 ──────────────────────────────────────────────────────────
  const topicCount = new Map<string, number>();
  for (const r of users) {
    if (SMALLTALK.test(r.content)) continue;
    const hit = TOPICS.find((t) => t.re.test(r.content));
    const key = hit ? hit.주제 : "기타";
    topicCount.set(key, (topicCount.get(key) ?? 0) + 1);
  }
  const 주제분포 = [...topicCount.entries()]
    .map(([주제, 건수]) => ({ 주제, 건수 }))
    .sort((a, b) => b.건수 - a.건수);

  // ── 지식 공백 ──────────────────────────────────────────────────────────
  // 답변이 회피 문구면, 바로 앞 사용자 지시를 짝지어 "이 질문에 답을 못 했다"로 남긴다.
  const gaps: KnowledgeGap[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.role !== "assistant") continue;
    const sig = NO_ANSWER.find((n) => n.re.test(r.content));
    if (!sig) continue;
    let q = "";
    for (let j = i - 1; j >= 0; j--) {
      if (rows[j].sessionId !== r.sessionId) break;
      if (rows[j].role === "user") { q = rows[j].content.replace(/\s+/g, " ").trim(); break; }
    }
    if (!q || SMALLTALK.test(q)) continue; // 잡담에 못 답한 건 공백이 아니다
    gaps.push({ 질문: q.slice(0, 80), 이유: sig.이유, when: r.at });
  }
  // 같은 질문이 여러 번 막혔으면 한 줄로 (가장 최근 것만)
  const seen = new Set<string>();
  const 지식공백 = gaps
    .sort((a, b) => b.when - a.when)
    .filter((g) => { const k = normalize(g.질문); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 15);

  // ── 읽는 사람이 오해하지 않게 붙이는 단서 ──────────────────────────────
  const 비고: string[] = [];
  if (users.length < 20) 비고.push("표본이 적습니다(지시 " + users.length + "건) — 아직 경향으로 읽지 마세요.");
  if (반복지시.some((x) => x.횟수 >= 3)) 비고.push("3회 이상 반복된 지시가 있습니다 — 자동화하거나 화면에 버튼으로 두면 됩니다.");
  if (지식공백.length) 비고.push("답을 못 준 질문이 " + 지식공백.length + "건 있습니다 — 해당 주제 문서를 올리면 다음부터 답합니다.");
  비고.push("QA·회귀 검사가 남긴 지시도 함께 집계됩니다 — 같은 문장이 여러 번 보이면 그것일 수 있습니다.");

  return {
    기간일수: days,
    집계시각: Date.now(),
    총계: { 세션, 지시: users.length, 답변: bots.length },
    반복지시,
    주제분포,
    지식공백,
    잡담: { 건수: 잡담, 비율: users.length ? Math.round((잡담 / users.length) * 100) : 0 },
    비고,
  };
}

export function registerSessionPatternRoutes(app: Express): void {
  app.get("/api/session-patterns", authMiddleware, (req, res) => {
    const raw = Number(req.query.days);
    const days = Number.isFinite(raw) && raw > 0 && raw <= 365 ? Math.floor(raw) : 30;
    res.json(analyzeSessionPatterns(days));
  });
}
