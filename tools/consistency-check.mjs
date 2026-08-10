// tools/consistency-check.mjs — 규정 질문 상충 감지 (중-3 게이트 보강)
//
// ⚠ 왜 (2026-08-10 실측, Mac 발견): ops-sim은 각 문항 **1회**라 「통과했는데 회차마다 답이
//   정반대」를 못 본다. 「퇴사자 계정 언제까지」가 10회에 6개월/1년/2년/즉시로 갈렸는데
//   낱말 판정(개인정보|보관|삭제)이 5/5 통과했다. 담당자가 이 답으로 규정을 정하면
//   어제는 1년, 오늘은 2년이다. **핵심 수치가 회차마다 갈리면 실패**로 잡는다.
//
// ⚠ 근본은 RAG 오염(모델이 회차마다 다르게 씀)이라 ①ⓑ가 고칠 것이다. 이 검사는 그걸
//   **드러내는 잣대**다 — ①ⓑ 전후로 「상충 N건 → 몇 건」을 같은 방법으로 잰다.
//
// 사용:  QA_USER/QA_PASS 환경변수 후  node tools/consistency-check.mjs [반복수(기본 5)]
const base = "http://localhost:4000";
const N = Number(process.argv[2] ?? 5);

// 수치(기간)로 답해야 하는 규정 질문 — 회차마다 갈리면 담당자가 규정을 잘못 정한다.
const 규정질문 = [
  "퇴사자 계정 언제까지 남겨둬야 해?",
  "개인정보 접속기록 몇 년 보관해야 해?",
  "장비 로그 보관 기간 알려줘",
];

// 답에서 「보관/삭제 기간」의 대표값을 뽑는다. 년·개월·일 단위 수치와 「즉시」를 모은다.
function 기간값(text) {
  const s = new Set();
  for (const m of String(text).matchAll(/(\d+)\s*(년|개월|주|일)(?!\s*(이내|간|자)?\s*(전|후|째))?/g)) s.add(`${m[1]}${m[2]}`);
  if (/즉시\s*(삭제|비활성|파기)|지체\s*없이/.test(text)) s.add("즉시");
  return [...s];
}

const l = await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: process.env.QA_USER, password: process.env.QA_PASS, force: true }) })).json();
const H = { Authorization: "Bearer " + l.accessToken, "Content-Type": "application/json" };

let 상충건수 = 0;
console.log(`규정 질문 ${규정질문.length}개 × ${N}회 상충 검사\n`);
for (const q of 규정질문) {
  const 회차값 = [];
  for (let i = 0; i < N; i++) {
    const j = await (await fetch(base + "/api/dispatch", { method: "POST", headers: H, body: JSON.stringify({ text: q, qa: true }), signal: AbortSignal.timeout(120000) })).json();
    회차값.push(기간값(j.output ?? ""));
  }
  // ⚠ 「한 답에 여러 값」(1년/2년 조건별 구분 = 정상)과 「회차마다 값이 바뀜」(모델이 지어냄 = 상충)을
  //   가른다. 정답: 회차별 값 **집합**이 전부 같으면 일관, 하나라도 다르면 상충.
  //   (접속기록은 매번 {1년,2년}로 일관 — 조건별 구분이라 정상. 퇴사자는 회차마다 달라 상충.)
  const 정규화 = 회차값.map((v) => [...v].sort().join("|") || "—");
  const 서로다른답 = [...new Set(정규화)];
  const 상충 = 서로다른답.length > 1;
  if (상충) 상충건수++;
  console.log(`${상충 ? "⚠ 상충" : "✓ 일관"}  "${q}"`);
  console.log(`   회차별 기간값: ${회차값.map((v) => `{${v.join(",") || "—"}}`).join(" ")}`);
  console.log(`   서로 다른 답 ${서로다른답.length}종: ${서로다른답.map((s) => `{${s.replace(/\|/g, ",")}}`).join(" ")}\n`);
}
console.log(`■ 상충 ${상충건수}/${규정질문.length}건 — ${상충건수 === 0 ? "전부 일관 (통과)" : "규정 질문이 회차마다 갈린다 (RAG 오염 ①ⓑ가 고칠 것)"}`);
process.exit(상충건수 === 0 ? 0 : 1);
