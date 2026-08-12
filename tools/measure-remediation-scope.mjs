// tools/measure-remediation-scope.mjs — **조치 플레이북 분기가 무엇을 채 가는가**를 잰다.
//
// ■ 왜 재고 시작하나
//   이 자리는 이 저장소가 반복해 다친 곳이다(「분기 순서가 기능을 죽인다」).
//   dispatcher.ts:1143의 플레이북 분기에는 이미 배제가 **세 겹**(장애·침해사고·실행지시)
//   붙어 있다. 하나씩 사고가 날 때마다 덧댄 것이다. 네 번째를 덧대기 전에
//   **지금 영토가 어디까지인지** 표로 본다 — 안 그러면 또 한 겹 덧대고 또 새는 것을 반복한다.
//
// ■ 어떻게 가르나 — 답의 **서명**으로 본다(LLM 판정 안 씀).
//   플레이북은 결정적이라 0.1초에 「🛠 조치 플레이북」으로 시작한다. 지식 조회는 수 초 걸린다.
//   그래서 시간과 머리글만 보면 어느 분기가 가져갔는지 확실히 안다.
//
// ■ 두 쪽을 다 잰다 — 한쪽만 재면 「좁히면 낫다」는 착각에 빠진다.
//   ① 가로채면 안 되는 것: 우리 지식 저장소에 문서가 있는 주제를 담당자 말투로 물은 것
//   ② 가로채야 하는 것: 진짜 「일반 취약점을 어떻게 조치하나」 물음 — 여기서 플레이북이
//      안 나오면 그건 **기능을 죽인 것**이다.
//
// 사용: GIJO_QA_PASSWORD=… node tools/measure-remediation-scope.mjs

const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const PW = process.env.GIJO_QA_PASSWORD;
if (!PW) { console.error("★ GIJO_QA_PASSWORD가 없다."); process.exit(2); }

// ① 지식이 있는 주제 — 담당자가 실제로 쓸 말투. **플레이북이 가로채면 안 된다.**
const 지식질문 = [
  "내부 PC에서 인터넷으로 나가는 445 포트 접속이 급증했는데 어떻게 대응해?",
  "outbound 445 급증 초동 조치 절차가 뭐야?",
  "SSH root 직접 로그인이 허용돼 있는데 어떻게 조치해?",
  "S3 버킷이 퍼블릭으로 열려 있어. 대응 방안 알려줘",
  "brute force 로그인 시도가 계속 잡히는데 어떻게 대응해?",
  "WAF에서 SQL 인젝션 탐지가 떴는데 조치 방법 알려줘",
  "IPS 오탐이 너무 많아. 어떻게 대응하지?",
  "개인정보 유출이 의심되면 어떤 절차로 대응해?",
  "Log4Shell 대응 방법 알려줘",
  "MFA를 어디부터 적용해야 하는지 조치 절차 알려줘",
  // ↓ max 실측(2026-08-12). **보안 질문조차 아닌데** 취약점 플레이북이 나왔다 —
  //   「어떻게 대응해?」라고만 물으면 무엇이든 걸린다는 증거다.
  "직원이 퇴사하는데 어떻게 대응해?",
  "고객사에서 견적서를 요청했는데 어떻게 대응해?",
  "방화벽 로그가 안 쌓이는데 어떻게 대응해?",
];

// ② 진짜 플레이북 영토 — **여기서 플레이북이 나와야 정상이다.**
const 플레이북질문 = [
  "이 취약점 조치 방법 알려줘",
  "취약점 조치 절차가 어떻게 돼?",
  "medium 취약점은 며칠 안에 조치해야 해?",
  "KEV에 오른 취약점 대응 방안 알려줘",
  "조치 플레이북 보여줘",
];

// ⚠ 계정 이름은 **기계 접두사**를 붙인다(사장님 결정 2026-08-12): win_claude-qa · max_claude-qa.
//   두 기계에 같은 이름이 있던 것이 헷갈림의 원인이었다.
const USER = process.env.GIJO_QA_USER || "win_claude-qa";
const l = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PW, force: true }),
});
if (!l.ok) { console.error(`★ 로그인 실패 ${l.status}`); process.exit(2); }
const { accessToken, refreshToken } = await l.json();

async function 물어본다(q) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text: q, qa: true }),
  });
  const j = await r.json().catch(() => ({}));
  const 답 = String(j?.output ?? "");
  const 플레이북 = 답.startsWith("🛠 조치 플레이북");
  // ⚠ **「플레이북이 나왔다」와 「맞는 플레이북이 나왔다」는 다르다.**
  //   특정 규칙 5종(rce·injection·llm·misconfig·outdated)에 걸리면 쓸모 있는 답이다.
  //   아무 데도 안 걸려 「일반 취약점 조치」로 떨어진 것만이 **내용 없는 정형문**이다.
  //   첫 측정에서 이 둘을 안 갈라 오탐을 부풀려 셌다(2026-08-12).
  const 제목 = 플레이북 ? (답.split("\n")[0].split("—")[1] ?? "").trim() : "";
  return { 답, 초: (Date.now() - t0) / 1000, 플레이북, 제목, 일반: 제목.startsWith("일반 취약점 조치") };
}

function 표줄(q, r, 나쁨) {
  const 어디 = r.플레이북 ? `플레이북: ${r.제목}` : "그 밖(지식·LLM)";
  return `${나쁨 ? "  ★" : "  ✓"} ${r.초.toFixed(1).padStart(5)}초 · ${어디.padEnd(28)} · ${q}`;
}

console.log("① 지식이 있는 주제 — **내용 없는 「일반」 정형문**이 가로채면 안 된다");
let 일반가로챔 = 0, 특정플레이북 = 0;
for (const q of 지식질문) {
  const r = await 물어본다(q);
  if (r.일반) 일반가로챔++;
  else if (r.플레이북) 특정플레이북++;
  console.log(표줄(q, r, r.일반));
}

console.log("\n② 진짜 플레이북 영토 — 여기서 플레이북이 나와야 한다");
let 미탐 = 0;
for (const q of 플레이북질문) {
  const r = await 물어본다(q);
  if (!r.플레이북) 미탐++;
  console.log(표줄(q, r, !r.플레이북));
}
const 오탐 = 일반가로챔;
console.log(`\n(참고) ①에서 **맞는** 특정 플레이북이 나온 것: ${특정플레이북}건 — 이건 결함이 아니다.`);

await fetch(`${BASE}/api/auth/logout`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ refreshToken }),
});

console.log(`\n요약: 가로챔(오탐) ${오탐}/${지식질문.length} · 영토 지킴 실패(미탐) ${미탐}/${플레이북질문.length}`);
console.log("세션 정리 완료");
