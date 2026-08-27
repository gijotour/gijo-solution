// tools/local-digest.mjs — gb10 로컬 LLM(Qwen3-Coder-30B-A3B)으로 **Claude 입력을 줄이는** 창구.
// (하이브리드 설계서 §6-⑴ · 1주차 게이트 통과 실측: 발췌 20/20 · 생성 69.8 tok/s · 압축 ~45×)
//
// ■ 무엇을 아끼나 (2026-08-27 사장님 「gb10으로 토큰 줄일 수 있는 거 있으면 해줘 — 검토관·소스관리·검사 등」)
//   이 저장소에서 Claude 토큰을 먹는 두 자리:
//   ① 큰 파일 통째 읽기(2,000줄급) → `file` 모드가 관련 줄만 원문으로 돌려준다
//   ② 검토관이 diff·파일을 전부 읽는 것 → `review` 모드가 의심 지점을 1차 선별한다
//
// ■ 지키는 선 (설계서 §3·§4 — 어기면 아낀 것보다 재작업이 비싸진다)
//   · 로컬 모델은 **어느 줄을 볼지 고르기만** 한다. 본문은 기계가 원문을 자른다(재서술 금지 —
//     실사고 주석 1,711건이 요약에 뭉개지면 함정을 두 번 밟는다).
//   · `review`는 **1차 선별이지 판정이 아니다.** 출력마다 「후보」라 박는다. 확정은 Claude/사람이
//     그 지점을 직접 열어 한다 — CLAUDE.md 「검토관 모델을 내리면 그럴듯한데 틀린 지적이 는다」는
//     그대로 유효하고, 이 도구는 검토관을 **대체하지 않고 읽을 양을 줄인다.**
//   · gb10이 죽어 있으면 **크고 시끄럽게** 실패한다(조용한 폴백 금지) — 그때는 그냥 원문을 읽는다.
//
// ■ 전송: win → ssh gb10 → localhost:8082 (llama-server는 루프백만 열려 있다 — WireGuard에
//   포트를 더 열지 않는다). 요청 JSON은 stdin 파이프라 한글·따옴표 안전.
//   ⚠ 서버는 --parallel 1로 떠 있어야 한다(2가 되면 ctx 반토막 — hybrid-probe.mjs 머리주석 실사고).
//
// 사용:
//   node tools/local-digest.mjs file <경로> "<질문>"     ← 관련 줄만 원문 발췌
//   node tools/local-digest.mjs review [커밋]            ← diff 의심 지점 1차 선별(기본 HEAD)
//   node tools/local-digest.mjs log <경로> "<질문>"      ← 긴 로그에서 관련 줄 발췌
//   node tools/local-digest.mjs up                       ← gb10 서버 상태/기동
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [mode, 대상, 질문] = process.argv.slice(2);

// ── gb10 창구 ────────────────────────────────────────────────────────────────
function gb10Chat(prompt, schema, nPredict) {
  const body = {
    model: "local",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: nPredict ?? 512,
  };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "out", strict: true, schema } };
  const r = spawnSync("ssh", ["gb10", "curl -s --max-time 300 -X POST http://localhost:8082/v1/chat/completions -H 'content-type: application/json' --data-binary @-"],
    { input: JSON.stringify(body), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("ssh 실패: " + (r.stderr || "").slice(0, 200));
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error("gb10 응답이 JSON이 아님(서버 죽음?): " + r.stdout.slice(0, 200)); }
  if (j.error) throw new Error("llama-server 오류: " + JSON.stringify(j.error).slice(0, 300));
  return j.choices?.[0]?.message?.content ?? "";
}

function 서버확인() {
  const r = spawnSync("ssh", ["gb10", "curl -s --max-time 5 http://localhost:8082/health"], { encoding: "utf8" });
  return /ok/.test(r.stdout || "");
}

// ── 공통: 줄범위 발췌 (hybrid-probe 검증 패턴 — 20/20) ──────────────────────────
const RANGE_SCHEMA = {
  type: "object",
  properties: {
    ranges: { type: "array", items: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 }, minItems: 0, maxItems: 12 },
  },
  required: ["ranges"],
};

// 큰 파일은 겹침 분할(프로브 실사고: 2,000줄급이 슬롯 ctx를 넘으면 400) — 조각마다 묻고 범위 병합.
const 조각줄수 = 1500, 겹침 = 150;

function 발췌(경로, 물음) {
  const abs = path.isAbsolute(경로) ? 경로 : path.join(ROOT, 경로);
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  const 전체범위 = [];
  for (let s = 0; s < lines.length; s += 조각줄수 - 겹침) {
    const e = Math.min(lines.length, s + 조각줄수);
    const 번호원문 = lines.slice(s, e).map((l, i) => `${s + i + 1}\t${l}`).join("\n");
    const prompt =
      `아래는 줄번호가 붙은 파일 일부다(${s + 1}~${e}줄/총 ${lines.length}줄). 질문에 답하는 데 필요한 부분의 **줄 범위**만 골라라.\n` +
      `내용을 요약하거나 다시 쓰지 마라 — 줄 범위 선택만. 관련이 없으면 빈 배열.\n\n질문: ${물음}\n\n파일 ${경로}:\n${번호원문}`;
    try {
      const out = JSON.parse(gb10Chat(prompt, RANGE_SCHEMA, 256));
      for (const [a, b] of out.ranges || []) if (a >= s + 1 && b <= e) 전체범위.push([a, b]);
    } catch (e2) { console.error(`⚠ 조각 ${s + 1}~${e} 실패: ${e2.message}`); }
    if (e >= lines.length) break;
  }
  // 병합·출력 — 본문은 **기계가 원문을 자른다**
  전체범위.sort((x, y) => x[0] - y[0]);
  const 병합 = [];
  for (const r of 전체범위) {
    const last = 병합[병합.length - 1];
    if (last && r[0] <= last[1] + 3) last[1] = Math.max(last[1], r[1]);
    else 병합.push([...r]);
  }
  const 총 = 병합.reduce((a, [x, y]) => a + (y - x + 1), 0);
  console.log(`# ${경로} — ${lines.length}줄 중 ${총}줄 발췌 (${병합.length}구간 · gb10 30B-A3B · 원문 그대로)`);
  for (const [a, b] of 병합) {
    console.log(`\n── ${a}~${b}줄 ──`);
    console.log(lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l}`).join("\n"));
  }
  if (!병합.length) console.log("(관련 구간 없음 — 질문을 좁히거나 원문을 직접 읽어라)");
}

// ── review: diff 1차 선별 ────────────────────────────────────────────────────
const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array", maxItems: 15,
      items: {
        type: "object",
        required: ["file", "quote", "why"],
        properties: {
          file: { type: "string" },
          quote: { type: "string", description: "diff에서 그대로 복사한 한 줄(재서술 금지)" },
          why: { type: "string", description: "왜 의심되나 한 문장(한국어)" },
          kind: { type: "string", enum: ["logic", "leftover", "mismatch", "contract", "type", "other"] },
        },
      },
    },
  },
  required: ["findings"],
};

function 리뷰(커밋) {
  const ref = 커밋 || "HEAD";
  const diff = execFileSync("git", ["show", "--no-color", ref], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const 조각크기 = 60000; // 문자 기준 — ctx 여유
  const all = [];
  for (let i = 0; i < diff.length; i += 조각크기) {
    const 부분 = diff.slice(i, i + 조각크기);
    const prompt =
      `아래는 git 커밋 diff의 일부다. **결함 후보**를 골라라 — 로직 오류, 옮기다 남긴 것(leftover), ` +
      `약속(주석·메시지)과 코드의 불일치, 반쪽 수리. 스타일 지적 금지. 확실하지 않으면 빼라(적은 게 낫다).\n` +
      `quote는 diff에서 **그대로 복사**한 줄이어야 한다.\n\n${부분}`;
    try {
      const out = JSON.parse(gb10Chat(prompt, REVIEW_SCHEMA, 1024));
      all.push(...(out.findings || []));
    } catch (e2) { console.error(`⚠ diff 조각 ${i} 실패: ${e2.message}`); }
  }
  console.log(`# ${ref} 1차 선별 — 후보 ${all.length}건 (gb10 30B-A3B)`);
  console.log(`# ⚠ **후보이지 판정이 아니다.** 각 지점은 Claude/사람이 직접 열어 확정할 것 —`);
  console.log(`#    이 선별은 검토관을 대체하지 않고 읽을 양을 줄인다(CLAUDE.md 검토관 원칙 유효).`);
  for (const f of all) console.log(`\n[후보·${f.kind || "other"}] ${f.file}\n  인용: ${f.quote}\n  왜: ${f.why}`);
  if (!all.length) console.log("(후보 없음 — 로컬 선별이 못 보는 부류일 수 있다. 게시 전엔 정식 검토관을 태울 것)");
}

// ── 실행 ────────────────────────────────────────────────────────────────────
if (!서버확인() && mode !== "up") {
  console.error("✗ gb10:8082가 응답하지 않는다 — 조용한 폴백은 하지 않는다.");
  console.error("  기동:  node tools/local-digest.mjs up");
  process.exit(2);
}
if (mode === "file" || mode === "log") 발췌(대상, 질문 || "핵심 내용");
else if (mode === "review") 리뷰(대상);
else if (mode === "up") {
  if (서버확인()) { console.log("이미 떠 있음 ✅"); process.exit(0); }
  spawnSync("ssh", ["gb10", "cd ~/gijo-as/server && nohup llama.cpp/build/bin/llama-server -m models/qwen3-coder-30b-a3b/qwen3-coder-30b-a3b.gguf -ngl -1 --ctx-size 65536 --parallel 1 --port 8082 --jinja > /tmp/qwen3coder.log 2>&1 & sleep 1"], { encoding: "utf8", timeout: 20000 });
  console.log("기동 명령 보냄 — 로드 30~60초 뒤 다시 확인");
} else {
  console.log("사용: node tools/local-digest.mjs file <경로> \"<질문>\" | review [커밋] | log <경로> \"<질문>\" | up");
}
