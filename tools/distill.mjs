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
//     [--source files|store] [--corpus-server http://localhost:4000] [--force-login]
//     [--src-lang ko|en] [--no-topic-filter]
//   --no-intake: 편입 없이 교사 수율(사전검사 통과율)만 잰다 — 보고서의 accepted는 0, preChecked에 남는다.
//   --src-lang en: 근거가 **영어 원문**일 때(NVD·CISA·ATT&CK). 문답은 한국어로 쓰되 답 안에 근거의 영어 원문
//     **한 문장을 그대로** 인용하게 한다(「원문: "…"」) — 20자 겹침 규칙을 **완화하지 않고** 그대로 통과시키는 길이다.
//     왜 필요한가(설계관 2026-09-03 실측): 기본 프롬프트는 「한국어만」과 「근거 문장을 그대로 살려 쓴다」를 함께
//     요구하는데 근거가 영어면 이 둘이 서로를 배반해 답↔조각 20자 겹침이 0이 되고 **전량 거절**됐다(편입률 0).
//   --no-topic-filter: --files 로 사람이 문서를 골랐을 때 주제 정규식(TOPIC_RE) 선별을 건너뛴다.
//     왜: TOPIC_RE는 한글 낱말뿐이라 영어 조각은 재료 단계에서 먼저 사라진다(주제 조각 0 → 즉사).
//   ⚠ --topic 일반 은 --source files(문서 지목)만 된다 — 「일반」은 두 뜻이라(증류 주제=용어·개념 / 문서 업무영역=전 영역
//     공용 + 분류 미확정 기본값) store로 받으면 미분류 더미가 통째로 용어 재료가 된다(검토관 2026-09-03 가).
// 산출: .tmp-reports/distill-<주제>-<시각>.json (생성·사전검사·편입·거절 사유·교사·토큰·시간 — 폐기율이 교사 품질 지표)
//   + server/data/distill-archive/<주제>-<시각>.jsonl — 문답과 **근거 본문**(RAFT 빌더 재료, 아래 「근거 본문 보관」)
//
// 근거 조각 = 저장소의 문서 파일(기본: server/docs-manifest.json의 files + knowledge/*.md)을 800자로 자른 것.
//   ref = <경로>#<sha1(본문) 12자> — 재인입해도 안 바뀐다. 고객 자산·규정은 여기 안 쓴다(출하 재료 원칙 5).
// 표준 라이브러리만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 시점데이터, sha12, 사전검사 } from "./distill-precheck.mjs";

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
// --source store: 근거를 저장소 파일이 아니라 **운영 지식 저장소의 조각**(POST /api/learnloop/distill/corpus)에서 받는다(2026-09-03).
//   운영에 올린 매뉴얼·지침·보고서가 재료가 되고, 조각 경계도 검색이 쓰는 그것이다. ref = store:<문서>#<sha12>.
const SOURCE = opt("--source", "files");
const CORPUS_SERVER = (opt("--corpus-server", SERVER) || "").replace(/\/+$/, "");
if (!["files", "store"].includes(SOURCE)) { console.error("--source 는 files 또는 store"); process.exit(2); }
// --src-lang en: 근거가 영어일 때의 교사 지시(아래 SYSTEM_EN). 규칙을 푸는 것이 아니라 **인용으로 통과**시킨다.
const SRC_LANG = opt("--src-lang", "ko");
if (!["ko", "en"].includes(SRC_LANG)) { console.error("--src-lang 은 ko 또는 en"); process.exit(2); }
// --no-topic-filter: 사람이 --files 로 고른 문서에만 허용한다. 저장소(store)는 업무영역 분류가 틀린 문서의
//   엉뚱한 조각을 주제 정규식이 한 번 더 걸러 주는 구조라(아래 SOURCE==="store" 갈래), 여기서 끄면 그 그물이 사라진다.
const NO_TOPIC_FILTER = has("--no-topic-filter");
if (NO_TOPIC_FILTER && (SOURCE !== "files" || !FILES)) {
  console.error("--no-topic-filter 는 --source files 와 --files 를 함께 줄 때만 됩니다 — 「사람이 문서를 골랐다」가 이 스위치의 근거이기 때문입니다.");
  process.exit(2);
}
// ⚠ 서버 learnloop.ts TOPICS와 같은 값·같은 순서여야 한다 — 편입 라우트(learncandidates.ts)가 서버 TOPICS로 topic을
//   받아들이므로 여기만 더하면 「주제 없음」으로 전부 거절된다. 「일반」(2026-09-03)=해설 팀원 normaltic 재료(용어·개념).
const TOPICS = ["취약점", "장비운영", "사내규정", "위협대응", "일반"];
if (!TOPICS.includes(TOPIC)) { console.error(`--topic 은 ${TOPICS.join("·")} 중 하나여야 합니다`); process.exit(2); }
// ⚠ 「일반」은 두 뜻이다(검토관 2026-09-03 가). 증류 주제 「일반」=용어·개념(해설 팀원 재료). 문서 업무영역 「일반」=전 영역 공용
//   자료이자 **분류 실패 기본값**(memory.ts categorizeDocument — 규칙·LLM이 확신 못 하면 「일반(그 외)」). 글자가 같아
//   --source store로 코퍼스 창구(learncandidates buildDistillCorpus)에 category=일반 을 넣으면 회의 메모·엉뚱한 PDF 같은
//   미분류 더미가 통째로 용어 재료로 둔갑한다. 그래서 「일반」은 --files 로 문서(용어사전·knowledge/*.md)를 지목하는 길만 연다.
if (TOPIC === "일반" && SOURCE === "store") {
  console.error("--topic 일반 은 --source store 를 받지 않습니다 — 저장소의 업무영역 「일반」은 「분류 미확정」 문서까지 담는 기본값이라 용어·개념 재료가 아닙니다. --source files --files \"GIJO_AS_용어사전.md,knowledge/*.md\" 처럼 문서를 지목하세요.");
  process.exit(2);
}

// ── 주제별 조각 고르기(낱말 규칙 — 서버 질문주제와 같은 취지, 재료 선별용) ─────────────────
// ⚠ TOPICS에 주제를 더하면 여기도 더한다 — 없으면 아래 TOPIC_RE[TOPIC].test에서 TypeError로 즉사한다.
const TOPIC_RE = {
  취약점: /취약점|CVE|CVSS|KEV|EPSS|패치|취약|스캔|SBOM|익스플로잇|공격 표면/i,
  장비운영: /방화벽|장비|스위치|라우터|VPN|백업|정기점검|설정|펌웨어|IPS|IDS|WAF|EDR|SIEM|로그 보관/i,
  사내규정: /규정|지침|정책|승인|보고|절차|책임|ISMS|개인정보|법|의무|감사|보관 기간|접근 통제/i,
  위협대응: /위협|침해|사고|악성|랜섬|피싱|C2|IOC|CTI|인텔|대응|격리|초동|탐지/i,
  // 「일반」= 용어·개념 해설 조각. 용어사전(GIJO_AS_용어사전.md)의 표제어 꼴이 근거 — 「**용어**」 다음 줄이
  //   「쉽게 말하면 …」, 약자는 「무엇의 줄임말인지·읽는 법」을 적는다(문서 머리말 규칙). 지식 문서(knowledge/*.md)의
  //   「○○이란」「정의」「개념」 조각도 같은 잣대로 든다. 재료는 --files "GIJO_AS_용어사전.md,knowledge/*.md"로 지목한다.
  //   「이란/란」은 서버 learnloop.ts GENERAL_RE와 같은 취지로 좁힌다(검토관 2026-09-03 라): 단독 낱말 「이란」(국가명)은 앞글자
  //   없이 서므로 빼고, 「혼란·분란·교란·반란·소란·파란·착란」은 끝음절만 같을 뿐이라 앞 음절로 뺀다 — 끝음절만으로 조각을 뽑지 않게.
  일반: /쉽게 말하면|용어|뜻|약자|약어|줄임말|정의|개념|읽는 법|무엇의|무엇인가|(?<=\S)이란(?=[\s?!.,:]|$)|(?<![혼분교반소파착이\s])란(?=[\s?!.,:]|$)/i,
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

// 사전검사 잣대(겹침·시점데이터·한국어)는 distill-precheck.mjs 한 곳에 둔다 — 서버 규칙의 사본이라
//   시험이 서버 함수와 직접 대조할 수 있어야 하고, 그러려면 최상위 await 스크립트 밖에 있어야 한다.
// ⚠ 최종 관문은 서버다(규칙이 바뀌면 서버가 거절한다) — 여기는 왕복을 아끼는 사전검사일 뿐.

// ── 교사 호출 ──────────────────────────────────────────────────────
const SYSTEM_KO = [
  "너는 보안 담당자를 가르치는 교사다. 규칙:",
  "1) 반드시 주어진 근거 조각만으로 답한다. 근거에 없는 사실·숫자·날짜는 쓰지 않는다.",
  "2) 답의 핵심 문장은 근거 조각의 문장을 **그대로** 살려 쓴다(바꿔 말하지 말 것).",
  "3) 질문은 담당자가 실제로 물을 법한 자연스러운 한국어 한 문장. 답은 3~6문장, 한국어만, 한자·영어 나열 금지.",
  "4) 날짜(YYYY-MM-DD)와 「N건」 같은 통계 나열은 쓰지 않는다.",
  "5) cite에는 준 ref 문자열을 그대로 넣는다.",
].join("\n");
// 영어 원천용 — 규칙을 **완화하지 않는다.** 「한국어로 설명」과 「원문 그대로 겹침」이 서로를 배반하지 않게
//   답 안에 원문 한 문장을 인용으로 심는다. 겹침 판정(overlap20)은 공백을 지우고 20자 창을 4칸씩 밀며 보므로
//   인용이 짧으면 창이 어긋나 못 걸린다 — 그래서 「40자 이상인 문장」을 고르게 한다(20자는 경계값이다).
//   인용은 **한 문장만**이다: 문서를 통째로 옮기면 「사실만 싣는다」는 재료 원칙(docslicense)이 인용이 아니라 복제가 된다.
const SYSTEM_EN = [
  "너는 보안 담당자를 가르치는 교사다. 근거 조각은 **영어 원문**이다. 규칙:",
  "1) 반드시 주어진 근거 조각만으로 답한다. 근거에 없는 사실·숫자·날짜는 쓰지 않는다.",
  "2) 질문과 설명은 **한국어**로 쓴다. 질문은 담당자가 실제로 물을 법한 자연스러운 한국어 한 문장.",
  '3) 답 안에 근거 조각의 영어 문장 **하나**를 한 글자도 바꾸지 말고 그대로 옮겨 「원문: "..."」 꼴로 넣는다.',
  "   고르는 문장은 40자보다 길어야 하고, 인용은 한 번·한 문장뿐이다. 나머지는 전부 한국어 설명이다.",
  "4) 답은 3~6문장. 인용을 뺀 나머지 설명은 한국어만 쓴다(한자 금지).",
  "5) 날짜(YYYY-MM-DD)와 「N건」 같은 통계 나열은 쓰지 않는다 — 그런 숫자가 든 문장은 인용으로 고르지 말고 다른 문장을 골라라.",
  "6) cite에는 준 ref 문자열을 그대로 넣는다.",
].join("\n");
const SYSTEM = SRC_LANG === "en" ? SYSTEM_EN : SYSTEM_KO;
const SCHEMA = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" }, cite: { type: "array", items: { type: "string" } } }, required: ["q", "a", "cite"] } } }, required: ["items"] };

async function askTeacher(ref, text) {
  // 영어 원천이면 사용자 지시에서도 한 번 더 못을 박는다 — 체계 지시만으로는 모델이 통째로 영어로 답하거나
  //   인용을 빼먹는 일이 잦다(그 답은 아래 사전검사에서 「한국어 아님」·「영어 원문 인용 없음」으로 떨어진다).
  const 꼬리 = SRC_LANG === "en"
    ? ' 근거는 영어이니 설명은 한국어로 쓰고, 각 답에 근거의 영어 문장 하나를 「원문: "..."」로 그대로 옮겨 넣어라.'
    : "";
  const user = `근거 조각 (ref: ${ref}):\n${text}\n\n위 근거로 서로 다른 질문 ${PER_CHUNK}개와 각 답을 만들어라. 주제는 「${TOPIC}」이다.${꼬리}`;
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
// ⚠ signal(60초)을 왜 못 박나: undici 기본 HeadersTimeout이 **300초**다. 서버가 재시작 중이면
//   로그인 요청이 5분을 매달렸다가 죽는데, 그동안 화면에는 아무 줄도 안 나와 사람은 「도는 중」으로
//   읽는다(2026-09-03 사내규정-01 실기동: 로그에 `[distill]` 첫 줄조차 없이 UND_ERR_HEADERS_TIMEOUT).
//   로그인은 1초짜리 일이다 — 60초를 넘겼으면 그건 「느린 것」이 아니라 「없는 것」이다.
const 창구타임아웃 = 60_000;
async function login(base = SERVER) {
  const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
  if (!user || !password) throw new Error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다(편입은 admin)");
  const j = await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password, force: has("--force-login") }), redirect: "error", signal: AbortSignal.timeout(창구타임아웃) })).json();
  if (!j.accessToken) throw new Error("로그인 실패: " + JSON.stringify(j).slice(0, 120) + (/(세션|로그인)/.test(JSON.stringify(j)) ? " — 이미 로그인된 세션이 있으면 --force-login(그 세션이 끊긴다)" : ""));
  return { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken };
}
async function intake(auth, teacher, items) {
  const r = await fetch(SERVER + "/api/learnloop/distill/intake", { method: "POST", headers: auth, body: JSON.stringify({ teacher, items }), redirect: "error" });
  const j = await r.json();
  if (!r.ok) throw new Error(`편입 ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

// ── 최상위(try 밖) 호출을 지키는 껍데기 ─────────────────────────────
// ⚠ 왜 있나(2026-09-03 1일차 실기동에서 회차 하나를 통째로 잃었다): 아래 저장소(store) 갈래의
//   로그인·코퍼스 호출은 **최상위 await**이라 try 밖이다. 그래서 win 서버가 **한 번 재시작되는**
//   그 몇십 초에 걸리면 처리되지 않은 예외로 프로세스가 즉사했고, 그것도 조용히 죽었다
//   (undici HeadersTimeout 300초를 다 기다린 뒤라 로그에 `[distill]` 첫 줄조차 없었다).
//   ①위 창구타임아웃으로 60초에 끊고 ②20초 뒤 **한 번만** 다시 부르고 ③그래도 안 되면
//   사람이 읽을 사유를 남기고 나간다(코드 2 = 쓰는 법·전제 틀림. 아무것도 안 태웠다는 뜻이다).
// 왜 한 번뿐인가: 서버 재시작은 20~30초면 끝난다. 무한정 매달리면 「죽었는데 도는 것처럼 보이는」
//   시간만 길어져, 밤새 도는 사슬에서는 빨리 죽는 편이 싸다.
async function 한번더(무엇, 부르기) {
  try {
    return await 부르기();
  } catch (e) {
    console.warn(`[distill] ${무엇} 실패: ${e.message} — 20초 뒤 한 번만 더 부른다(서버 재시작이면 그 사이에 돌아온다)`);
    await new Promise((r) => setTimeout(r, 20_000));
    try {
      return await 부르기();
    } catch (e2) {
      console.error(`✗ [distill] ${무엇} — 두 번 다 실패했다: ${e2.message}`);
      console.error(`  볼 곳: ${CORPUS_SERVER} 가 살아 있나(/api/health) · 같은 계정 세션이 물고 있나(409면 --force-login) · VPN·방화벽.`);
      console.error("  이 회차는 교사를 한 번도 안 불렀다 — 서버를 살린 뒤 같은 명령을 그대로 다시 돌리면 된다.");
      process.exit(2);
    }
  }
}

// ── 본체 ───────────────────────────────────────────────────────────
const files = SOURCE === "store" ? [] : listSourceFiles(); // store면 파일 수 0으로 정직하게(로그 「파일 N」이 재료를 잘못 말하지 않게)
const pool = [];
for (const f of (SOURCE === "store" ? [] : files)) {
  const rel = path.relative(repo, f).replace(/\\/g, "/");
  // --no-topic-filter면 주제 정규식을 건너뛴다 — 사람이 --files 로 고른 문서가 곧 선별이다(영어 원천은 한글 낱말에 안 걸린다).
  for (const c of chunk(fs.readFileSync(f, "utf8"))) if (NO_TOPIC_FILTER || TOPIC_RE[TOPIC].test(c)) pool.push({ ref: `${rel}#${sha12(c)}`, text: c });
}
// 같은 조각이 매번 같은 순서면 상위 조각만 닳는다 — 결정적으로 섞는다(주제+날짜 시드).
let 코퍼스문서 = 0;
let 코퍼스auth = null; // 같은 서버면 편입에도 이 세션을 쓴다 — 같은 계정 두 번 로그인은 중복로그인 방지(409)에 걸린다(검토관 2026-09-03)
if (SOURCE === "store") {
  // 지식 저장소 조각 — admin 로그인 필요(코퍼스 창구는 admin). 같은 창구로 편입도 하므로 계정 하나면 된다.
  // ⚠ 이 둘은 try 밖 최상위 await이라 예전에는 서버 재시작 한 번에 회차째 즉사했다 — 한번더()가 지킨다.
  코퍼스auth = await 한번더("코퍼스 서버 로그인", () => login(CORPUS_SERVER));
  const auth = 코퍼스auth;
  const j = await 한번더("코퍼스 창구(/api/learnloop/distill/corpus)", async () => {
    const r = await fetch(CORPUS_SERVER + "/api/learnloop/distill/corpus", { method: "POST", headers: auth, body: JSON.stringify({ category: TOPIC, maxChunks: 20000 }), redirect: "error", signal: AbortSignal.timeout(창구타임아웃) });
    const 몸 = await r.json();
    if (!r.ok) throw new Error("코퍼스 창구 실패: " + JSON.stringify(몸).slice(0, 200));
    return 몸;
  });
  코퍼스문서 = j.docs;
  // 저장소는 업무영역으로 이미 걸렀지만 주제 정규식도 한 번 더 — 분류가 틀린 문서의 엉뚱한 조각을 막는다(파일 경로와 같은 잣대).
  for (const c of j.chunks) if (TOPIC_RE[TOPIC].test(c.text)) pool.push({ ref: c.ref, text: c.text });
  console.log(`[distill] 저장소 코퍼스: 문서 ${j.docs} · 조각 ${j.chunks.length} → 주제 일치 ${pool.length} · 거름 ${JSON.stringify(j.skipped)}`);
}
const seed = sha12(TOPIC + new Date().toISOString().slice(0, 10));
pool.sort((a, b) => (sha12(a.ref + seed) < sha12(b.ref + seed) ? -1 : 1));
const need = Math.ceil(LIMIT / PER_CHUNK);
const picked = pool.slice(0, need);
console.log(`[distill] 주제 ${TOPIC} · 원천말 ${SRC_LANG}${NO_TOPIC_FILTER ? "(주제선별 끔)" : ""} · 파일 ${files.length} · 주제 조각 ${pool.length} · 쓸 조각 ${picked.length} (조각당 ${PER_CHUNK}문답, 목표 ${LIMIT}) · 교사 ${ENDPOINT}${DRY ? " · DRY-RUN" : ""}`);
if (!pool.length) {
  console.error(SOURCE === "store"
    ? `저장소에 '${TOPIC}' 업무영역의 공개(global) 문서 조각이 없거나 거름(위 줄의 skipped)에 전부 걸렸습니다 — 문서의 업무영역 분류·등급을 확인하세요`
    : SRC_LANG === "en" && !NO_TOPIC_FILTER
      ? "주제에 맞는 조각이 없습니다 — 주제 정규식은 한글 낱말뿐이라 영어 원천은 여기서 전부 사라집니다. --no-topic-filter 를 함께 주세요"
      : "주제에 맞는 조각이 없습니다 — --files 로 문서를 더 주세요");
  process.exit(2);
}
if (DRY) {
  // 시점데이터 규칙이 얼마나 버릴지 — **조각**을 재는 대리 지표다(답은 교사를 불러야 나오므로 dry-run은 답을 못 잰다).
  //   왜 이 값이 말이 되나: 교사에게 「근거 문장을 그대로 살려 쓰라」(en 모드는 「원문 한 문장을 인용하라」)고
  //   시키므로, 근거에 날짜·「N건」이 박혀 있으면 답에도 따라 들어와 사전검사에서 떨어진다.
  const 날짜 = picked.filter((p) => /\d{4}-\d{2}-\d{2}/.test(p.text)).length;
  const 건수 = picked.filter((p) => (p.text.match(/\d+\s*건/g) || []).length >= 3).length;
  const 식별자 = picked.filter((p) => /\b(?:vuln|asset|prod|cti):[\w.-]+/.test(p.text)).length;
  const 걸림 = picked.filter((p) => 시점데이터(p.text)).length;
  const 몫 = ((걸림 / (picked.length || 1)) * 100).toFixed(0);
  console.log(`[distill] 시점데이터 대리지표 — 쓸 조각 ${picked.length} 중 ${걸림}개(${몫}%)에 날짜·「N건」·식별자가 있다 (날짜 ${날짜} · 「N건」3회+ ${건수} · 식별자 ${식별자}). 답 기준 실측이 아니라 **조각 기준 상한 추정**이다 — 교사가 그 문장을 피해 인용하면 통과한다.`);
  for (const p of picked.slice(0, 3)) console.log("--", p.ref, "\n", p.text.slice(0, 200).replace(/\n/g, " "));
  process.exit(0);
}

const 시각 = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
// ── 근거 본문 보관(RAFT 재료) ───────────────────────────────────────
// 왜: 서버는 편입 때 근거 **ref만** 저장한다(learncandidates insertDistillStmt: cites=ref 배열). 그런데 RAFT형
//   학습 재료는 「질문 + 검색 조각(정답 조각 + 방해 조각) + 근거 인용 답」이라 **조각 본문**이 있어야 만들어진다.
//   나중에 ref로 되찾으려면 문서가 그때와 한 글자도 같아야 하는데(ref 꼬리가 본문 sha12다) 재인입·수정 한 번이면
//   달라져 못 찾는다 — 실측으로도 승인 1,776건이 전부 ref만 갖고 있어 빌더가 본문을 되찾아야 하는 처지다(계획서 §12.6).
//   그래서 본문이 손에 있는 유일한 자리(교사에게 준 바로 그 텍스트)에서 남긴다.
// 한 줄 = {question, answer, topic, cites:[{ref,text}], promptHash, accepted}. accepted는 **서버 편입 결과**이고,
//   편입을 시도하지 않았거나(--no-intake) 편입 요청 자체가 실패하면 **null**이다(모른다를 false로 적지 않는다).
// 운영 데이터라 저장소에 안 들어간다(.gitignore server/data/).
const ARCHIVE_DIR = path.join(repo, "server", "data", "distill-archive");
const ARCHIVE = path.join(ARCHIVE_DIR, `${TOPIC}-${시각}.jsonl`);

const report = { topic: TOPIC, endpoint: ENDPOINT, startedAt: new Date().toISOString(), files: SOURCE === "store" ? 0 : files.length, source: SOURCE, srcLang: SRC_LANG, topicFilter: !NO_TOPIC_FILTER, corpusDocs: 코퍼스문서, chunks: picked.length, generated: 0, preRejected: {}, preChecked: 0, accepted: 0, rejected: {}, archive: path.relative(repo, ARCHIVE).replace(/\\/g, "/"), archived: 0, teacher: null, tokens: { prompt: 0, completion: 0 }, teacherMs: 0, errors: [] };
function 보관(items, accepted) {
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.appendFileSync(ARCHIVE, items.map((it, i) => JSON.stringify({
      question: it.question, answer: it.answer, topic: it.topic,
      cites: it.cites, promptHash: it.promptHash ?? null,
      accepted: typeof accepted === "function" ? accepted(i) : accepted,
    }) + "\n").join(""), "utf8");
    report.archived += items.length;
  } catch (e) {
    // 보관 실패로 증류를 멈추지 않는다 — 다만 조용히 넘기면 「있는 줄 알았는데 없는」 최악이 되므로 보고서에 남긴다.
    report.errors.push(`보관 실패: ${e.message}`); console.warn("[distill] 보관 실패:", e.message);
  }
}

// --no-intake: 편입 없이 교사 수율만 잰다(교사·프롬프트 비교용) — 서버 로그인도 안 한다.
const NO_INTAKE = has("--no-intake");
let auth = NO_INTAKE ? null : (코퍼스auth && CORPUS_SERVER === SERVER ? 코퍼스auth : await login()); // 세션 하나 재사용(서버가 다를 때만 새 로그인) · 401이면 flush가 다시 로그인한다
const queue = [...picked]; let teacherId = null; const batch = []; const flushEvery = 40;
async function flush(force = false) {
  if (!batch.length || (!force && batch.length < flushEvery)) return;
  const items = batch.splice(0, batch.length);
  report.preChecked += items.length;
  if (NO_INTAKE) { 보관(items, null); console.log(`[distill] (편입 생략) 사전검사 통과 ${items.length}건`); return; }
  try {
    let r;
    try {
      r = await intake(auth, teacherId || "unknown", items);
    } catch (e) {
      // 접속 토큰은 짧게 만료된다 — 긴 증류(30분+)에서 뒤쪽 묶음이 401로 통째로 버려졌다(2026-09-03 실측: 223건 중 141건).
      if (!/편입 401/.test(String(e.message))) throw e;
      console.warn("[distill] 편입 401 — 다시 로그인해 한 번 더");
      auth = await login();
      r = await intake(auth, teacherId || "unknown", items);
    }
    report.accepted += r.accepted;
    for (const [k, v] of Object.entries(r.byReason || {})) report.rejected[k] = (report.rejected[k] ?? 0) + v;
    // 서버가 건별 거절을 묶음 안 자리(i)로 돌려준다 — 그 자리로 accepted를 건별로 적는다(묶음 통째로 true/false가 아니다).
    const 거절자리 = new Set((r.rejected || []).map((x) => x.i));
    보관(items, (i) => !거절자리.has(i));
    console.log(`[distill] 편입 ${r.accepted}/${items.length} · 거절 ${JSON.stringify(r.byReason)}`);
  } catch (e) {
    report.errors.push(String(e.message)); console.warn("[distill] 편입 실패:", e.message);
    보관(items, null); // 편입을 못 했으니 「모른다」 — 교사가 만든 근거 본문은 그래도 남긴다
    // 편입 못 한 문답은 보고서에 남긴다 — 교사 시간이 사라지지 않게(다음 실행이 --reintake로 넣을 수 있다)
    (report.failedItems ??= []).push(...items);
  }
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
        const pre = 사전검사(q, a, c.text, { srcLang: SRC_LANG });
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
// 보고서와 보관 파일은 **같은 시각**을 쓴다(시작 시각) — 이름이 어긋나면 나중에 둘을 짝지을 수 없다.
const out = path.join(repo, ".tmp-reports", `distill-${TOPIC}-${시각}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
const total = report.generated || 1;
console.log(`[distill] 끝 — 생성 ${report.generated} · 사전거절 ${Object.values(report.preRejected).reduce((a, b) => a + b, 0)} · 사전검사 통과 ${report.preChecked}(${((report.preChecked / total) * 100).toFixed(0)}%) · 편입 ${NO_INTAKE ? "생략" : `${report.accepted}(${((report.accepted / total) * 100).toFixed(0)}%)`} · 서버거절 ${JSON.stringify(report.rejected)} · 교사 ${report.teacher} · 교사시간 ${(report.teacherMs / 60000).toFixed(1)}분 · 보관 ${report.archived}줄 ${report.archive} · 보고서 ${out}`);
