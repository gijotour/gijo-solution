#!/usr/bin/env node
// tools/slow-report.mjs — 느린 답 원장에서 **반복 등장 질문**을 뽑는다(다음 즉답화 후보).
//
// 왜: 강제 라우팅은 실측된 느린 질문에서 나왔다(30초→0.2초 사례 다수). 원장이 자동으로
// 쌓이니, "어떤 질문이 반복해서 느린가"를 이 한 줄로 물을 수 있어야 다음 후보가 보인다.
// 사용: QA_USER=... QA_PASS=... node tools/slow-report.mjs
//
// ■ 왜 응답 **모양**을 먼저 보나 (2026-09-10 수리)
//   GET /api/slow-answers가 그날 **admin 전용**으로 닫혔다(원장에 남이 친 질문 원문이 실린다).
//   그런데 이 도구는 받은 것을 곧장 `j.groups.length`로 읽어서, 담당자 계정으로 돌리면
//   403 본문 `{error:"관리자만 접근할 수 있습니다"}`에 groups가 없어 **TypeError로 죽었다** —
//   화면에 뜨는 것은 「Cannot read properties of undefined」뿐이고, 진짜 이유(권한)는 한 글자도
//   안 나온다. 이 저장소가 반복해 겪은 「실패의 이유를 조용히 버린다」의 또 한 판이다.
//   ★ 그래서 **읽기 전에 모양을 보고**, 아니면 무엇을 하면 되는지까지 적어 종료코드 2로 나간다.
import path from "path";
import { fileURLToPath } from "url";

const BASE = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const USER = process.env.QA_USER || process.env.GIJO_ADMIN_USER;
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;

/** 로그인 응답 판정 — 토큰이 없으면 그 다음 요청은 전부 401이라 여기서 끊는다. */
export function 로그인판정(상태, 본문) {
  if (상태 === 200 && 본문 && typeof 본문.accessToken === "string" && 본문.accessToken) {
    return { ok: true, 종료: 0, 말: "" };
  }
  const 이유 = (본문 && 본문.error) || `HTTP ${상태}`;
  return {
    ok: false,
    종료: 2,
    말: `✗ 로그인 실패 — ${이유}\n  ▸ QA_USER/QA_PASS(또는 GIJO_ADMIN_USER/GIJO_ADMIN_PASSWORD)를 확인하고, 서버가 ${BASE}에 떠 있는지 본다.`,
  };
}

/** 원장 응답 판정 — **읽기 전에** 모양을 본다. 403은 도구가 아니라 **계정** 문제라고 말한다. */
export function 원장응답판정(상태, 본문) {
  if (상태 === 403) {
    return {
      ok: false,
      종료: 2,
      말: [
        "✗ 느린 답 원장은 **관리자(admin) 계정만** 볼 수 있다 — 지금 계정은 403(권한 없음)을 받았다.",
        "  왜: 이 원장에는 남이 친 질문 원문이 14일치 담겨 있어 2026-09-10에 admin으로 닫았다.",
        "  ▸ 할 일: QA_USER/QA_PASS를 **admin 역할 계정**으로 주고 다시 돌린다(GIJO_ADMIN_USER/GIJO_ADMIN_PASSWORD도 같은 자리).",
        "  ▸ 도구를 고칠 일이 아니다 — 담당자(security_officer) 계정으로는 원래 못 본다.",
      ].join("\n"),
    };
  }
  if (상태 === 401) {
    return { ok: false, 종료: 2, 말: "✗ 인증이 안 됐다(401) — 토큰이 만료됐거나 로그인이 실패했다. 다시 돌려 본다." };
  }
  if (상태 !== 200) {
    const 이유 = (본문 && 본문.error) || "본문 없음";
    return { ok: false, 종료: 2, 말: `✗ 원장을 못 받았다 — HTTP ${상태} · ${String(이유).slice(0, 200)}` };
  }
  if (!본문 || !Array.isArray(본문.groups) || typeof 본문.thresholdMs !== "number") {
    // ⚠ 200인데 모양이 다르면 **창구가 바뀐 것**이다 — 「비어 있음」으로 읽지 않는다.
    return {
      ok: false,
      종료: 2,
      말: `✗ 200을 받았는데 원장 모양이 아니다(groups/thresholdMs가 없다) — 창구 규격이 바뀌었을 수 있다.\n  받은 것: ${JSON.stringify(본문).slice(0, 200)}`,
    };
  }
  return { ok: true, 종료: 0, 말: "" };
}

/** 본문을 JSON으로 읽되, JSON이 아니어도(에러 페이지 등) 죽지 않는다. */
async function 본문읽기(r) {
  const 글 = await r.text();
  try { return JSON.parse(글); } catch { return { error: 글.slice(0, 200) }; }
}

async function main() {
  if (!USER || !PASS) { console.error("QA_USER/QA_PASS 필요 (admin 역할 계정)"); process.exit(2); }

  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS, force: true }),
  });
  const L = await 본문읽기(lr);
  const 로그인 = 로그인판정(lr.status, L);
  if (!로그인.ok) { console.error(로그인.말); process.exit(로그인.종료); }

  const jr = await fetch(`${BASE}/api/slow-answers`, { headers: { Authorization: `Bearer ${L.accessToken}` } });
  const j = await 본문읽기(jr);
  const 판정 = 원장응답판정(jr.status, j);
  if (!판정.ok) { console.error(판정.말); process.exit(판정.종료); }

  console.log(`■ 느린 답 원장 (${j.thresholdMs / 1000}초 초과, 14일 보관) — 총 ${j.total}건, 질문 ${j.groups.length}종`);
  if (!j.groups.length) { console.log("  비어 있음 — 담당자를 기다리게 한 답이 없었습니다."); process.exit(0); }
  console.log("  회수 | 최대 | 마지막     | 질문");
  for (const g of j.groups.slice(0, 15)) {
    const d = new Date(g.lastAt).toISOString().slice(5, 10);
    console.log(`  ${String(g.count).padStart(3)}회 | ${String(Math.round(g.maxMs / 1000)).padStart(3)}초 | ${d} | ${g.question.slice(0, 60)}`);
  }
  console.log("\n▸ 2회 이상 반복이면 즉답화(강제 라우팅) 후보 — 원인 추적은 route-explain으로.");
}

// ⚠ 진입점 관문 — import(시험)로 들어오면 아무것도 돌지 않는다. 없으면 시험이 운영 4000에
//   로그인을 시도하게 되고, 그 순간 시험이 「서버가 떠 있는가」를 재는 물건으로 바뀐다.
const 이파일 = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(이파일)) {
  main().catch((e) => { console.error("✗ " + (e?.message ?? e)); process.exit(1); });
}
