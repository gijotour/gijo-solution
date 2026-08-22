// tools/parse-ab.mjs — 웹취약점 보고서 파싱 A/B 실측 하네스 (2026-08-21, 계획서 전-2 계열)
//
// A = 현행 규칙 파서(server/src/engine/webreport.ts → dist/engine/webreport.js, 순수 함수)
// B = 로컬 LLM(llama-server POST /chat/completions, json_schema 강제, temperature 0)
// 채점 = 결정적(LLM 심판 없음). 분류: 일치 | 불일치 | 누락 | 과추출 | ★지어냄
//   - 지어냄 = gold에 없고 **원문 재확인 실패**(추출 텍스트에 그 이름/코드가 아예 없음)
//   - 과추출 = gold에 없지만 원문에는 있는 문자열(예: 점검항목 목록·조치 가이드를 발견으로 오인)
//   - ★잣대: 지어냄 1건 = 탈락 (어댑터 불채택 잣대와 동일)
//
// 사용법:
//   node tools/parse-ab.mjs A                          # 규칙 파서 실행·채점 (win)
//   node tools/parse-ab.mjs B --base http://127.0.0.1:18080 --label qwen2.5-14b   # LLM 실행·채점 (gb10)
//   node tools/parse-ab.mjs report                     # _results/*.json 통합 markdown 표
//
// 제품 코드는 수정하지 않는다 — 이 파일과 server/test/fixtures/parse-corpus/ 만 만든다.
// 코퍼스 구조: parse-corpus/<샘플>/{source.txt, gold.json, meta.json}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// gb10 시점 복사(~/parse-ab/) 대응: 스크립트 옆에 parse-corpus가 있으면 그것을 쓴다.
const CORPUS = fs.existsSync(path.join(__dirname, "parse-corpus"))
  ? path.join(__dirname, "parse-corpus")
  : path.join(ROOT, "server", "test", "fixtures", "parse-corpus");
const RESULTS = path.join(CORPUS, "_results");

// ── LLM 강제 스키마 (설계서 AB_SCHEMA) — 전 필드 필수, 없으면 빈 문자열 ──────────────
const AB_SCHEMA = {
  type: "object",
  properties: {
    assets: {
      type: "array",
      items: {
        type: "object",
        properties: { host: { type: "string" }, name: { type: "string" }, ip: { type: "string" } },
        required: ["host", "name", "ip"],
      },
    },
    vulns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          host: { type: "string" }, code: { type: "string" }, name: { type: "string" },
          risk: { type: "string" }, cve: { type: "string" }, port: { type: "string" },
        },
        required: ["host", "code", "name", "risk", "cve", "port"],
      },
    },
    declaredTotal: { type: "string" },
  },
  required: ["assets", "vulns", "declaredTotal"],
};

const SYSTEM_PROMPT = [
  "너는 보안 점검 결과보고서 텍스트에서 구조화 데이터를 추출하는 도구다. 규칙:",
  "① 문서에서 실제로 '발견'된 취약점만 vulns에 넣는다. 점검 항목 목록, 항목 설명, 조치(보안 대책) 가이드, '미발견' 표시 항목은 발견이 아니다.",
  "② 값이 문서에 없으면 빈 문자열 \"\"로 둔다. 추측하거나 지어내지 않는다.",
  "③ assets는 점검 대상(호스트·서비스)이다. host에는 도메인 또는 IP를 넣는다.",
  "④ risk는 문서 표기를 그대로 쓴다(예: 상, 중, 하, High, Medium, Low, Informational).",
  "⑤ code는 문서의 취약점 코드([IW-20]이면 IW-20)다. 코드 체계가 없는 문서면 빈 문자열.",
  "⑥ declaredTotal은 문서가 스스로 밝힌 취약점 총 건수다(숫자만, 없으면 빈 문자열).",
  "⑦ 같은 취약점의 변형(URL·파라미터만 다른 발견)은 한 건으로 합친다.",
  "JSON만 출력한다.",
].join("\n");

// ── 정규화 (A·B 동일 적용 — 공정성) ─────────────────────────────────────────────
const RISK_CANON = {
  상: "high", 중: "medium", 하: "low", 정보: "info",
  critical: "critical", high: "high", medium: "medium", moderate: "medium",
  low: "low", info: "info", informational: "info", none: "info",
};
const canonRisk = (r) => RISK_CANON[String(r ?? "").trim().toLowerCase()] ?? RISK_CANON[String(r ?? "").trim()] ?? String(r ?? "").trim().toLowerCase();
const normName = (s) => String(s ?? "").toLowerCase().replace(/^\[[a-z]{2,4}\s*-\s*\d{1,3}\]\s*/i, "").replace(/\s+/g, " ").replace(/[.,;:!?'"()]+$/g, "").trim();
const normCode = (s) => {
  const m = /([A-Za-z]{2,4})\s*-\s*(\d{1,3})/.exec(String(s ?? ""));
  return m ? `${m[1].toUpperCase()}-${String(Number(m[2])).padStart(2, "0")}` : "";
};
const normHost = (s) => String(s ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

// host 해석: gold 자산과 일치하면 그대로, 아니면(예: Acunetix의 "Web Server") 유일 자산으로 귀속.
function resolveHost(raw, goldHosts) {
  const h = normHost(raw);
  if (goldHosts.includes(h)) return h;
  if (goldHosts.length === 1) return goldHosts[0];
  return h;
}

// 키는 gold가 정한다 — gold가 코드 체계를 쓰는 표본이면 host::code, 아니면 host::이름.
// (모델이 코드 없는 문서에 코드를 지어내도 키가 흔들리면 안 된다 — 지어냄은 필드 검사에서 잡는다.)
const vulnKey = (v, goldHosts, goldUsesCodes) => {
  const host = resolveHost(v.host, goldHosts);
  if (goldUsesCodes) {
    const code = normCode(v.code || v.pluginId || "") || normCode(v.name || "");
    if (code) return `${host}::${code}`;
  }
  return `${host}::${normName(v.name)}`;
};

// 원문 재확인 — 지어냄 판정. 공백·대소문자 잡음을 무시하고 이름(또는 코드)이 원문에 있는지 본다.
function foundInSource(v, sourceSquashed) {
  const code = normCode(v.code || v.pluginId || "") || normCode(v.name || "");
  if (code) {
    const [a, b] = code.split("-");
    if (new RegExp(`\\[?\\s*${a}\\s*-\\s*0?${Number(b)}\\s*\\]?`, "i").test(sourceSquashed)) return true;
  }
  const nm = normName(v.name).replace(/\s+/g, "");
  if (nm.length >= 4 && sourceSquashed.includes(nm)) return true;
  // 짧은 이름은 원어 그대로도 본다
  return nm.length > 0 && nm.length < 4 && sourceSquashed.includes(nm);
}

// ── 채점 (결정적) ────────────────────────────────────────────────────────────────
function score(pred, gold, sourceText) {
  const squash = (s) => String(s).toLowerCase().replace(/\s+/g, "");
  const src = squash(sourceText);
  const goldHosts = gold.assets.map((a) => normHost(a.host));

  // 자산
  const assetRows = [];
  const predAssets = new Map();
  for (const a of pred.assets ?? []) {
    const h = normHost(a.host);
    if (h && !predAssets.has(h)) predAssets.set(h, a);
  }
  for (const g of gold.assets) {
    const h = normHost(g.host);
    const p = predAssets.get(h);
    if (!p) { assetRows.push({ key: h, 판정: "누락" }); continue; }
    predAssets.delete(h);
    const ipOk = !g.ip || normHost(p.ip ?? "") === normHost(g.ip);
    assetRows.push({ key: h, 판정: ipOk ? "일치" : "불일치", ...(ipOk ? {} : { 이유: `ip ${p.ip ?? ""}≠${g.ip}` }) });
  }
  for (const [h] of predAssets) {
    assetRows.push({ key: h, 판정: src.includes(squash(h)) ? "과추출" : "지어냄" });
  }

  // 취약점 — 예측을 키로 중복 제거(변형 합치기 규칙과 동일 적용)
  const goldUsesCodes = gold.vulns.some((g) => normCode(g.code));
  const predV = new Map();
  for (const v of pred.vulns ?? []) {
    const k = vulnKey(v, goldHosts, goldUsesCodes);
    if (!predV.has(k)) predV.set(k, v);
  }
  const vulnRows = [];
  // 필드 값 지어냄 검사 — 예측이 채운 값(코드·CVE)이 원문에 아예 없으면 그 자체가 지어냄이다.
  // (14b 실측: 코드 없는 Acunetix 문서에 IW-20~35를 순번으로 창작 — 이름이 맞아도 잡아야 한다.)
  const fabricatedFields = (p, g) => {
    const fab = [];
    const pc = normCode(p.code ?? "");
    if (pc && pc !== normCode(g.code ?? "")) {
      const [a, b] = pc.split("-");
      if (!new RegExp(`${a}\\s*-\\s*0?${Number(b)}`, "i").test(sourceText)) fab.push(`code ${p.code}`);
    }
    const pcve = String(p.cve ?? "").toUpperCase().trim();
    if (pcve && pcve !== String(g.cve ?? "").toUpperCase().trim() && !src.includes(squash(pcve))) fab.push(`cve ${p.cve}`);
    // port — 문서에 없는 값을 채웠으면 창작(32b 실측: "default (80/443 등 …추정)"). 원문에 있는
    // 문자열(예: "http")은 창작이 아니라 불일치로 남는다.
    const pport = String(p.port ?? "").trim();
    if (pport && pport !== String(g.port ?? "").trim() && !src.includes(squash(pport))) fab.push(`port ${p.port}`);
    return fab;
  };
  for (const g of gold.vulns) {
    const k = vulnKey(g, goldHosts, goldUsesCodes);
    const p = predV.get(k);
    if (!p) { vulnRows.push({ key: k, 판정: "누락" }); continue; }
    predV.delete(k);
    const fab = fabricatedFields(p, g);
    if (fab.length) { vulnRows.push({ key: k, 판정: "지어냄", 이유: `필드 창작: ${fab.join(" · ")}` }); continue; }
    const diffs = [];
    if (normName(p.name) !== normName(g.name)) diffs.push(`name ${p.name}`);
    if (canonRisk(p.risk) !== canonRisk(g.risk)) diffs.push(`risk ${p.risk}→${canonRisk(p.risk)}≠${canonRisk(g.risk)}`);
    if ((p.cve ?? "").toUpperCase().trim() !== (g.cve ?? "").toUpperCase().trim()) diffs.push(`cve ${p.cve ?? ""}≠${g.cve}`);
    if (String(p.port ?? "").trim() !== String(g.port ?? "").trim()) diffs.push(`port ${p.port ?? ""}≠${g.port}`);
    vulnRows.push(diffs.length ? { key: k, 판정: "불일치", 이유: diffs.join(" · ") } : { key: k, 판정: "일치" });
  }
  for (const [k, v] of predV) {
    vulnRows.push({ key: k, 판정: foundInSource(v, src) ? "과추출" : "지어냄", 이름: v.name });
  }

  // 자체합계
  const predTotal = String(pred.declaredTotal ?? "").trim();
  const goldTotal = gold.declaredTotal === undefined || gold.declaredTotal === null ? "" : String(gold.declaredTotal);
  const totalOk = predTotal === goldTotal;

  const count = (rows, 판정) => rows.filter((r) => r.판정 === 판정).length;
  return {
    assets: assetRows, vulns: vulnRows,
    declaredTotal: { pred: predTotal, gold: goldTotal, ok: totalOk },
    요약: {
      자산: `${count(assetRows, "일치")}/${gold.assets.length}`,
      취약점일치: count(vulnRows, "일치"),
      불일치: count(vulnRows, "불일치"),
      누락: count(vulnRows, "누락"),
      과추출: count(vulnRows, "과추출") + count(assetRows, "과추출"),
      지어냄: count(vulnRows, "지어냄") + count(assetRows, "지어냄"),
      goldVulns: gold.vulns.length,
      자체합계: totalOk ? "✓" : `✗(${predTotal || "없음"}≠${goldTotal || "없음"})`,
    },
  };
}

// ── 실행기 ──────────────────────────────────────────────────────────────────────
function listSamples() {
  return fs.readdirSync(CORPUS).filter((d) => !d.startsWith("_") && fs.existsSync(path.join(CORPUS, d, "gold.json")));
}
const readSample = (s) => ({
  source: fs.readFileSync(path.join(CORPUS, s, "source.txt"), "utf8"),
  gold: JSON.parse(fs.readFileSync(path.join(CORPUS, s, "gold.json"), "utf8")),
});

async function runA() {
  const require = createRequire(import.meta.url);
  const webreport = require(path.join(ROOT, "server", "dist", "engine", "webreport.js"));
  const out = { engine: "A(규칙 파서 webreport.ts)", ranAt: new Date().toISOString(), samples: {} };
  for (const s of listSamples()) {
    const { source, gold } = readSample(s);
    const t0 = Date.now();
    const r = webreport.parseWebVulnReport(source);
    const ms = Date.now() - t0;
    const pred = {
      assets: r.assets,
      vulns: r.vulns.map((v) => ({ host: v.host, code: v.pluginId, name: v.name, risk: v.risk, cve: v.cve, port: v.port })),
      declaredTotal: r.declaredTotal === undefined ? "" : String(r.declaredTotal),
    };
    out.samples[s] = { ms, pred, notes: r.notes, score: score(pred, gold, source) };
    console.log(`[A] ${s}: ${JSON.stringify(out.samples[s].score.요약)} (${ms}ms)`);
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, "A.json"), JSON.stringify(out, null, 2));
  console.log(`저장: ${path.join(RESULTS, "A.json")}`);
}

async function runB(base, label) {
  const out = { engine: `B(LLM ${label})`, base, ranAt: new Date().toISOString(), samples: {} };
  for (const s of listSamples()) {
    const { source, gold } = readSample(s);
    const body = {
      model: "local",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `다음 보고서 텍스트에서 추출하라.\n\n${source.slice(0, 120000)}` },
      ],
      json_schema: AB_SCHEMA,
      temperature: 0,
      max_tokens: 4096,
    };
    const t0 = Date.now();
    let pred = null, raw = "", err = "";
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = await res.json();
      raw = j.choices?.[0]?.message?.content ?? "";
      pred = JSON.parse(raw);
    } catch (e) {
      err = String(e?.message ?? e);
    }
    const ms = Date.now() - t0;
    if (!pred) {
      out.samples[s] = { ms, error: err, raw: raw.slice(0, 2000) };
      console.log(`[B:${label}] ${s}: 실패 — ${err} (${ms}ms)`);
      continue;
    }
    out.samples[s] = { ms, pred, score: score(pred, gold, source) };
    console.log(`[B:${label}] ${s}: ${JSON.stringify(out.samples[s].score.요약)} (${Math.round(ms / 1000)}s)`);
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `B-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`저장: ${file}`);
}

// ── 원문 대조 가드 (제품 후처리 시뮬레이션 — gold는 안 본다, 원문만 본다) ─────────────
// LLM이 채운 값 중 원문에서 확인 안 되는 code·cve·port·ip를 소거한다. 실측 근거:
// 14b는 코드를(IW-20~35 순번 창작), 32b는 포트를("default …추정") 지어냈다 — 두 양상 모두
// 「원문에 없는 값은 비운다」 한 가지 규칙으로 막힌다. 제품에 그대로 옮길 수 있는 결정적 코드다.
function guardPred(pred, sourceText) {
  const squash = (s) => String(s).toLowerCase().replace(/\s+/g, "");
  const src = squash(sourceText);
  const inSrc = (v) => v && src.includes(squash(v));
  const codeInSrc = (c) => {
    const n = normCode(c);
    if (!n) return false;
    const [a, b] = n.split("-");
    return new RegExp(`${a}\\s*-\\s*0?${Number(b)}`, "i").test(sourceText);
  };
  return {
    assets: (pred.assets ?? []).map((a) => ({ ...a, ip: inSrc(a.ip) ? a.ip : "" })),
    vulns: (pred.vulns ?? []).map((v) => ({
      ...v,
      code: codeInSrc(v.code) ? v.code : "",
      cve: inSrc(v.cve) ? v.cve : "",
      // 포트는 숫자(1~65535)여야 한다 — 제품 ParsedVuln.port 계약. "http"·"default(추정)" 같은
      // 낱말은 포트가 아니므로 소거한다(32b 실측 양상).
      port: /^\d{1,5}$/.test(String(v.port ?? "").trim()) && inSrc(v.port) ? String(v.port).trim() : "",
    })),
    declaredTotal: pred.declaredTotal,
  };
}

// 저장된 예측을 현재 채점기로 재채점한다 — LLM 재실행 없이 채점 수리를 반영(결정적).
// B(LLM) 결과에는 원문 대조 가드를 적용한 점수(scoreGuarded)도 함께 계산한다.
function rescore() {
  for (const f of fs.readdirSync(RESULTS).filter((x) => x.endsWith(".json"))) {
    const file = path.join(RESULTS, f);
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [s, d] of Object.entries(r.samples)) {
      if (!d.pred) continue;
      const { source, gold } = readSample(s);
      d.score = score(d.pred, gold, source);
      console.log(`[재채점 ${f}] ${s}: ${JSON.stringify(d.score.요약)}`);
      if (r.engine.startsWith("B")) {
        d.scoreGuarded = score(guardPred(d.pred, source), gold, source);
        console.log(`[재채점 ${f}+가드] ${s}: ${JSON.stringify(d.scoreGuarded.요약)}`);
      } else delete d.scoreGuarded;
    }
    fs.writeFileSync(file, JSON.stringify(r, null, 2));
  }
}

function report() {
  const files = fs.readdirSync(RESULTS).filter((f) => f.endsWith(".json"));
  const lines = [];
  lines.push("## 파싱 A/B 실측 결과 (지어냄 1건 = 탈락)");
  lines.push("");
  lines.push("| 엔진 | 샘플 | 자산 | 취약점 일치 | 불일치 | 누락 | 과추출 | ★지어냄 | 자체합계 | 소요 | 판정 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const f of files.sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8"));
    for (const [s, d] of Object.entries(r.samples)) {
      if (d.error) {
        lines.push(`| ${r.engine} | ${s} | — | — | — | — | — | — | — | ${Math.round(d.ms / 1000)}s | 실행실패(${d.error.slice(0, 40)}) |`);
        continue;
      }
      const row = (engine, q, ms) => {
        const verdict = q.지어냄 > 0 ? "★탈락"
          : q.취약점일치 === q.goldVulns && q.불일치 === 0 && q.과추출 === 0 && q.자체합계 === "✓" ? "통과"
          : "부분";
        lines.push(`| ${engine} | ${s} | ${q.자산} | ${q.취약점일치}/${q.goldVulns} | ${q.불일치} | ${q.누락} | ${q.과추출} | ${q.지어냄} | ${q.자체합계} | ${ms < 2000 ? ms + "ms" : Math.round(ms / 1000) + "s"} | ${verdict} |`);
      };
      row(r.engine, d.score.요약, d.ms);
      if (d.scoreGuarded) row(`${r.engine}+원문가드`, d.scoreGuarded.요약, d.ms);
    }
  }
  const md = lines.join("\n");
  console.log(md);
  fs.writeFileSync(path.join(RESULTS, "REPORT.md"), md);
}

// ── 진입점 ──────────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : dflt;
};
if (cmd === "A") await runA();
else if (cmd === "B") await runB(arg("base", "http://127.0.0.1:18080"), arg("label", "llm"));
else if (cmd === "rescore") rescore();
else if (cmd === "report") report();
else {
  console.log("사용법: node tools/parse-ab.mjs A | B --base <url> --label <모델명> | rescore | report");
  process.exit(1);
}
