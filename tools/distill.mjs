#!/usr/bin/env node
// tools/distill.mjs — 증류기 v1: 교사 모델(gb10)에게 **근거 조각**을 주고 주제별 문답을 만들게 한 뒤,
// 근거 겹침·제외 규칙을 통과한 것만 후보함에 「증류」 출처로 넣는다(rating NULL — 승인은 사람).
//
// 왜 tools/에 있나(설계관 2026-09-03 ★1·7): 서버 엔진에서 LLM을 직접 부르면 internalprompt 소스 감시에
// 걸리고, win의 chat()을 타면 팀원 호출 수(llm_activity_daily)가 증류로 부풀어 지표가 거짓이 된다.
// 교사는 **끝점 단위**로 고른다 — 정식 창구(gb10 4000, 토큰) 또는 옆 포트(ssh 터널). 교사 id는 상수가
// 아니라 응답의 model 필드 실측값을 남긴다.
//
// 사용:
//   GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… [GIJO_SERVE_TOKEN=…] node tools/distill.mjs --topic 취약점 [--limit 500]
//     [--endpoint http://10.8.0.12:4000/api/llm/serve/v1] [--server http://localhost:4000]
//     [--per-chunk 3] [--concurrency 2] [--files "knowledge/*.md,GIJO_AS_취약점관리_지침.md"] [--dry-run] [--no-intake]
//   --no-intake: 편입 없이 교사 수율(사전검사 통과율)만 잰다 — 보고서의 accepted는 0, preChecked에 남는다.
// 산출: .tmp-reports/distill-<주제>-<시각>.json (생성·사전검사·편입·거절 사유·교사·토큰·시간 — 폐기율이 교사 품질 지표)
//
// 근거 조각 = 저장소의 문서 파일(기본: server/docs-manifest.json의 files + knowledge/*.md)을 800자로 자른 것.
//   ref = <경로>#<sha1(본문) 12자> — 재인입해도 안 바뀐다. 고객 자산·규정은 여기 안 쓴다(출하 재료 원칙 5).
// 표준 라이브러리만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const TOPIC = opt("--topic", "");
const LIMIT = Number(opt("--limit", 500));
const PER_CHUNK = Number(opt("--per-chunk", 3));
const CONC = Math.max(1, Math.min(2, Number(opt("--concurrency", 2)))); // 정식 창구 동시 상한 2(초과 429)
const ENDPOINT = (opt("--endpoint", "http://10.8.0.12:4000/api/llm/serve/v1") || "").replace(/\/+$/, "");
const SERVER = (opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000") || "").replace(/\/+$/, "");
const DRY = has("--dry-run");
const FILES = opt("--files", "");
const TOPICS = ["취약점", "장비운영", "사내규정", "위협대응"];
if (!TOPICS.includes(TOPIC)) { console.error(`--topic 은 ${TOPICS.join("·")} 중 하나여야 합니다`); process.exit(2); }

// ── 주제별 조각 고르기(낱말 규칙 — 서버 질문주제와 같은 취지, 재료 선별용) ─────────────────
const TOPIC_RE = {
  취약점: /취약점|CVE|CVSS|KEV|EPSS|패치|취약|스캔|SBOM|익스플로잇|공격 표면/i,
  장비운영: /방화벽|장비|스위치|라우터|VPN|백업|정기점검|설정|펌웨어|IPS|IDS|WAF|EDR|SIEM|로그 보관/i,
  사내규정: /규정|지침|정책|승인|보고|절차|책임|ISMS|개인정보|법|의무|감사|보관 기간|접근 통제/i,
  위협대응: /위협|침해|사고|악성|랜섬|피싱|C2|IOC|CTI|인텔|대응|격리|초동|탐지/i,
};

function listSourceFiles() {
  const out = new Set();
  if (FILES) {
    for (const pat of FILES.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (pat.includes("*")) {
        const dir = path.resolve(repo, path.dirname(pat));
        const re = new RegExp("^" + path.basename(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (re.test(f)) out.add(path.join(dir, f));
      } else out.add(path.resolve(repo, pat));
    }
  } else {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(repo, "server", "docs-manifest.json"), "utf8"));
      for (const f of m.files || []) { const p = typeof f === "string" ? f : f.file; if (p) out.add(path.resolve(repo, p)); }
    } catch (e) { console.warn("docs-manifest.json 못 읽음:", e.message); }
    const kdir = path.join(repo, "knowledge");
    if (fs.existsSync(kdir)) for (const f of fs.readdirSync(kdir)) if (f.endsWith(".md")) out.add(path.join(kdir, f));
  }
  return [...out].filter((p) => fs.existsSync(p) && /\.(md|txt)$/i.test(p));
}

function chunk(text, size = 800, overlap = 100) {
  // 빈 줄 없이 이어진 문서(변환된 PDF 등)는 문단 하나가 수만 자다 — 그대로 두면 한 조각이 교사 문맥(16K)을 넘긴다
  // (2026-09-03 실측: KISA 가이드 조각이 149,612토큰으로 교사 400). 긴 문단은 문장 경계에서 size로 다시 자른다.
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).flatMap((p) => {
    if (p.length <= size * 2) return [p];
    const out = []; let buf = "";
    for (const s of p.split(/(?<=[.!?。]|다\.|니다\.)\s+/)) {
      if ((buf + " " + s).length > size && buf) { out.push(buf); buf = s; } else buf = buf ? buf + " " + s : s;
    }
    if (buf) out.push(buf);
    return out.flatMap((c) => (c.length > size * 2 ? (c.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) || []) : [c]));
  });
  const chunks = []; let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { chunks.push(cur); cur = cur.slice(-overlap) + "\n\n" + p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.replace(/\s/g, "").length >= 200);
}

const sha12 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const norm = (s) => String(s || "").replace(/\s+/g, "");
function overlap20(answer, text) { // 서버 근거겹침과 같은 규칙(20자 창, 공백 무시)
  const a = norm(answer), s = norm(text);
  if (a.length < 20 || s.length < 20) return null;
  for (let i = 0; i + 20 <= s.length; i += 4) { const w = s.slice(i, i + 20); if (a.includes(w)) return w; }
  return null;
}
// 위생 사전검사(서버 datasethygiene 시점데이터 규칙 세 신호 전부) — 날짜·「N건」 나열·우리 DB 식별자는 서버가 거절하니 미리 거른다.
// ⚠ 최종 관문은 서버다(규칙이 바뀌면 서버가 거절한다) — 여기는 왕복을 아끼는 사전검사일 뿐.
const 시점데이터 = (a) => /\d{4}-\d{2}-\d{2}/.test(a) || ((a.match(/\d+\s*건/g) || []).length >= 3) || /\b(?:vuln|asset|prod|cti):[\w.-]+/.test(a);

// ── 교사 호출 ──────────────────────────────────────────────────────
const SYSTEM = [
  "너는 보안 담당자를 가르치는 교사다. 규칙:",
  "1) 반드시 주어진 근거 조각만으로 답한다. 근거에 없는 사실·숫자·날짜는 쓰지 않는다.",
  "2) 답의 핵심 문장은 근거 조각의 문장을 **그대로** 살려 쓴다(바꿔 말하지 말 것).",
  "3) 질문은 담당자가 실제로 물을 법한 자연스러운 한국어 한 문장. 답은 3~6문장, 한국어만, 한자·영어 나열 금지.",
  "4) 날짜(YYYY-MM-DD)와 「N건」 같은 통계 나열은 쓰지 않는다.",
  "5) cite에는 준 ref 문자열을 그대로 넣는다.",
].join("\n");
const SCHEMA = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" }, cite: { type: "array", items: { type: "string" } } }, required: ["q", "a", "cite"] } } }, required: ["items"] };

async function askTeacher(ref, text) {
  const user = `근거 조각 (ref: ${ref}):\n${text}\n\n위 근거로 서로 다른 질문 ${PER_CHUNK}개와 각 답을 만들어라. 주제는 「${TOPIC}」이다.`;
  const body = { model: "local", messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], temperature: 0.7, max_tokens: 1200, response_format: { type: "json_schema", json_schema: { name: "distill", schema: SCHEMA } } };
  const headers = { "Content-Type": "application/json" };
  if (process.env.GIJO_SERVE_TOKEN) headers["x-gijo-serve-token"] = process.env.GIJO_SERVE_TOKEN;
  const t0 = Date.now();
  const r = await fetch(ENDPOINT + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(600_000) });
  const j = await r.json();
  if (!r.ok) throw new Error(`교사 ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  const content = j.choices?.[0]?.message?.content ?? "";
  let parsed = null; try { parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { /* 아래서 0건 처리 */ }
  return { items: Array.isArray(parsed?.items) ? parsed.items : [], model: String(j.model ?? ""), usage: j.usage ?? {}, ms: Date.now() - t0, promptHash: sha12(SYSTEM + "\n" + user) };
}

// ── 서버 편입 ──────────────────────────────────────────────────────
async function login() {
  const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
  if (!user || !password) throw new Error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다(편입은 admin)");
  const j = await (await fetch(SERVER + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password, force: true }), redirect: "error" })).json();
  if (!j.accessToken) throw new Error("로그인 실패: " + JSON.stringify(j).slice(0, 120));
  return { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken };
}
async function intake(auth, teacher, items) {
  const r = await fetch(SERVER + "/api/learnloop/distill/intake", { method: "POST", headers: auth, body: JSON.stringify({ teacher, items }), redirect: "error" });
  const j = await r.json();
  if (!r.ok) throw new Error(`편입 ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

// ── 본체 ───────────────────────────────────────────────────────────
const files = listSourceFiles();
const pool = [];
for (const f of files) {
  const rel = path.relative(repo, f).replace(/\\/g, "/");
  for (const c of chunk(fs.readFileSync(f, "utf8"))) if (TOPIC_RE[TOPIC].test(c)) pool.push({ ref: `${rel}#${sha12(c)}`, text: c });
}
// 같은 조각이 매번 같은 순서면 상위 조각만 닳는다 — 결정적으로 섞는다(주제+날짜 시드).
const seed = sha12(TOPIC + new Date().toISOString().slice(0, 10));
pool.sort((a, b) => (sha12(a.ref + seed) < sha12(b.ref + seed) ? -1 : 1));
const need = Math.ceil(LIMIT / PER_CHUNK);
const picked = pool.slice(0, need);
console.log(`[distill] 주제 ${TOPIC} · 파일 ${files.length} · 주제 조각 ${pool.length} · 쓸 조각 ${picked.length} (조각당 ${PER_CHUNK}문답, 목표 ${LIMIT}) · 교사 ${ENDPOINT}${DRY ? " · DRY-RUN" : ""}`);
if (!pool.length) { console.error("주제에 맞는 조각이 없습니다 — --files 로 문서를 더 주세요"); process.exit(2); }
if (DRY) { for (const p of picked.slice(0, 3)) console.log("--", p.ref, "\n", p.text.slice(0, 200).replace(/\n/g, " ")); process.exit(0); }

const report = { topic: TOPIC, endpoint: ENDPOINT, startedAt: new Date().toISOString(), files: files.length, chunks: picked.length, generated: 0, preRejected: {}, preChecked: 0, accepted: 0, rejected: {}, teacher: null, tokens: { prompt: 0, completion: 0 }, teacherMs: 0, errors: [] };
// --no-intake: 편입 없이 교사 수율만 잰다(교사·프롬프트 비교용) — 서버 로그인도 안 한다.
const NO_INTAKE = has("--no-intake");
const auth = NO_INTAKE ? null : await login();
const queue = [...picked]; let teacherId = null; const batch = []; const flushEvery = 40;
async function flush(force = false) {
  if (!batch.length || (!force && batch.length < flushEvery)) return;
  const items = batch.splice(0, batch.length);
  report.preChecked += items.length;
  if (NO_INTAKE) { console.log(`[distill] (편입 생략) 사전검사 통과 ${items.length}건`); return; }
  try {
    const r = await intake(auth, teacherId || "unknown", items);
    report.accepted += r.accepted;
    for (const [k, v] of Object.entries(r.byReason || {})) report.rejected[k] = (report.rejected[k] ?? 0) + v;
    console.log(`[distill] 편입 ${r.accepted}/${items.length} · 거절 ${JSON.stringify(r.byReason)}`);
  } catch (e) { report.errors.push(String(e.message)); console.warn("[distill] 편입 실패:", e.message); }
}
async function worker(n) {
  while (queue.length) {
    const c = queue.shift();
    try {
      const t = await askTeacher(c.ref, c.text);
      if (!teacherId && t.model) { teacherId = t.model; report.teacher = t.model; }
      report.tokens.prompt += t.usage.prompt_tokens || 0; report.tokens.completion += t.usage.completion_tokens || 0; report.teacherMs += t.ms;
      for (const it of t.items) {
        report.generated++;
        const q = String(it.q || "").trim(), a = String(it.a || "").trim();
        const pre = !q || !a ? "빈 문답" : a.length < 80 ? "답 너무 짧음" : a.length > 1200 ? "답 너무 김" : 시점데이터(a) ? "시점데이터(날짜·N건)" : !overlap20(a, c.text) ? "근거 겹침 없음(20자)" : null;
        if (pre) { report.preRejected[pre] = (report.preRejected[pre] ?? 0) + 1; continue; }
        batch.push({ question: q, answer: a, topic: TOPIC, cites: [{ ref: c.ref, text: c.text }], promptHash: t.promptHash });
      }
      console.log(`[distill#${n}] ${c.ref.slice(-24)} → ${t.items.length}건 (${(t.ms / 1000).toFixed(0)}s, 남은 조각 ${queue.length})`);
      await flush();
    } catch (e) { report.errors.push(`${c.ref}: ${e.message}`); console.warn(`[distill#${n}] 실패 ${c.ref}: ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
await flush(true);
report.finishedAt = new Date().toISOString();
fs.mkdirSync(path.join(repo, ".tmp-reports"), { recursive: true });
const out = path.join(repo, ".tmp-reports", `distill-${TOPIC}-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16)}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
const total = report.generated || 1;
console.log(`[distill] 끝 — 생성 ${report.generated} · 사전거절 ${Object.values(report.preRejected).reduce((a, b) => a + b, 0)} · 사전검사 통과 ${report.preChecked}(${((report.preChecked / total) * 100).toFixed(0)}%) · 편입 ${NO_INTAKE ? "생략" : `${report.accepted}(${((report.accepted / total) * 100).toFixed(0)}%)`} · 서버거절 ${JSON.stringify(report.rejected)} · 교사 ${report.teacher} · 교사시간 ${(report.teacherMs / 60000).toFixed(1)}분 · 보고서 ${out}`);
