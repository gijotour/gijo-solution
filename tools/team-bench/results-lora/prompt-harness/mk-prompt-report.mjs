// 프롬프트 기준선 보고서 생성기(2026-09-03). 숫자는 전부 결과 JSON에서 읽는다. 표본 판정만 사람(나)이 읽은 것.
import fs from "node:fs";
const H = process.env.HOME; const NL = "\n";
const L = (f) => JSON.parse(fs.readFileSync(`${H}/bench/${f}`, "utf8"));
const eb = L("results/qwen3-14b.json"), el = L("results-lora-v3-easy/qwen3-14b+vuln-v3.json"), ep = L("results-prompt-easy/qwen3-14b+prompt.json");
const hb = L("results-r2/qwen3-14b.json"), hl = L("results-lora-v3/qwen3-14b+vuln-v3.json"), hp = L("results-prompt/qwen3-14b+prompt.json");
const sb = L("lora-vuln/samples-base.json"), sl = L("lora-vuln/samples-lora.json"), sp = L("lora-vuln/samples-prompt.json");
const kev = L("lora-vuln/kev-prompt.json"), kev2 = L("lora-vuln/kev-prompt2.json");
const SYS = L("models-prompt.json")[0].system;
const f2 = (x) => (typeof x === "number" ? x.toFixed(2) : "-");
const f1 = (x) => (typeof x === "number" ? x.toFixed(1) : "-");
const pct = (x) => (typeof x === "number" ? (x * 100).toFixed(0) + "%" : "-");
const delta = (a, b) => { const d = b - a; return Math.abs(d) < 0.005 ? "=" : (d > 0 ? "▲+" : "▼") + d.toFixed(2); };
const avgOf = (r) => { const v = Object.values(r.tasks).map((t) => t.score).filter((x) => typeof x === "number"); return v.reduce((a, b) => a + b, 0) / v.length; };
const genSum = (r) => Object.values(r.tasks).reduce((s, t) => s + (t.genTokens || 0), 0);
const tpsAvg = (r) => { const v = Object.values(r.tasks).map((t) => t.genTps).filter(Boolean); return v.reduce((a, b) => a + b, 0) / v.length; };
const koAvg = (r) => { const v = Object.values(r.tasks).map((t) => t.한글).filter((x) => typeof x === "number"); return v.reduce((a, b) => a + b, 0) / v.length; };
const oneLine = (s) => String(s).replace(/\n/g, " ");
function table(b, l, p) {
  const out = ["| 과제 | 기준선 | 어댑터 v3 | **프롬프트** | 프롬프트-기준선 | 기준선 판정 | 프롬프트 판정 | 생성 토큰(기/어/프) | tok/s(기/어/프) | 한글(기/어/프) |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const id of Object.keys(b.tasks)) { const B = b.tasks[id], Lr = l.tasks[id], P = p.tasks[id]; out.push(`| ${id} | ${f2(B.score)} | ${f2(Lr.score)} | **${f2(P.score)}** | ${delta(B.score, P.score)} | ${B.detail.slice(0, 60)} | ${P.detail.slice(0, 60)} | ${B.genTokens ?? "-"}/${Lr.genTokens ?? "-"}/${P.genTokens ?? "-"} | ${f1(B.genTps)}/${f1(Lr.genTps)}/${f1(P.genTps)} | ${pct(B.한글)}/${pct(Lr.한글)}/${pct(P.한글)} |`); }
  out.push(`| **평균** | **${avgOf(b).toFixed(3)}** | **${avgOf(l).toFixed(3)}** | **${avgOf(p).toFixed(3)}** | ${delta(avgOf(b), avgOf(p))} | | | 합 ${genSum(b)}/${genSum(l)}/${genSum(p)} | ${f1(tpsAvg(b))}/${f1(tpsAvg(l))}/${f1(tpsAvg(p))} | ${pct(koAvg(b))}/${pct(koAvg(l))}/${pct(koAvg(p))} |`);
  return out.join(NL);
}
// 표본 12건 — 사람 판정(내가 읽고 데이터셋 정답과 대조). 베이스·어댑터 판정은 지난 보고(mk-samples.mjs)의 것을 그대로 옮겼다.
const J = [
  { i: 1, base: "틀림", lora: "부분", prompt: "부분", 날조: "의심", 메모: "AD 일부 기능이 기본 공유로 동작한다는 방향은 맞음. 참조로 「Microsoft 공식 문서 “Understanding Default Shares in Windows Server”」를 달았는데 주어진 문서가 없다(실존 미확인)." },
  { i: 2, base: "부분", lora: "부분", prompt: "부분", 날조: "확실", 메모: "호환성·사전 테스트는 맞으나 정답의 「재시작 필요」 누락. 참조 「GIJO AS 보안 운영 가이드, 2023년 10월 발행」은 존재하지 않는 우리 문서다." },
  { i: 3, base: "맞음", lora: "맞음", prompt: "맞음", 날조: "없음", 메모: "추측 공격 위험을 맞힘. 참조 없음." },
  { i: 4, base: "틀림", lora: "틀림", prompt: "틀림", 날조: "확실", 메모: "토켓(Tomcat 오타)을 Ticket 시스템으로 오해. 「관련 문서에서 명시된 절차」라며 굵은 따옴표로 문장을 인용했는데 문서가 없다 — 인용문 자체를 지어냄." },
  { i: 5, base: "부분", lora: "부분", prompt: "부분", 날조: "없음", 메모: "MD5·SHA-1 예시는 맞고 정답의 「SHA-2 이상」 기준 누락. 참조 NIST SP 800-63B는 실존 문서." },
  { i: 6, base: "틀림", lora: "틀림", prompt: "틀림", 날조: "없음", 메모: "정답은 「웜 때문에 네트워크 분리 상태로 설치」인데 「안정적인 네트워크 연결 필요」로 정반대 — 셋 다 같은 방향으로 틀림." },
  { i: 7, base: "맞음", lora: "맞음", prompt: "맞음", 날조: "확실", 메모: "스팸 릴레이 악용을 맞힘(DoS 누락). 참조 「RFC 5542」는 SMTP 문서가 아니다(IPP URL 스킴; SMTP는 RFC 5321)." },
  { i: 8, base: "맞음", lora: "부분", prompt: "맞음", 날조: "의심", 메모: "인증 없음을 맞힘. 참고 URL cisa.gov/ncas/current-activity/2019-04-15-tftp-vulnerability 는 형식만 CISA를 흉내 낸 것으로 보임(실존 미확인)." },
  { i: 9, base: "부분", lora: "부분", prompt: "틀림", 날조: "확실", 메모: "★사내 사례를 지어냄 — 「약 10만 건 유출 · 2021년 보안 사고 분석 보고서 p.45」. 정답은 M365 Copilot RAG 사례. 베이스의 「사례 1」 날조보다 구체적이라 더 위험." },
  { i: 10, base: "맞음", lora: "맞음", prompt: "맞음", 날조: "없음", 메모: "Log4Shell=RCE 정확. NVD 링크 실존." },
  { i: 11, base: "틀림", lora: "부분", prompt: "틀림", 날조: "확실", 메모: "★「2023년 4분기 12개 시스템 37건·34건 완료 · 보안 점검 보고서 p.15」 — 전부 지어낸 숫자·문서. 정답 424/369/55. 베이스도 가짜 리포트를 썼고 어댑터만 일반론으로 피했다." },
  { i: 12, base: "틀림", lora: "틀림", prompt: "틀림", 날조: "확실", 메모: "VPR을 「보안 제품 성능 요인」으로 오해(Tenable 지표 아님). 자기 문장을 「예시」로 따옴표 재인용 — 인용 지시가 만든 형식적 날조. 어댑터와 달리 한국어로는 답함(한글 82%)." },
];
const cnt = (k, v) => J.filter((x) => x[k] === v).length;
const avg = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0) / a.length;
const tps = (a) => a.reduce((s, x) => s + (x.genTps || 0), 0) / a.filter((x) => x.genTps).length;
const trunc = (a) => a.filter((x) => x.finish === "length").length;
const all13 = (e, h) => (avgOf(e) * 7 + avgOf(h) * 6) / 13;
const lines = [];
lines.push(`# 프롬프트 기준선 실측 — 「무어댑터 14B + 시스템 프롬프트」가 LoRA v3의 이득을 공짜로 주나`);
lines.push(``);
lines.push(`**어디서**: gb10(ARM CUDA·통합메모리 121GB) · **언제**: 2026-09-03 · **계획서**: 전-7(검증 기계) 연장 · AI팀 증류학습 계획서 1회전의 후속(\`report-lora-vuln-v3.md\` §5가 「다음 회전 전에 먼저 잴 것」으로 적은 실험)`);
lines.push(`**판정은 사장님이 한다. 이 문서는 판정 재료다.**`);
lines.push(``);
lines.push(`## 0. 한 줄 답`);
lines.push(``);
lines.push(`**형식 이득(간결·잘림 0·지연 단축·한글 유지)은 프롬프트만으로 거의 그대로 나온다. 사실 정확도는 어댑터와 마찬가지로 안 오르고, 「원문 인용」 지시가 문서 없는 질문에서 가짜 출처를 부른다(날조 5 → 8건). 학습으로만 얻는 것은 확인되지 않았다.**`);
lines.push(``);
lines.push(`## 1. 무엇을 어떻게 쟀나`);
lines.push(``);
lines.push(`| 항목 | 값 |`);
lines.push(`|---|---|`);
lines.push(`| 모델 | \`~/gijo-as/server/models/qwen3-14b/qwen3-14b.gguf\` — **어댑터 없음**. 인자는 하네스와 같음(\`-ngl -1 --parallel 1 --jinja --reasoning off --reasoning-budget 0\`, temperature 0, max_tokens 900) |`);
lines.push(`| 시스템 프롬프트 | 지시받은 문장 **그대로**(한 글자도 안 보탬): 「${SYS}」 |`);
lines.push(`| 주입 방식 | ★ **13과제 전부에 과제 고유 system이 이미 있다**(tasks.mjs·tasks-r2.mjs). 그래서 system을 둘 두지 않고 **모델 항목의 system을 과제 system 앞에 붙여 하나의 system**으로 보냈다(사이는 빈 줄 하나). 이유: 템플릿에 따라 둘째 system이 버려질 수 있어서. \`/apply-template\`로 펼친 결과를 눈으로 확인했다 — 합친 system이 통째로 \`<|im_start|>system\` 안에 들어간다. 표본 12건·KEV는 과제 system이 없으므로 system 하나만 앞에 넣었다. |`);
lines.push(`| 하네스 변경 | **원본 무변경**. 사본 \`run-prompt.mjs\`·\`run-r2-prompt.mjs\`(각 diff 14줄): ① 1행 머리 주석 ② 29행 \`--models\` 옵션(models.json 대신 \`models-prompt.json\`) ③ 76~85행 \`withSystem()\` 추가 ④ 87행 \`messages: withSystem(task.messages, m)\` ⑤ 106행 \`m.warmup\`이면 워밍업 1회 버림. 과제·채점기(tasks*.mjs)는 손대지 않았다. 표본은 \`ask12-prompt.mjs\`(원본 ask12.mjs와 diff 3줄: SYS 상수 + messages 앞 system). |`);
lines.push(`| 기준선 | 다시 재지 않았다 — \`results/qwen3-14b.json\`(쉬움·ctx 32768)·\`results-r2/qwen3-14b.json\`(어려움·ctx 65536)·\`samples-base.json\`. 어댑터 값은 \`results-lora-v3-easy/\`·\`results-lora-v3/\`·\`samples-lora.json\`. 같은 과제 id·같은 채점기(tasks*.mjs md5 변동 없음)임을 확인했다. |`);
lines.push(`| 서버 | 8093 하나만(하네스가 띄웠다 내림 ×2, 표본·KEV용 수동 1회). 8080·8081·4000은 건드리지 않음. |`);
lines.push(``);
lines.push(`## 2. 하네스 13과제 — 기준선 · 어댑터 v3 · 프롬프트`);
lines.push(``);
lines.push(`### 쉬운 7과제 (\`run-prompt.mjs\` · ctx 32768 · \`results-prompt-easy/\`)`);
lines.push(``);
lines.push(table(eb, el, ep));
lines.push(``);
lines.push(`### 어려운 6과제 (\`run-r2-prompt.mjs\` · ctx 65536 · \`results-prompt/\`)`);
lines.push(``);
lines.push(table(hb, hl, hp));
lines.push(``);
lines.push(`**합산 13과제**: 기준선 **${all13(eb, hb).toFixed(3)}** · 어댑터 **${all13(el, hl).toFixed(3)}** · 프롬프트 **${all13(ep, hp).toFixed(3)}** — 셋이 사실상 같다.`);
lines.push(``);
lines.push(`읽기:`);
lines.push(`- **glossary_cite 1.00 → 0.70(20자 겹침 1 → 0)** — 어댑터와 **똑같이** 떨어졌다. 「그 원문을 그대로 옮겨 적어 인용」이라고 시켰는데도 14B는 근거를 자기 말로 바꿔 썼다. 조각과의 **최장 연속 일치는 15자**(베이스는 20자 창 7개 일치). 즉 프롬프트도 인용 충실도를 못 지킨다 — 이 축은 프롬프트로도 어댑터로도 안 된다.`);
lines.push(`- **scan_messy 0.50 → 0.75**(어댑터는 1.00) — 중복은 합쳤으나(9 → 8건) 오탐 CSRF를 「※ 오탐」 주석까지 달고 목록에 남겼다. 어댑터가 유일하게 프롬프트보다 나은 자리인데, 원인은 지식이 아니라 「짧게 뽑기」 성향이다.`);
lines.push(`- **needle_32k 1.00 유지**(어댑터 0.80) — 어댑터는 「18개월」을 「18」로 깎았지만 프롬프트는 온전한 문장으로 답했다. 대신 needle 답이 **길어졌다**(16k: 46 → 116 토큰, 32k: 50 → 117) — 「3~6문장」 지시가 항목 나열을 문장으로 풀게 했다. 점수엔 무해, 형식은 과제 system(「짧게 답한다」)과 어긋난다.`);
lines.push(`- **속도**: 프롬프트 생성 ${f1(tpsAvg(ep))}/${f1(tpsAvg(hp))} tok/s = 기준선과 같다. 어댑터의 9% 저하가 없다(프롬프트는 프리필 토큰 100개쯤만 늘어난다).`);
lines.push(`- **생성 토큰 합**: 쉬움 ${genSum(eb)} → ${genSum(ep)}(어댑터 ${genSum(el)}) · 어려움 ${genSum(hb)} → ${genSum(hp)}(어댑터 ${genSum(hl)}). 하네스 과제는 과제 system이 이미 길이를 묶고 있어 **간결 효과가 작다** — 간결 이득이 크게 드러나는 곳은 아래 표본(열린 질문)이다.`);
lines.push(`- needle_64k는 셋 다 요청 실패(74K 토큰 > ctx 65536, 과제 설정 탓) · ti_trap은 셋 다 0.00(오탐 3/4).`);
lines.push(``);
lines.push(`## 3. 표본 12건 (\`samples-questions.json\` · pick.mjs 시드 20260903 · 전부 학습에 쓴 문항)`);
lines.push(``);
lines.push(`| | 베이스(프롬프트 없음) | 어댑터 v3 | **프롬프트** |`);
lines.push(`|---|---|---|---|`);
lines.push(`| 평균 길이 | ${Math.round(avg(sb, "len"))}자 | ${Math.round(avg(sl, "len"))}자 (${(avg(sl, "len") / avg(sb, "len")).toFixed(2)}배) | **${Math.round(avg(sp, "len"))}자 (${(avg(sp, "len") / avg(sb, "len")).toFixed(2)}배)** |`);
lines.push(`| 900토큰 잘림 | ${trunc(sb)}건 | ${trunc(sl)}건 | **${trunc(sp)}건** |`);
lines.push(`| 평균 한글 | ${pct(avg(sb, "한글"))} | ${pct(avg(sl, "한글"))} | **${pct(avg(sp, "한글"))}** |`);
lines.push(`| 한자 | ${sb.reduce((s, x) => s + (x.한자 || 0), 0)} | ${sl.reduce((s, x) => s + (x.한자 || 0), 0)} | ${sp.reduce((s, x) => s + (x.한자 || 0), 0)} |`);
lines.push(`| 평균 지연 | ${(avg(sb, "ms") / 1000).toFixed(1)}s | ${(avg(sl, "ms") / 1000).toFixed(1)}s | **${(avg(sp, "ms") / 1000).toFixed(1)}s** |`);
lines.push(`| 평균 생성 tok/s | ${f1(tps(sb))} | ${f1(tps(sl))} | **${f1(tps(sp))}** |`);
lines.push(`| 내 판정 맞음/부분/틀림 | ${cnt("base", "맞음")}/${cnt("base", "부분")}/${cnt("base", "틀림")} | ${cnt("lora", "맞음")}/${cnt("lora", "부분")}/${cnt("lora", "틀림")} | **${cnt("prompt", "맞음")}/${cnt("prompt", "부분")}/${cnt("prompt", "틀림")}** |`);
lines.push(`| 날조(출처·수치·인용문 지어냄) | 5건(지난 판정) | 2건(지난 판정) | **확실 ${cnt("날조", "확실")} + 의심 ${cnt("날조", "의심")} = ${cnt("날조", "확실") + cnt("날조", "의심")}건** |`);
lines.push(``);
lines.push(`| # | 출처 | 질문(앞 30자) | 길이 기/어/프 | 한글 기/어/프 | 지연 기/어/프 | 판정 기/어/프 | 프롬프트 날조 | 프롬프트 답 메모 |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (let i = 0; i < 12; i++) { const j = J[i]; lines.push(`| ${i + 1} | ${sb[i].origin === "distill" ? "증류" : "실대화"} | ${oneLine(sb[i].question).slice(0, 30)} | ${sb[i].len}/${sl[i].len}/${sp[i].len} | ${pct(sb[i].한글)}/${pct(sl[i].한글)}/${pct(sp[i].한글)} | ${(sb[i].ms / 1000).toFixed(1)}/${(sl[i].ms / 1000).toFixed(1)}/${(sp[i].ms / 1000).toFixed(1)}s | ${j.base}/${j.lora}/**${j.prompt}** | ${j.날조} | ${j.메모} |`); }
lines.push(``);
lines.push(`판정은 자동 채점기가 아니라 **내가 읽고 데이터셋 정답과 대조한 것**이다(베이스·어댑터 칸은 지난 보고 mk-samples.mjs의 판정을 그대로). 원문은 \`samples-prompt.json\`.`);
lines.push(``);
lines.push(`★ **새로 생긴 실패 — 출처 날조.** 프롬프트의 「근거 문서가 주어지면 그 원문을 그대로 옮겨 적어 인용」 조항이, 문서가 **안 주어진** 열린 질문에서 「(참조: …)」·「근거 문서: …」·굵은 따옴표 인용문을 붙이게 만들었다. 12건 중 8건에 참조가 달렸고 실존이 확인되는 것은 NIST SP 800-63B·NVD 두 건뿐이다. #9·#11은 사내 문서명·쪽수·수치를 통째로 지어냈다 — 우리가 파는 것이 「근거 있는 답」이라 이것은 형식 이득보다 무겁다. 베이스는 장황해서 틀리고, 프롬프트는 짧고 그럴듯하게 틀린다.`);
lines.push(``);
lines.push(`## 4. KEV 발표 주체 — 프롬프트 유무 대조 (\`kev-prompt.json\`·\`kev-prompt2.json\`)`);
lines.push(``);
lines.push(`| 질문 | 조건 | 답(요지) | 주체 판정 |`);
lines.push(`|---|---|---|---|`);
for (const o of kev) lines.push(`| KEV가 뭐야? | ${o.label} #${o.run} | ${oneLine(o.text).slice(0, 150)}… | ${o.label.startsWith("noprompt") ? "✗ 보안 뜻 자체를 못 잡음(keV 물리 단위·영상·닉네임)" : /국방부/.test(o.text) ? "✗ **국방부**(오답)" : /CISA\(/.test(o.text) ? "✓ 본문에 CISA" : "△ 본문은 「미국 (연방) 정부」, 링크만 cisa.gov"} |`);
for (const o of kev2) lines.push(`| ${o.q} | ${o.label} | ${oneLine(o.text).slice(0, 150)}… | ${o.label === "noprompt" && /보건복지부|백신/.test(o.text) ? "✗ **보건복지부·Key Vaccine**(전부 날조)" : o.cisaBody ? (/FCC/.test(o.text) ? "✓ CISA — 단 「FCC와 함께」·「사이버 보안 이니셔티브」 등 없는 말을 보탬" : /30일/.test(o.text) ? "✓ CISA — 단 「30일 내 패치 미제공 시 등재」는 지어낸 기준" : "✓ CISA") : "△ 「미국 정부」"} |`);
lines.push(``);
lines.push(`읽기:`);
lines.push(`- 「KEV가 뭐야?」를 **프롬프트 없이** 물으면 베이스 14B는 보안 뜻을 잡지도 못한다(keV·영상·닉네임 4가지 해석). 지난 보고 §4의 「scale 0.0 = CISA」는 같은 서버에서 다른 문구로 물은 결과라, 이 표와 직접 비교하지 말 것(그때 문구는 기록에 없다).`);
lines.push(`- 프롬프트가 「보안 전문가」 맥락을 주니 temp 0에서 3/3 보안 뜻 + cisa.gov 링크. 그러나 본문은 「미국 연방 정부」라 하고 CISA를 이름으로 안 부른다. **temp 0.7에선 3회 중 1회가 「미국 국방부」**(오답) — 어댑터 scale 1.0의 「국방부」와 같은 오류가 베이스에도 잠재해 있다.`);
lines.push(`- 주체를 **직접** 물으면(「누가 발표해?」) 프롬프트 있음은 2/2 CISA를 맞히되 곁가지를 지어낸다(「30일 내 패치 미제공 시 등재」·「FCC와 함께」). 프롬프트 없음은 「보건복지부 Key Vaccine」까지 간다.`);
lines.push(`- 결론: KEV 주체는 **프롬프트가 베이스보다 낫고 어댑터(척도 0.3 이상)보다 낫다**. 다만 「맞힌다」가 아니라 「대체로 맞히며 곁가지를 붙인다」다.`);
lines.push(``);
lines.push(`## 5. 판정 초안 (결정은 사장님)`);
lines.push(``);
lines.push(`1. **프롬프트만으로 v3의 형식 이득이 나오나 — 나온다.** 표본 12건 평균 ${Math.round(avg(sb, "len"))} → **${Math.round(avg(sp, "len"))}자**(어댑터 ${Math.round(avg(sl, "len"))}), 잘림 ${trunc(sb)} → **0**, 지연 ${(avg(sb, "ms") / 1000).toFixed(1)} → **${(avg(sp, "ms") / 1000).toFixed(1)}s**(어댑터 ${(avg(sl, "ms") / 1000).toFixed(1)}s), 한글 ${pct(avg(sb, "한글"))} → ${pct(avg(sp, "한글"))}, 속도 저하 0(어댑터 -9%). 어댑터 고유의 형식 이득은 없다.`);
lines.push(`2. **사실 정확도는 유지되나 — 유지되지 않는다(어댑터와 같은 급으로).** 13과제 ${all13(eb, hb).toFixed(3)} → ${all13(ep, hp).toFixed(3)}, glossary_cite 원문 겹침 1 → 0(최장 15자), 표본 판정 ${cnt("base", "맞음")}/${cnt("base", "부분")}/${cnt("base", "틀림")} → ${cnt("prompt", "맞음")}/${cnt("prompt", "부분")}/${cnt("prompt", "틀림")}(같음). 그리고 **날조가 5 → 8건으로 늘었다** — 「원문 인용」 지시가 문서 없는 답에 가짜 출처를 붙인다. KEV 주체는 베이스·어댑터보다 낫지만 곁가지 오류가 남는다.`);
lines.push(`3. **무엇이 남나 — 학습이 필요하다는 증거는 없다.** 어댑터가 프롬프트를 이긴 자리는 scan_messy 하나(0.75 vs 1.00)뿐이고 그것도 길이 효과다. 프롬프트를 제품에 쓰려면 **「근거 문서가 주어지면」 조항을 프롬프트가 아니라 코드로 가드**해야 한다(RAG 조각이 없는 답에 참조·쪽수·URL 금지, 출처는 조각 id만 허용 — CLAUDE.md 「7B에 프롬프트로 행동 교정 말고 코드로」와 같은 원칙). 그 가드가 있어야 「짧고 그럴듯하게 틀리는」 답이 「근거 있는 답」으로 보이는 사고를 막는다. 사실 정확도 자체는 프롬프트도 어댑터도 못 올렸으니, 그 축은 RAG(문서 스코프·인용 강제)와 더 큰 교사 쪽 문제로 남는다.`);
lines.push(``);
lines.push(`## 6. 되돌리기 · 원본 무변경 증명`);
lines.push(``);
lines.push(`- 원본 \`run.mjs\`·\`run-r2.mjs\`·\`tasks.mjs\`·\`tasks-r2.mjs\`·\`models.json\`·\`models.json.bak-prelora\`·\`ask12.mjs\`·\`pick.mjs\`·\`samples-questions.json\`의 md5를 시작 전(\`orig-md5-before-prompt.txt\`)과 끝난 뒤 \`md5sum -c\`로 대조했다(결과는 실행 로그·본문 §8). 사본(\`run-prompt.mjs\`·\`run-r2-prompt.mjs\`·\`models-prompt.json\`·\`ask12-prompt.mjs\`·\`kev-prompt*.mjs\`·\`mk-prompt-copies.mjs\`·\`mk-prompt-report.mjs\`)은 남겨 두었다 — 지워도 제품엔 영향 없다.`);
lines.push(`- 8093은 내렸다(앵커 pkill). 8080(Flash-Next)·8081(bge-m3)·4000은 손대지 않았다.`);
lines.push(``);
lines.push(`## 7. 산출물`);
lines.push(``);
lines.push(`- gb10: \`~/bench/results-prompt-easy/qwen3-14b+prompt.json\` · \`~/bench/results-prompt/qwen3-14b+prompt.json\` · \`~/bench/lora-vuln/samples-prompt.json\` · \`kev-prompt.json\` · \`kev-prompt2.json\` · 이 보고서 \`~/bench/report-prompt-baseline.md\``);
lines.push(`- win: \`D:/Connect AI/tools/team-bench/results-lora/report-prompt-baseline.md\` + \`easy-qwen3-14b+prompt.json\` · \`hard-qwen3-14b+prompt.json\` · \`samples-prompt.json\` · \`kev-prompt.json\` · \`kev-prompt2.json\` · \`prompt-harness/\`(사본 스크립트)`);
lines.push(``);
lines.push(`## 8. gb10 이용 내역`);
lines.push(`- **무엇에 썼나**: 14B 베이스 + 시스템 프롬프트로 하네스 13과제(쉬움 7 · 어려움 6) 실측, 표본 12건 1벌, KEV 대조 11회(3+3+1+4), apply-template로 주입 확인. 서버는 8093 하나를 세 번 띄웠다 내림.`);
lines.push(`- **무엇을 돌려받았나**: 위 표의 숫자 전부와 「형식은 프롬프트로 충분, 사실은 프롬프트로도 안 되고 출처 날조가 는다」는 대조 증거. 시간은 하네스 3분·표본 1.5분·KEV 2분.`);
lines.push(`- **값을 했나**: 했다 — 이 한 번으로 「학습 자체가 필요한가」에 **아니오 쪽 증거**가 생겼고(비용 0·위험 0 경로 확인), 동시에 프롬프트 경로의 새 위험(출처 날조)을 제품 반영 전에 잡았다.`);
lines.push(`- **못 한 것·안 쓴 것**: 지난 스모크의 KEV 질문 문구를 못 찾아 「베이스 = CISA」와 이번 「베이스 = keV 물리」를 같은 잣대로 못 세웠다(§4에 표기). \`local-digest\` 발췌는 안 썼다 — 읽은 파일이 하네스 150줄·표본 JSON뿐이라 발췌가 더 비쌌다. 사본 생성기에서 백슬래시 줄바꿈이 전송 중 접혀 한 번 재작업했다(String.fromCharCode로 회피).`);
lines.push(`- **규칙 준수**: 8080(PID 135515)·8081(PID 3294142)·4000(PID 3294106) 무접촉. 큰 모델은 한 번에 하나. nvidia-smi 안 씀(free -g만). 한글 요청은 전부 Node fetch.`);
fs.writeFileSync(`${H}/bench/report-prompt-baseline.md`, lines.join(NL) + NL);
console.log("wrote report-prompt-baseline.md", lines.join(NL).length, "chars");
