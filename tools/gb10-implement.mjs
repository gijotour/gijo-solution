// tools/gb10-implement.mjs — gb10 교사(내부 LLM)에게 **정형 구현·작성 작업**을 시킨다(2026-09-15 사장님 「내부 LLM으로 할 수 있는 건 다 해줘」).
//
// ■ 무엇을 하나
//   지시서(--spec 파일)와 대상 파일들(--files a,b)을 교사에게 주고,
//     · --mode diff   : 「대상 파일만 고치는 unified diff」를 받아 .tmp-reports/gb10-impl/<이름>.diff 에 저장(git apply --check 통과해야 저장)
//     · --mode append : 큰 파일(용어사전·계획서처럼 120KB 넘는 것)에 **맨 끝에 덧붙일 새 글**만 받는다 — 꼬리 --tail 줄만 어투 참고로 보낸다.
//   적용·시험·검토는 **메인(사람/Claude)** 이 한다 — 교사는 도구를 못 돌리므로(시험 실행·grep 불가) 판단이 필요한 작업은 맡기지 않는다.
//   정형 작업(문서 항목·시험 문장 추가·문구 통일·표 갱신)만.
// ■ 전송: win → ssh gb10 → localhost:8080(교사, 루프백만 열림 · `--reasoning off`로 떠 있어 생각 없이 답한다). tools/local-digest.mjs와 같은 길.
// ■ 판정: diff가 대상 파일 밖을 건드리면 버린다(파일 경계) · `git apply --check`가 통과해야 저장한다(--no-check로 끌 수 있다).
//
// 사용:
//   node tools/gb10-implement.mjs --name n --spec spec.md --files a,b [--mode diff|append] [--tail 120] [--max-tokens 4000] [--no-check]
//   → .tmp-reports/gb10-impl/<name>.diff | <name>.append.md · <name>.raw.txt(교사 원문) · 종료코드 0=저장, 2=diff 없음/적용 불가
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const NAME = opt("--name", "impl");
const SPEC = opt("--spec", "");
const FILES = (opt("--files", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX = Number(opt("--max-tokens", 4000));
const MODE = opt("--mode", "diff"); // diff | append
const TAIL = Number(opt("--tail", 120));
const 뿌리 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!SPEC || !FILES.length) { console.error("사용: --spec <지시서> --files <a,b> [--name n] [--mode diff|append]"); process.exit(1); }

const 지시 = fs.readFileSync(path.resolve(뿌리, SPEC), "utf8");
const 파일들 = FILES.map((f) => ({ f, 글: fs.readFileSync(path.resolve(뿌리, f), "utf8") }));
const 큰파일 = MODE === "append" ? [] : 파일들.filter((x) => x.글.length > 120000);
if (큰파일.length) { console.error("⚠ 120KB 넘는 파일은 통째로 못 보낸다 — --mode append 나 발췌가 필요: " + 큰파일.map((x) => x.f).join(", ")); process.exit(1); }

const 줄들 = (글) => 글.split(/\r?\n/);
const prompt = MODE === "append"
  ? [
    "너는 GIJO AS 저장소의 작성자다. 아래 지시서대로 대상 파일 **맨 끝에 덧붙일 새 글만** 쓴다(기존 글 수정 금지). 아래에 파일의 꼬리 " + TAIL + "줄을 어투·형식 참고용으로 준다.",
    "규칙: 지시서 밖 내용 금지 · 설명·머리말 금지(덧붙일 본문만) · 경어체·「」·**강조** 등 어투는 꼬리와 같게 · 마크다운 그대로.",
    "", "[지시서]", 지시, "",
    ...파일들.flatMap((x) => ["[대상 파일 꼬리: " + x.f + " (총 " + 줄들(x.글).length + "줄)]", 줄들(x.글).slice(-TAIL).join("\n"), ""]),
    "이제 덧붙일 본문만 출력하라(코드 울타리 없이).",
  ].join("\n")
  : [
    "너는 GIJO AS 저장소의 구현자다. 아래 지시서대로 **대상 파일만** 고치고, 결과를 `git apply`가 그대로 먹는 unified diff(--- a/경로 / +++ b/경로, @@ 헝크 줄 번호 정확히)로만 답하라.",
    "규칙: 지시서 밖의 변경 금지 · 대상 파일 밖 변경 금지 · 설명 문장 금지(diff만) · 한글 문장은 지시서의 어투(경어체·「」)를 따른다 · 줄 끝(CRLF/LF)은 원문 그대로.",
    "", "[지시서]", 지시, "",
    ...파일들.flatMap((x) => ["[대상 파일: " + x.f + "] (줄 번호는 1부터, 아래는 원문 그대로)", 줄들(x.글).map((l, i) => String(i + 1).padStart(5) + "  " + l).join("\n"), ""]),
    "이제 diff만 출력하라. ```diff 로 감싸도 된다.",
  ].join("\n");

const body = JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: MAX });
const 시작 = Date.now();
const 원문 = await new Promise((resolve) => {
  const p = spawn("ssh", ["-o", "ConnectTimeout=10", "gb10", "curl -sS --max-time 900 -X POST http://localhost:8080/v1/chat/completions -H 'content-type: application/json' --data-binary @-"]);
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", () => { try { const j = JSON.parse(out); resolve({ 글: j.choices?.[0]?.message?.content || "", model: j.model, usage: j.usage }); } catch { resolve({ 글: "", 오류: (err || out).slice(0, 300) }); } });
  p.stdin.end(body);
});
const outDir = path.join(뿌리, ".tmp-reports", "gb10-impl");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, NAME + ".raw.txt"), 원문.글 || ("(오류) " + (원문.오류 || "")));
console.log("교사 " + (원문.model || "?") + " · " + Math.round((Date.now() - 시작) / 1000) + "초 · 토큰 " + (원문.usage ? 원문.usage.prompt_tokens + "→" + 원문.usage.completion_tokens : "?"));
if (!원문.글) { console.error("답 없음: " + (원문.오류 || "")); process.exit(2); }

if (MODE === "append") {
  let 본문 = 원문.글.replace(/\r\n/g, "\n").trim();
  const m = 본문.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (m) 본문 = m[1];
  본문 = 본문.trim() + "\n";
  const p = path.join(outDir, NAME + ".append.md");
  fs.writeFileSync(p, 본문);
  console.log("덧붙일 글 " + 본문.length + "자 저장: " + path.relative(뿌리, p) + " — 사람이 읽고 붙인다(자동 적용 안 함)");
  process.exit(0);
}

// diff 추출 — ```diff 울타리 안이거나, 첫 "--- " 부터 끝까지.
let diff = 원문.글;
const fence = diff.match(/```(?:diff)?\s*\n([\s\S]*?)```/);
if (fence) diff = fence[1];
const start = diff.indexOf("--- ");
if (start < 0) { console.error("diff 머리(--- a/…)가 없다 — 원문은 .raw.txt"); process.exit(2); }
diff = diff.slice(start).replace(/\r\n/g, "\n");
if (!diff.endsWith("\n")) diff += "\n";
// 파일 경계 — 대상 밖 파일을 건드리면 버린다.
const 건드린 = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1].trim());
const 밖 = 건드린.filter((f) => !FILES.includes(f));
if (밖.length) { console.error("대상 밖 파일을 건드렸다 — 버림: " + 밖.join(", ")); fs.writeFileSync(path.join(outDir, NAME + ".rejected.diff"), diff); process.exit(2); }
const diffPath = path.join(outDir, NAME + ".diff");
fs.writeFileSync(diffPath, diff);
if (!has("--no-check")) {
  try { execFileSync("git", ["apply", "--check", "--recount", diffPath], { cwd: 뿌리, stdio: "pipe" }); console.log("git apply --check 통과 · 저장: " + path.relative(뿌리, diffPath)); }
  catch (e) { console.error("git apply --check 실패: " + String(e.stderr || e.message).slice(0, 400)); console.error("diff는 저장돼 있다(사람이 손볼 수 있다): " + path.relative(뿌리, diffPath)); process.exit(2); }
} else console.log("저장(검사 생략): " + path.relative(뿌리, diffPath));
console.log("건드린 파일: " + 건드린.join(", "));
