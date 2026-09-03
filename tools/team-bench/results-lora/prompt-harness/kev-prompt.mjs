// KEV 발표 주체 대조(2026-09-03 프롬프트 실험) — 8093. 프롬프트 있음 3회(temp 0) + 3회(temp 0.7) + 프롬프트 없음 1회(temp 0).
// 한글은 curl이 깨지므로 Node fetch만(CLAUDE.md). 워밍업 1회 버림.
import fs from "node:fs";
const H = process.env.HOME; const PORT = 8093; const NL = String.fromCharCode(10);
const SYS = JSON.parse(fs.readFileSync(`${H}/bench/models-prompt.json`, "utf8"))[0].system;
const Q = "KEV가 뭐야?";
async function ask(messages, temperature) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "local", messages, temperature, max_tokens: 900, cache_prompt: false }), signal: AbortSignal.timeout(600000) });
  const j = await r.json(); const c = j.choices?.[0]; const u = j.usage || {};
  return { text: c?.message?.content ?? "", ms: Date.now() - t0, finish: c?.finish_reason, genTokens: u.completion_tokens };
}
// 템플릿이 system을 어떻게 펼치는지 눈으로 확인(apply-template) — 합친 system이 그대로 들어가는지
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/apply-template`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: [SYS, "과제 고유 system 예시"].join(String.fromCharCode(10, 10)) }, { role: "user", content: Q }] }) });
  const j = await r.json(); console.log("[apply-template]", r.status, String(j.prompt || JSON.stringify(j)).split(NL).join("⏎").slice(0, 600));
} catch (e) { console.log("[apply-template] 실패", e.message); }
await ask([{ role: "user", content: "안녕하세요" }], 0);
const out = [];
for (let i = 0; i < 3; i++) out.push({ label: "prompt·temp0", run: i + 1, ...(await ask([{ role: "system", content: SYS }, { role: "user", content: Q }], 0)) });
for (let i = 0; i < 3; i++) out.push({ label: "prompt·temp0.7", run: i + 1, ...(await ask([{ role: "system", content: SYS }, { role: "user", content: Q }], 0.7)) });
out.push({ label: "noprompt·temp0", run: 1, ...(await ask([{ role: "user", content: Q }], 0)) });
for (const o of out) { o.cisa = /CISA|Cybersecurity and Infrastructure Security Agency|사이버보안[·\s]*인프라[·\s]*보안국|미국 사이버보안/i.test(o.text); console.log(o.label, o.run, o.cisa ? "CISA✓" : "CISA✗", o.finish, o.text.length + "자", (o.ms / 1000).toFixed(1) + "s", "|", o.text.split(NL).join(" ").slice(0, 200)); }
fs.writeFileSync(`${H}/bench/lora-vuln/kev-prompt.json`, JSON.stringify(out, null, 1));
console.log("저장 kev-prompt.json");
