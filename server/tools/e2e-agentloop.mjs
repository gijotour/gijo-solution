// tools/e2e-agentloop.mjs — 에이전트 루프 실 GPU end-to-end 검증 (격리 서버 대상)
// 사용: 격리 서버 기동 후  node tools/e2e-agentloop.mjs http://localhost:4100
// 검증: ① 자산 조회 지시 → list_assets 도구 호출 + 실데이터 근거 한국어 답변
//       ② 특정 자산 상세 지시 → get_asset(assetId 인자 추출)
//       ③ 잡담 → 도구 미사용(기존 채팅 폴백)

const base = process.argv[2] ?? "http://localhost:4100";

async function api(path, opts = {}, token) {
  const res = await fetch(base + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

const { accessToken: token } = await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "jyh", password: "changeme" }),
});

// 테스트 자산 2건 등록
for (const id of ["e2e-bot-01", "e2e-rag-02"]) {
  await api("/api/assets", { method: "POST", body: JSON.stringify({ id, name: id, path: `models/${id}.gguf` }) }, token);
}

// ① 자산 개수 질의 — list_assets 도구 경유(모델 최초 로드 포함이라 여유 타임아웃)
console.log("① '등록된 AI 자산 몇 개야?' 디스패치 (모델 로드 포함, 최대 3분)…");
let t0 = Date.now();
const r1 = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: "등록된 AI 자산 몇 개야?" }) }, token);
console.log(`   (${Math.round((Date.now() - t0) / 1000)}s) 답변:`, r1.output?.slice(0, 200));
console.log("   toolCalls:", (r1.toolCalls ?? []).map((c) => c.tool).join(", ") || "(없음)");
check("① 도구 list_assets 호출", (r1.toolCalls ?? []).some((c) => c.tool === "list_assets"));
check("① 답변에 실데이터 근거", /2|두/.test(r1.output ?? "") && /(e2e-bot-01|자산)/.test(r1.output ?? ""), r1.output?.slice(0, 80));
check("① 한자 없음(한국어)", !/[一-鿿]{2,}/.test(r1.output ?? ""));

// ② 특정 자산 상세 — assetId 인자 추출
console.log("② 'e2e-bot-01 상세 정보 알려줘' 디스패치…");
t0 = Date.now();
const r2 = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: "e2e-bot-01 자산 상세 정보 알려줘" }) }, token);
console.log(`   (${Math.round((Date.now() - t0) / 1000)}s) 답변:`, r2.output?.slice(0, 200));
console.log("   toolCalls:", JSON.stringify(r2.toolCalls?.map((c) => ({ t: c.tool, a: c.args }))));
check("② get_asset(assetId) 호출", (r2.toolCalls ?? []).some((c) => c.tool === "get_asset" && c.args?.assetId === "e2e-bot-01"));
check("② 답변에 자산 정보", (r2.output ?? "").includes("e2e-bot-01"), r2.output?.slice(0, 80));

// ③ 잡담 — 도구 미사용 폴백
console.log("③ '고마워 수고했어' 디스패치…");
const r3 = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: "고마워 수고했어" }) }, token);
console.log("   답변:", r3.output?.slice(0, 120));
check("③ 도구 미사용(폴백)", !r3.toolCalls || r3.toolCalls.length === 0);

const fail = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
