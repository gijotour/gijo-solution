// tools/ingest-sim.mjs — 챗봇으로 파일을 넣고, 넣은 것을 실제로 써먹는가
//
// 사용자 지시(2026-08-01): "실제 챗봇에서 파일도 넣고" 테스트하라.
//
// ★ 여기서 재는 것은 "업로드가 200을 돌려주나"가 아니다. 그건 쉽다.
//   재는 것은 **넣은 문서의 내용으로 답이 달라지는가** — 즉 정말 학습(인입)됐는가다.
//   그래서 넣기 전에 같은 질문을 먼저 던져 놓고(대조군), 넣은 뒤 다시 던져 비교한다.
//   이 대조가 없으면 "올라갔습니다"만 보고 됐다고 착각한다(이 저장소의 반복 사고).
//
// 정리까지 한다 — 시험이 만든 문서를 남기면 다음 사람이 실데이터로 착각한다.
//
// 사용: QA_USER=claude-deploy QA_PASS=… SAMPLES=<폴더> node tools/ingest-sim.mjs
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const USER = process.env.QA_USER || "claude-deploy";
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
const SAMPLES = process.env.SAMPLES;
const 정리 = !process.argv.includes("--keep");

// 넣을 문서와, 그 문서에만 있는 사실을 묻는 질문(카나리 질문).
// 질문은 **문서를 안 읽으면 못 맞히는 것**으로 고른다 — 일반 상식이면 대조가 안 된다.
const 시험 = [
  {
    파일: "샘플_방화벽_월간점검보고서_2026-07.md",
    // ⚠ 카나리는 **그 문서에만 있는 값**이라야 한다. 첫 시험에서 "미사용"을 단서로 썼다가
    //   넣기 전 답의 "미사용 룰 검색" 문구에 걸려 "이미 답함(대조 불가)"이 됐다.
    질문: "FW-01 방화벽 점검에서 미사용 룰이 정확히 몇 개 나왔어? 숫자만 알려줘",
    단서: ["37"],
  },
  {
    파일: "샘플_보안운영_인수인계_메모.md",
    질문: "우리 회사 방화벽 유지보수 업체 이름과 계약 만료가 언제야?",
    단서: ["넷가드", "2027-03"],
  },
];

async function 로그인() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS, force: true }),
  });
  const j = await r.json();
  const t = j.accessToken || j.token;
  if (!t) throw new Error("로그인 실패");
  return t;
}

async function 물어보기(H, text) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/dispatch", {
    method: "POST", headers: H, body: JSON.stringify({ text, qa: true }),
  });
  const j = await r.json();
  return { out: String(j.output ?? ""), ms: Date.now() - t0, sources: j.sources };
}

const H = { authorization: "Bearer " + (await 로그인()), "content-type": "application/json" };
if (!SAMPLES) { console.error("SAMPLES 환경변수에 샘플 폴더 경로를 주세요"); process.exit(2); }

console.log("■ 챗봇 파일 인입 — 넣은 내용으로 답이 달라지는가\n");
const 결과 = [];

for (const t of 시험) {
  const p = path.join(SAMPLES, t.파일);
  if (!fs.existsSync(p)) { console.log("✗ 파일 없음:", p); continue; }
  console.log("◆ " + t.파일);

  // ① 넣기 전 — 대조군. 여기서 이미 맞히면 이 시험은 아무것도 증명하지 못한다.
  const 전 = await 물어보기(H, t.질문);
  const 전맞 = t.단서.some((c) => 전.out.includes(c));
  console.log("  ① 넣기 전 물어보기 →", 전맞 ? "⚠ 이미 답함(대조 불가)" : "모름(정상)");
  console.log("     " + 전.out.replace(/\n/g, " ").slice(0, 100));

  // ② 넣기 — 대화창 ＋ 가 쓰는 것과 같은 경로(/api/memory/ingest-file)
  const b64 = fs.readFileSync(p).toString("base64");
  const t0 = Date.now();
  const up = await fetch(BASE + "/api/memory/ingest-file", {
    method: "POST", headers: H, body: JSON.stringify({ filename: t.파일, content: b64 }),
  });
  const upj = await up.json().catch(() => ({}));
  const 걸린 = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("  ② 넣기 →", up.status, "(" + 걸린 + "s)", JSON.stringify(upj).slice(0, 120));
  if (!up.ok) { 결과.push({ ...t, 판정: "인입 실패", 상세: JSON.stringify(upj).slice(0, 150) }); continue; }

  // ③ 넣은 뒤 — 이제 답할 수 있어야 한다
  await new Promise((r) => setTimeout(r, 2000)); // 색인 반영 여유
  const 후 = await 물어보기(H, t.질문);
  const 후맞 = t.단서.some((c) => 후.out.includes(c));
  console.log("  ③ 넣은 뒤 물어보기 →", 후맞 ? "✅ 답함" : "❌ 못 답함");
  console.log("     " + 후.out.replace(/\n/g, " ").slice(0, 140));
  console.log("     근거:", (후.sources || []).join(", ") || "(없음)");
  const 판정 = 전맞 ? "대조 불가(넣기 전에도 답함)" : 후맞 ? "통과" : "실패 — 넣었는데 못 씀";
  console.log("  판정:", 판정, "\n");
  결과.push({ ...t, 판정, 전: 전.out.slice(0, 200), 후: 후.out.slice(0, 200), 인입초: 걸린 });
}

// ④ 정리 — 시험 흔적을 남기지 않는다
if (정리) {
  for (const t of 시험) {
    const r = await fetch(BASE + "/api/memory/document/delete", {
      method: "POST", headers: H, body: JSON.stringify({ documentId: t.파일, deleteSource: true }),
    }).catch(() => null);
    console.log("정리:", t.파일, r ? r.status : "실패");
  }
  const docs = await (await fetch(BASE + "/api/memory/documents", { headers: H })).json();
  const 남음 = (Array.isArray(docs) ? docs : docs.documents || []).filter((d) => /^샘플_/.test(d.documentId));
  console.log("샘플 문서 남은 것:", 남음.length ? 남음.map((d) => d.documentId).join(", ") : "없음 ✅");
}

const 통과 = 결과.filter((r) => r.판정 === "통과").length;
console.log(`\n■ ${통과}/${결과.length} 통과`);
fs.writeFileSync(path.join(process.cwd(), ".tmp-reports", "ingest-sim.json"), JSON.stringify(결과, null, 1), "utf8");
