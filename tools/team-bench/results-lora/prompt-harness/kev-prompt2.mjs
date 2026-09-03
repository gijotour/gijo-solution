// KEV 발표 주체 직접 질문 — 프롬프트 유무 대조(temp 0). 8093.
import fs from "node:fs";
const H = process.env.HOME; const PORT = 8093; const NL = String.fromCharCode(10);
const SYS = JSON.parse(fs.readFileSync(`${H}/bench/models-prompt.json`, "utf8"))[0].system;
async function ask(messages) { const t0 = Date.now(); const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "local", messages, temperature: 0, max_tokens: 900, cache_prompt: false }), signal: AbortSignal.timeout(600000) }); const j = await r.json(); const c = j.choices?.[0]; return { text: c?.message?.content ?? "", ms: Date.now() - t0, finish: c?.finish_reason }; }
const qs = ["KEV 목록은 누가 발표해?", "보안에서 말하는 KEV가 뭐야? 누가 발표하는 거야?"];
const out = [];
for (const q of qs) { out.push({ label: "prompt", q, ...(await ask([{ role: "system", content: SYS }, { role: "user", content: q }])) }); out.push({ label: "noprompt", q, ...(await ask([{ role: "user", content: q }])) }); }
for (const o of out) { o.cisaBody = /CISA|Cybersecurity and Infrastructure Security Agency|사이버\s*보안\s*(및\s*)?(인프라|기반시설)\s*보안\s*(국|청)/i.test(o.text.replace(/https?:[^\s)]+/g, "")); o.cisaUrl = /cisa\.gov/i.test(o.text); console.log(`[${o.label}] ${o.q} → 본문CISA ${o.cisaBody ? "✓" : "✗"} · URL cisa.gov ${o.cisaUrl ? "✓" : "✗"} · ${o.text.length}자 · ${(o.ms / 1000).toFixed(1)}s`); console.log("   " + o.text.split(NL).join(" ").slice(0, 400)); }
fs.writeFileSync(`${H}/bench/lora-vuln/kev-prompt2.json`, JSON.stringify(out, null, 1));
