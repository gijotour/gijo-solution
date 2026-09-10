#!/usr/bin/env node
// chat-probe.mjs — 고객 QA 인스턴스(4100)에서 **고객이 실제로 쓰는 길**로 한 문답을 돌리고,
//                  그 문답이 학습 재료(chat_logs)로 **실제로 쌓였는지**까지 확인한다.
//
// ■ 왜 필요한가 (2026-09-10 검토관 [중])
//   첫 검증은 `/api/llm/chat`(직접 채팅 API)로 200만 확인했다. 그런데 그 경로엔 agentId가
//   없어 수집이 `NOT NULL constraint failed: chat_logs.agentId`로 **두 번 다 실패**했고,
//   보고에는 그 실패가 없었다. 고객 QA의 존재 이유가 「고객 질문이 곧 학습 재료」인데
//   그 재료가 하나도 안 쌓이는 것을 「통과」라고 적은 셈이다.
//   그래서 이 탐침은 **대화창 출구(POST /api/dispatch)** 로 묻고, 전·후 수집 건수를 센다.
//
// ■ 비밀값
//   자격은 env로만 받는다 — 인자·파일·출력 어디에도 싣지 않는다(작업 규칙).
//     QA_BASE        기본 http://localhost:4100
//     QA_USER/QA_PASS        고객 계정(security_officer) — 필수
//     QA_ADMIN_USER/QA_ADMIN_PASS  수집 건수 조회용 admin — 없으면 위 계정으로 조회 시도
//     QA_QUESTION    기본 「ISMS-P가 뭐야?」
//
// 종료코드 0=통과 / 2=자격 없음 / 1=실패(까닭 출력)

const BASE = process.env.QA_BASE || "http://localhost:4100";
const USER = process.env.QA_USER;
const PASS = process.env.QA_PASS;
const ADMIN_USER = process.env.QA_ADMIN_USER || USER;
const ADMIN_PASS = process.env.QA_ADMIN_PASS || PASS;
const QUESTION = process.env.QA_QUESTION || "ISMS-P가 뭐야?";

if (!USER || !PASS) {
  console.error("✗ QA_USER·QA_PASS를 env로 넘길 것 — 이 스크립트는 자격을 파일에서 읽지 않는다.");
  process.exit(2);
}

// ⚠ 주소 오발사 방지 — 기본값이 운영(4000)으로 떨어지면 고객 탐침이 사내 서버를 두드린다.
if (/:4000(\/|$)/.test(BASE)) {
  console.error(`✗ QA_BASE가 운영(4000)을 가리킨다: ${BASE} — 고객 인스턴스(4100)로 바꿀 것.`);
  process.exit(2);
}

const login = async (u, p) => {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: p, force: true }),
  }).then((x) => x.json());
  if (!r.accessToken) throw new Error(`로그인 실패(${u}) — ${JSON.stringify(r).slice(0, 160)}`);
  return r.accessToken;
};

const 수집건수 = async (tok) => {
  const r = await fetch(BASE + "/api/learnloop/logs", { headers: { authorization: `Bearer ${tok}` } });
  if (!r.ok) return null; // 권한이 없으면 null — 「못 쟀다」를 0으로 읽지 않는다.
  const j = await r.json();
  return j?.kpis?.total ?? (Array.isArray(j?.logs) ? j.logs.length : null);
};

const 폴백문구 = [
  "AI 모델이 아직 준비되지 않았습니다",
  "모델을 불러오는 중",
  "일시적인 오류",
  "죄송합니다. 요청을 처리하지 못했습니다",
];

let 실패 = 0;
const adminTok = await login(ADMIN_USER, ADMIN_PASS).catch((e) => { console.error("· admin 로그인 실패:", e.message); return null; });
const 전 = adminTok ? await 수집건수(adminTok) : null;
console.log(`· 수집 전 chat_logs: ${전 === null ? "(못 쟀다 — 권한 없음)" : 전}`);

const userTok = await login(USER, PASS);
const t0 = Date.now();
const res = await fetch(BASE + "/api/dispatch", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${userTok}` },
  body: JSON.stringify({ text: QUESTION, screen: "chat", sessionId: "chat-probe-" + Date.now() }),
});
const 초 = ((Date.now() - t0) / 1000).toFixed(1);
const body = await res.text();
let j = null;
try { j = JSON.parse(body); } catch { /* 그대로 둔다 */ }
const out = j?.output ?? "";
// route는 RoutedIntent{agentId, action, targetAssetId?}다(intent.ts:12) — 없는 이름으로 찍으면 늘 "?"가 나온다.
console.log(`· POST /api/dispatch → ${res.status} · ${초}초 · 답 ${out.length}자 · 경로 ${j?.route?.action ?? "?"}/${j?.route?.agentId ?? "?"}`);
console.log(`· 답 앞 120자: ${out.slice(0, 120).replace(/\n/g, " ")}`);

if (!res.ok || !out.trim()) { console.error("✗ 대화창 경로가 답을 못 냈다"); 실패 = 1; }
for (const f of 폴백문구) if (out.includes(f)) { console.error(`✗ 폴백 문구가 나왔다: ${f}`); 실패 = 1; }

// 수집은 응답 뒤에 비동기로 들어갈 수 있어 잠깐 기다렸다 센다.
await new Promise((r) => setTimeout(r, 1500));
const 후 = adminTok ? await 수집건수(adminTok) : null;
console.log(`· 수집 후 chat_logs: ${후 === null ? "(못 쟀다)" : 후}`);
if (전 !== null && 후 !== null) {
  if (후 > 전) console.log(`✓ 대화가 학습 재료로 쌓였다(${전} → ${후})`);
  else { console.error(`✗ 대화가 안 쌓였다(${전} → ${후}) — 수집 입구가 깨졌다. server.log의 「대화 수집 실패」를 볼 것.`); 실패 = 1; }
} else {
  console.error("✗ 수집 건수를 못 쟀다 — admin 자격(QA_ADMIN_USER·QA_ADMIN_PASS)을 넘길 것. 「못 쟀다」는 통과가 아니다.");
  실패 = 1;
}

console.log(실패 ? "종합: ✗ 실패" : "종합: 통과");
process.exit(실패);
