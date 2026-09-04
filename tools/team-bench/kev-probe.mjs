#!/usr/bin/env node
// tools/team-bench/kev-probe.mjs — 「KEV 목록은 누가 발표하나」 3문항을 두 조건으로 던진다.
//
// ■ 왜 저장소로 옮겼나 (2026-09-04)
//   원본은 gb10 홈(`~/bench/ladder/kev3.mjs`)에만 있었다 — 게이트 관문 ①이 읽는 파일을 만드는 자가
//   저장소 밖이면, 그 기계가 사라질 때 판정 근거를 다시 만들 길이 없다. 문항·조건은 **한 글자도 안 바꿨다**
//   (temperature 0 · max_tokens 900 · cache_prompt false · 워밍업 1회 버림).
//
// ■ 두 라벨
//   · prompt   = 시스템 프롬프트 있음(제품이 쓰는 조건) → 관문이 세는 쪽
//   · noprompt = 대조군(맨 질문). gates.mjs 기본값이 이 라벨을 뺀다.
//
// ■ 시스템 프롬프트는 **받아 온다** — 결과 파일에는 지문만 적는다
//   원본은 gb10의 `~/bench/models-prompt.json`(그 기계에만 있는 파일)을 읽었다. 그러면 「어느 프롬프트로
//   쟀는지」가 결과에 안 남고, 기계를 바꾸면 조건이 조용히 달라진다. 여기서는 제품 창구
//   (GET /api/learnloop/raft/prompt)의 팀원 프롬프트를 쓰고 `promptSha12`만 결과에 적는다
//   (원문은 관리자 전용 값이라 저장소로 안 내보낸다).
//   ⚠ `--system-file <경로>`를 주면 그 파일의 [0].system을 쓴다 — 옛 회차(models-prompt.json)와
//     맞춰 재야 할 때만 쓰고, 그때도 지문이 달라지므로 표에서 바로 드러난다.
//
// 사용:
//   PORT=8093 node tools/team-bench/kev-probe.mjs <출력파일> [--server URL] [--agent normaltic] [--system-file 경로]
//   나가는 코드: 0=정상 · 2=쓰는 법 틀림 · 3=env/서버 없음

import fs from "node:fs";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

export const sha12 = (s) => crypto.createHash("sha1").update(String(s ?? "")).digest("hex").slice(0, 12);

/**
 * KEV 3문항 — **여기가 문항의 단일 출처다.** 왜 3인가: gates.mjs의 KEV_최소문항 = 3
 * (두 문항이면 우연히 맞을 여지가 크다). 문구를 바꾸면 지난 회차와 못 견주므로 바꾸지 않는다.
 */
export const KEV_문항 = [
  "KEV 목록은 누가 발표해?",
  "보안에서 말하는 KEV가 뭐야? 누가 발표하는 거야?",
  "우리 취약점 목록에 KEV 표시가 붙어 있던데, KEV 카탈로그를 발표하는 기관이 어디야?",
];

async function login(base, user, password) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }), redirect: "error",
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error("로그인 실패: " + JSON.stringify(j).slice(0, 200) + "\n(계정당 1세션이다 — 밀어내지 않는다.)");
  // ⚠ refreshToken이 있어야 끝날 때 세션을 **실제로** 닫는다(/api/auth/logout은 body의 그 값으로만 지운다).
  return { auth: { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken }, refreshToken: j.refreshToken };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("team-bench/kev-probe.mjs")) {
  const OUT = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))) ?? "";
  if (!OUT) { console.error("쓰는 법: node tools/team-bench/kev-probe.mjs <출력파일> [--server URL] [--agent id] [--system-file 경로]"); process.exit(2); }
  const PORT = Number(process.env.PORT || opt("--port", 8093));
  const SERVER = String(opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
  const AGENT = String(opt("--agent", "normaltic"));
  const SYSFILE = opt("--system-file", "");
  const REQ_MS = Number(process.env.REQ_MS || 600_000);

  let SYS = "", 출처 = "", auth = null, refreshToken = null;
  if (SYSFILE) {
    SYS = JSON.parse(fs.readFileSync(SYSFILE, "utf8"))[0].system;
    출처 = `system-file:${SYSFILE}`;
  } else {
    const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
    if (!user || !password) { console.error("✗ GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 가 필요하다(팀원 프롬프트를 서버에서 받아 온다)"); process.exit(3); }
    ({ auth, refreshToken } = await login(SERVER, user, password));
    const r = await fetch(SERVER + `/api/learnloop/raft/prompt?agentId=${encodeURIComponent(AGENT)}`, { headers: auth, redirect: "error" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      await fetch(SERVER + "/api/auth/logout", { method: "POST", headers: auth, redirect: "error", body: JSON.stringify({ refreshToken }) }).catch(() => {});
      console.error(`✗ raft/prompt ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      process.exit(3);
    }
    SYS = j.system;
    출처 = `raft/prompt:${AGENT}`;
  }
  const 지문 = sha12(SYS);

  async function ask(messages) {
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "local", messages, temperature: 0, max_tokens: 900, cache_prompt: false }),
      signal: AbortSignal.timeout(REQ_MS),
    });
    const j = await r.json();
    const c = j.choices?.[0];
    return { text: c?.message?.content ?? "", ms: Date.now() - t0, finish: c?.finish_reason };
  }

  const 실행인자 = process.argv.slice(1).join(" ");
  const out = [];
  // ⚠ try/finally — 중간에 죽어도 **세션은 닫는다**(계정당 1세션이라 남으면 다음 사람을 막는다).
  try {
    // ★ 워밍업 1회를 버린다 — 기동 직후 첫 요청이 반복 루프로 깨진 적이 있다(ask-samples.mjs와 같은 이유).
    await ask([{ role: "user", content: "안녕하세요" }]);
    for (const q of KEV_문항) {
      out.push({ label: "prompt", q, promptSha12: 지문, systemChars: SYS.length, systemSource: 출처, argv: 실행인자, ...(await ask([{ role: "system", content: SYS }, { role: "user", content: q }])) });
      out.push({ label: "noprompt", q, promptSha12: "", systemChars: 0, systemSource: "(없음)", argv: 실행인자, ...(await ask([{ role: "user", content: q }])) });
    }
  } finally {
    // 계정당 1세션 — 내 세션은 내가 닫는다(refreshToken을 함께 보내야 실제로 닫힌다).
    if (auth) await fetch(SERVER + "/api/auth/logout", { method: "POST", headers: auth, redirect: "error", body: JSON.stringify({ refreshToken }) }).catch(() => {});
  }

  // 판정은 gates.mjs가 한다(URL을 지운 본문에서 CISA를 찾는 그 자). 여기서는 눈으로 볼 한 줄만 찍는다.
  const 본문CISA = (t) => /CISA|Cybersecurity and Infrastructure Security Agency|사이버\s*보안\s*(및\s*)?(인프라|기반시설)\s*보안\s*(국|청)/i.test(String(t).replace(/https?:[^\s)]+/g, ""));
  for (const o of out) {
    console.log(`[${o.label}] ${o.q} → 본문CISA ${본문CISA(o.text) ? "O" : "X"} · URL ${/cisa\.gov/i.test(o.text) ? "O" : "X"} · ${o.text.length}자 · ${(o.ms / 1000).toFixed(1)}s · ${o.finish}`);
    console.log("   " + o.text.split("\n").join(" ").slice(0, 300));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`저장 ${OUT} — 프롬프트 지문 ${지문}(${출처})`);
}
