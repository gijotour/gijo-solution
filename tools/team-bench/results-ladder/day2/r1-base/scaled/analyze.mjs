// 무학습 진단 분석 — 세기 0/0.25/0.5/0.75/1.0 을 한 표로. 숫자는 전부 결과 파일에서 읽는다(추정 금지).
import fs from "node:fs";
import path from "node:path";
import { TASKS as T1 } from "../../../gijo-as/tools/team-bench/tasks.mjs";
import { TASKS as T2 } from "../../../gijo-as/tools/team-bench/tasks-r2.mjs";

const HOME = process.env.HOME;
const LAD = `${HOME}/gijo-as/tools/team-bench/results-ladder`;
const R1B = `${LAD}/day2/r1-base`;
const SYS = JSON.parse(fs.readFileSync(`${HOME}/bench/models-prompt.json`, "utf8"))[0].system;

const rd = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const EASY_IDS = T1.map((t) => t.id);
const HARD_IDS = T2.map((t) => t.id);
const ALL_IDS = [...EASY_IDS, ...HARD_IDS];
const NARR = ["report_draft", "priority_rank", "glossary_cite", "scan_messy", "priority_6", "report_fix"];
const PROMPT = Object.fromEntries([...T1, ...T2].map((t) => [t.id, t.messages.map((m) => m.content).join("\n")]));

// 「원문: "…"」 창작 판정 — 따옴표 안 문자열이 프롬프트(근거)에 그대로 없으면 창작이다.
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
function 원문검사(text, src) {
  const t = String(text || "");
  const hits = [...t.matchAll(/원문\s*[:：]\s*[“"「\x27]([^”"」\x27]{6,400})[”"」\x27]/g)].map((m) => m[1]);
  const bare = /원문\s*[:：]/.test(t);
  const s = norm(src || "");
  const 창작 = hits.filter((h) => !s.includes(norm(h)));
  return { 표기: bare, 인용수: hits.length, 창작수: 창작.length, 창작예: 창작[0]?.slice(0, 70) ?? null };
}
const median = (xs) => { const a = xs.filter((x) => typeof x === "number").sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const cisa본문 = (t) => /CISA|Cybersecurity and Infrastructure Security Agency|사이버\s*보안\s*(및\s*)?(인프라|기반시설)\s*보안\s*(국|청)/i.test(String(t).replace(/https?:[^\s)]+/g, ""));

const 점 = [
  { 이름: "기준선(어댑터 없음)", easy: `${LAD}/baseline/r1-qwen3-14b.json`, hard: `${LAD}/baseline/r2-qwen3-14b.json`, kev: `${R1B}/kev-base-대조.json` },
  { 이름: "r1-base @1.00", easy: `${R1B}/easy/qwen3-14b+r1-base.json`, hard: `${R1B}/hard/qwen3-14b+r1-base.json`, kev: `${R1B}/kev.json` },
  ...["0.75", "0.5", "0.25"].map((s) => ({
    이름: `r1-base @${Number(s).toFixed(2)}`,
    easy: `${R1B}/scaled/${s}/easy/qwen3-14b+r1-base@${s}.json`,
    hard: `${R1B}/scaled/${s}/hard/qwen3-14b+r1-base@${s}.json`,
    kev: `${R1B}/scaled/${s}/kev.json`,
  })),
];

const 행 = [];
for (const p of 점) {
  const e = rd(p.easy), h = rd(p.hard), k = rd(p.kev);
  const tasks = { ...(e?.tasks || {}), ...(h?.tasks || {}) };
  const 점수 = Object.fromEntries(ALL_IDS.map((i) => [i, tasks[i]?.score ?? null]));
  const 열두 = ALL_IDS.filter((i) => i !== "needle_64k").map((i) => 점수[i]).filter((x) => typeof x === "number");
  const gen = Object.fromEntries(NARR.map((i) => [i, tasks[i]?.genTokens ?? null]));
  // 과제 답의 「원문:」 (answer는 1500자 잘림 — 표기 유무만 신뢰)
  const 과제원문 = ALL_IDS.map((i) => ({ id: i, ...원문검사(tasks[i]?.answer, PROMPT[i]) })).filter((x) => x.표기);
  const kevs = Array.isArray(k) ? k : [];
  const kp = kevs.filter((x) => x.label === "prompt"), kn = kevs.filter((x) => x.label === "noprompt");
  const kevChk = kevs.map((x) => ({ label: x.label, q: x.q, cisa: cisa본문(x.text), ...원문검사(x.text, SYS + "\n" + x.q), len: String(x.text || "").length }));
  행.push({
    이름: p.이름,
    있음: { easy: !!e, hard: !!h, kev: !!k },
    점수,
    평균12: 열두.length ? Number((열두.reduce((a, b) => a + b, 0) / 열두.length).toFixed(3)) : null,
    과제수12: 열두.length,
    genTokens: gen,
    genTokens중앙값: median(Object.values(gen)),
    glossary_cite_detail: tasks.glossary_cite?.detail ?? null,
    kev: {
      prompt본문CISA: `${kp.filter((x) => cisa본문(x.text)).length}/${kp.length}`,
      noprompt본문CISA: `${kn.filter((x) => cisa본문(x.text)).length}/${kn.length}`,
      원문표기: kevChk.filter((x) => x.표기).length,
      원문창작: kevChk.filter((x) => x.창작수 > 0).length,
      상세: kevChk,
    },
    과제원문표기: 과제원문,
    생성tok당초: median(ALL_IDS.map((i) => tasks[i]?.genTps).filter((x) => typeof x === "number")),
  });
}
fs.writeFileSync(`${R1B}/scaled/analysis.json`, JSON.stringify(행, null, 1));
console.log(JSON.stringify(행.map((r) => ({ 이름: r.이름, 있음: r.있음, 평균12: r.평균12, 과제수: r.과제수12, gen중앙값: r.genTokens중앙값, cite: r.glossary_cite_detail, kevP: r.kev.prompt본문CISA, kevN: r.kev.noprompt본문CISA, 원문표기: r.kev.원문표기, 원문창작: r.kev.원문창작, 과제원문: r.과제원문표기.map((x) => x.id) })), null, 1));
