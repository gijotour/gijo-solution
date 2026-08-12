// tools/measure-branch-grabs.mjs — **결정 분기가 남의 말을 채 가는지** 전수로 잰다.
//
// ■ 왜 이렇게 재나 (2026-08-12)
//   dispatcher.ts에는 결정 분기가 77개 있다. 그중 **하나**(조치 플레이북)를 재봤더니
//   담당자 말투 10개 중 5개를 채 갔다. 나머지 76개는 아무도 음성으로 재본 적이 없다.
//   그런데 분기를 하나씩 열어 보는 것은 느리고, **코드를 읽는 것으로는 안 드러난다** —
//   오늘 것도 코드만 봐서는 「배제가 세 겹이나 있으니 괜찮겠지」로 보였다.
//
//   그래서 분기를 세지 않고 **증상으로 잡는다**: 결정 분기는 LLM을 안 타므로 답이
//   **1.5초 미만**에 돌아온다. 지식·LLM이 답해야 할 물음에 그런 답이 오면 누군가 채 간 것이다.
//   ⚠ 빠른 답이 전부 잘못은 아니다("오늘 할 일"은 빠른 게 정상이다). 그래서 **판정하지 않고
//   표로 낸다** — 어느 분기가 왜 가져갔는지는 사람이 본다. 기계가 섣불리 판정하면
//   오늘 내가 첫 측정에서 오탐을 8건으로 부풀려 센 것과 같은 일이 난다.
//
// ■ 문항은 **사용자 언어**로 쓴다 — 담당자는 라벨이 아니라 증상으로 말한다.
//   지금까지 게이트 문항이 「제품이 답해야 하는 말」로 짜여 있었던 것이 결함이 오래 남은 이유다.
//
// 사용: GIJO_QA_PASSWORD=… node tools/measure-branch-grabs.mjs

const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const USER = process.env.GIJO_QA_USER || "win_claude-qa";
const PW = process.env.GIJO_QA_PASSWORD;
if (!PW) { console.error("★ GIJO_QA_PASSWORD가 없다."); process.exit(2); }

// 결정 분기 답으로 의심할 문턱(초). 이 아래면 LLM을 안 탄 것이다.
const 빠름 = 1.5;

const 문항 = [
  // ── 보안 운영: 증상 서술 (지식 저장소에 자료가 있는 축) ──────────────
  ["로그", "방화벽 로그에 deny가 갑자기 늘었는데 뭘 봐야 해?"],
  ["로그", "syslog에 pri 값이 뭘 뜻하는지 모르겠어"],
  ["탐지", "브루트포스 같은 게 계속 보이는데 어디부터 봐야 하지?"],
  ["탐지", "IPS에서 자꾸 같은 룰이 뜨는데 튜닝 어떻게 해?"],
  ["클라우드", "S3에 퍼블릭 걸린 게 있대. 뭐부터 확인해?"],
  ["클라우드", "IAM 권한을 최소로 준다는 게 실제로 뭘 어떻게 하는 거야?"],
  ["취약점", "EPSS랑 VPR이랑 뭐가 달라?"],
  ["취약점", "KEV에 올라오면 며칠 안에 해야 하는 거였지?"],
  ["하드닝", "SSH에서 root 로그인 막는 게 U 몇 번이야?"],
  ["규정", "개인정보가 샜을 때 며칠 안에 신고해야 해?"],
  ["규정", "망분리가 전자금융 쪽에선 어떻게 되는 거야?"],
  ["AI보안", "프롬프트 인젝션이 우리 제품에선 어떻게 막히는 거야?"],

  // ── 상태·조회: 빠른 답이 **정상**인 것들(대조군) ─────────────────────
  ["대조군", "오늘 뭐부터 해야 해?"],
  ["대조군", "스캔 현황 알려줘"],
  ["대조군", "보안 KPI 어때?"],

  // ── 영역 밖: 정형 보안 답이 나오면 안 되는 것들 ──────────────────────
  ["영역밖", "직원이 퇴사하는데 어떻게 대응해?"],
  ["영역밖", "고객사에서 견적서를 요청했는데 어떻게 대응해?"],
  ["영역밖", "내일 회의 자료를 어떻게 준비하지?"],
  ["영역밖", "휴가 신청은 어떻게 해?"],

  // ── 장애·침해: 서로 다른 분기가 다투는 자리 ──────────────────────────
  ["장애/침해", "방화벽이 갑자기 응답이 없어. 뭐부터 해?"],
  ["장애/침해", "직원 PC가 이상해. 랜섬웨어 같은데 어떡하지?"],
  ["장애/침해", "로그가 어제부터 안 들어와. 뭐가 문제일까?"],

  // ── 되묻기가 맞는 자리(대상 없는 대명사) ─────────────────────────────
  ["되묻기", "이거 어떻게 해?"],
  ["되묻기", "그거 처리해줘"],
];

const l = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PW, force: true }),
});
if (!l.ok) { console.error(`★ 로그인 실패 ${l.status}`); process.exit(2); }
const { accessToken, refreshToken } = await l.json();

console.log(`문항 ${문항.length}개 · 빠름 문턱 ${빠름}초 (그 아래면 결정 분기가 답한 것)\n`);
const 의심 = [];

for (const [갈래, q] of 문항) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text: q, qa: true }),
  });
  const j = await r.json().catch(() => ({}));
  const 초 = (Date.now() - t0) / 1000;
  const 답 = String(j?.output ?? "").replace(/\n+/g, " ");
  const 도구 = (j?.toolCalls ?? []).map((t) => t.tool).join(",") || "-";
  const 되묻기 = j?.confirm?.type ?? (j?.approval ? "결재판" : "");
  const 빠른가 = 초 < 빠름;
  if (빠른가) 의심.push([갈래, q, 초, 답.slice(0, 60)]);
  console.log(`${빠른가 ? "⚡" : "  "} ${초.toFixed(1).padStart(5)}초 [${갈래.padEnd(6)}] ${q}`);
  console.log(`      도구=${도구}${되묻기 ? " · " + 되묻기 : ""} · ${답.slice(0, 90)}`);
}

await fetch(`${BASE}/api/auth/logout`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ refreshToken }),
});

console.log(`\n⚡ 표시 ${의심.length}건 — 결정 분기가 답한 것(대조군·되묻기는 정상일 수 있다).`);
console.log("판정은 사람이 한다. 갈래가 「대조군」·「되묻기」가 아닌데 ⚡면 들여다볼 자리다.");
console.log("세션 정리 완료");
