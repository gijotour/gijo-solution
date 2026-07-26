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

  await scenario("QA-S12", "작업 세션", "작업 세션 목록 조회", {
    given: "대시보드·드로어가 공유하는 작업 세션 저장소에서",
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
    const j = await post("/api/llm/chat", { agentId: "normaltic", message: q });
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
    const j = await post("/api/llm/chat", { agentId: "normaltic", message: q });
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
    if (!/차단|Deny|ACL/i.test(reply)) throw new Error("차단 의미 미설명");
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

  await scenario("QA-C01", "메뉴 C안", "자산 허브 탭 컨테이너 렌더", {
    given: "메뉴 C안(32→11항목) 적용 클라에서",
    when: "hub.html?g=assets 를 열면",
    then: "탭 4개(통합 뷰·자산 목록·AI-BOM·취약점)와 embed iframe이 뜨고, iframe 안 페이지의 자체 헤더는 숨겨진다",
  }, async () => {
    await open("hub.html?g=assets");
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".hub-tab")].map((t) => t.textContent));
    if (tabs.length !== 4) throw new Error(`탭 ${tabs.length}개`);
    const src = await page.evaluate(() => document.querySelector(".hub-frame.on")?.getAttribute("src"));
    if (!/assethub\.html\?embed=1/.test(src || "")) throw new Error(`iframe src=${src}`);
    const dupHeader = await page.evaluate(() => {
      const f = document.querySelector(".hub-frame.on");
      const h = f?.contentDocument?.querySelector(".header");
      return h ? getComputedStyle(h).display : "none";
    });
    if (dupHeader !== "none") throw new Error("iframe 안 헤더가 보임(중복 크롬)");
    return `탭[${tabs.join("·")}], iframe=${src}, 중복 헤더 없음`;
  });

  await scenario("QA-C02", "메뉴 C안", "구주소 자동 리다이렉트", {
    given: "예전 즐겨찾기·바로가기가 kpi.html을 직접 가리킬 때",
    when: "kpi.html을 열면",
    then: "hub.html?g=report&t=kpi.html 로 이동하고 '보안 KPI' 탭이 활성화된다(KPI는 리포트 그룹 — 2026-07-25 이동)",
  }, async () => {
    await open("kpi.html");
    await page.waitForTimeout(600);
    const url = page.url();
    if (!/hub\.html\?g=report&t=kpi\.html/.test(url)) throw new Error(`URL=${url}`);
    const onTab = await page.evaluate(() => document.querySelector(".hub-tab.on")?.textContent);
    if (onTab !== "보안 KPI") throw new Error(`활성 탭=${onTab}`);
    return `kpi.html → ${url.split("/").pop()}, 활성 탭 '보안 KPI'`;
  });

  await scenario("QA-C03", "메뉴 C안", "설정 허브 + 업데이트 배지", {
    given: "새 버전이 있다고 서버가 알려줄 때",
    when: "hub.html?g=settings 를 열면",
    then: "설정 계열 5탭(설정·MCP 연동·업데이트·로그·작업 기록)이 뜨고 사이드바 설정 항목에 업데이트 배지가 표시된다",
  }, async () => {
    await open("hub.html?g=settings");
    const tabs = await page.evaluate(() => document.querySelectorAll(".hub-tab").length);
    // 메뉴 정리(2026-07-25): 사용량·요금·기능 안내 제거, MCP 연동 이동 편입 → 5탭
    if (tabs !== 5) throw new Error(`탭 ${tabs}개`);
    const badge = await page.evaluate(() => !!document.querySelector(".gn-upbadge"));
    if (!badge) throw new Error("업데이트 배지 없음");
    return `탭 5개 + 업데이트 배지 표시`;
  });

  // 2026-07-27 기대값 현행화: 오른쪽 가장자리 세로 글씨 탭 2개를 없앴다.
  //   · "작업 세션" → 왼쪽 메뉴 '관제 > 작업 세션'(sessions.html)
  //   · "AI 라이브 오피스" → 'AI 팀 > 팀 사무실(창)'과 같은 것이라 개념이 둘로 나뉘어 있었다
  // 세로로 눕힌 글씨는 읽는 데만 시간이 걸린다는 판단(실화면 점검). 팝업 몸통은 남아 있고
  // window.gijoOpenSessions/OpenOffice로 부를 수 있다 — 상시 노출되는 입구만 없앴다.
  await scenario("QA-C04", "작업 세션", "작업 세션은 왼쪽 메뉴에 있고 세로 글씨 탭은 없다", {
    given: "허브 화면(임베드 아님, 최상위)에서",
    when: "페이지 로드가 끝나면",
    then: "왼쪽 메뉴에 '작업 세션'이 있고, 가장자리 세로 글씨 탭은 하나도 없다",
  }, async () => {
    await open("hub.html?g=assets");
    const r = await page.evaluate(() => ({
      rail: Boolean(document.getElementById("gijoEdgeRail")),
      menuSess: [...document.querySelectorAll("#gijoNav *")].some((e) => e.children.length === 0 && e.textContent.trim() === "작업 세션"),
      vertical: [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).writingMode.startsWith("vertical") && e.offsetParent).length,
      openApi: typeof window.gijoOpenSessions === "function",
      open: document.getElementById("gijoCmdPanel")?.classList?.contains("on") ?? false,
    }));
    if (r.rail) throw new Error("가장자리 레일이 아직 있음");
    if (!r.menuSess) throw new Error("왼쪽 메뉴에 '작업 세션' 없음");
    if (r.vertical > 0) throw new Error("세로로 쓴 글씨 " + r.vertical + "개 남음");
    if (!r.openApi) throw new Error("gijoOpenSessions 함수 없음(팝업 몸통 유실)");
    if (r.open) throw new Error("기본이 펼침 상태");
    return "메뉴에 작업 세션 있음, 세로 글씨 0개, 팝업 기본 접힘";
  });

  await scenario("QA-C05", "메뉴 C안", "AI 지식·모델 허브 6탭", {
    given: "AI 계열 화면이 허브 하나로 통합된 뒤(문서 보강은 기억·학습에 병합 — 2026-07-25 메뉴 정리)",
    when: "hub.html?g=aiknowledge 를 열면",
    then: "기억·학습(RAG)/인수인계/온톨로지/학습 루프/LLM 합성/LLM 가이드 6탭이 뜬다",
  }, async () => {
    await open("hub.html?g=aiknowledge");
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".hub-tab")].map((t) => t.textContent));
    if (tabs.length !== 6) throw new Error(`탭 ${tabs.length}개: ${tabs.join(",")}`);
    if (!tabs.some((t) => t.includes("인수인계"))) throw new Error("인수인계 탭 누락");
    return `탭 6개: ${tabs.join("·")}`;
  });

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
