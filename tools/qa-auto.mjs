#!/usr/bin/env node
// QA Auto ver1 — GIJO AS 자동 QA 하네스
//
// 근거(리서치): 스모크 우선(빌드 헬스체크) → 위험도 기반 선별(사용 빈도·이번 주 변경 영역 우선),
// 시나리오는 Given-When-Then 실예시로 기술해 개별 pass/fail 판정, 실환경(운영 HTTP·실페이지) 실행.
//
// 사용법:
//   서버 계층(WSL 안에서 — 운영 4000에 실 HTTP):
//     wsl.exe -e bash -lc 'cd "/mnt/d/Connect AI" && QA_USER=... QA_PASS=... node tools/qa-auto.mjs --layer=server'
//   클라 계층(Windows — 헤드리스 크로미엄 실페이지):
//     node tools/qa-auto.mjs --layer=client
//   리포트 병합(두 계층 JSON → 마크다운):
//     node tools/qa-auto.mjs --report
//
// 환경변수: QA_USER/QA_PASS(서버 계층 로그인 계정), QA_BASE(기본 http://localhost:4000)
// 결과: .tmp-reports/qa-auto-{server,client}.json, qa-auto-v1-report.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".tmp-reports");
fs.mkdirSync(OUT_DIR, { recursive: true });
const layer = (process.argv.find((a) => a.startsWith("--layer=")) || "").split("=")[1] || (process.argv.includes("--report") ? "report" : "");

// ─────────────────────────────────── 공통 러너 ───────────────────────────────────
const results = [];
// opts.retries — LLM 답변 케이스처럼 **같은 질문에 답이 달라질 수 있는** 것만 재시도를 허용한다
// (2026-07-26 사용자 결정). 결정적 검사(HTTP·렌더)는 재시도하지 않는다 — 거기서 흔들리면 그건 버그다.
// ⚠ 재시도로 통과해도 **몇 번째에 통과했는지 반드시 남긴다.** 흔들린 사실을 지우면 재시도는
//   실패를 감추는 장치가 된다(그 함정 때문에 방금 qa-auto 종료코드를 고쳤다).
async function scenario(id, area, title, gwt, fn, opts = {}) {
  const started = Date.now();
  const maxTry = 1 + (opts.retries ?? 0);
  let pass = false, evidence = "", attempts = 0, firstError = "";
  for (let i = 1; i <= maxTry; i++) {
    attempts = i;
    try {
      evidence = await fn();
      pass = true;
      break;
    } catch (e) {
      if (i === 1) firstError = e.message;
      evidence = `실패: ${e.message}`;
    }
  }
  if (pass && attempts > 1) evidence += ` [${attempts}번째 시도에 통과 — 1차: ${firstError}]`;
  if (!pass && maxTry > 1) evidence += ` [${maxTry}회 모두 실패]`;
  results.push({ id, area, title, ...gwt, pass, evidence, attempts, ms: Date.now() - started });
  console.log(`${pass ? (attempts > 1 ? "⚠️" : "✅") : "❌"} ${id} ${title} (${Date.now() - started}ms) — ${evidence}`);
}
// LLM 답변 케이스 전용 옵션 — 같은 질문에 답이 달라질 수 있어 최대 3회 시도한다.
// (결정적 검사에는 절대 쓰지 않는다. 재시도로 통과하면 ⚠️와 함께 몇 번째였는지 남는다.)
// ⚠ 3회로 정한 근거: 단독 실행에서는 3/3 통과하는 케이스가 전체 실행(앞 계층의 LLM 호출 뒤)에서는
//   2회까지 흔들리는 것을 실측했다(2026-07-26 QA-M04). 흔들림 자체는 결과에 남으므로 감춰지지 않는다.
const LLM_RETRY = { retries: 2 };

function save(name) {
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
}

// ─────────────────────────────── 서버 계층(실 HTTP) ───────────────────────────────
async function runServer() {
  const BASE = process.env.QA_BASE || "http://localhost:4000";
  const USER = process.env.QA_USER, PASS = process.env.QA_PASS;
  if (!USER || !PASS) { console.error("QA_USER/QA_PASS 환경변수가 필요합니다"); process.exit(2); }
  let token = "", refresh = "";
  const api = async (p, opt = {}) => {
    const res = await fetch(BASE + p, {
      ...opt,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opt.headers || {}) },
    });
    return res;
  };
  const jok = async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return res.json();
  };

  await scenario("QA-S01", "서버", "헬스체크", {
    given: "운영 서버(WSL systemd gijo-as.service)가 기동 중일 때",
    when: "GET /api/health를 호출하면",
    then: "ok:true와 서비스명이 즉시 반환된다",
  }, async () => {
    const j = await jok(await api("/api/health"));
    if (j.ok !== true) throw new Error("ok!==true");
    return `service=${j.service}, schema=${j.schema}`;
  });

  await scenario("QA-S02", "인증", "미인증 차단 → 로그인 → 보호 API 통과", {
    given: "토큰이 없는 상태에서",
    when: "보호 API(/api/assethub)를 먼저 호출하고, 실계정으로 로그인 후 재호출하면",
    then: "처음엔 401로 차단되고 로그인 후에는 200으로 통과한다",
  }, async () => {
    const before = await api("/api/assethub");
    if (before.status !== 401) throw new Error(`미인증인데 ${before.status}`);
    const j = await jok(await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: USER, password: PASS, force: true }) }));
    token = j.accessToken; refresh = j.refreshToken;
    if (!token) throw new Error("accessToken 없음");
    const after = await api("/api/assethub");
    if (!after.ok) throw new Error(`로그인 후에도 ${after.status}`);
    return `미인증 401 → 로그인(${j.user.displayName}) → 200`;
  });

  await scenario("QA-S03", "인증", "오답 비밀번호 거부", {
    given: "실존 계정에 대해",
    when: "틀린 비밀번호로 로그인하면",
    then: "401 invalid credentials로 거부된다(브루트포스 방어 카운터 동작)",
  }, async () => {
    const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: USER, password: "wrong-password-qa" }) });
    if (res.status !== 401) throw new Error(`기대 401, 실제 ${res.status}`);
    return "틀린 비밀번호 → 401 확인";
  });

  await scenario("QA-S04", "인증", "중복로그인 방지(계정당 세션 1개)", {
    given: "이미 로그인 세션이 살아있는 계정으로",
    when: "force 없이 다시 로그인하면",
    then: "409 already_logged_in으로 차단된다",
  }, async () => {
    const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: USER, password: PASS }) });
    if (res.status !== 409) throw new Error(`기대 409, 실제 ${res.status}`);
    const j = await res.json();
    return `409 ${j.error} 확인`;
  });

  await scenario("QA-S05", "자산 허브", "자산 통합 집계 + AI 자산 우선 정렬", {
    given: "운영 DB에 데모 자산(AI 자산 '테스트LLM' 포함)이 들어있을 때",
    when: "GET /api/assethub를 호출하면",
    then: "rows가 1건 이상이고 AI 자산이 앞에 오며 노출점수·취약점 집계가 숫자로 온다",
  }, async () => {
    const j = await jok(await api("/api/assethub"));
    if (!Array.isArray(j.rows) || j.rows.length < 1) throw new Error("rows 비어있음");
    const ai = j.rows.filter((r) => r.isAi);
    if (ai.length && !j.rows[0].isAi) throw new Error("AI 자산이 선두가 아님");
    if (typeof j.rows[0].exposureScore !== "number") throw new Error("exposureScore 없음");
    return `자산 ${j.rows.length}건(AI ${ai.length}) — 1위 ${j.rows[0].name}(노출 ${j.rows[0].exposureScore}), 미조치 취약점 ${j.summary?.vuln?.open ?? "?"}건`;
  });

  await scenario("QA-S06", "KPI", "보안 태세 점수 계산", {
    given: "자산·취약점·SLA 실데이터가 있을 때",
    when: "GET /api/kpi를 호출하면",
    then: "posture.score가 0~100 범위이고 band(good/fair/poor)가 판정된다",
  }, async () => {
    const j = await jok(await api("/api/kpi"));
    const p = j.current?.posture;
    if (!p || typeof p.score !== "number" || p.score < 0 || p.score > 100) throw new Error("posture.score 범위 밖");
    if (!["good", "fair", "poor"].includes(p.band)) throw new Error("band 이상");
    return `posture=${p.score}(${p.band}), 감점요인 ${p.factors?.length ?? 0}개`;
  });

  await scenario("QA-S07", "조치·승인", "승인 대기열 5-상태 조회", {
    given: "결재판에 항목이 있거나 없을 때",
    when: "GET /api/approvals를 호출하면",
    then: "배열이 오고 각 항목의 status는 5-상태 집합 안에 있다",
  }, async () => {
    const j = await jok(await api("/api/approvals"));
    const items = Array.isArray(j) ? j : j.items ?? [];
    const allowed = new Set(["pending", "in_progress", "verifying", "approved", "rejected"]);
    const bad = items.filter((i) => i.status && !allowed.has(i.status));
    if (bad.length) throw new Error(`알 수 없는 상태: ${bad[0].status}`);
    return `${items.length}건, 상태 분포 정상`;
  });

  await scenario("QA-S08", "위협 인텔", "CTI 피드 목록(직접 입력 벤더 포함)", {
    given: "피드 구독 화면에서 벤더명을 직접 입력해 등록할 수 있게 바뀐 뒤",
    when: "GET /api/cti/feeds를 호출하면",
    then: "구독 피드 배열이 반환된다",
  }, async () => {
    const j = await jok(await api("/api/cti/feeds"));
    const feeds = Array.isArray(j) ? j : j.feeds ?? [];
    return `피드 ${feeds.length}건: ${feeds.slice(0, 3).map((f) => f.name || f.vendor || f.id).join(", ")}`;
  });

  await scenario("QA-S09", "하드닝", "점검 표준 4종 노출(kisa/cis/kisa_pc/kisa_net)", {
    given: "이번 주 CCE 파이프라인 1~3단계(리눅스 보강+Windows PC+네트워크 장비) 배포 후",
    when: "GET /api/hardening/checklists를 호출하면",
    then: "표준 4종이 모두 내려온다",
  }, async () => {
    const j = await jok(await api("/api/hardening/checklists"));
    const ids = (Array.isArray(j) ? j : j.standards ?? []).map((c) => c.id || c.standard);
    for (const need of ["kisa", "cis", "kisa_pc", "kisa_net"]) if (!ids.includes(need)) throw new Error(`${need} 없음 (실제: ${ids.join(",")})`);
    return `표준 ${ids.length}종: ${ids.join(", ")}`;
  });

  await scenario("QA-S10", "하드닝", "점검 대상·정기 스케줄 조회", {
    given: "특정 IP 대상 등록 기능 배포 후",
    when: "GET /api/hardening/targets 와 /api/hardening/schedules 를 호출하면",
    then: "대상(장비 유형별 표준 컬럼 포함)과 스케줄 배열이 반환된다",
  }, async () => {
    const t = await jok(await api("/api/hardening/targets"));
    const s = await jok(await api("/api/hardening/schedules"));
    const targets = Array.isArray(t) ? t : t.targets ?? [];
    const schedules = Array.isArray(s) ? s : s.schedules ?? [];
    return `대상 ${targets.length}건, 스케줄 ${schedules.length}건`;
  });

  await scenario("QA-S11", "리포트", "정기 리포트 스케줄 조회", {
    given: "리포트 정기 스케줄 기능 배포 후",
    when: "GET /api/report/schedules 를 호출하면",
    then: "스케줄 배열이 반환된다",
  }, async () => {
    const j = await jok(await api("/api/report/schedules"));
    const arr = Array.isArray(j) ? j : j.schedules ?? [];
    return `스케줄 ${arr.length}건`;
  });

  await scenario("QA-S12", "작업 내역", "작업 내역 목록 조회", {
    given: "작업 내역 저장소(work_sessions)에서",
    when: "GET /api/work-sessions 를 호출하면",
    then: "세션 배열이 반환된다",
  }, async () => {
    const j = await jok(await api("/api/work-sessions"));
    const arr = Array.isArray(j) ? j : j.sessions ?? [];
    return `세션 ${arr.length}건`;
  });

  await scenario("QA-S13", "라이선스", "번들 LLM 라이선스 게이트", {
    given: "번들 라이선스 가시화 기능이 있는 서버에서",
    when: "GET /api/localengine/model-licenses 를 호출하면",
    then: "모델별 라이선스 판정과 집계(summary)가 반환된다",
  }, async () => {
    const j = await jok(await api("/api/localengine/model-licenses"));
    const models = j.models ?? j;
    if (!models || (Array.isArray(models) && !models.length)) throw new Error("모델 목록 비어있음");
    const n = Array.isArray(models) ? models.length : Object.keys(models).length;
    return `모델 ${n}개 판정, summary=${JSON.stringify(j.summary ?? {}).slice(0, 80)}`;
  });

  // 뒷정리 — QA 세션 로그아웃(운영 세션 흔적 남기지 않기)
  if (refresh) await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: refresh }) }).catch(() => {});
  save("qa-auto-server.json");
}

// ──────────────────── 지식 계층(ver2: bge 검색→온톨로지→LLM 답변) ────────────────────
// 인터넷 리서치 문서(knowledge/) 인입 후, 검색→그래프 확장→실 LLM 답변까지 실경로 검증.
// LLM 답변은 판정과 별개로 전문을 출력한다 — 자동검사만 믿지 말고 사람이 읽는다.
async function runKnowledge() {
  const BASE = process.env.QA_BASE || "http://localhost:4000";
  const USER = process.env.QA_USER, PASS = process.env.QA_PASS;
  if (!USER || !PASS) { console.error("QA_USER/QA_PASS 환경변수가 필요합니다"); process.exit(2); }
  const login = await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS, force: true }) })).json();
  const H = { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` };
  const post = async (p, body) => {
    const res = await fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    return res.json();
  };

  await scenario("QA-K01", "bge 검색", "거버넌스 질문이 새 문서 청크를 찾는다", {
    given: "NIST CSF 2.0 거버넌스 문서가 bge-m3 임베딩으로 인입된 뒤",
    when: "'NIST CSF 2.0에서 거버넌스 기능이 뭐야?'로 지식 검색(/api/memory/query)하면",
    then: "GOVERN/거버넌스가 담긴 청크가 상위로 검색된다",
  }, async () => {
    const chunks = await post("/api/memory/query", { question: "NIST CSF 2.0에서 거버넌스 기능이 뭐야?", topK: 4 });
    const hit = chunks.findIndex((c) => /GOVERN|거버넌스/.test(c));
    if (hit < 0) throw new Error("관련 청크 없음");
    return `청크 ${chunks.length}건, ${hit + 1}위에 적중: "${chunks[hit].slice(0, 60)}…"`;
  });

  await scenario("QA-K02", "bge 검색", "CCE·CVE 차이 질문이 표준 문서를 찾는다", {
    given: "취약점 식별체계 문서(CVE·CWE·CCE 구분)가 인입된 뒤",
    when: "'CCE와 CVE의 차이가 뭐야?'로 지식 검색하면",
    then: "설정(구성) 대 코드 결함 구분이 담긴 청크가 검색된다",
  }, async () => {
    const chunks = await post("/api/memory/query", { question: "CCE와 CVE의 차이가 뭐야?", topK: 4 });
    const hit = chunks.findIndex((c) => /CCE/.test(c) && /설정|구성/.test(c));
    if (hit < 0) throw new Error("관련 청크 없음");
    return `청크 ${chunks.length}건, ${hit + 1}위에 적중`;
  });

  await scenario("QA-K03", "온톨로지", "우선순위 질문에 지식 그래프 규칙이 걸린다", {
    given: "KEV·EPSS·CVSS 관계 트리플 37건이 온톨로지에 들어간 뒤",
    when: "'KEV와 EPSS 중 뭘 먼저 봐야 해?'로 확장(/api/ontology/expand)하면",
    then: "KEV 발행기관·조치원칙 등 관련 트리플이 동반 주입된다",
  }, async () => {
    const j = await post("/api/ontology/expand", { text: "KEV와 EPSS 중 뭘 먼저 봐야 해?" });
    const txt = JSON.stringify(j);
    if (!/CISA/.test(txt) || !/최우선/.test(txt)) throw new Error(`KEV 규칙 미포함: ${txt.slice(0, 120)}`);
    const n = Array.isArray(j?.triples) ? j.triples.length : Array.isArray(j) ? j.length : "?";
    return `확장 트리플 ${n}건 — CISA 발행·최우선 조치 규칙 포함`;
  });

  const ask = async (q) => {
    // ⚠ qa:true — 대화 이력을 읽지도 쓰지도 않는다(chat()이 args.qa로 격리).
    //   없으면 직전 문항의 답이 다음 문항에 맥락으로 섞인다: QA-M04(정기점검 절차)가
    //   재시도될 때 M03/M05 대화가 끼어들어 답이 흔들렸다(2026-07-31, 격리하면 13항목 적중).
    //   판단 경로(RAG·가드레일·라우팅)는 그대로다 — 단기 기억만 끈다.
    const j = await post("/api/llm/chat", { agentId: "normaltic", message: q, qa: true });
    const reply = String(j.reply ?? "");
    console.log(`\n──── 💬 실제 LLM 답변 (${q}) ────\n${reply}\n────────────────────────\n`);
    if (/등록된 사내 자료에는 관련 내용이 없습니다/.test(reply)) throw new Error("그라운딩 실패 — 자료 못 찾음 답변");
    return reply;
  };

  await scenario("QA-K04", "LLM 답변", "CVE·CWE·CCE 차이를 근거 기반으로 설명", {
    given: "지식 해설 에이전트(normaltic, 참고자료만 근거로 답변)에",
    when: "'CVE와 CWE, CCE의 차이를 설명해줘'라고 물으면",
    then: "인입 문서 근거로 사건/원인유형/설정 구분을 설명한다(전문은 사람이 검독)",
  }, async () => {
    const reply = await ask("CVE와 CWE, CCE의 차이를 설명해줘");
    if (!/CWE/.test(reply) || !/설정|구성/.test(reply)) throw new Error("핵심 구분 누락");
    return `답변 ${reply.length}자 — CWE·설정 구분 포함`;
  }, LLM_RETRY);

  await scenario("QA-K05", "LLM 답변", "취약점 우선순위를 KEV 최우선으로 안내", {
    given: "우선순위 지표 문서·트리플이 들어간 상태에서",
    when: "'취약점이 수백 건인데 뭐부터 조치해야 해?'라고 물으면",
    then: "KEV 최우선 → EPSS/Critical → CVSS 순서를 안내한다",
  }, async () => {
    const reply = await ask("취약점이 수백 건인데 뭐부터 조치해야 해? KEV, EPSS, CVSS 기준으로 알려줘");
    if (!/KEV/.test(reply)) throw new Error("KEV 미언급");
    return `답변 ${reply.length}자 — KEV 우선순위 포함`;
  }, LLM_RETRY);

  await scenario("QA-K06", "LLM 답변", "NIST CSF 2.0 신설 기능을 설명", {
    given: "거버넌스 표준 문서가 들어간 상태에서",
    when: "'NIST CSF 2.0에서 새로 생긴 기능이 뭐고 왜 중요해?'라고 물으면",
    then: "GOVERN(거버넌스) 신설과 6기능 구조를 설명한다",
  }, async () => {
    const reply = await ask("NIST CSF 2.0에서 새로 생긴 기능이 뭐고 왜 중요해?");
    if (!/거버넌스|GOVERN/i.test(reply)) throw new Error("거버넌스 미언급");
    return `답변 ${reply.length}자 — 거버넌스 신설 포함`;
  }, LLM_RETRY);

  save("qa-auto-knowledge.json");
}

// ──────────── 유지보수 계층(ver3: 보안 장비 매뉴얼·로그·유지보수 절차 시나리오) ────────────
// 실무 유지보수 절차(정기점검→로그 판독→장애 대응) 순서를 그대로 시나리오로 옮겼다.
async function runMaintenance() {
  const BASE = process.env.QA_BASE || "http://localhost:4000";
  const USER = process.env.QA_USER, PASS = process.env.QA_PASS;
  if (!USER || !PASS) { console.error("QA_USER/QA_PASS 환경변수가 필요합니다"); process.exit(2); }
  const login = await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS, force: true }) })).json();
  const H = { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` };
  const post = async (p, body) => {
    const res = await fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    return res.json();
  };
  const ask = async (q) => {
    // ⚠ qa:true — 대화 이력을 읽지도 쓰지도 않는다(chat()이 args.qa로 격리).
    //   없으면 직전 문항의 답이 다음 문항에 맥락으로 섞인다: QA-M04(정기점검 절차)가
    //   재시도될 때 M03/M05 대화가 끼어들어 답이 흔들렸다(2026-07-31, 격리하면 13항목 적중).
    //   판단 경로(RAG·가드레일·라우팅)는 그대로다 — 단기 기억만 끈다.
    const j = await post("/api/llm/chat", { agentId: "normaltic", message: q, qa: true });
    const reply = String(j.reply ?? "");
    console.log(`\n──── 💬 실제 LLM 답변 (${q}) ────\n${reply}\n────────────────────────\n`);
    if (/등록된 사내 자료에는 관련 내용이 없습니다/.test(reply)) throw new Error("그라운딩 실패 — 자료 못 찾음 답변");
    return reply;
  };

  await scenario("QA-M01", "bge 검색", "정기점검 질문이 유지보수 문서를 찾는다", {
    given: "장비 유지보수 절차 문서(월간 7항목 체크리스트)가 인입된 뒤",
    when: "'FortiGate 정기점검 때 뭘 확인해야 해?'로 지식 검색하면",
    then: "점검 항목(HA·시그니처·백업 등)이 담긴 청크가 검색된다",
  }, async () => {
    const chunks = await post("/api/memory/query", { question: "FortiGate 정기점검 때 뭘 확인해야 해?", topK: 4 });
    const hit = chunks.findIndex((c) => /정기점검|FortiGuard|HA/.test(c));
    if (hit < 0) throw new Error("관련 청크 없음");
    return `청크 ${chunks.length}건, ${hit + 1}위 적중`;
  });

  await scenario("QA-M02", "bge 검색", "장비 로그 판독 질문이 로그체계 문서를 찾는다", {
    given: "Cisco ASA 로그 메시지(302013/302014/106023) 문서가 인입된 뒤",
    when: "'ASA 302014 로그가 무슨 뜻이야?'로 지식 검색하면",
    then: "Teardown(연결 종료) 설명 청크가 검색된다",
  }, async () => {
    const chunks = await post("/api/memory/query", { question: "ASA 302014 로그가 무슨 뜻이야?", topK: 4 });
    const hit = chunks.findIndex((c) => /302014|Teardown|종료/.test(c));
    if (hit < 0) throw new Error("관련 청크 없음");
    return `청크 ${chunks.length}건, ${hit + 1}위 적중`;
  });

  await scenario("QA-M03", "온톨로지", "장비 제조사 질문에 그래프 규칙이 걸린다", {
    given: "장비-제조사 트리플(SNIPER→윈스 등)이 들어간 뒤",
    when: "'SNIPER 장비 제조사가 어디야?'로 확장하면",
    then: "윈스(한국)·IPS 관련 트리플이 동반 주입된다",
  }, async () => {
    const j = await post("/api/ontology/expand", { text: "SNIPER 장비 제조사가 어디야?" });
    const txt = JSON.stringify(j);
    if (!/윈스/.test(txt)) throw new Error(`SNIPER 트리플 미포함: ${txt.slice(0, 120)}`);
    return `확장 결과에 윈스·IPS 규칙 포함`;
  });

  await scenario("QA-M04", "LLM 답변", "월간 정기점검 절차 안내 (시나리오: 점검일 아침)", {
    given: "담당자가 월간 정기점검을 시작하며",
    when: "'방화벽 월간 정기점검 절차를 알려줘'라고 물으면",
    then: "자원·HA·시그니처·백업·로그 등 7항목 계열의 점검 절차를 안내한다",
  }, async () => {
    const reply = await ask("방화벽 월간 정기점검 절차를 알려줘");
    const hits = ["HA", "시그니처", "백업"].filter((k) => new RegExp(k, "i").test(reply));
    if (hits.length < 2) throw new Error(`핵심 항목 부족(${hits.join(",")})`);
    return `답변 ${reply.length}자 — ${hits.join("·")} 포함`;
  }, LLM_RETRY);

  await scenario("QA-M05", "LLM 답변", "장애 대응 절차 안내 (시나리오: 장비 다운)", {
    given: "방화벽 장애가 발생한 상황에서",
    when: "'방화벽 장비가 갑자기 죽었어, 어떻게 대응해야 해?'라고 물으면",
    then: "로그 확보(재부팅 전)·HA 확인·유지보수 접수 순의 표준 절차를 안내한다",
  }, async () => {
    const reply = await ask("방화벽 장비가 갑자기 죽었어. 어떻게 대응해야 해?");
    const hits = ["로그", "HA|이중화|절체", "유지보수|벤더|접수"].filter((k) => new RegExp(k).test(reply));
    if (hits.length < 2) throw new Error("표준 절차 요소 부족");
    return `답변 ${reply.length}자 — 장애 절차 요소 ${hits.length}/3 포함`;
  }, LLM_RETRY);

  await scenario("QA-M06", "LLM 답변", "차단 로그 반복 판독 (시나리오: 로그 검토 중)", {
    given: "정기점검 중 이상 이벤트를 리뷰하다가",
    when: "'ASA 106023 로그가 한 IP에서 계속 올라오는데 무슨 의미야?'라고 물으면",
    then: "ACL 차단이며 반복 시 스캔·공격 시도 의심임을 설명한다",
  }, async () => {
    const reply = await ask("ASA 106023 로그가 한 IP에서 계속 올라오는데 무슨 의미야?");
    // ⚠ 영문 약어만 보면 **옳은 답을 실패로 찍는다**(2026-07-30 실측): 모델이 "액세스 리스트에
    //   의해 거부당한 패킷"이라고 **한글로** 정확히 설명했는데 ACL·Deny·차단이 없어 실패했다.
    //   이 제품은 한국어로 답하는 것이 규칙이다 — 검사가 그 규칙과 싸우면 안 된다.
    if (!/차단|거부|Deny|ACL|액세스\s*리스트|접근\s*(제어|통제)/i.test(reply)) throw new Error("차단 의미 미설명");
    return `답변 ${reply.length}자 — ACL 차단·의심 징후 설명 포함`;
  }, LLM_RETRY);

  save("qa-auto-maintenance.json");
}

// ─────────────────────────── 클라 계층(헤드리스 실페이지) ───────────────────────────
// 주의: Electron preload가 없는 환경이므로 window.gijo는 최소 스텁(인증·이동만).
// 화면 로직·nav.js·hub.html·페이지 마크업은 전부 실물이 그대로 실행된다.
async function runClient() {
  const req = createRequire(path.join(ROOT, "server", "package.json"));
  const { chromium } = req("playwright-core");
  const PAGES = path.join(ROOT, "client", "src", "renderer", "pages");
  const stub = () => {
    window.gijo = {
      isAuthenticated: () => true, checkServerHealth: async () => ({ ok: true }), me: async () => ({ displayName: "QA" }),
      navigateTo: (p) => { location.href = p; }, openTeamOffice: () => { window.__officeOpened = true; },
      listWorkSessions: async () => [], onCollaborationEvent: () => {}, update: { checkForUpdate: async () => ({ updateAvailable: true }) },
    };
    window.gijoRealtime = { connect: () => {} };
  };
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.addInitScript(stub);
  const open = async (rel) => { await page.goto("file://" + path.join(PAGES, rel).replace(/\\/g, "/")); await page.waitForTimeout(1200); };

  // 4.0.0 — 허브(2단 탭)를 없애고 화면을 셸 탭으로 연다. 겹이 셸→실화면 2겹으로 고정되는 것이
  // 이 구조의 핵심이다(3겹이던 시절 레이아웃이 0으로 굳어 빈 화면이 됐다 — 2026-07-28).
  await scenario("QA-C01", "탭 셸", "메뉴를 누르면 화면이 탭으로 열린다(이동 아님)", {
    given: "탭 셸(app.html)에서",
    when: "왼쪽 메뉴의 '취약점'을 누르면",
    then: "주소는 셸 그대로이고 탭이 하나 생기며, 탭 안은 vulnscan.html을 **직접** 품는다(중간에 허브가 없다)",
  }, async () => {
    await open("app.html");
    await page.waitForTimeout(1500);
    const before = page.url();
    await page.evaluate(() => {
      const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent === "취약점");
      it?.querySelector(".gn-label").click();
    });
    await page.waitForTimeout(1200);
    if (page.url() !== before) throw new Error(`셸을 떠났다: ${page.url().split("/").pop()}`);
    const st = await page.evaluate(() => ({
      탭: [...document.querySelectorAll("#tabBar .tab .nm")].map((t) => t.textContent),
      활성: document.querySelector("#tabBar .tab.on .nm")?.textContent,
      src: decodeURIComponent(document.querySelector("#screens iframe.on")?.getAttribute("src") || ""),
    }));
    if (!st.탭.includes("취약점")) throw new Error(`탭 없음: ${st.탭.join(",")}`);
    if (!/^vulnscan\.html\?embed=1/.test(st.src)) throw new Error(`탭 안이 직접 화면이 아님: ${st.src}`);
    return `탭[${st.탭.join("·")}] 활성=${st.활성}, 안=${st.src}`;
  });

  await scenario("QA-C02", "탭 셸", "탭을 옮겨도 앞서 보던 탭이 살아 있다", {
    given: "화면 두 개를 탭으로 열어 둔 상태에서",
    when: "다른 탭으로 갔다가 돌아오면",
    then: "iframe이 그대로 살아 있어 다시 읽히지 않는다(보던 상태가 유지된다 — 팝업을 없앨 수 있는 근거)",
  }, async () => {
    await page.evaluate(() => {
      const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent === "자산 목록");
      it?.querySelector(".gn-label").click();
    });
    await page.waitForTimeout(1500);
    // ⚠ 프레임 **안**(contentWindow)은 이 하네스에서 못 만진다 — file://이 서로 다른 출처라
    //   SecurityError가 난다(2026-07-28 실측). 그래서 프레임 **요소**에 표시를 남겨,
    //   탭을 옮겼다 돌아왔을 때 그 요소가 그대로인지(=지워지고 다시 만들어지지 않았는지) 본다.
    //   안쪽 내용까지 살아 있는지는 실제 앱으로 도는 shell 계층이 확인한다.
    await page.evaluate(() => { document.querySelector("#screens iframe.on").dataset.qaMark = "표시"; });
    const srcBefore = await page.evaluate(() => document.querySelector("#screens iframe.on").src);
    await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("취약점"))?.click());
    await page.waitForTimeout(600);
    await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("자산 목록"))?.click());
    await page.waitForTimeout(800);
    const alive = await page.evaluate(() => {
      const f = document.querySelector("#screens iframe.on");
      return { mark: f.dataset.qaMark || null, src: f.src, frames: document.querySelectorAll("#screens iframe").length };
    });
    if (alive.mark !== "표시") throw new Error("돌아오니 프레임이 새로 만들어졌다(보던 상태 유실)");
    if (alive.src !== srcBefore) throw new Error(`돌아온 프레임 주소가 바뀌었다: ${alive.src}`);
    return `프레임 ${alive.frames}개가 살아 있고 같은 프레임으로 돌아왔다`;
  });

  await scenario("QA-C03", "메뉴 C안", "설정 허브 + 업데이트 배지", {
    given: "새 버전이 있다고 서버가 알려줄 때",
    when: "셸(app.html)에서 설정 구역을 열면",
    then: "설정 5탭(내 설정·서버·AI·연동·관리자·기록 보기)이 뜨고 사이드바 설정 항목에 업데이트 배지가 표시된다",
  }, async () => {
    await open("app.html");
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("#gijoNav .gn-item .gn-label")].map((e) => e.textContent);
      return { 설정구역: labels.filter((l) => ["내 설정", "서버·AI", "연동", "관리자", "기록 보기"].includes(l)), 배지: !!document.querySelector(".gn-upbadge") };
    });
    if (r.설정구역.length !== 5) throw new Error(`설정 구역 ${r.설정구역.length}개: ${r.설정구역.join(",")}`);
    if (!r.배지) throw new Error("업데이트 배지 없음");
    return `설정 5구역(${r.설정구역.join("·")}) + 업데이트 배지 표시`;
  });

  // 4.0.0 기대값 현행화: 오른쪽 숨은 팝업(commandpanel.js)을 통째로 삭제했다.
  //   · "작업 세션" → 왼쪽 메뉴 맨 위 고정(sessions.html) — 정식 화면이다
  //   · "AI 라이브 오피스" → '🏢 팀 사무실 (창)'과 같은 것이라 개념이 둘로 나뉘어 있었다
  // 2026-07-27에 입구인 가장자리 세로 탭을 먼저 없앴고, 그때는 팝업 몸통을 남겨 뒀다.
  // 그 결과 **아무도 못 여는 숨은 DOM과 iframe**이 전 화면에 실렸다 — 4.0.0의 "내부 팝업
  // 전체 삭제" 지시에 따라 파일째 걷어냈다. 이 검사는 그게 되살아나지 않는지를 지킨다.
  // 이름은 '작업 세션' → '작업 내역'으로 바꿨다(2026-07-28 사용자 지시) — '세션'은 로그인
  // 세션과도 겹치는 개발자 말이고, 이 화면은 결국 한 일의 기록이다.
  await scenario("QA-C04", "작업 내역", "작업 내역은 메뉴에 있고 숨은 팝업은 없다", {
    given: "셸(app.html)에서",
    when: "페이지 로드가 끝나면",
    then: "왼쪽 메뉴에 '작업 내역'이 있고, 가장자리 세로 탭도 숨은 팝업 몸통도 하나도 없다",
  }, async () => {
    await open("app.html");
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      rail: Boolean(document.getElementById("gijoEdgeRail")),
      menuSess: [...document.querySelectorAll("#gijoNav *")].some((e) => e.children.length === 0 && e.textContent.trim() === "작업 내역"),
      vertical: [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).writingMode.startsWith("vertical") && e.offsetParent).length,
      // 숨은 팝업의 흔적 — 스크립트·패널·오피스 iframe·전역 함수 어느 하나도 남으면 안 된다
      잔재: [
        document.getElementById("gijoCmdScript") && "commandpanel 스크립트",
        document.getElementById("gijoCmdPanel") && "작업세션 팝업 몸통",
        document.getElementById("gijoOfficePop") && "오피스 팝업 몸통",
        typeof window.gijoOpenSessions === "function" && "gijoOpenSessions 전역",
      ].filter(Boolean),
    }));
    if (r.rail) throw new Error("가장자리 레일이 아직 있음");
    if (!r.menuSess) throw new Error("왼쪽 메뉴에 '작업 내역' 없음");
    if (r.vertical > 0) throw new Error("세로로 쓴 글씨 " + r.vertical + "개 남음");
    if (r.잔재.length) throw new Error("숨은 팝업 잔재: " + r.잔재.join(", "));
    return "메뉴에 작업 내역 있음, 세로 글씨 0개, 숨은 팝업 잔재 0개";
  });

  // 메뉴 CSS는 자바스크립트 문자열을 + 로 이어 붙여 만든다. 중간에 + 하나를 빠뜨리면
  // **그 뒤 CSS가 통째로 조용히 버려진다** — 문법 오류도 안 나고 화면도 뜬다. 그래서 못 알아챈다.
  // 실사고(2026-07-28): 별표 규칙 끝에 +가 빠져 .gn-item 글씨 크기·배지·대시보드 테두리가
  // 전부 사라졌고, 메뉴 글씨가 기본값 16px로 커진 뒤에야 발견됐다.
  await scenario("QA-C4B", "메뉴", "메뉴 CSS가 끝까지 살아 있다", {
    given: "메뉴 스타일을 문자열로 이어 붙여 만드는 구조에서",
    when: "셸을 열고 주입된 스타일의 규칙을 세어 보면",
    then: "핵심 규칙(.gn-item·배지·활성표시)이 모두 파싱돼 있고, 글씨 크기가 기본값(16px)으로 튀지 않는다",
  }, async () => {
    await open("app.html");
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const n = document.getElementById("gijoNavCss");
      if (!n) return { err: "메뉴 스타일이 없음" };
      const sheet = [...document.styleSheets].find((s) => s.ownerNode === n);
      let sels = [];
      try { sels = [...sheet.cssRules].map((x) => x.selectorText || ""); } catch (e) { return { err: "규칙을 읽지 못함" }; }
      const item = document.querySelector("#gijoNav .gn-item");
      return {
        규칙수: sels.length,
        gnItem: sels.includes(".gn-item"),
        배지: sels.some((s) => s.indexOf("gn-upbadge") >= 0),
        활성: sels.some((s) => s.indexOf(".gn-item.active") >= 0),
        글씨: item ? getComputedStyle(item).fontSize : null,
      };
    });
    if (r.err) throw new Error(r.err);
    if (!r.gnItem) throw new Error(`.gn-item 규칙이 파싱되지 않음 — 앞쪽에서 CSS가 끊겼다(규칙 ${r.규칙수}개)`);
    if (!r.배지) throw new Error("배지 규칙이 없음 — CSS가 중간에 끊겼다");
    if (!r.활성) throw new Error("활성 항목 규칙이 없음 — CSS가 중간에 끊겼다");
    if (parseFloat(r.글씨) >= 16) throw new Error(`메뉴 글씨가 기본값으로 튐(${r.글씨}) — 스타일이 안 먹었다`);
    return `규칙 ${r.규칙수}개 · 항목 글씨 ${r.글씨}`;
  });

  await scenario("QA-C05", "전체메뉴", "허브를 걷어낸 평평한 메뉴", {
    given: "4.0.0에서 허브(2단 탭)를 없앤 뒤",
    when: "셸의 왼쪽 메뉴를 보면",
    then: "4그룹에 화면이 그대로 늘어서고(약 30개), 허브 주소나 없어진 화면이 남아 있지 않다",
  }, async () => {
    await open("app.html");
    await page.waitForTimeout(1500);
    // 트리 구조 — 그룹 헤더(.gn-g) 다음에 자식 묶음(.gn-kids)이 온다.
    // ⚠ 세는 범위에 **맨 위 고정 3자리(.gn-top-fixed)**를 함께 넣는다. 대시보드·팀 사무실·
    //   작업 내역을 가지 밖으로 빼 늘 보이게 했는데(2026-07-28 사용자 지시), 가지만 세면
    //   화면이 3개 줄어든 것처럼 보인다 — 자리를 옮겼을 뿐 화면은 그대로다.
    // ⚠ ⭐즐겨찾기는 **내용 그룹이 아니다** — 내가 꽂아 둔 화면을 모아 두는 바로가기 가지다.
    //   4.1.0부터 비어 있어도 늘 보이게 했으므로(그전엔 별표한 게 없으면 아예 안 그렸다)
    //   같이 세면 "그룹 5개"가 되어 헛되이 실패한다. 그래서 빼고 세되, **있는지는 따로 본다.**
    const m = await page.evaluate(() => {
      const groups = [...document.querySelectorAll("#gijoNav .gn-g:not(.gn-fav-g)")].map((gh) => ({
        g: gh.querySelector(".cnt") ? gh.textContent.replace(/\d+$/, "").replace("▶", "").trim() : gh.textContent.trim(),
        items: [...(gh.nextElementSibling?.querySelectorAll(".gn-item .gn-label") || [])].map((e) => e.textContent),
      }));
      const fixed = [...document.querySelectorAll("#gijoNav .gn-top-fixed .gn-item .gn-label")].map((e) => e.textContent);
      const all = groups.flatMap((x) => x.items).concat(fixed);
      const favG = document.querySelector("#gijoNav .gn-fav-g");
      return {
        groups: groups.map((x) => x.g), fixed, total: all.length, all,
        // 즐겨찾기 가지는 비어 있어도 보여야 한다 — 안 보이면 '별표'라는 기능이 있는 줄도 모른다
        // (4.1.0에서 고친 실사고). 세는 데선 뺐으니 존재는 여기서 따로 지킨다.
        fav: !!favG,
        // 안내 문구는 없앴다(2026-07-29) — 좁은 폭에서 두 줄로 접혀 어설펐다.
        // 대신 **☆가 마우스 없이도 보이는지**를 지킨다. 그게 원래 목적이었다:
        // opacity:0으로 숨겨 뒀더니 즐겨찾기라는 기능이 있는 줄도 몰랐다(4.1.0 실사고).
        starOpacity: (() => {
          const s = document.querySelector("#gijoNav .gn-kids .gn-item .gn-star");
          return s ? Number(getComputedStyle(s).opacity) : 0;
        })(),
      };
    });
    // 그룹 7개(2026-08-01 사용자 지시로 재편) — 관제 · 자산·조치 · 보안제품 · 업무 관리 ·
    // AI · 데이터 플라이휠 · 설정. 자산·조치에 10개가 몰려 있던 것을 갈랐다.
    // 개수만 세면 "무엇이 바뀌었는지"를 못 잡으므로 이름까지 확인한다.
    // 그룹 8개 — **업무 절차 5단계 + 기반 3그룹**(2026-08-02 사용자 승인, 시안 menu-workflow).
    //   예전 7그룹은 **데이터 종류**로 묶여 있었다(관제/자산·조치/보안제품/업무 관리/AI/플라이휠/설정).
    //   담당자가 하는 일은 절차인데 메뉴가 창고라, 취약점 한 바퀴에 그룹 3개를 오갔다.
    // ⚠ 기대값만 바꾸지 않는다 — **순서까지** 지킨다. 절차는 위에서 아래로 한 방향이어야
    //   의미가 있고, 순서가 섞이면 개편의 뜻이 사라지는데 개수 검사로는 안 잡힌다.
    if (m.groups.length !== 8) throw new Error(`그룹 ${m.groups.length}개: ${m.groups.join(",")}`);
    const 절차순서 = ["발견", "우선순위", "조치", "검증", "보고"];
    절차순서.forEach((이름, i) => {
      if (!m.groups[i] || !m.groups[i].includes(이름)) {
        throw new Error(`${i + 1}번째 그룹이 '${이름}'이 아니다: ${m.groups.join(",")}`);
      }
    });
    for (const 있어야 of ["등록부", "AI 운영", "설정"]) {
      if (!m.groups.some((g) => g.includes(있어야))) throw new Error(`그룹에 '${있어야}'가 없다: ${m.groups.join(",")}`);
    }
    // 맨 위 고정 **3자리** — 대시보드 · 팀 사무실(창) · 작업 내역.
    // 2026-07-31 문서함(창)으로 4가 됐다가, 2026-08-02 사용자 지시로 문서함을 **왼쪽 메뉴에서
    //   감췄다**("문서함 메뉴는 아래 있으니 안 보이게 해 줘") — 사용자 이름 옆 📚로 옮겼기 때문이다.
    //   데이터에는 남아 있어 상단 바 🔍 화면찾기로는 여전히 찾아진다. 그래서 화면이 준 게 아니라
    //   **자리를 옮긴 것**이고, 기대값을 3으로 내린다.
    if (m.fixed.length !== 3) throw new Error(`맨 위 고정이 ${m.fixed.length}자리: ${m.fixed.join(",")}`);
    // ⚠ 문서함은 뺐다 — 없앤 게 아니라 사용자 이름 옆 📚로 **옮겼다**(2026-08-02).
    //   그 자리는 아래 gtb-userarea 검사에서 따로 지킨다.
    for (const 있어야 of ["대시보드", "팀 사무실", "작업 내역"]) {
      if (!m.fixed.some((f) => f.includes(있어야))) throw new Error(`맨 위 고정에 '${있어야}'가 없다: ${m.fixed.join(",")}`);
    }
    // 문서함은 왼쪽 메뉴에서 뺐으니(2026-08-02) **옮겨간 자리에 있는지**를 여기서 지킨다.
    //   기대값만 내리고 끝내면, 나중에 📚가 통째로 사라져도 아무도 못 잡는다.
    const 문서함 = await page.evaluate(() => {
      const el = document.querySelector("#gijoNav .gtb-userarea [title*='문서함'], #gijoNav .gtb-userarea .gtb-doc");
      const 글 = document.querySelector("#gijoNav .gtb-userarea")?.innerText || "";
      return { 있나: !!el || /📚/.test(글), 글: 글.replace(/s+/g, " ").slice(0, 40) };
    });
    if (!문서함.있나) throw new Error(`문서함(📚)이 사용자 이름 옆에도 없다: ${문서함.글}`);
    if (!m.fav) throw new Error("⭐즐겨찾기 가지가 안 보인다 — 비어 있어도 보여야 한다");
    if (!(m.starOpacity > 0.15)) throw new Error(`☆가 마우스 없이는 안 보인다(opacity ${m.starOpacity}) — 즐겨찾기를 발견할 수 없다`);
    // 하한 27(2026-08-08): 「모델 합치기」를 메뉴에서 내렸다(사용자 결정 "머지·추천은 접는다"
    //   — 화면·기록은 보존, 저장된 탭·직접 주소로는 열림). 28→27은 의도한 감소다.
    //   ⚠ 하한을 또 내릴 일이 생기면 먼저 "지운 게 맞나"부터 물을 것 — 이 검사의 본래 몫이다.
    if (m.total < 27) throw new Error(`항목 ${m.total}개 — 허브가 덜 풀렸다(의도한 제거인지 확인)`);
    if (m.all.some((x) => x.includes("모델 합치기"))) throw new Error("내린 「모델 합치기」가 메뉴에 되살아났다");
    // 허브 안에서만 통하던 짧은 이름이 남으면 밖에서 무엇의 '통합 뷰'인지 알 수 없다.
    for (const bad of ["통합 뷰", "등록부", "유지보수"]) if (m.all.includes(bad)) throw new Error(`홀로 못 서는 이름 남음: ${bad}`);
    // 없앤 화면이 메뉴에 남아 있으면 눌러도 죽는다.
    for (const gone of ["LLM 가이드", "MCP 연동", "업데이트", "로그"]) if (m.all.includes(gone)) throw new Error(`없앤 화면이 메뉴에 남음: ${gone}`);
    return `${m.groups.join("·")} / 항목 ${m.total}개(고정 ${m.fixed.length} 포함)`;
  });

  // 코드가 가리키는 화면이 **실제로 있는 파일**인지 전수 대조한다. 링크가 죽어도 화면은
  // 멀쩡히 뜨니 렌더만 보는 스윕으로는 절대 안 잡힌다.
  // 실사고(2026-07-28): 설정 5구역 재편 뒤에도 링크가 update.html 옛 주소로 남아 '업데이트'를
  // 눌러도 엉뚱한 곳이 열렸다 → "업데이트 화면이 없다". 4.0.0에서 허브를 없애 딥링크는
  // 사라졌지만, **없어진 화면을 가리키는 링크**는 여전히 생길 수 있다(hub.html·shell-popup.js처럼).
  await scenario("QA-C06", "링크 무결성", "navigateTo가 가리키는 화면이 실제로 있다", {
    given: "허브를 걷어내 화면이 곧 주소가 된 뒤",
    when: "코드의 navigateTo(\"…\") 대상을 전부 모아 실제 파일 목록과 대조하면",
    then: "모두 존재하는 화면이거나, nav.js가 흡수처로 돌려보내는 옛 주소다(죽은 링크 없음)",
  }, async () => {
    const pagesDir = path.join(ROOT, "client", "src", "renderer", "pages");
    const files = fs.readdirSync(pagesDir).filter((f) => /\.(html|js)$/.test(f));
    const exists = new Set(files.filter((f) => f.endsWith(".html")));
    // 없어진 화면을 되돌려 보내는 표(nav.js TAB_REDIRECT) — 여기 있으면 죽은 링크가 아니다.
    await open("app.html");
    await page.waitForTimeout(1200);
    const redirects = await page.evaluate(() => Object.keys(window.gijoRedirects || {}));
    const bad = [];
    let checked = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(pagesDir, f), "utf8");
      const re = /navigateTo\(\s*["'`]([^"'`]+)["'`]/g;
      let m;
      while ((m = re.exec(src))) {
        const target = m[1].split("?")[0];
        if (!target.endsWith(".html")) continue;   // 변수 조합 등은 건너뛴다
        checked++;
        if (!exists.has(target) && !redirects.includes(target)) bad.push(`${f}: → ${target} (없는 화면)`);
      }
    }
    // ⚠ 아무것도 못 찾으면 통과가 아니라 **검사기가 고장 난 것**이다. 실패할 수 없는 검사는 QA가 아니다.
    if (checked === 0) throw new Error("navigateTo 링크를 하나도 못 찾음 — 검사기 자체가 고장(정규식/경로 확인)");
    if (bad.length) throw new Error(bad.join(" / "));
    return `링크 ${checked}개 전수 대조 통과 (화면 ${exists.size}개 + 흡수처 ${redirects.length}개 기준)`;
  });

  // 서버가 적어 보낸 사유를 담당자가 **읽을 수 있어야** 한다. 이 메시지 형식은 모든 화면이 쓴다.
  // 실사고(2026-07-29): 법령 조회가 실패했는데 화면에 뜬 첫 줄이
  //   "GIJO AS 서버 오류 500 /api/law/search?query=%EA%B0%9C%EC%9D%B8…" 였다.
  //   서버는 "인증값(OC)을 확인하세요"라고 한글로 적어 보냈는데 URL·JSON 뒤에 묻혀 못 읽었다.
  //   사유를 아는데 못 읽게 만드는 건 없느니만 못하다.
  // ⚠ 이 계층은 로그인·preload가 없어 실제 API를 못 부른다 — 그래서 **코드를 읽어** 확인한다.
  await scenario("QA-C07", "오류 메시지", "서버가 준 사유가 앞에 온다", {
    given: "서버가 error/message에 한글 사유를 담아 보낼 때",
    when: "클라이언트가 그 실패를 Error로 바꾸면",
    then: "사유가 첫 줄에 오고, URL·JSON 같은 기술 정보는 뒤로 간다",
  }, async () => {
    // 2026-08-06 apiClient.ts 분리 — request()와 오류 처리부는 api/core.ts에 산다.
    const src = fs.readFileSync(path.join(ROOT, "client", "src", "api", "core.ts"), "utf8");
    const 시작 = src.indexOf("if (!res.ok)");
    if (시작 < 0) throw new Error("응답 오류 처리부를 못 찾음 — api/core.ts 구조가 바뀌었나");
    const 조각 = src.slice(시작, 시작 + 1400);
    // ⚠ 예전 검사는 `body?.error ?? body?.message` **순서를 못박고** 있었다. 그런데 그 순서가
    //   틀렸다(2026-07-30 발견): error는 "password_required" 같은 **기계 코드**이고 message가
    //   사람이 읽는 문장이다. 둘 다 있을 때 error를 고르면 담당자 화면 첫 줄에 영문 코드가 나온다.
    //   그래서 제품을 message 우선으로 고쳤고, 검사도 **그 순서를 요구**하도록 바꾼다.
    //   (검사가 낡은 동작을 지키고 있으면, 옳은 수정이 실패로 찍혀 되돌리게 된다.)
    if (!/body\?\.message\s*\?\?\s*body\?\.error/.test(조각)) {
      throw new Error("사람이 읽는 message를 기계 코드 error보다 앞세우지 않는다");
    }
    // 사유가 있을 때 그것을 **앞에** 세우는지 — 템플릿 첫 자리가 사유여야 한다
    if (!/\$\{\s*사유\s*\}\\n|^\s*사유\s*\n?\s*\?/m.test(조각) && !/사유\s*\?\s*`\$\{\s*사유\s*\}/.test(조각)) {
      throw new Error("사유를 첫 줄에 세우지 않는다(URL·상태코드가 앞에 오면 못 읽는다)");
    }
    return "서버 사유를 첫 줄에 세우고 기술 정보는 뒤로 보낸다";
  });

  // 온프렘(폐쇄망) 제품은 **바깥으로 아무것도 부르면 안 된다.**
  // 실사고(2026-07-29): 화면 46곳이 로고를 https://gijo.ai/_nuxt/… 에서 불러오고 있었다.
  //   개발 PC는 인터넷이 되니 멀쩡해 보였지만, 고객사 폐쇄망에서는 로고가 깨진 채로 뜬다.
  //   자산을 동봉해 로컬 파일로 바꿨다 — 다시 새 화면이 외부 주소를 물고 오지 않게 지킨다.
  await scenario("QA-C08", "온프렘", "화면이 바깥 주소를 부르지 않는다", {
    given: "폐쇄망에 설치되는 온프렘 제품에서",
    when: "화면들의 src/href를 전부 훑으면",
    then: "http(s) 바깥 주소가 하나도 없다(그림·글꼴·스크립트 모두 동봉)",
  }, async () => {
    const pagesDir = path.join(ROOT, "client", "src", "renderer", "pages");
    const files = fs.readdirSync(pagesDir).filter((f) => /\.(html|js|css)$/.test(f));
    const 바깥 = [];
    for (const f of files) {
      const s = fs.readFileSync(path.join(pagesDir, f), "utf8");
      for (const m of s.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g)) {
        // w3.org는 XML 네임스페이스 **이름표**다 — 네트워크를 타지 않는다.
        if (/^https?:\/\/(?:www\.)?w3\.org\//.test(m[1])) continue;
        바깥.push(`${f} → ${m[1].slice(0, 60)}`);
      }
    }
    if (바깥.length) throw new Error(`바깥 주소 ${바깥.length}곳: ${바깥.slice(0, 3).join(" | ")}`);
    return `화면 ${files.length}개 — 바깥 주소 0곳`;
  });

  // ⚠ "관리자 탭에 업데이트가 펼쳐져 보이는가"는 여기(헤드리스 client 계층)에 두지 않는다.
  //    이 하네스는 preload(window.gijo)도 로그인도 없어서 설정 화면 **안**이 아예 안 그려지고,
  //    file:// iframe은 서로 다른 출처라 contentDocument도 null이다(2026-07-28 실측).
  //    실제 앱으로 도는 shell 계층(tools/qa-shell.mjs)에 두었다 — 거기서만 진짜로 확인된다.

  await browser.close();
  save("qa-auto-client.json");
}

// ─────────────────────────────────── 리포트 병합 ───────────────────────────────────
function report() {
  const load = (n) => { try { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, n), "utf8")); } catch { return null; } };
  const sv = load("qa-auto-server.json"), cl = load("qa-auto-client.json"), kn = load("qa-auto-knowledge.json"), mt = load("qa-auto-maintenance.json");
  const all = [...(sv?.results ?? []), ...(kn?.results ?? []), ...(mt?.results ?? []), ...(cl?.results ?? [])];
  const pass = all.filter((r) => r.pass).length;
  const lines = [];
  lines.push(`# QA Auto ver1 — 실행 결과`);
  lines.push(``);
  lines.push(`- 실행: 서버 계층 ${sv?.at ?? "미실행"} / 클라 계층 ${cl?.at ?? "미실행"}`);
  lines.push(`- 결과: **${pass}/${all.length} 통과**`);
  lines.push(``);
  for (const r of all) {
    lines.push(`## ${r.pass ? "✅" : "❌"} ${r.id} [${r.area}] ${r.title}`);
    lines.push(`- Given: ${r.given}`);
    lines.push(`- When: ${r.when}`);
    lines.push(`- Then: ${r.then}`);
    lines.push(`- 실측: ${r.evidence} (${r.ms}ms)`);
    lines.push(``);
  }
  const out = path.join(OUT_DIR, "qa-auto-v1-report.md");
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`통과 ${pass}/${all.length} — ${out}`);
}

if (layer === "server") await runServer();
else if (layer === "knowledge") await runKnowledge();
else if (layer === "maintenance") await runMaintenance();
else if (layer === "client") await runClient();
else if (layer === "report" || process.argv.includes("--report")) report();
else { console.error("--layer=server | --layer=client | --report 중 하나를 지정하세요"); process.exit(2); }

// ⚠ 케이스가 실패하면 반드시 0이 아닌 코드로 끝낸다(2026-07-26 발견).
// 이게 없어서 qa-full이 개별 실패를 안고도 계층을 "통과"로 표시했다 —
// 실패를 감추는 QA는 없는 것보다 나쁘다.
const failedCases = results.filter((r) => r.pass === false);
if (failedCases.length) {
  console.error(`\n✗ 실패 ${failedCases.length}건: ${failedCases.map((r) => r.id).join(", ")}`);
  process.exit(1);
}
