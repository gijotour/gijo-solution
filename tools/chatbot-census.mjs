// tools/chatbot-census.mjs — 챗봇 전수 점검 (사용자 상황점검 1,133개 중 「챗봇 99개」)
//
// 상황점검(GIJO_AS_사용자_상황점검_2026-08.md)에서 챗봇만 표본(서랍 17문항)으로 대신했다.
// 실 LLM이라 한 건에 5~30초가 걸려 전수가 4시간이기 때문이다. 이 도구가 그 전수다.
//
// 무엇을 재나 — 화면 33개 × 대표 질문 3개:
//   ① 여기 뭐 하는 곳이야   (화면 안내 — screenguide가 답해야 한다)
//   ② 여기서 뭘 할 수 있어  (할 수 있는 일 — 도구·행동으로 이어져야 한다)
//   ③ 화면별 실제 질문      (그 화면의 본업 — 자료를 보고 답해야 한다)
//
// FAIL로 치는 것(제품 규칙: 폴백 문구가 나오면 FAIL):
//   · 되물음("무엇을 도와드릴까요") — 질문을 못 알아들었다
//   · 규칙·머리말 누출("당신은 …입니다", "【")
//   · 빈 답 / 오류 / 가드레일 차단(정상 질문인데 막혔으면 자기차단)
//   · 30자 미만 — 답이라 할 수 없다
//
// ⚠ 실행 중 같은 계정(claude-deploy)으로 앱에 로그인하지 말 것 — 계정당 세션 1개라 서로 끊는다.
// ⚠ qa:true로 돌린다 — 작업 세션·학습 후보를 오염시키지 않는다.
//
// 사용: QA_USER=claude-deploy QA_PASS=… node tools/chatbot-census.mjs [--limit N]
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const USER = process.env.QA_USER || "claude-deploy";
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
const OUT = path.join(process.cwd(), ".tmp-reports");
const 제한 = (() => { const i = process.argv.indexOf("--limit"); return i > 0 ? Number(process.argv[i + 1]) : 0; })();

// 화면 목록은 nav.js에서 뽑는다 — 코드가 곧 목록이라 어긋나지 않는다.
function 화면들() {
  const src = fs.readFileSync("client/src/renderer/pages/nav.js", "utf8");
  const out = [];
  const seen = new Set();
  for (const m of src.matchAll(/\{\s*page:\s*"([^"]+\.html[^"]*)",\s*label:\s*"([^"]+)"/g)) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ page: m[1], label: m[2] });
  }
  return out;
}

// ③ 화면의 본업을 묻는 질문. 상상해서 만들지 않고 **그 화면이 실제로 다루는 것**으로 적는다.
const 본업질문 = {
  "dashboard.html": "오늘 뭐부터 볼까?",
  "sessions.html": "최근에 내가 한 작업 보여줘",
  "analysis.html": "지금 제일 급한 위험 뭐야?",
  "threat.html": "우리 자산에 걸리는 위협 있어?",
  "report.html": "이번 달 보안 리포트 만들어줘",
  "kpi.html": "우리 보안 점수 어때?",
  "compliance.html": "컴플라이언스 대응 안 된 항목 알려줘",
  "assethub.html": "위험도 높은 자산 알려줘",
  "inventory.html": "우리 자산 몇 대야?",
  "sbom.html": "AI-BOM이 뭐야?",
  "vulnscan.html": "미조치 취약점 알려줘",
  "approvals.html": "검토 안 한 항목 몇 건이야?",
  "products.html": "우리가 쓰는 보안제품 뭐뭐 있어?",
  "opsguide.html": "유지보수 점검 절차 알려줘",
  "hardening.html": "하드닝 점검 결과 알려줘",
  "terminal.html": "장비에 접속하려면 어떻게 해?",
  "agent.html": "에이전트가 뭐 하는 거야?",
  "memory.html": "문서를 올리려면 어떻게 해?",
  "handover.html": "인수인계 어떻게 시작해?",
  "ontology.html": "온톨로지가 뭐야?",
  "learnloop.html": "학습 루프가 뭐야?",
  "merge.html": "LLM 합성이 뭐야?",
  "redteam.html": "레드팀 점검 결과 알려줘",
  "settings.html?s=my": "내 비밀번호 바꾸려면?",
  "settings.html?s=ai": "쓰는 모델 뭐야?",
  "settings.html?s=link": "외부 연동 어떻게 설정해?",
  "settings.html?s=admin": "사용자 추가하려면?",
  "audit.html": "누가 뭘 지웠는지 볼 수 있어?",
};

// 폴백·누출 판정. 하나라도 걸리면 FAIL — 후하게 봐 주면 점검이 무의미해진다.
const 되물음 = /무엇을 도와드릴까요/;
// ⚠ "시스템 프롬프트"를 누출 표시로 쓰면 안 된다(2026-08-01 실측: AI-BOM 3문항 전부 오판).
//   이 제품에서 시스템 프롬프트는 **AI-BOM이 관리하는 자산 종류**라 화면 설명에 당연히 나온다.
//   보안 도메인 어휘가 자기 검사 규칙에 걸리는, 「자기차단 함정」과 같은 꼴이다.
//   진짜 누출 표시는 내부 프롬프트의 대괄호(【)와 페르소나 선언이다.
const 규칙누출 = /【|당신은\s.{0,20}(입니다|이다)|위\s*규칙을\s*따라/;
const 차단 = /차단했습니다|프롬프트 인젝션/;
// 0건일 때 짧은 답은 **정답**이다. "없습니다"를 길이로 깎으면 정직한 답을 벌주게 된다.
const 없음답 = /없습니다|없어요|해당(하는)?\s*(항목|건|자료)가?\s*없/;

async function 로그인() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS, force: true }),
  });
  const j = await r.json();
  const t = j.accessToken || j.token;
  if (!t) throw new Error("로그인 실패: " + JSON.stringify(j).slice(0, 200));
  return t;
}

async function 물어보기(H, text, screen) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + "/api/dispatch", {
      method: "POST", headers: H,
      body: JSON.stringify({ text, screen, qa: true }),
    });
    const j = await r.json();
    return { out: String(j.output ?? ""), action: j.route?.action ?? "?", ms: Date.now() - t0, dataHits: j.dataHits };
  } catch (e) {
    return { out: "", action: "ERROR", ms: Date.now() - t0, err: String(e).slice(0, 120) };
  }
}

function 판정(r, q) {
  if (r.err) return { ok: false, why: "오류 " + r.err };
  const o = r.out.trim();
  if (!o) return { ok: false, why: "빈 답" };
  if (되물음.test(o)) return { ok: false, why: "되물음(질문을 못 알아들음)" };
  if (규칙누출.test(o)) return { ok: false, why: "내부 규칙 누출" };
  if (차단.test(o)) return { ok: false, why: "가드레일이 정상 질문을 막음(자기차단)" };
  if (o.replace(/\s/g, "").length < 30 && !없음답.test(o)) return { ok: false, why: "너무 짧음(" + o.length + "자)" };
  // 내부 상태 이름이 그대로 나오면 담당자는 못 읽는다("active" 상태의 작업 내역이 없습니다).
  if (/"(active|pending|open|done|closed|approved|rejected)"/.test(o)) {
    return { ok: false, why: "내부 영문 상태값이 그대로 노출" };
  }
  // ★ "말이 되는 답"과 "물은 것에 대한 답"은 다르다.
  //   실측(2026-08-01): "내 업무 화면은 뭐 하는 곳이야?"에 설명 대신 할 일 목록이 쏟아졌다.
  //   내용은 멀쩡해서 길이·폴백 검사를 전부 통과한다 — 그래서 따로 본다.
  //   담당자에겐 "물어봤는데 딴 걸 준다"가 곧 안 직관적인 화면이다.
  if (q.종류 === "화면안내" && !/화면|메뉴|여기(는|서)|하는 곳|사용 안내|🤖/.test(o)) {
    return { ok: false, why: "화면 설명을 물었는데 자료를 쏟음" };
  }
  return { ok: true };
}

const 화면 = 화면들();
const 문항 = [];
for (const s of 화면) {
  문항.push({ 화면: s.page, 이름: s.label, 종류: "화면안내", q: `여기 ${s.label} 화면은 뭐 하는 곳이야?` });
  문항.push({ 화면: s.page, 이름: s.label, 종류: "할수있는일", q: `${s.label}에서 내가 할 수 있는 게 뭐야?` });
  문항.push({ 화면: s.page, 이름: s.label, 종류: "본업", q: 본업질문[s.page] || `${s.label} 현황 알려줘` });
}
const 대상 = 제한 ? 문항.slice(0, 제한) : 문항;

console.log(`■ 챗봇 전수 점검 — 화면 ${화면.length}개 × 3문항 = ${문항.length}문항${제한 ? ` (이번엔 ${대상.length}개만)` : ""}`);
console.log(`  서버 ${BASE} · 계정 ${USER} · qa=true(학습·세션 오염 없음)\n`);

const t시작 = Date.now();
const 결과 = [];
const H = { authorization: "", "content-type": "application/json" };
H.authorization = "Bearer " + (await 로그인());

for (let i = 0; i < 대상.length; i++) {
  const q = 대상[i];
  const r = await 물어보기(H, q.q, q.화면);
  const v = 판정(r, q);
  결과.push({ ...q, ...r, ok: v.ok, why: v.why });
  const 표 = v.ok ? "✓" : "✗";
  const 남 = 대상.length - i - 1;
  const 평균 = (Date.now() - t시작) / (i + 1);
  process.stdout.write(
    `${표} [${i + 1}/${대상.length}] ${q.이름} · ${q.종류} (${(r.ms / 1000).toFixed(1)}s${v.ok ? "" : " — " + v.why})` +
    `  남은 예상 ${Math.round((남 * 평균) / 60000)}분\n`
  );
  // 진행 중에도 결과를 남긴다 — 중간에 끊겨도 여기까지가 증거로 남는다.
  if (i % 10 === 0 || i === 대상.length - 1) fs.writeFileSync(path.join(OUT, "chatbot-census.json"), JSON.stringify(결과, null, 1), "utf8");
}

const 실패 = 결과.filter((r) => !r.ok);
const 종류별 = {};
for (const r of 결과) {
  종류별[r.종류] = 종류별[r.종류] || { 전체: 0, 실패: 0 };
  종류별[r.종류].전체++;
  if (!r.ok) 종류별[r.종류].실패++;
}
const 분 = Math.round((Date.now() - t시작) / 60000);

const md = [
  "# 챗봇 전수 점검 — 화면 33개 × 대표 질문 3개",
  "",
  `측정: ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${분}분 소요 · 실 LLM · qa=true`,
  `대상: ${대상.length}문항 (상황점검 1,133개 중 「챗봇 99개」 — 그동안 표본만 봤던 자리)`,
  "",
  `## 결과: ${결과.length - 실패.length}/${결과.length} 통과 (실패 ${실패.length})`,
  "",
  "| 질문 종류 | 전체 | 실패 | 통과율 |",
  "|---|---:|---:|---:|",
  ...Object.entries(종류별).map(([k, v]) => `| ${k} | ${v.전체} | ${v.실패} | ${Math.round(((v.전체 - v.실패) / v.전체) * 100)}% |`),
  "",
  실패.length ? "## 실패 목록 — 담당자가 실제로 마주칠 자리" : "## 실패 없음",
  "",
  ...(실패.length
    ? ["| 화면 | 종류 | 질문 | 왜 실패 | 답(앞부분) |", "|---|---|---|---|---|",
       ...실패.map((r) => `| ${r.이름} | ${r.종류} | ${r.q} | ${r.why} | ${r.out.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 60)} |`)]
    : []),
  "",
  "## 다시 돌리는 법",
  "```bash",
  "QA_USER=claude-deploy QA_PASS=… node tools/chatbot-census.mjs        # 전수(수 시간)",
  "QA_USER=claude-deploy QA_PASS=… node tools/chatbot-census.mjs --limit 20  # 맛보기",
  "```",
  "⚠ 도는 동안 같은 계정으로 앱에 로그인하지 말 것 — 계정당 세션 1개라 서로 끊는다.",
  "",
].join("\n");

fs.writeFileSync(path.join(OUT, "chatbot-census.md"), md, "utf8");
console.log(`\n■ 끝 — ${결과.length - 실패.length}/${결과.length} 통과 · ${분}분`);
console.log(`  보고서 .tmp-reports/chatbot-census.md`);
