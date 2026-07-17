// tools/e2e-approval.mjs — 결재판(시안 B) 실 GPU end-to-end 검증 (격리 서버 대상)
// 사용: 격리 서버 기동 후  node tools/e2e-approval.mjs http://localhost:4100
// 검증: ① 쓰기 지시 → 실행되지 않고 결재판 반환 + 값 출처 판정
//       ② 필수값 누락 지시 → missing으로 되물음
//       ③ 승인 실행 → 실제 등록  ④ 조회 도구는 승인 경로로 실행 불가

const base = process.argv[2] ?? "http://localhost:4100";

async function api(path, opts = {}, token) {
  const res = await fetch(base + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

const { body: auth } = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "jyh", password: "changeme" }) });
const token = auth.accessToken;

const before = (await api("/api/assets", {}, token)).body.length;
console.log(`시작 자산 수: ${before}\n`);

// ① 쓰기 지시 — 실행되지 않고 결재판이 와야 한다
console.log('① "사내 챗봇 자산 등록해줘. 경로는 models/chatbot.gguf 야" (모델 로드 포함, 최대 3분)…');
let t0 = Date.now();
const r1 = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: "사내 챗봇 자산 등록해줘. 경로는 models/chatbot.gguf 야" }) }, token);
const ap = r1.body.approval;
console.log(`   (${Math.round((Date.now() - t0) / 1000)}s) 답변: ${r1.body.output?.slice(0, 120)}`);
if (ap) console.log("   결재판 필드:", ap.fields.map((f) => `${f.label}=${f.value || "(빈칸)"}[${f.source}]`).join(" · "));
check("① 결재판 반환(실행 안 함)", !!ap && ap.tool === "register_asset");
check("① 승인 전 자산이 늘지 않음", (await api("/api/assets", {}, token)).body.length === before);
if (ap) {
  const by = (k) => ap.fields.find((f) => f.key === k);
  check("① id 자동생성", by("assetId")?.source === "auto" && !!by("assetId")?.value, by("assetId")?.value);
  check("① 경로를 지시에서 추출", by("path")?.value === "models/chatbot.gguf" && by("path")?.source === "said", by("path")?.value);
  check("① 유형 규칙 추정(.gguf→LLM 서비스)", by("assetType")?.value === "LLM 서비스" && by("assetType")?.source === "auto");
  check("① 실행 영향 고지 있음", !!ap.effect, ap.effect?.slice(0, 60));
}

// ② 필수값 누락 — 되물어보기(빈 칸)
console.log('\n② "테스트봇 등록해줘" (경로 없음)…');
const r2 = await api("/api/dispatch", { method: "POST", body: JSON.stringify({ text: "테스트봇 자산 등록해줘" }) }, token);
const ap2 = r2.body.approval;
console.log(`   답변: ${r2.body.output?.slice(0, 140)}`);
if (ap2) console.log("   missing:", JSON.stringify(ap2.missing));
check("② 필수값 누락을 missing으로 되물음", !!ap2 && ap2.missing.includes("path"));
check("② 안내문이 필요한 값을 알려줌", /경로/.test(r2.body.output ?? ""));

// ③ 승인 실행
console.log("\n③ 결재판 승인 실행…");
if (ap) {
  const args = Object.fromEntries(ap.fields.map((f) => [f.key, f.value]));
  const r3 = await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ tool: "register_asset", args }) }, token);
  console.log("   결과:", r3.body.output ?? r3.body.error);
  check("③ 승인 실행 성공", r3.status === 200 && /등록했습니다/.test(r3.body.output ?? ""));
  const after = (await api("/api/assets", {}, token)).body.length;
  check("③ 자산이 실제로 늘어남", after === before + 1, `${before} → ${after}`);
  const created = (await api("/api/assets", {}, token)).body.find((a) => a.id === args.assetId);
  check("③ 값이 정확히 저장됨", created?.name === "사내 챗봇" && created?.path === "models/chatbot.gguf");
}

// ④ 조회 도구는 승인 경로로 실행 불가
const r4 = await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ tool: "list_assets", args: {} }) }, token);
check("④ 조회 도구는 승인 경로 거부(400)", r4.status === 400, r4.body.error);

// ⑤ 무인증 차단
const r5 = await api("/api/agent/approve", { method: "POST", body: JSON.stringify({ tool: "register_asset", args: { name: "해커", path: "x.gguf" } }) });
check("⑤ 무인증 승인 차단(401)", r5.status === 401);

const fail = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
