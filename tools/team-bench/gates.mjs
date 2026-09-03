#!/usr/bin/env node
// tools/team-bench/gates.mjs — 증류 사다리(계획서 §12)의 **판정자**. 결과 JSON들을 받아 결정적으로 합격/불합격을 낸다.
//
// ■ 왜 있나
//   사다리는 「재료 확장 → RAFT형 학습 → 게이트 → 판정」인데, 앞 세 단계는 밤새 돌아가고
//   **판정만 사람 눈에 걸린다.** 눈으로 표를 보면 「대체로 좋아 보인다」로 채택이 통과한다 —
//   이 저장소가 반복해 겪은 「고쳤다가 거짓」의 자리다. 그래서 채택 전 마지막 관문을
//   **코드 한 곳**으로 못박는다. LLM 채점기는 쓰지 않는다(중-3 게이트 원칙과 같다).
//
// ■ 잣대는 새로 적지 않는다 — 이미 있는 것을 **인용**한다
//   · 인용 성립  = tasks.mjs T6(glossary_cite) detail의 「20자겹침」 (그 자가 이미 판정한 값을 읽는다)
//   · KEV 발표주체 = prompt-harness/kev-prompt2.mjs 방식 — **URL을 지운 본문**에서 CISA를 찾는다
//     (URL만 맞고 본문은 「보건복지부」라고 답한 실측이 있다 — URL을 세면 그 거짓이 통과한다)
//   · 점수·한글·tok/s = run.mjs / run-r2.mjs가 남긴 결과 JSON의 필드 그대로
//   ⚠ 새 잣대를 여기서 만들면 「같은 것을 여러 곳에 적으면 어긋난다」가 판정층에서 재발한다.
//
// ■ 관문 7개
//   ① kev            KEV 발표 주체를 3문항 모두 본문에서 CISA로 답한다(3/3)
//   ② cite_overlap   glossary_cite 20자겹침이 기준선 이상(근거를 실제로 옮겨 적는가)
//   ③ easy7_no_drop  1회차 7과제가 **하나도** 기준선보다 낮아지지 않는다
//   ④ avg13          13과제 평균이 기준선 초과(needle_64k 포함 여부를 표에 적는다)
//   ⑤ truncated      잘린 답(finish=length) 0건
//   ⑥ hangul         한글 비율 평균이 기준선 이상
//   ⑦ tps_drop       생성 속도 중앙값이 기준선 대비 10% 넘게 안 떨어진다
//
// ■ 없으면 불합격(fail-closed)
//   입력 파일이 없으면 그 관문은 「미측정」이고 **전체는 불합격**이다. 못 잰 것을 통과로
//   적으면 게이트가 게이트가 아니다(2026-09-03 실측: 「전원사망을 0건으로 보고」한 전례).
//
// 사용:
//   node tools/team-bench/gates.mjs --easy <r1결과.json> --hard <r2결과.json> \
//        [--samples <samples.json>] [--kev <kev.json>] [--out <디렉터리>] [--include-needle64k]
//        [--baseline-easy …] [--baseline-hard …] [--kev-label prompt] [--label 회차이름]
//   기본 기준선: tools/team-bench/results-ladder/baseline/r1-qwen3-14b.json · r2-qwen3-14b.json
//   나가는 코드: 0=합격 · 1=불합격 · 2=쓰는 법 틀림
//
// 표준 라이브러리 + 이 저장소 도구만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { overlap20 } from "../distill-precheck.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** 기준선 파일의 정본 위치 — 어디서 왔는지는 results-ladder/baseline/README.md에 적혀 있다. */
export const 기준선기본 = {
  easy: path.join(here, "results-ladder", "baseline", "r1-qwen3-14b.json"),
  hard: path.join(here, "results-ladder", "baseline", "r2-qwen3-14b.json"),
};

/** ctx를 넘겨 원리상 0점인 과제 — 평균에서 뺄지를 사람이 고르게 하고, 고른 쪽을 표에 적는다. */
export const NEEDLE64K = "needle_64k";

/** tok/s 허용 낙폭. 왜 10%인가: 어댑터를 얹으면 프리필·샘플링이 조금 느려지는 것은 정상이고,
 *  그 이상은 「모델이 바뀐 것」이라 속도로 티가 난다. 기준은 사람이 옮길 수 있게 상수로 둔다. */
export const TPS_허용낙폭 = 0.10;

/** KEV 문항 최소 개수 — 「3/3」의 3. 두 문항이면 우연히 맞을 여지가 커서 사다리 기준을 3으로 잡았다. */
export const KEV_최소문항 = 3;

// ── 잣대 인용부 ─────────────────────────────────────────────────────────

/**
 * KEV 발표 주체가 **본문**에서 CISA인가.
 *
 * ⚠ URL을 먼저 지운다 — 실측(2026-09-03 kev-prompt2): 본문은 「대한민국 보건복지부」라고 답하고
 *   맨 끝에 cisa.gov 링크만 붙인 답이 있었다. URL을 세면 그 거짓이 통과한다.
 * 이 정규식은 prompt-harness/kev-prompt2.mjs의 것을 그대로 옮긴 것이다(잣대 단일 출처).
 */
export function cisa본문(text) {
  const 본문 = String(text ?? "").replace(/https?:[^\s)]+/g, "");
  return /CISA|Cybersecurity and Infrastructure Security Agency|사이버\s*보안\s*(및\s*)?(인프라|기반시설)\s*보안\s*(국|청)/i.test(본문);
}

/**
 * 채점기가 남긴 detail 문자열에서 이름표가 붙은 수를 꺼낸다.
 * 예) "인용 1 · 20자겹침 1 · 핵심 1" 에서 "20자겹침" → 1
 * 값을 **다시 계산하지 않는다** — 채점한 자가 남긴 그 값을 읽는 것이 요점이다.
 */
export function detail숫자(detail, 이름) {
  const 안전 = String(이름).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${안전}\\s+(-?\\d+(?:\\.\\d+)?)`).exec(String(detail ?? ""));
  return m ? Number(m[1]) : null;
}

/** glossary_cite의 「20자겹침」(0|1). 과제가 없거나 detail이 그 꼴이 아니면 null(=모름). */
export function 인용겹침(결과) {
  return detail숫자(결과?.tasks?.glossary_cite?.detail, "20자겹침");
}

// ── 결과 JSON 훑기 ──────────────────────────────────────────────────────

/** 결과 JSON(run.mjs 꼴)에서 [과제id, 값] 쌍을 낸다. 건너뛴(skipped) 과제는 빼고 센다. */
function 과제들(결과) {
  const t = 결과?.tasks ?? {};
  return Object.entries(t).filter(([, v]) => v && !v.skipped);
}

/** 결과 JSON 하나 또는 여럿에서 과제 점수를 모은다 → { 과제id: 점수 } */
export function 점수표(...결과들) {
  const out = {};
  for (const r of 결과들) for (const [id, v] of 과제들(r)) out[id] = Number(v.score ?? 0);
  return out;
}

/**
 * 생성 속도 중앙값.
 * ⚠ run.mjs의 summary 표와 **같은 규칙**으로 고른다(정렬 후 Math.floor(n/2) 자리) — 표에 찍힌
 *   숫자와 게이트가 쓰는 숫자가 다르면 사람이 둘을 대조하다 헛짚는다.
 */
export function tps중앙값(...결과들) {
  const xs = [];
  for (const r of 결과들) for (const [, v] of 과제들(r)) if (typeof v.genTps === "number" && v.genTps > 0) xs.push(v.genTps);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

/** 한글 비율 평균(과제 기준). JSON만 뱉는 과제는 0이 정상이라 기준선도 같은 방식으로 잰다. */
export function 한글평균(...결과들) {
  const xs = [];
  for (const r of 결과들) for (const [, v] of 과제들(r)) if (typeof v.한글 === "number") xs.push(v.한글);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * 잘린 답의 수 — finish === "length".
 * ⚠ 요청 자체가 실패한 것(finish 없음)은 여기서 안 센다. 그건 잘림이 아니라 **실패**이고
 *   점수 0으로 이미 드러난다(needle_64k의 400이 그 예다). 둘을 섞으면 원인을 잘못 읽는다.
 */
export function 잘림수(...묶음들) {
  let n = 0;
  for (const b of 묶음들) {
    if (!b) continue;
    if (Array.isArray(b)) { for (const s of b) if (String(s?.finish ?? "") === "length") n++; continue; }
    for (const [, v] of 과제들(b)) if (String(v.finish ?? "") === "length") n++;
  }
  return n;
}

/** samples 배열의 한글 비율 평균(기준선이 없어 참고용). */
export function 표본한글평균(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const xs = samples.map((s) => s?.한글).filter((x) => typeof x === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * samples의 근거 인용 성립률(참고) — 증류기가 쓰는 overlap20을 그대로 부른다.
 * gold(근거 원문)가 없는 표본은 셈에서 뺀다(모르는 것을 0으로 적지 않는다).
 */
export function 표본인용률(samples) {
  if (!Array.isArray(samples)) return null;
  const 대상 = samples.filter((s) => s && typeof s.gold === "string" && s.gold.length >= 20 && typeof s.text === "string");
  if (!대상.length) return null;
  const 성립 = 대상.filter((s) => overlap20(s.text, s.gold) !== null).length;
  return { 대상: 대상.length, 성립, 비율: 성립 / 대상.length };
}

// ── KEV ────────────────────────────────────────────────────────────────

/**
 * KEV 판정. entries = kev 결과 배열([{label?, q, text}...]).
 * label이 있는 파일은 시험 대상 라벨만 센다(대조군 "noprompt"를 같이 세면 절대 통과 못 한다).
 */
export function kev판정(entries, { 라벨 = null, 최소 = KEV_최소문항 } = {}) {
  if (!Array.isArray(entries)) return { 대상: 0, 성립: 0, 통과: false, 상세: [] };
  const 라벨있음 = entries.some((e) => e && typeof e.label === "string");
  const 대상들 = !라벨있음
    ? entries
    : entries.filter((e) => (라벨 ? e.label === 라벨 : e.label !== "noprompt"));
  const 상세 = 대상들.map((e) => ({ q: String(e?.q ?? ""), 본문CISA: cisa본문(e?.text) }));
  const 성립 = 상세.filter((x) => x.본문CISA).length;
  return { 대상: 상세.length, 성립, 통과: 상세.length >= 최소 && 성립 === 상세.length, 상세 };
}

// ── 판정표 ─────────────────────────────────────────────────────────────

const 미측정 = (키, 이름, 왜) => ({ 키, 이름, 값: "미측정", 기준: "-", 통과: false, 설명: `${왜} — 못 잰 것은 통과로 세지 않는다` });
const 반올림 = (x, n = 3) => (typeof x === "number" ? Number(x.toFixed(n)) : x);

/**
 * 관문 7개를 판정한다. **순수 함수** — 파일을 읽지도 쓰지도 않는다(시험이 여기를 직접 부른다).
 *
 * 입력 { easy, hard, samples, kev } / 기준선 { easy, hard }
 * 옵션 { needle64k포함=false, kev라벨=null, 이름표="" }
 */
export function 판정(입력 = {}, 기준선 = {}, 옵션 = {}) {
  const { easy = null, hard = null, samples = null, kev = null } = 입력;
  const { easy: bEasy = null, hard: bHard = null } = 기준선;
  const needle64k포함 = Boolean(옵션.needle64k포함);
  const 검사 = [];

  // ① KEV 3/3
  if (!kev) 검사.push(미측정("kev", "KEV 발표 주체 3/3", "kev 결과 파일 없음"));
  else {
    const k = kev판정(kev, { 라벨: 옵션.kev라벨 ?? null });
    검사.push({
      키: "kev", 이름: "KEV 발표 주체 3/3", 값: `${k.성립}/${k.대상}`, 기준: `${KEV_최소문항}문항 이상 전부 본문에 CISA`,
      통과: k.통과,
      설명: k.대상 < KEV_최소문항 ? `문항이 ${k.대상}개뿐이다(최소 ${KEV_최소문항})` : (k.통과 ? "URL이 아니라 본문에서 CISA를 말한다" : "본문이 CISA를 말하지 않는 답이 있다(URL만 맞는 답 포함)"),
    });
  }

  // ② 인용 20자 겹침
  const c = easy ? 인용겹침(easy) : null;
  const bc = bEasy ? 인용겹침(bEasy) : null;
  if (c === null || bc === null) 검사.push(미측정("cite_overlap", "인용 20자 겹침", c === null ? "glossary_cite detail을 못 읽었다" : "기준선의 glossary_cite detail을 못 읽었다"));
  else 검사.push({
    키: "cite_overlap", 이름: "인용 20자 겹침", 값: c, 기준: `기준선 ${bc} 이상`,
    통과: c >= bc, 설명: c >= bc ? "근거 문장을 그대로 옮겨 적는다" : "근거를 옮겨 적지 않고 제 말로 바꿔 썼다(20자 창이 하나도 안 남았다)",
  });

  // ③ 1회차 7과제 무하락
  if (!easy || !bEasy) 검사.push(미측정("easy7_no_drop", "1회차 과제 무하락", easy ? "기준선(easy) 없음" : "easy 결과 파일 없음"));
  else {
    const b = 점수표(bEasy), r = 점수표(easy);
    const 과제 = Object.keys(b); // ★ 과제 목록의 출처는 **기준선 그 파일**이다(여기 따로 적지 않는다)
    // ⚠ 「안 돌린 것」과 「떨어진 것」을 **섞지 않는다.** 없는 과제를 0점으로 세면 표가
    //   「tool_select 1→0」이라고 말하는데, 실제로는 0점을 받은 게 아니라 **재지도 않았다.**
    //   둘 다 막는 것은 같지만(과제를 빼서 평균을 올리는 길을 닫는다) 사람에게 하는 말이 달라야 한다.
    const 빠진 = 과제.filter((id) => !(id in r));
    const 떨어진 = 과제.filter((id) => id in r && r[id] < b[id] - 1e-9);
    검사.push({
      키: "easy7_no_drop", 이름: `1회차 ${과제.length}과제 무하락`,
      값: `하락 ${떨어진.length}건${빠진.length ? ` · 미실시 ${빠진.length}건` : ""}`, 기준: "하락 0건 · 미실시 0건",
      통과: 떨어진.length === 0 && 빠진.length === 0,
      설명: [
        떨어진.length ? 떨어진.map((id) => `${id} ${반올림(b[id], 2)}→${반올림(r[id], 2)}`).join(" · ") : "",
        빠진.length ? `안 돌린 과제: ${빠진.join(", ")}` : "",
      ].filter(Boolean).join(" / ") || "이미 되던 것이 하나도 안 깨졌다",
    });
  }

  // ④ 13과제 평균
  if (!easy || !hard || !bEasy || !bHard) 검사.push(미측정("avg13", "13과제 평균", "easy·hard 결과와 기준선이 모두 있어야 한다"));
  else {
    const 평균 = (실행, 기준) => {
      const s = { ...점수표(...실행) };
      if (!needle64k포함) delete s[NEEDLE64K];
      const 목록 = Object.keys({ ...점수표(...기준) }).filter((id) => needle64k포함 || id !== NEEDLE64K);
      const 값들 = 목록.map((id) => s[id] ?? 0);
      return { 평균: 값들.reduce((a, b2) => a + b2, 0) / (값들.length || 1), 수: 값들.length };
    };
    const r = 평균([easy, hard], [bEasy, bHard]);
    const b = 평균([bEasy, bHard], [bEasy, bHard]);
    검사.push({
      키: "avg13", 이름: `13과제 평균 (needle_64k ${needle64k포함 ? "포함" : "제외"} → ${r.수}과제)`,
      값: 반올림(r.평균), 기준: `기준선 ${반올림(b.평균)} 초과`,
      통과: r.평균 > b.평균 + 1e-9,
      설명: needle64k포함
        ? "★ needle_64k는 74,256토큰이라 ctx를 넘겨 기준선도 0이다 — 포함하면 둘 다 0으로 눌린 채 비교된다"
        : "needle_64k는 ctx 초과라 양쪽 0 — 빼고 잰다(넣어도 순위는 안 바뀌고 평균만 낮아진다)",
    });
  }

  // ⑤ 잘림 0
  if (!easy && !hard && !samples) 검사.push(미측정("truncated", "잘린 답 0건", "잘림을 셀 결과가 하나도 없다"));
  else {
    const n = 잘림수(easy, hard, samples);
    검사.push({ 키: "truncated", 이름: "잘린 답 0건", 값: n, 기준: "0건", 통과: n === 0, 설명: n ? "max_tokens에 걸려 답이 중간에 끊겼다(요청 실패와 다르다)" : "끊긴 답 없음" });
  }

  // ⑥ 한글 비율
  const h = 한글평균(...[easy, hard].filter(Boolean));
  const bh = 한글평균(...[bEasy, bHard].filter(Boolean));
  if (h === null || bh === null) 검사.push(미측정("hangul", "한글 비율 평균", "한글 비율을 잰 결과가 없다"));
  else 검사.push({
    키: "hangul", 이름: "한글 비율 평균", 값: 반올림(h), 기준: `기준선 ${반올림(bh)} 이상`,
    통과: h >= bh - 1e-9,
    설명: "JSON만 뱉는 과제는 0이 정상이라 기준선도 같은 방식으로 잰다(과제 구성이 같을 때만 견줄 수 있다)",
  });

  // ⑦ 생성 속도
  const t = tps중앙값(...[easy, hard].filter(Boolean));
  const bt = tps중앙값(...[bEasy, bHard].filter(Boolean));
  if (t === null || bt === null || bt <= 0) 검사.push(미측정("tps_drop", "생성 속도 낙폭", "tok/s를 잰 결과가 없다"));
  else {
    const 낙폭 = (bt - t) / bt;
    검사.push({
      키: "tps_drop", 이름: "생성 속도 낙폭", 값: `${(낙폭 * 100).toFixed(1)}% (${반올림(t, 2)} tok/s)`,
      기준: `기준선 ${반올림(bt, 2)} tok/s 대비 ${(TPS_허용낙폭 * 100).toFixed(0)}% 이내`,
      통과: 낙폭 <= TPS_허용낙폭 + 1e-9,
      설명: "8080 /health는 붕괴해도 200이라 속도로 본다 — 크게 느려졌으면 두뇌가 스왑에 밀린 것이다",
    });
  }

  return { 이름표: String(옵션.이름표 ?? ""), needle64k포함, 검사, 합격: 검사.every((x) => x.통과), 잰때: new Date().toISOString() };
}

/** 사람이 읽는 표(markdown). 판정 결과만 받는다 — 여기서 다시 계산하지 않는다. */
export function 표만들기(결과, 참고 = {}) {
  const 줄 = 결과.검사.map((c) => `| ${c.통과 ? "✅" : "❌"} | ${c.이름} | ${c.값} | ${c.기준} | ${c.설명} |`);
  const 참고줄 = [];
  if (참고.표본수 != null) 참고줄.push(`- 표본 ${참고.표본수}건 · 한글 ${참고.표본한글 == null ? "-" : (참고.표본한글 * 100).toFixed(0) + "%"}`);
  if (참고.표본인용) 참고줄.push(`- 표본 근거 인용(overlap20) ${참고.표본인용.성립}/${참고.표본인용.대상} (${(참고.표본인용.비율 * 100).toFixed(0)}%) — 참고값이다(기준선이 없어 관문으로 세지 않는다)`);
  if (참고.원천) 참고줄.push(...참고.원천.map((s) => `- 원천: ${s}`));
  return [
    `# 증류 사다리 게이트 — ${결과.이름표 || "(이름표 없음)"} · ${결과.합격 ? "**합격**" : "**불합격**"}`,
    "",
    `잰 때 ${결과.잰때} · needle_64k ${결과.needle64k포함 ? "포함" : "제외"}`,
    "",
    "| | 관문 | 실측 | 기준 | 왜 이 잣대인가 |",
    "|---|---|---|---|---|",
    ...줄,
    "",
    ...(참고줄.length ? ["참고(관문 아님)", ...참고줄, ""] : []),
    결과.합격
      ? "→ 일곱 관문을 모두 넘었다. 채택 여부는 사람이 정한다(게이트는 「못 넘은 것을 막는」 자다)."
      : "→ 넘지 못한 관문이 있다. **채택하지 않는다.** 「대체로 좋아 보인다」로 넘기지 않는 것이 이 자의 존재 이유다.",
    "",
  ].join("\n");
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("team-bench/gates.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const 읽기 = (p) => { if (!p) return null; if (!fs.existsSync(p)) { console.error(`✗ 파일 없음: ${p}`); return null; } return JSON.parse(fs.readFileSync(p, "utf8")); };

  const easyP = opt("--easy", ""), hardP = opt("--hard", ""), samplesP = opt("--samples", ""), kevP = opt("--kev", "");
  if (!easyP && !hardP) { console.error("쓰는 법: node tools/team-bench/gates.mjs --easy <r1.json> --hard <r2.json> [--samples s.json] [--kev k.json] [--out 디렉터리]"); process.exit(2); }

  const bEasyP = opt("--baseline-easy", 기준선기본.easy), bHardP = opt("--baseline-hard", 기준선기본.hard);
  const 입력 = { easy: 읽기(easyP), hard: 읽기(hardP), samples: 읽기(samplesP), kev: 읽기(kevP) };
  const 기준 = { easy: 읽기(bEasyP), hard: 읽기(bHardP) };
  const r = 판정(입력, 기준, {
    needle64k포함: args.includes("--include-needle64k"),
    kev라벨: opt("--kev-label", null),
    이름표: opt("--label", path.basename(easyP || hardP || "")),
  });

  const 표 = 표만들기(r, {
    표본수: Array.isArray(입력.samples) ? 입력.samples.length : null,
    표본한글: 표본한글평균(입력.samples),
    표본인용: 표본인용률(입력.samples),
    원천: [easyP, hardP, samplesP, kevP, `기준선 ${bEasyP}`, `기준선 ${bHardP}`].filter(Boolean),
  });
  console.log(표);

  const out = opt("--out", "");
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "gate.json"), JSON.stringify(r, null, 2));
    fs.writeFileSync(path.join(out, "gate.md"), 표);
    console.log(`판정 파일: ${path.join(out, "gate.json")} · ${path.join(out, "gate.md")}`);
  }
  process.exit(r.합격 ? 0 : 1);
}
