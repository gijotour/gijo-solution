#!/usr/bin/env node
// tools/ladder/export-prompt-spec.mjs — 제품이 쓰는 **근거 꼴(프롬프트 규격)을 파일로 못 박는다.**
//
// ■ 왜 만들었나 (2026-09-04 · R3)
//   표본 하네스(ask-samples.mjs)와 빌더는 근거 머리말을 `GET /api/learnloop/raft/prompt`에서 받는다.
//   그런데 **사슬이 도는 곳은 gb10**이다. 거기서 그 창구에 닿으려면
//     ① gb10 자신의 4000(관리자 계정이 win과 다를 수 있다) 이거나
//     ② win 운영 4000(WireGuard 너머 · 계정당 1세션이라 남이 잡고 있으면 막힌다)
//   뿐이라, 「학습과 같은 꼴로 재는가」가 **남의 기계 사정**에 매여 있었다. 규격을 파일로 뽑아
//   저장소에 넣어 두면 하네스는 서버 없이도 학습과 한 글자도 다르지 않은 틀로 잰다.
//
// ■ 이 파일이 낡으면 어떻게 아나 — 세 겹으로 막는다(규격 파일의 유일한 위험이 「낡음」이라서다)
//   ① 짝 시험 raftdataset.test.ts 가 이 파일의 ragHeader를 server/src/engine/llm.ts의
//      RAG_BLOCK_HEADER와 **글자 단위로** 대조한다 — 서버가 바뀌면 그 시험이 빨강이 된다.
//   ② 빌더(build-raft-dataset.mjs --prompt-spec)가 실행 중에 창구 값과 대조한다.
//   ③ 이 파일 자신이 ragHeader ↔ ragBlockSample 앞뒤를 맞춰 본다(규격읽기).
//
// ■ system(팀원 프롬프트)을 왜 파일에 담나 — 담아야 하네스가 서버 없이 돈다.
//   ⚠ 새로 새는 것은 없다: 같은 글이 이미 저장소 두 곳에 있다 —
//     · server/src/engine/llm.ts systemPromptFor("normaltic") (소스 상수)
//     · tools/team-bench/results-ladder/day2/build/longform-vuln-v1.json 121행의 `system` 칸
//   즉 이 파일은 **이미 저장소에 있는 글의 사본**이다. 그래도 사본이므로 ③처럼 스스로를 대조한다.
//
// 사용(win에서 · 관리자 env 필요):
//   GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… node tools/ladder/export-prompt-spec.mjs \
//     [--server http://localhost:4000] [--agent normaltic] [--out tools/team-bench/prompt-spec.json]
//
// 나가는 코드: 0=정상 · 2=쓰는 법 틀림 · 3=env/서버 없음 · 1=규격이 스스로 어긋남
//
// ⚠ **로그인을 밀어내지 않는다.** 계정당 1세션이라 남의 세션이 붙어 있으면 기다린다(밀면 남의 작업이 끊긴다).
// ⚠ 운영 데이터를 **읽기만** 한다 — 쓰는 창구를 부르지 않는다.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 예시블록 } from "../build-raft-dataset.mjs";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 저장소 = path.resolve(여기, "..", "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const sha12 = (s) => crypto.createHash("sha1").update(String(s ?? "")).digest("hex").slice(0, 12);

/**
 * 서버 schema를 **사람이 읽는 한 줄**로. GET /api/health의 schema는 문자열이 아니라
 * `{ count, latest }`(server/src/db.ts schemaVersion)라, 그냥 문자열에 끼우면 `[object Object]`가 찍힌다.
 * ⚠ 실측(2026-09-04): 콘솔에 「서버 schema [object Object]」가 나와, 규격을 뽑은 서버가 어느 판인지
 *   **화면에서는 알 수 없었다**(파일에는 제대로 들어가 있었다 — 표시만 흠이었다).
 * 꼴이 또 바뀌어도 사람이 읽을 것이 남게, 모르는 꼴은 JSON 그대로 보여 준다.
 */
export function 스키마표시(s) {
  if (s == null) return "(모름)";
  if (typeof s !== "object") return String(s);
  if (typeof s.count === "number" || s.latest !== undefined) {
    return `마이그레이션 ${s.count ?? "?"}개 · 최신 ${s.latest ?? "(없음)"}`;
  }
  return JSON.stringify(s);
}

const SERVER = String(opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
const AGENT = String(opt("--agent", "normaltic"));
const OUT = path.resolve(저장소, opt("--out", path.join("tools", "team-bench", "prompt-spec.json")));

const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
// ⚠ 비밀값은 env로만 — 없으면 그 자리에서 죽는다(스크립트에 적어 두면 기록에 찍힌다).
//   ⚠ 그 판정은 **부를 때** 한다(아래 뽑기 첫 줄). 모듈을 읽는 것만으로 process.exit이 돌면,
//     이 파일의 함수 하나를 불러 보려는 시험이 그 자리에서 죽는다(2026-09-04 실측: vitest
//     「process.exit unexpectedly called with 3」으로 파일 전체가 안 돌았다).

// ⚠ 실패할 때 `process.exit()`을 **곧바로 부르지 않는다.** 뜨는 fetch 핸들이 남은 채로 끝내면
//   Windows node가 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`를 토한다 —
//   실측(2026-09-04): 진짜 원인(「이미 로그인 중」)이 그 소음에 묻혀, 이 도구를 처음 만난 사람이
//   무엇을 해야 하는지 못 읽는다. 대신 코드를 정해 던지고, 맨 아래에서 한 번에 끝낸다.
class 나감 extends Error {
  constructor(코드, 말) { super(말); this.코드 = 코드; }
}

async function login() {
  const r = await fetch(SERVER + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }), redirect: "error",
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) {
    throw new 나감(
      3,
      "로그인 실패: " + JSON.stringify(j).slice(0, 200) +
      "\n  (계정당 1세션입니다 — 다른 작업이 같은 계정으로 붙어 있으면 끝날 때까지 기다리세요. 밀어내지 않습니다.)"
    );
  }
  return { auth: { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken }, refreshToken: j.refreshToken };
}

async function 뽑기() {
  if (!user || !password) throw new 나감(3, "GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 가 필요합니다(창구가 관리자 전용입니다)");
  const { auth, refreshToken } = await login();
  try {
    const r = await fetch(SERVER + `/api/learnloop/raft/prompt?agentId=${encodeURIComponent(AGENT)}`, { headers: auth, redirect: "error" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new 나감(3, `raft/prompt ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);

    // ⚠ fail-closed — 창구가 대조용 예시를 안 주면 규격을 **뽑지 않는다.**
    //   대조 못 한 규격을 저장소에 넣으면, 그 뒤로 모두가 그 틀을 믿고 재게 된다.
    for (const 칸 of ["system", "ragHeader", "ragBlockSample"]) {
      if (!String(j?.[칸] ?? "").trim()) throw new 나감(1, `창구가 ${칸}을 안 줍니다 — 규격을 뽑을 수 없습니다`);
    }
    if (예시블록(j.ragHeader) !== j.ragBlockSample) {
      throw new 나감(1, "창구의 ragHeader와 ragBlockSample이 서로 어긋납니다 — 서버(llm.ts ragBlock)를 먼저 보세요");
    }

    // 서버가 자기 커밋을 말해 주지 않는다(GET /api/health는 schema까지만) — 그래서 **거짓말하지 않는다**:
    //   serverCommit은 null로 두고, 대신 「뽑은 기계의 저장소 HEAD」를 그 이름 그대로 적는다.
    //   나중에 health가 커밋을 싣게 되면 그때 이 칸이 채워진다.
    let 서버스키마 = null;
    try {
      const h = await fetch(SERVER + "/api/health", { redirect: "error", signal: AbortSignal.timeout(10_000) });
      서버스키마 = (await h.json().catch(() => ({})))?.schema ?? null;
    } catch { /* 헬스가 없어도 규격은 뽑는다 — 있으면 적을 뿐이다 */ }
    let 뽑은기계커밋 = null;
    try { 뽑은기계커밋 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: 저장소, encoding: "utf8" }).trim(); } catch { /* 저장소가 아니어도 된다 */ }

    const 규격 = {
      "이 파일은": "제품이 쓰는 근거 꼴(프롬프트 규격)의 사본이다. 손으로 고치지 말고 export-prompt-spec.mjs로 다시 뽑을 것.",
      agentId: AGENT,
      server: SERVER,
      system: j.system,
      systemSha12: sha12(j.system),
      systemChars: String(j.system).length,
      ragHeader: j.ragHeader,
      ragBlockSample: j.ragBlockSample,
      fetchedAt: new Date().toISOString(),
      serverCommit: null,
      serverSchema: 서버스키마,
      뽑은기계커밋,
      "serverCommit이 왜 null인가": "서버가 자기 커밋을 알려주는 창구가 없다(GET /api/health는 schema까지). 뽑은기계커밋은 **뽑은 쪽** 저장소의 HEAD이지 돌고 있는 서버의 빌드가 아니다 — 두 값을 섞어 적지 않는다.",
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(규격, null, 2) + "\n", "utf8");
    console.log(
      `규격 저장 ${OUT}\n` +
      `  팀원(${AGENT}) 프롬프트 ${규격.systemChars}자 · 지문 ${규격.systemSha12}\n` +
      `  근거 머리말 ${규격.ragHeader.length}자 · 서버 schema ${스키마표시(서버스키마)} · 뽑은기계 HEAD ${뽑은기계커밋?.slice(0, 8) ?? "(모름)"}`
    );
  } finally {
    // 계정당 1세션 — 내 세션은 내가 닫는다(refreshToken을 함께 보내야 실제로 닫힌다).
    await fetch(SERVER + "/api/auth/logout", {
      method: "POST", headers: auth, redirect: "error", body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
}

// 한 자리에서만 끝낸다 — 뜬 핸들이 정리된 뒤에 코드를 정한다(위 「나감」 주석 참조).
// ⚠ **직접 실행일 때만** 돈다(gates.mjs와 같은 꼴). 이 빗장이 없으면 시험이 스키마표시() 하나를
//   불러 보려고 import하는 순간 이 스크립트가 통째로 돌아 서버에 붙으려 든다(env 없으면 exit 3).
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("ladder/export-prompt-spec.mjs")) {
  try {
    await 뽑기();
  } catch (e) {
    console.error("✗ " + (e?.message ?? String(e)));
    process.exitCode = e instanceof 나감 ? e.코드 : 1;
  }
}
