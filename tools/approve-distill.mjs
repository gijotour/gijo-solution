#!/usr/bin/env node
// tools/approve-distill.mjs — 후보함의 **증류분만** 품질 심사해 승인한다(증류학습 계획서 §12.2 「후보 편입·승인
//   (품질 심사 자동, 증류분만)」 · §12.4 「승인은 사장님 위임 범위(증류분 자동 품질 심사)만, 실대화 후보는 사람」).
//
// ⚠ 왜 서버의 일괄 승인을 안 쓰나: 서버 acceptStrongCandidates는 증류 후보를 **일부러 건너뛴다**
//   (「교사 문답은 사람 눈을 한 번은 지나야 한다」, 계획서 §9-3). 이 도구는 그 원칙을 뒤집는 것이 아니라,
//   사장님이 사다리 3일 동안 **증류분에 한해** 위임한 자동 심사 경로다. 그래서 아래 두 가지를 지킨다:
//     ① source==="distill" 이 아닌 후보는 **절대** 건드리지 않는다(실대화·작업내역은 사람 몫).
//     ② 무엇을 어떤 잣대로 승인·탈락시켰는지 **결과 파일로 남긴다**(--out).
// ⚠ 승인 사유가 감사에 안 남는다: 서버 감사는 「학습 후보 결정 / 승인 / <id>」만 적는다(learncandidates 라우트).
//   **왜 승인했는지·무엇을 왜 떨어뜨렸는지의 근거는 이 결과 파일뿐**이다 — 그래서 results-ladder에 함께 커밋한다.
// ⚠ 승인은 되돌리기 쉽지 않다: 승인 = 👍 기록 **그리고** 그 주제 지식영역에 문서로 반입(다음 답의 근거가 된다).
//   그래서 --max 로 하루 상한을 두고, --dry-run 으로 먼저 세어 보고 돌린다.
//
// 사용:
//   GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… node tools/approve-distill.mjs [--topic 취약점] [--dry-run]
//     [--max 300] [--server http://localhost:4000] [--days 60] [--limit 2000] [--out] [--day 2026-09-04]
//     [--reject-failed] [--force-login]
//   진행 로그는 stderr, **결과 JSON은 stdout** — `2>/dev/null` 하면 JSON만 남는다.
//
// ⚠ 창 두 겹을 알고 써야 한다(서버 listLearnCandidates 실측):
//   ① 증류 후보는 실대화·작업내역을 채우고 **남는 칸**에만 붙는다 → --limit 이 작으면 증류가 0건으로 보인다.
//      그래서 기본값이 2000이고, kpis.distill(진짜 총수)과 받아온 수가 다르면 「창 모자람」을 결과에 적는다.
//   ② 서버 증류 창 자체가 500건이다(unratedDistillStmt LIMIT 500) → 한 번에 최대 500건. 승인하면 창에서
//      빠지므로 **여러 번 돌리면** 나머지가 따라 나온다.
// 표준 라이브러리만 쓴다(toolsdeps 감시).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── 품질 심사(순수 함수 — 시험이 직접 부른다: server/test/approvedistill.test.ts) ────────────
/** JSON·덤프 조각이 답에 섞인 것 — 교사가 자료 파일의 키 이름을 소리 나는 대로 읽어 문답을 만든 꼴(첫 운영 증류 실측). */
export const JSON조각_RE = /"[A-Za-z_][A-Za-z0-9_.]*"\s*:|[{}[\]]{2,}|^\s*[{[]/;
/** 한자 — 중국어 드리프트의 흔적이다. 이걸 학습하면 모델이 한자를 섞어 답하는 법을 배운다.
 *  제품(llm.ts)은 단일 한자를 봐주지만 **학습 재료는 봐주지 않는다** — 고르는 자리라 엄해도 잃는 것이 없다. */
export const 한자_RE = /[一-鿿㐀-䶿]/;
/** 답 최소 길이. 서버 편입은 30자(길이 극단)까지 받지만, 가중치에 넣을 재료는 그보다 엄하게 본다. */
export const 답최소 = 60;

/** 후보 한 건을 승인할까 — 통과면 null, 아니면 **탈락 사유**(결과 JSON byReason의 키가 된다). */
export function 심사(c) {
  const q = String(c?.question ?? "").trim();
  const a = String(c?.answer ?? "").trim();
  if (!q || !a) return "빈 문답";
  if (a.length < 답최소) return `답 ${답최소}자 미만`;
  if (한자_RE.test(q) || 한자_RE.test(a)) return "한자 섞임";
  if (JSON조각_RE.test(a)) return "JSON 조각";
  return null;
}

/** 손댈 후보만 고른다 — **증류분만**, 주제를 주면 그 주제만. 다른 출처는 이 도구가 절대 안 만진다. */
export function 고르기(candidates, { topic = "" } = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c?.source === "distill")
    .filter((c) => !topic || c?.topic === topic);
}

/** 그 지역 달력의 오늘(YYYY-MM-DD) — 밤 작업이 UTC 날짜로 넘어가 어제 폴더에 떨어지지 않게. */
export function 오늘날짜(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ── 본체(스크립트로 실행할 때만 돈다 — import하면 아무 일도 일어나지 않는다) ───────────────
async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, "..");
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const has = (k) => args.includes(k);
  const 로그 = (...a) => console.error("[approve]", ...a); // 진행은 stderr — stdout은 결과 JSON만

  const SERVER = (opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000") || "").replace(/\/+$/, "");
  const TOPIC = opt("--topic", "");
  const DRY = has("--dry-run");
  // 숫자 옵션은 검사해서 죽인다 — `--max 삼백` 이 NaN이 되면 비교가 늘 거짓이라 **상한이 통째로 사라진다**(조용한 사고).
  const 수 = (k, d) => { const v = opt(k, String(d)); const n = Number(v); if (!Number.isFinite(n) || n < 0) { console.error(`${k} 는 0 이상의 숫자여야 합니다(받은 값: ${v})`); process.exit(2); } return n; };
  const MAX = 수("--max", 100000);
  const DAYS = 수("--days", 60);
  const LIMIT = 수("--limit", 2000);
  const REJECT_FAILED = has("--reject-failed");
  const DAY = opt("--day", 오늘날짜());
  const 시각 = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace(/[:T]/g, "-").slice(0, 16);

  const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
  if (!user || !password) { console.error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다"); process.exit(2); }
  // 기본은 force가 아니다 — 증류가 같은 계정으로 돌고 있으면 force 로그인이 **그 세션을 끊는다**(계정당 1세션).
  //   밤새 돌던 증류를 승인 스크립트가 죽이는 일이 없게, 끊을 각오가 있을 때만 --force-login.
  const login = async () => {
    const lr = await fetch(SERVER + "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password, force: has("--force-login") }), redirect: "error",
    });
    const lj = await lr.json();
    if (!lj.accessToken) {
      console.error("로그인 실패: " + JSON.stringify(lj).slice(0, 160) + " — 이미 로그인된 세션이 있으면 --force-login(⚠ 돌고 있는 증류 세션이 끊긴다)");
      process.exit(2);
    }
    return { "Content-Type": "application/json", Authorization: "Bearer " + lj.accessToken };
  };
  let auth = await login();

  const lc = await fetch(`${SERVER}/api/learnloop/candidates?days=${DAYS}&limit=${LIMIT}`, { headers: auth, redirect: "error" });
  if (!lc.ok) { console.error(`후보 목록 ${lc.status}`); process.exit(2); }
  const { candidates = [], kpis = {} } = await lc.json();
  const 증류전체 = 고르기(candidates);
  const 대상 = 고르기(candidates, { topic: TOPIC });
  // 창 모자람을 **숫자로** 드러낸다 — 0건을 「다 했다」로 읽으면 안 되는 날이 온다.
  const 창모자람 = Number(kpis.distill ?? 0) > 증류전체.length;

  const 결과 = {
    startedAt: new Date().toISOString(), server: SERVER, topic: TOPIC || null, dryRun: DRY, max: MAX,
    listed: candidates.length, distillTotal: Number(kpis.distill ?? 0), distillInWindow: 증류전체.length,
    targeted: 대상.length, 창모자람, approved: 0, failed: 0, byReason: {}, skippedByMax: 0,
    approvedIds: [], rejectedIds: [], samples: [], errors: [], day: DAY, finishedAt: null,
  };
  if (창모자람) 로그(`⚠ 창 모자람 — 서버가 센 증류 ${kpis.distill}건 중 ${증류전체.length}건만 받았다(실대화 후보가 창을 채웠다). --limit 을 올려 다시 돌려라`);
  로그(`대상 ${대상.length}건${TOPIC ? ` (주제 ${TOPIC})` : ""}${DRY ? " · DRY-RUN(아무것도 안 바꾼다)" : ""}`);

  const 한번 = (id, accept) => fetch(SERVER + "/api/learnloop/candidates/decide", {
    method: "POST", headers: auth, body: JSON.stringify({ id, accept }), redirect: "error",
  });
  const decide = async (id, accept) => {
    let r = await 한번(id, accept);
    // 접속 토큰은 짧게 만료된다. 승인 한 건이 **지식 반입(임베딩)**을 끌고 가 수백 건이면 길어지므로,
    //   증류기가 겪은 그 사고(뒤쪽 묶음이 통째로 401)를 여기서도 같은 방법으로 막는다 — 다시 로그인해 한 번 더.
    if (r.status === 401) { 로그("401 — 다시 로그인해 한 번 더"); auth = await login(); r = await 한번(id, accept); }
    if (!r.ok) throw new Error(`decide ${r.status}: ${(await r.text()).slice(0, 120)}`);
  };

  for (const c of 대상) {
    const why = 심사(c);
    if (why) {
      결과.failed += 1;
      결과.byReason[why] = (결과.byReason[why] ?? 0) + 1;
      // 왜 떨어졌는지 사람이 읽을 수 있게 앞머리를 남긴다(사유 이름만 세면 잣대가 틀렸을 때 못 알아챈다).
      if (결과.samples.length < 20) 결과.samples.push({ id: c.id, reason: why, question: String(c.question).slice(0, 80), answer: String(c.answer).slice(0, 120) });
      if (REJECT_FAILED && !DRY) {
        try { await decide(c.id, false); 결과.rejectedIds.push(c.id); }
        catch (e) { 결과.errors.push(`${c.id} 제외: ${e.message}`); }
      }
      continue;
    }
    if (결과.approved >= MAX) { 결과.skippedByMax += 1; continue; }
    if (DRY) { 결과.approved += 1; 결과.approvedIds.push(c.id); continue; }
    try { await decide(c.id, true); 결과.approved += 1; 결과.approvedIds.push(c.id); }
    catch (e) { 결과.errors.push(`${c.id} 승인: ${e.message}`); }
  }
  결과.finishedAt = new Date().toISOString();

  if (has("--out")) {
    const dir = path.join(repo, "tools", "team-bench", "results-ladder", DAY);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `approve-${시각}.json`);
    fs.writeFileSync(out, JSON.stringify(결과, null, 2), "utf8");
    로그(`결과 파일 ${path.relative(repo, out).replace(/\\/g, "/")}`);
  }
  로그(`끝 — 승인 ${결과.approved} · 탈락 ${결과.failed} ${JSON.stringify(결과.byReason)}${결과.skippedByMax ? ` · 상한(--max ${MAX})으로 미룬 것 ${결과.skippedByMax}` : ""}${결과.errors.length ? ` · 오류 ${결과.errors.length}` : ""}`);
  process.stdout.write(JSON.stringify(결과, null, 2) + "\n");
}

if (process.argv[1] && process.argv[1].endsWith("approve-distill.mjs")) {
  await main();
}
