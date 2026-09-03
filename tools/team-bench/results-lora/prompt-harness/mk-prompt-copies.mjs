// 사본 생성기(2026-09-03 프롬프트 실험) — 원본은 읽기만 한다. 패턴이 없거나 둘 이상이면 죽는다(조용히 넘기지 않음).
import fs from "node:fs";
const SYS = "당신은 GIJO AS의 보안 전문가입니다. 답은 간결하게 — 핵심만 3~6문장, 목록은 필요할 때만. 사실은 아는 것만 말하고 모르면 모른다고 합니다. 근거 문서가 주어지면 **그 원문을 그대로 옮겨 적어** 인용하고, 지어내지 않습니다. 한국어로 답합니다.";
function patch(src, dst) {
  let s = fs.readFileSync(src, "utf8");
  const rep = (from, to) => { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`패턴 ${n}개 in ${src}: ${from.slice(0, 60)}`); s = s.replace(from, to); };
  rep(`// tools/team-bench/run.mjs — `, `// ★ 사본(2026-09-03 프롬프트 실험) — 원본 ${src}은 손대지 않았다. 바뀐 곳: --models 옵션 · withSystem(모델 항목 system을 과제 system 앞에 합침) · m.warmup이면 워밍업 1회 버림.\n// tools/team-bench/run.mjs — `);
  rep(`const manifest = JSON.parse(fs.readFileSync(path.join(here, "models.json"), "utf8"));`, `const manifest = JSON.parse(fs.readFileSync(path.join(here, opt("--models", "models.json")), "utf8"));`);
  rep(`async function ask(task, m) {`, `// ★ 모델 항목의 system을 messages 맨 앞에 넣는다. 과제에 이미 system이 있으면(13과제 전부) 그 앞에 합쳐 **하나의 system**으로 — 둘을 두면 템플릿에 따라 둘째가 버려질 수 있다.\nfunction withSystem(messages, m) {\n  if (!m.system) return messages;\n  const [first, ...rest] = messages;\n  if (first?.role === "system") return [{ role: "system", content: [m.system, first.content].join(String.fromCharCode(10, 10)) }, ...rest];\n  return [{ role: "system", content: m.system }, ...messages];\n}\n\nasync function ask(task, m) {`);
  rep(`const body = { model: "local", messages: task.messages, temperature: 0,`, `const body = { model: "local", messages: withSystem(task.messages, m), temperature: 0,`);
  rep("  log(`  적재 ${(s.loadMs / 1000).toFixed(0)}s`);\n", "  log(`  적재 ${(s.loadMs / 1000).toFixed(0)}s`);\n  if (m.warmup) { try { await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: \"POST\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ model: \"local\", messages: [{ role: \"user\", content: \"안녕하세요\" }], max_tokens: 32, cache_prompt: false }), signal: AbortSignal.timeout(120000) }); log(\"  워밍업 1회 버림\"); } catch (e) { log(\"  워밍업 실패(무시): \" + e.message); } }\n");
  fs.writeFileSync(dst, s);
  console.log("wrote", dst);
}
patch("run.mjs", "run-prompt.mjs");
patch("run-r2.mjs", "run-r2-prompt.mjs");
fs.writeFileSync("models-prompt.json", JSON.stringify([{ id: "qwen3-14b+prompt", path: "~/gijo-as/server/models/qwen3-14b/qwen3-14b.gguf", license: "Apache-2.0", thinking: true, note: "무어댑터 베이스 + 시스템 프롬프트(간결·원문 인용) — LoRA v3 대조용(2026-09-03)", warmup: true, system: SYS }], null, 1));
console.log("wrote models-prompt.json");
let a = fs.readFileSync("lora-vuln/ask12.mjs", "utf8");
const from = `messages: [{ role: "user", content: q }]`;
if (a.split(from).length !== 2) throw new Error("ask12 패턴");
a = a.replace(from, `messages: [{ role: "system", content: SYS }, { role: "user", content: q }]`);
a = a.replace(`// 표본 12개를 8093 서버에 던져 답을 저장한다.`, `// ★ 사본(프롬프트 실험) — 원본 ask12.mjs는 그대로. 다른 점: system 프롬프트를 맨 앞에 넣는다.\nconst SYS = ${JSON.stringify(SYS)};\n// 표본 12개를 8093 서버에 던져 답을 저장한다.`);
fs.writeFileSync("lora-vuln/ask12-prompt.mjs", a);
console.log("wrote lora-vuln/ask12-prompt.mjs");
