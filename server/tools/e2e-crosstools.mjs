// tools/e2e-crosstools.mjs — 의도 축 도구셋이 실 LLM에게 편한지 검증 (격리 서버)
// 사용: node tools/e2e-crosstools.mjs http://localhost:4100
// 핵심 질문: 메뉴를 가로지르는 지시("오늘 뭐부터?", "○○ 관련된 거 찾아줘", "이게 뭐야")를
//           도구 1개로 답하는가? (메뉴 미러링이면 여러 도구를 조합해야 해서 실패율이 오른다)

const base = process.argv[2] ?? "http://localhost:4100";

async function api(path, opts = {}, token) {
  const res = await fetch(base + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

const { body: auth } = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "jyh", password: "changeme" }) });
const token = auth.accessToken;

// 케이스: 지시 → 기대 도구(메뉴를 가로지르는 질문을 도구 1개로 답해야 한다)
const CASES = [
  { text: "오늘 뭐부터 조치해야 해?", expect: "today" },
  { text: "지금 급한 취약점 상위 3건만 알려줘", expect: "today" },
  { text: "프롬프트 인젝션이 뭐야? 우리 대응 통제는 있어?", expect: "explain" },
  { text: "Log4Shell 관련된 거 다 찾아줘", expect: "search" },
  { text: "등록된 AI 자산 몇 개야?", expect: "list_assets" },
  { text: "ai-secbot-01 자세히 보여줘", expect: "get_asset" },
];

for (const c of CASES) {
  const t0 = Date.now();
  const r = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: c.text }) }, token);
  const tools = (r.body.toolCalls ?? []).map((x) => x.tool);
  const sec = Math.round((Date.now() - t0) / 1000);
  const ok = tools[0] === c.expect;
  check(`"${c.text}" → ${c.expect}`, ok, `호출=[${tools.join(", ") || "없음"}] ${sec}s`);
  if (ok) console.log(`     답변: ${(r.body.output ?? "").slice(0, 150).replace(/\n/g, " ")}`);
}

// 도구 1개로 끝나는지(턴 낭비 없음) — today는 단일 호출이어야 한다
const r2 = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: "오늘 뭐부터 해야 해?" }) }, token);
check("메뉴 가로지르는 질문을 도구 1회로 답함", (r2.body.toolCalls ?? []).length === 1, `${(r2.body.toolCalls ?? []).length}회 호출`);

const fail = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
