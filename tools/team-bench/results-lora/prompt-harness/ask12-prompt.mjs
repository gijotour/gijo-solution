// ★ 사본(프롬프트 실험) — 원본 ask12.mjs는 그대로. 다른 점: system 프롬프트를 맨 앞에 넣는다.
const SYS = "당신은 GIJO AS의 보안 전문가입니다. 답은 간결하게 — 핵심만 3~6문장, 목록은 필요할 때만. 사실은 아는 것만 말하고 모르면 모른다고 합니다. 근거 문서가 주어지면 **그 원문을 그대로 옮겨 적어** 인용하고, 지어내지 않습니다. 한국어로 답합니다.";
// 표본 12개를 8093 서버에 던져 답을 저장한다. 인자: <라벨>  (base | lora)
// 한글은 curl이 깨지므로 Node fetch만 쓴다(CLAUDE.md).
import fs from "node:fs";
const H = process.env.HOME;
const label = process.argv[2];
const PORT = 8093;
const qs = JSON.parse(fs.readFileSync(`${H}/bench/lora-vuln/samples-questions.json`, "utf8"));
const 한글비율 = (s) => { const m = String(s).match(/[가-힣A-Za-z]/g) || []; if (!m.length) return 0; return (String(s).match(/[가-힣]/g) || []).length / m.length; };
const 한자수 = (s) => (String(s).match(/[\u4E00-\u9FFF]/g) || []).length;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function ask(q) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", messages: [{ role: "system", content: SYS }, { role: "user", content: q }], temperature: 0, max_tokens: 900, cache_prompt: false }),
    signal: AbortSignal.timeout(600000),
  });
  const j = await r.json();
  const ms = Date.now() - t0;
  const c = j.choices?.[0];
  const text = c?.message?.content ?? "";
  const think = c?.message?.reasoning_content ?? "";
  const u = j.usage || {};
  return { text, think, ms, finish: c?.finish_reason, genTokens: u.completion_tokens, genTps: u.completion_tokens && (u.completion_tokens / (ms / 1000)), 한글: 한글비율(text), 한자: 한자수(text), len: text.length };
}
// ★ 워밍업 1회를 버린다 — 스모크에서 기동 직후 첫 요청이 반복 루프로 깨진 적이 있다(재현은 안 됨).
await ask("안녕하세요");
await sleep(500);
const out = [];
for (let i = 0; i < qs.length; i++) {
  const a = await ask(qs[i].question);
  out.push({ i: i + 1, origin: qs[i].origin, question: qs[i].question, gold: qs[i].answer, cites: qs[i].cites, ...a });
  console.log(`${i + 1}/${qs.length} ${a.finish} ${a.len}자 한글${a.한글.toFixed(2)} ${(a.ms / 1000).toFixed(1)}s`);
}
fs.writeFileSync(`${H}/bench/lora-vuln/samples-${label}.json`, JSON.stringify(out, null, 1));
console.log("저장", `samples-${label}.json`);
