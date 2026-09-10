#!/usr/bin/env node
// tools/team-bench/material-v6.mjs — 회전 5의 재료를 **승인 문답 등급 O에서 새로 굽는다**(계획서 §12.15).
//
// ■ 왜 새 파일인가 (material-r5.mjs와 무엇이 다른가)
//   r5는 **이미 구운 재료(raft-vuln-v4)를 다시 고르는** 도구다. 그 길의 천장이 2026-09-10에 드러났다 —
//   v4에서 등급 O만 남기면 **124행**(회전 4의 13%)이고 거절로 시작하는 행이 87.1%가 되어, 그 판으로는
//   「bf16이 나았나 / 재료가 얇았나」를 못 가른다(§12.13 ③). 그래서 이번에는 **원천에서 다시 굽는다**:
//   승인 문답 등급 O 2,181건 → 근거 조각 회수 → RAFT 행. 고르는 도구가 아니라 **굽는 도구**다.
//
// ■ 잣대는 새로 안 적는다 (2026-09-10에 밟은 자리 — 「같은 잣대가 두 벌」)
//   · 등급 판정·반출 감시·창 규격·언어·복사 상한·거절 판정 → tools/team-bench/material-r5.mjs
//   · 조각 규칙·근거 블록 조립·행 만들기·인용 규약·라이선스 허용목록 → tools/build-raft-dataset.mjs
//   이 파일이 새로 정하는 것은 **무엇을 넣고 무엇을 뗄지의 순서**뿐이다.
//
// ■ 세 모드
//   ① dump   운영 sqlite **읽기 전용** → 등급 O 승인 문답 · C 창 해시 · 전후 셈(운영 변경 0 증명)
//   ② corpus 운영 4000 **읽기 창구** → 근거 조각(코퍼스) · 팀원 프롬프트. 로그인 1회 · 끝나면 반드시 로그아웃
//   ③ bake   ①②를 재료로 → v6 · 새 홀드아웃 · 긴 형식 · 표본 문항 · 빌드 보고서
//
// ■ 뗄 순서가 곧 계약이다 (섞이면 판정이 안 선다)
//   홀드아웃을 **맨 먼저** 뗀다 → 긴 형식은 홀드아웃 밖에서 짓는다 → 남은 것으로 v6를 굽는다.
//   그래야 「시험지가 재료에 섞였나」를 나중에 따질 일이 없다. 뗀 수는 전부 보고서에 숫자로 적는다.
//
// ■ 운영에 쓰지 않는다
//   이 파일에는 운영을 **바꾸는** 창구가 하나도 없다(POST /api/dataset/save · UPDATE · INSERT · DELETE).
//   sqlite는 readonly로 열고, 4000은 읽기 창구 둘만 부르며, 세션은 끝나는 자리에서 반드시 닫는다.
//   그 사실을 짝 시험이 **소스로** 감시한다(server/test/materialv6.test.ts).
//
// 쓰는 법:
//   node tools/team-bench/material-v6.mjs --mode dump   --db <sqlite> --out-dir <dir>
//   GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… \
//     node tools/team-bench/material-v6.mjs --mode corpus --server http://localhost:4000 --out-dir <dir>
//   node tools/team-bench/material-v6.mjs --mode bake   --out-dir <dir> [--report-dir <저장소 기록 자리>]
//
// 나가는 코드: 0=성립 · 1=등급 관문 불합격(또는 목표 미달) · 2=쓰는 법 틀림 · 3=원천을 못 읽었다
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 잣대경로 = process.env.GIJO_MATERIAL_R5 || path.join(여기, "material-r5.mjs");
const 빌더경로 = process.env.GIJO_RAFT_BUILDER || path.join(여기, "..", "build-raft-dataset.mjs");

const R5 = await import(pathToFileURL(잣대경로).href);
const RAFT = await import(pathToFileURL(빌더경로).href);

const {
  등급관문, 잣대지문, 원천언어, 거절로시작하나, 사실주장인가, 창정규화, 창길이, 창적중수, 인용관문,
} = R5;
const { 질문해시 } = R5;
const {
  저장소, refParse, chunk, sha12, 행만들기, 시험문항목록, 라이선스판정기, 규격읽기,
  참고자료블록, 제목맞추기, 섞기, 방해조각고르기, 문항정규화, 인용붙이기,
} = RAFT;
// 걷어내는 자도 **하나**다 — 여기서 「C면 뺀다」를 다시 적으면 그것이 곧 잣대 두 벌이다(2026-09-10).
const { 걷어내기 } = await import(pathToFileURL(path.join(여기, "strip-c.mjs")).href);

/**
 * 구운 행에서 **인용이 제 번호의 블록에 없는 행을 걷어낸다**(2026-09-10 저녁 · 검토관 적발).
 *
 * 관문(인용관문)만 두면 「빨강이라고 말하고 그대로 굽는」 판이 된다 — 만든 자가 제 손으로 뺀다.
 * ⚠ 뺄셈은 **창 걸러내기 다음, 언어 맞추기 앞**이다. 뒤에 걸면 한국어 비중을 50%로 맞춰 놓고
 *   그 뒤에 행이 빠져 「≥50%」라 적은 줄이 거짓이 된다(창 걸러내기가 이미 밟은 자리다).
 */
export function 인용걸러내기(rows) {
  const 목록 = Array.isArray(rows) ? rows : [];
  const 걸린 = new Set(인용관문(목록).걸린행.map((x) => x.자리));
  return { rows: 목록.filter((_, i) => !걸린.has(i)), 지운: 걸린.size };
}

/**
 * 구운 행에서 **창 해시에 걸린 행을 걷어낸다** — 판정도 걷어내기도 저장소의 그 함수 하나로 한다.
 *
 * ★ 지도를 왜 「이 행들 전부 O」로 주나: v6의 등급은 **굽기 전에** 정해졌다(문답등급() — 자기 문서 등급과
 *   인용한 근거 문서 등급 중 가장 좁은 것). 질문 해시로 다시 찾을 것이 없다. 그래서 질문 해시 쪽은
 *   여기서 할 일이 없고, 실제로 일하는 것은 **창 해시**다 — 「굽는 사이에 C 글이 딸려 들어왔나」를 본다.
 * ★ 걸린 행은 **딱지를 고치지 않고 뺀다.** 「O인데 걸렸으니 관문이 틀렸다」고 판단하지 않는다 —
 *   관문이 못 미더우면 관문을 고칠 일이지, 걸린 행을 통과시킬 일이 아니다.
 */
export function 창걸러내기(rows, 창집합) {
  const 지도 = Object.fromEntries(rows.map((r) => [질문해시(r.question), "O"]));
  const { 남긴, 지운 } = 걷어내기(rows, 지도, 창집합);
  return { rows: 남긴, 지운: 지운.length };
}

// ── 창 해시 만들기 ──────────────────────────────────────────────────────
/**
 * C 본문 창을 **만들 때**의 걸음. 찾을 때의 걸음(R5.창걸음 = 1)과 **다른 값이고, 달라도 된다.**
 *
 * ★ 왜 20인가 — 이 값은 「얼마나 촘촘히 표본을 떠 두느냐」이지 판정 잣대가 아니다. 찾는 쪽이 1자 걸음이라
 *   재료에 실린 C 본문이 **어느 자리에서 시작하든** 이 창들과 맞는다. 최소적중 2와 겹쳐 보면 실효 검출
 *   하한은 **연속 60~80자**다(정렬이 최악일 때 80자). 그 아래 조각은 원리상 못 본다 — 숨기지 않고 적는다.
 * ⚠ 값을 바꾸면 §12.13이 gb10 재료를 지울 때 쓴 창 집합과 **다른 집합**이 된다. 더 촘촘하게 만들면
 *   더 잡히지만, 그 순간 「그때 C 0」과 「지금 C 0」이 다른 잣대의 0이 된다 — 두 벌이 되는 그 자리다.
 *   그래서 **그때 쓴 값 그대로** 둔다(짝 시험이 못 박는다).
 */
export const 창생성걸음 = 20;

/** 글 하나에서 창을 뜬다 — [{h(해시), w(창 글자)}]. 밖으로 나가는 것은 **h뿐**이다(w는 만드는 동안만 쓴다). */
export function 창목록(text) {
  const t = 창정규화(text);
  const out = [];
  for (let i = 0; i + 창길이 <= t.length; i += 창생성걸음) {
    const w = t.slice(i, i + 창길이);
    out.push({ h: crypto.createHash("sha1").update(w, "utf8").digest("hex").slice(0, 12), w });
  }
  return out;
}

/** 글 하나에서 창 해시만 — 본문은 안 내보낸다(지우려던 것을 다시 내보내지 않는다). */
export function 창들만들기(text) {
  return new Set(창목록(text).map((x) => x.h));
}

// ── 등급 잣대(문서) ─────────────────────────────────────────────────────
/**
 * 문서 등급 한 칸을 읽는 규칙 — server/src/engine/grades.ts gradeOf 와 같다.
 * 빈 칸 = O(아직 안 매김) · 모르는 값 = C(fail-closed). 여기서 값을 관대하게 읽으면 기밀이 그대로 나간다.
 */
export function 문서등급(v) {
  if (v === null || v === undefined || String(v).trim() === "") return "O";
  const u = String(v).trim().toUpperCase();
  return (u === "O" || u === "S" || u === "C") ? u : "C";
}

/** ref에서 문서 이름만 — `store:<문서>#<sha12>` · `<저장소 상대경로>#<sha12>` 두 꼴뿐이다. */
export function ref문서(ref) {
  const p = refParse(ref);
  return p ? p.id : String(ref ?? "").replace(/^store:/, "").split("#")[0];
}

/**
 * 승인 문답 한 건의 등급 — **자기 문서 등급과 인용한 근거 문서 등급 중 가장 좁은 것**.
 * ★ 왜 근거까지 보나: 답이 O라도 그 답이 C 문서를 인용해 쓰였다면, 그 답에는 C 본문이 실려 있다.
 *   자기 칸만 보면 「O 딱지를 단 C」가 통째로 나간다(2026-09-10 grade-map.py가 이미 이 규칙이었다).
 */
export function 문답등급(문답, 문서등급표) {
  const 순위 = { O: 0, S: 1, C: 2 };
  const 모음 = [];
  const 내문서 = 문서등급표.get("승인문답:" + 문답.id);
  if (내문서) 모음.push(내문서);
  for (const ref of 문답.cites ?? []) {
    const g = 문서등급표.get(ref문서(ref));
    if (g) 모음.push(g);
  }
  if (!모음.length) return "?";                       // 아무것도 못 대조했다 = 모른다(O가 아니다)
  return 모음.reduce((a, b) => (순위[b] > 순위[a] ? b : a));
}

// ── ① dump — 운영 sqlite 읽기 전용 ─────────────────────────────────────
/**
 * 운영 DB에서 **읽기만** 한다(SELECT 뿐 — 짝 시험이 소스로 감시한다).
 * @param db better-sqlite3 readonly 연결(시험은 같은 모양의 가짜를 끼운다)
 */
export function 뽑기(db, { 코퍼스조각들 = null, root = 저장소 } = {}) {
  const q = (s, ...a) => db.prepare(s).all(...a);
  const 셈 = {
    memory_documents: q("SELECT COUNT(*) n FROM memory_documents")[0].n,
    chat_logs: q("SELECT COUNT(*) n FROM chat_logs")[0].n,
    "chat_logs rating=1": q("SELECT COUNT(*) n FROM chat_logs WHERE rating = 1")[0].n,
  };
  const 문서등급표 = new Map();
  for (const r of q("SELECT documentId, grade FROM memory_documents")) 문서등급표.set(r.documentId, 문서등급(r.grade));

  const 문답들 = [];
  const 등급셈 = {};
  const C본문 = [], O본문 = [];
  const 파일근거 = new Set();                          // **등급 O** 문답이 가리킨 저장소 파일 근거(공개 원천)
  for (const r of q("SELECT id, question, answer, cites, topic, origin, teacher, createdAt FROM chat_logs WHERE rating = 1 ORDER BY createdAt ASC")) {
    let cites = [];
    try { cites = r.cites ? JSON.parse(r.cites) : []; } catch { cites = []; }
    const 문답 = {
      id: r.id, question: r.question, answer: r.answer, cites,
      topic: r.topic ?? null, origin: r.origin ?? null, teacher: r.teacher ?? null, createdAt: r.createdAt,
    };
    const g = 문답등급(문답, 문서등급표);
    등급셈[g] = (등급셈[g] ?? 0) + 1;
    // ⚠ 파일 근거는 **등급 O 문답이 가리킨 것만** 모은다(2026-09-10 저녁 · 검토관 적발).
    //   판정 전에 모으면 등급 C·? 문답이 가리킨 파일까지 「공개 원천」으로 읽어 창 집합에서 빼게 된다 —
    //   그 파일이 사내 문서인 날 **C 본문이 통째로 감시 밖으로 나간다.** 실측(2026-09-10): 승인 문답 전체가
    //   가리킨 파일 32개 · 등급 O만 29개였고, 차이 3개는 그날 마침 공개 knowledge 문서라 창 집합이 안 갈렸다.
    //   안 갈렸다는 것은 **그날 운이 좋았다**는 뜻이지 잣대가 옳았다는 뜻이 아니다.
    if (g === "O") {
      문답들.push(문답); O본문.push(r.answer);
      for (const ref of cites) { const p = refParse(ref); if (p?.kind === "file") 파일근거.add(p.id); }
    } else if (g === "C") C본문.push(r.answer);
  }
  // 공통 창은 뺀다 — 두 갈래다.
  //  ① O 승인 답에도 있는 글(정형 문구) — 그 글로 C를 판정하면 멀쩡한 행을 지운다.
  //  ② **공개 원천(지식 저장소 코퍼스)에 있는 글** — 이게 2026-09-10 저녁에 드러난 자리다.
  //     C 승인 답의 상당 부분은 KISA 가이드 같은 **등급 O 원문을 그대로 인용한 글**이다. 그 창을
  //     C 표식으로 두면, 같은 원문을 근거 블록에 실은 **정상 O 행**이 통째로 「C」로 찍힌다
  //     (실측: 코퍼스를 안 뺀 집합으로 v6를 재니 430행 중 244행이 거짓 빨강이었다).
  //     코퍼스에는 등급 C 문서·승인 문답이 애초에 안 들어온다(learncandidates.ts buildDistillCorpus)
  //     — 그래서 이 뺄셈은 **O로 이미 판정된 글만** 뺀다. 기밀이 새는 방향으로는 넓어지지 않는다.
  //   ⚠ 뺄셈을 **해시 대 해시**로 하면 안 된다 — 만드는 걸음이 20이라 C 답의 창 격자와 코퍼스의 창
  //     격자가 어긋난다(실측: 해시로 빼니 9,895→9,751, 144개만 빠졌다. 자리 어긋남 함정의 재판이다).
  //     그래서 코퍼스 본문을 **한 줄로 이어 붙여** 창 글자가 그 안에 **아무 자리에서나** 있는지 본다.
  //   ⚠ **부분집합이 아니다**(2026-09-10 저녁 · 검토관 적발 — 여기 적혀 있던 「좁으니 그때 판정은 그대로
  //     유효하다」는 거짓 논증이었다). 실측: 옛 집합 9,894 · 새 집합 6,386인데 **새 집합에만 있는 창이
  //     41개**다. 모집단이 함께 움직였기 때문이다(cdocs 1,598→1,597 · owin 12,612→12,614) — 「좁혔다」에서
  //     「새로 걸릴 것이 없다」가 따라 나오지 않는다.
  //     그래서 §12.13의 「C 0」은 논증이 아니라 **재측정**으로 지켰다: gb10 datasets 13파일을 이 집합으로
  //     다시 재서 「글에 C 본문 0」을 확인했다(~/bench/ladder/r5/lists/recheck-20260910-v6.tsv).
  //     **창 집합을 새로 만들면 그때마다 다시 잰다.** 좁아졌다는 말로 재측정을 건너뛰지 않는다.
  const C창 = new Map();                              // 해시 → 창 글자(뺄셈에만 쓰고 밖으로 안 나간다)
  const owin = new Set();
  for (const t of C본문) for (const x of 창목록(t)) if (!C창.has(x.h)) C창.set(x.h, x.w);
  for (const t of O본문) for (const h of 창들만들기(t)) owin.add(h);
  // 원천 본문 = 지식 저장소 코퍼스 + **승인 문답이 가리킨 저장소 파일**(knowledge/*.md · 사다리 재료).
  // ⚠ 파일 근거를 빼먹으면 그 파일에서 나온 O 행이 통째로 거짓 빨강이 된다 — 코퍼스 창구는 store 문서만
  //   주고, file 근거는 빌더가 저장소 파일을 직접 잘라 쓴다(실측: 색인 6,011조각 중 1,749가 file 쪽이다).
  const 원천글 = (코퍼스조각들 ?? []).map((c) => 창정규화(c.text));
  const 파일읽음 = [];
  if (코퍼스조각들) {
    for (const rel of 파일근거) {
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) continue;   // 저장소 밖은 안 읽는다
      try { 원천글.push(창정규화(fs.readFileSync(abs, "utf8"))); 파일읽음.push(rel); }
      catch { /* 못 읽은 파일은 아래 셈에 안 든다 — 「읽은 수」로 드러난다 */ }
    }
  }
  const 원천본문 = 원천글.join(" ");
  const onlyC = [...C창.keys()]
    .filter((h) => !owin.has(h) && !(코퍼스조각들 && 원천본문.includes(C창.get(h))))
    .sort();
  const cwin = { size: C창.size }, 코퍼스창 = { size: 원천본문.length, 파일: 파일읽음.length };
  const 주제 = {};
  for (const l of 문답들) 주제[l.topic ?? "(없음)"] = (주제[l.topic ?? "(없음)"] ?? 0) + 1;
  return {
    셈, 등급셈, 주제, 문답들,
    창: {
      cdocs: C본문.length, cwin: cwin.size, owin: owin.size, 원천글자: 코퍼스창.size, 원천파일: 코퍼스창.파일,
      코퍼스뺌: Boolean(코퍼스조각들), onlyC: onlyC.length, 생성걸음: 창생성걸음, windows: onlyC,
    },
  };
}

// ── ③ bake — 재료 굽기 ────────────────────────────────────────────────

/** 결정적 순서 — 같은 입력이면 같은 판이라야 「이 판으로 구웠다」가 뜻을 갖는다(무작위 금지). */
export const 순서키 = (s) => crypto.createHash("sha1").update(String(s), "utf8").digest("hex");

/**
 * 근거 색인 — store 조각은 코퍼스 창구가 준 것, file 조각은 저장소 파일을 **같은 규칙으로** 다시 잘라서.
 * ⚠ 자르는 규칙이 한 글자라도 다르면 해시가 안 맞아 회수율이 0이 되는데 **오류는 안 난다** — 그래서
 *   chunk()를 여기서 다시 적지 않고 빌더의 그 함수를 부른다.
 */
export function 색인만들기(코퍼스조각들, 필요파일들, root = 저장소) {
  const 색인 = new Map();
  for (const c of 코퍼스조각들 ?? []) 색인.set(c.ref, { ref: c.ref, text: c.text, 문서: c.documentId, category: c.category ?? null });
  const 파일 = { 지목: 0, 읽음: 0, 없음: [] };
  for (const rel of 필요파일들) {
    파일.지목 += 1;
    const abs = path.resolve(root, rel);
    // 저장소 밖은 읽지 않는다 — ref는 DB에서 온 값이라 신뢰 입력이 아니다.
    if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) { 파일.없음.push(rel); continue; }
    파일.읽음 += 1;
    for (const t of chunk(fs.readFileSync(abs, "utf8"))) {
      const ref = `${rel}#${sha12(t)}`;
      if (!색인.has(ref)) 색인.set(ref, { ref, text: t, 문서: rel, category: null });
    }
  }
  return { 색인, 파일 };
}

/**
 * 홀드아웃 후보를 **질문 뭉치**로 묶고 결정적 차례를 매긴다.
 * ★ 왜 뭉치로: 반쪽을 떼면 같은 질문이 양쪽에 남아 「외웠나」를 재게 된다.
 */
export function 질문뭉치(문답들, { 주제 = "취약점" } = {}) {
  const 후보 = 문답들.filter((l) => (l.topic ?? "") === 주제 && (l.cites ?? []).length);
  const 뭉치 = new Map();
  for (const l of 후보) {
    const k = 문항정규화(l.question);
    if (!뭉치.has(k)) 뭉치.set(k, []);
    뭉치.get(k).push(l);
  }
  const 차례 = [...뭉치.keys()].sort((a, b) => (순서키(a) < 순서키(b) ? -1 : 1));
  return { 후보, 뭉치, 차례 };
}

/**
 * 홀드아웃을 **맨 먼저** 뗀다 — 질문 뭉치를 통째로, 결정적 차례대로.
 * ★ 왜 먼저: 재료를 구운 **뒤에** 떼면 「무엇이 시험지고 무엇이 재료였나」가 굽기 인자에 따라 흔들린다.
 * ⚠ 목표는 **문답 수**가 아니라 **구운 행 수**로 세어야 한다 — 문답 하나가 라이선스·회수 실패·인용 없음으로
 *   버려지면 행이 안 나오기 때문이다(실측: 문답 99건을 떼었는데 행은 43행이었다). 그래서 이 함수는
 *   「몇 뭉치를 뗄지」만 받고, 몇 행이 나오는지는 부르는 쪽이 **구워 보고** 정한다.
 */
export function 홀드아웃뗀다(문답들, { 주제 = "취약점", 뗄질문 = null, 목표 = 100 } = {}) {
  const { 후보, 뭉치, 차례 } = 질문뭉치(문답들, { 주제 });
  let 뗀질문 = 뗄질문;
  if (!뗀질문) {
    뗀질문 = new Set();
    let 센수 = 0;
    for (const k of 차례) {
      if (센수 >= 목표) break;
      뗀질문.add(k);
      센수 += 뭉치.get(k).length;
    }
  }
  const 뗀문답 = 후보.filter((l) => 뗀질문.has(문항정규화(l.question)));
  const 남은 = 문답들.filter((l) => !뗀질문.has(문항정규화(l.question)));
  return {
    뗀문답, 남은, 뗀질문, 차례, 뭉치,
    보고: { 주제, 목표, 후보: 후보.length, 질문뭉치: 뭉치.size, 뗀질문: 뗀질문.size, 뗀문답: 뗀문답.length },
  };
}

/**
 * 절 제목 — 승인 문답의 **질문에서** 짓는다(새 글을 짓지 않는다).
 * 물음꼴 어미를 떼고 30자로 줄인다. 벤치 채점기의 6절과 겹치면 그 행은 아래에서 버린다.
 */
export function 절제목(question) {
  let t = String(question ?? "").trim()
    .replace(/^\s*[-–—]\s*/, "")
    .replace(/[?？]\s*$/, "")
    .replace(/(무엇인가요|무엇입니까|어떻게 하나요|어떻게 해야 하나요|알려\s*줘|설명해\s*줘|무엇인가|인가요|입니까|나요|까요|가요)\s*$/u, "")
    .replace(/\s+/g, " ").trim();
  if (t.length > 30) {
    // 30자에서 그냥 자르면 「… 피해자와 어떻게」처럼 말이 끊긴 제목이 남는다 — 재료가 가르치는 것은
    // 절 제목의 **꼴**이기도 하므로, 마지막 띄어쓰기에서 끊고 홀로 남은 의문사는 뗀다.
    const 잘린 = t.slice(0, 30);
    const 빈칸 = 잘린.lastIndexOf(" ");
    t = (빈칸 > 10 ? 잘린.slice(0, 빈칸) : 잘린).trim();
  }
  t = t.replace(/s*(어떻게|무엇을|무엇이|왜|어떤|얼마나|언제|어디서|누가)$/u, "").trim();
  return t || "관련 항목";
}

/** 벤치 채점기의 절 이름 세트 — 재료에 쓰지 않는다(시험을 답에 맞추면 점수만 오른다). */
export const 금지절 = [
  ["제목", "대상 자산", "위험 요약", "조치 방법", "조치 기한", "담당 부서"],
  ["제목", "대상 자산", "취약점 요약", "조치 방법", "조치 기한", "담당"],
];

/** 그 답이 금지 절 세트를 통째로 쓰고 있나(여섯이 전부 줄 머리에 서면 탈락 — 낱말 하나는 허용). */
export function 금지절썼나(answer) {
  const 머리 = new Set((String(answer ?? "").match(/^\s*#{1,3}\s*(.+)$/gm) ?? []).map((s) => s.replace(/^\s*#{1,3}\s*/, "").trim()));
  return 금지절.some((세트) => 세트.every((n) => 머리.has(n)));
}

/**
 * 긴 형식(D갈래) 행 — **교사를 부르지 않는다.**
 *
 * ★ 정직하게 무엇인가: 이 행은 새로 지은 글이 아니라 **같은 근거 조각을 인용해 이미 승인된 답 여럿을
 *   절로 세워 모은 것**이다. 문장은 전부 승인된(등급 O) 답에서 그대로 왔고, 근거 블록도 그 조각이다.
 * ★ 왜 이렇게 하나: 오늘은 gb10 GPU를 안 쓴다(원격 팀원 셋이 교사를 쓴다). 회전 2의 긴 형식(v1·v2)은
 *   교사가 지은 글이라 질문이 승인 문답에 없어 **등급이 「미매칭」**이고, 미매칭은 O가 아니다(§12.14).
 *   그래서 「O에서 나온 긴 글」을 만들 길은 지금 이것 하나뿐이다.
 * ⚠ 한계도 적는다 — 절 이름이 **제품 서식(요청서 7절·요약 보고 5절)이 아니다.** 제품 서식 판이
 *   필요하면 그것은 교사가 있는 밤에 굽는다(§12.9 ⑤의 그 일). 이 판이 가르치는 것은 「길게·절을 나눠·
 *   근거에서 인용하며」이지 「조치 요청서 서식」이 아니다.
 */
export function 긴형식짓기(문답들, 색인, {
  팀원프롬프트, ragHeader, 최소묶음 = 4, 최소절 = 3, 최소글자 = 700, 목표행 = 100, 씨앗 = "", 판정,
  distractors = 1, maxQuoteChars = 160, maxQuoteShare = 0.35, 시험 = new Set(),
} = {}) {
  const 통계 = {
    조각묶음: 0, 후보묶음: 0,
    제외: { "근거 회수 실패": 0, 라이선스: 0, "절이 모자람": 0, 짧음: 0, "시험 문항": 0, "금지 절": 0, "인용 없음": 0, "방해 없음": 0 },
  };
  // 같은 근거 조각을 인용한 문답끼리 묶는다 — 한 조각을 여러 각도에서 설명한 승인 답들이다.
  const 묶음 = new Map();
  for (const l of 문답들) {
    for (const ref of l.cites ?? []) {
      if (!묶음.has(ref)) 묶음.set(ref, []);
      묶음.get(ref).push(l);
    }
  }
  통계.조각묶음 = 묶음.size;
  const 후보풀 = [...색인.values()].filter((c) => !판정(c.문서));
  const 차례 = [...묶음.keys()].filter((ref) => 묶음.get(ref).length >= 최소묶음).sort((a, b) => (순서키(a) < 순서키(b) ? -1 : 1));
  통계.후보묶음 = 차례.length;
  const rows = [];
  for (const ref of 차례) {
    if (rows.length >= 목표행) break;
    const 조각 = 색인.get(ref);
    if (!조각) { 통계.제외["근거 회수 실패"] += 1; continue; }
    if (판정(조각.문서)) { 통계.제외.라이선스 += 1; continue; }
    // 결정적 순서로 세운다(답이 긴 순서로 세우면 같은 입력에서도 판이 갈릴 수 있다).
    const 식구 = 묶음.get(ref).slice().sort((a, b) => (순서키(a.id) < 순서키(b.id) ? -1 : 1));
    const 절들 = [];
    const 쓴제목 = new Set();
    for (const l of 식구) {
      const 제목 = 절제목(l.question);
      if (쓴제목.has(제목)) continue;                  // 같은 제목 두 번이면 절이 아니라 반복이다
      쓴제목.add(제목);
      절들.push(`## ${제목}\n${String(l.answer ?? "").trim()}`);
    }
    if (절들.length < 최소절) { 통계.제외["절이 모자람"] += 1; continue; }
    const 앵커 = 식구[0];
    const question = `${String(앵커.question).trim()} 같은 자료에서 이어지는 항목들까지 절을 나눠 함께 정리해 줘.`;
    if (시험.has(문항정규화(question))) { 통계.제외["시험 문항"] += 1; continue; }
    let answer = 절들.join("\n\n");
    if (창정규화(answer).length < 최소글자) { 통계.제외.짧음 += 1; continue; }
    if (금지절썼나(answer)) { 통계.제외["금지 절"] += 1; continue; }
    // 근거 블록 — A행과 **같은 조립기**로 만든다(학습 꼴과 추론 꼴이 갈리지 않게).
    const 방해 = 방해조각고르기([조각], 후보풀, distractors, 씨앗);
    if (distractors > 0 && !방해.length) { 통계.제외["방해 없음"] += 1; continue; }
    const 조각들 = 섞기([조각.text, ...방해.map((c) => c.text)], 씨앗 + ref);
    const 제목들 = 제목맞추기(조각들, [조각, ...방해]);
    const 결과 = 인용붙이기(answer, [조각.text], {
      꼴: "product", 블록조각들: 조각들, 인용상한자: maxQuoteChars, 인용비중상한: maxQuoteShare,
    });
    if (!결과.answer) { 통계.제외["인용 없음"] += 1; continue; }
    // ⚠ 인용붙이기는 답을 **문장 단위로 다시 흘린다** — 그래서 절 사이의 빈 줄이 사라지고 「## 제목」이
    //   줄 가운데로 밀린다(실측 2026-09-10: 111행 중 47행이 그렇게 절 하나짜리 글이 됐다. 짝 시험이 잡았다).
    //   이 갈래가 가르치려는 것이 **절을 나눈 꼴**이라, 줄 머리를 되돌린다. 인용 자체는 손대지 않는다.
    answer = 결과.answer.replace(/\s*##\s+/g, "\n\n## ").trim();
    rows.push({
      question, answer,
      system: [팀원프롬프트, 참고자료블록(ragHeader, 조각들, 제목들)].join("\n\n"),
      grade: "O",
      meta: { kind: "approved-digest", chunkRef: ref, 문서: 조각.문서, 절: 절들.length, 문답: 식구.map((l) => l.id) },
    });
  }
  return { rows, 통계 };
}

/**
 * 재료 한 판 굽기 — 레시피는 회전 4 그대로(§12.12: 바꾸는 변수는 학습 설정 둘뿐이다).
 * pOracle만 밖에서 받는다(아래 거절비율맞추기가 이 값을 움직여 거절 비율을 회전 2~4 범위에 맞춘다).
 */
export function 한판굽기(문답들, 색인, { pOracle, 팀원프롬프트, ragHeader, 판정, 씨앗, 시험, 레시피 }) {
  return 행만들기(문답들, 색인, {
    판정, system: 팀원프롬프트, ragHeader, 씨앗, 시험,
    distractors: 레시피.distractors, pOracle,
    noEvidenceFromUncited: 레시피.noevidenceFromUncited, closedbookRatio: 레시피.closedbookRatio,
    quoteRule: 레시피.quoteRule, distractorAllowlist: true,
    quoteStyle: 레시피.quoteStyle, maxQuoteChars: 레시피.maxQuoteChars, maxQuoteShare: 레시피.maxQuoteShare,
    maxCopyRatio: 레시피.maxCopyRatio, refusalStyle: 레시피.refusalStyle, noblockRatio: 레시피.noblockRatio,
  });
}

/** 한국어 원천 비중 맞추기 — 영어 원천 행을 **결정적 순서의 끝에서부터** 덜어 낸다(r5와 같은 규칙). */
export function 언어맞추기(rows, { 머리말, 목표한글 = 0.5 }) {
  const 딱지 = rows.map((r) => ({ r, 언어: 원천언어(r, 머리말).언어, 키: 순서키(r.question + "|" + r.answer) }));
  const ko = 딱지.filter((x) => x.언어 === "ko"), en = 딱지.filter((x) => x.언어 === "en");
  let 남길en = en.length;
  if (딱지.length && ko.length / 딱지.length < 목표한글) 남길en = Math.max(0, Math.floor((ko.length * (1 - 목표한글)) / 목표한글));
  en.sort((a, b) => (a.키 < b.키 ? -1 : 1));
  const 고른 = new Set([...ko, ...en.slice(0, 남길en)].map((x) => x.r));
  return {
    rows: rows.filter((r) => 고른.has(r)),
    보고: { ko: ko.length, en: en.length, 덜어낸영어: en.length - 남길en, 목표: 목표한글 },
  };
}

/**
 * 거절 비율 맞추기 — pOracle을 **이분 탐색**해 「거절로 시작하는 행」 비중을 목표 띠 안에 넣는다.
 *
 * ★ 왜 이 손잡이인가: 거절 행(ⓑ·ⓑ′·Ⓝ)은 「정답 조각을 안 싣기로 한 행」에서 나온다. 그 결정은
 *   행마다 결정값(씨앗+id) < pOracle 하나로 갈리므로, 거절 비중은 pOracle에 대해 **단조**다 —
 *   탐색이 성립하고, 같은 입력이면 같은 값이 나온다(무작위 아님).
 * ★ 왜 띠를 맞추나(§12.13 ③): 회전 4 재료의 거절 시작은 44.5%였는데 등급으로 거르면 87.1%가 됐다.
 *   재료의 성격이 통째로 바뀌면 「설정을 바꿔 나아졌나」를 못 가른다 — 옛 회전과 **같은 성격**의
 *   재료를 만들어야 변수가 둘로 남는다.
 * ⚠ 띠 안에 못 넣으면 **가장 가까운 값**을 쓰고 그 사실을 보고서에 적는다(맞춘 척하지 않는다).
 */
export function 거절비율맞추기(굽기, { 띠 = [0.40, 0.50], 반복 = 24, 시작 = 0.8 } = {}) {
  const 재기 = (p) => {
    const 판 = 굽기(p);
    const 비 = 판.rows.length ? 판.rows.filter(거절로시작하나).length / 판.rows.length : 0;
    return { p, 비, 판 };
  };
  const [lo, hi] = 띠;
  const 목표 = (lo + hi) / 2;
  let a = 0.02, b = 0.995;                        // 낮은 pOracle = 거절 많음 · 높은 pOracle = 거절 적음
  let 최선 = 재기(시작);                            // 회전 4의 값에서 시작한다(띠 안이면 그대로 쓴다)
  const 이력 = [{ p: 최선.p, 비: 최선.비 }];
  if (최선.비 >= lo && 최선.비 <= hi) return { ...최선, 이력, 띠, 띠안: true };
  for (let i = 0; i < 반복; i += 1) {
    const p = (a + b) / 2;
    const r = 재기(p);
    이력.push({ p: r.p, 비: r.비 });
    if (Math.abs(r.비 - 목표) < Math.abs(최선.비 - 목표)) 최선 = r;
    if (r.비 >= lo && r.비 <= hi) return { ...r, 이력, 띠, 띠안: true };
    if (r.비 > hi) a = p; else b = p;              // 거절이 너무 많다 → pOracle을 올린다
  }
  return { ...최선, 이력, 띠, 띠안: false };
}

/**
 * 표본 문항(관문 ⑬·⑭의 모집단) 만들기 — **홀드아웃 문답에서** 고른다.
 * ★ 왜 홀드아웃에서: 재료에 든 질문으로 재면 「외웠나」를 재게 된다. ⑬·⑭는 「배운 것이 옮겨붙었나」를
 *   재는 자리라, 모집단은 **학습에 안 실린 질문**이라야 한다.
 * ★ 회수는 **실측**한다 — cites가 있어도 색인에 없으면 그 문항은 안 싣는다(회수="성공"만 나간다).
 */
export function 표본문항짓기(홀드아웃문답들, 색인, { 목표 = 24, 씨앗 = "", 판정 } = {}) {
  const 후보풀 = [...색인.values()].filter((c) => !판정(c.문서));
  const 차례 = 홀드아웃문답들.slice().sort((a, b) => (순서키(a.id) < 순서키(b.id) ? -1 : 1));
  const out = [];
  const 통계 = { 후보: 차례.length, "회수 실패": 0, 라이선스: 0, "방해 없음": 0 };
  for (const l of 차례) {
    if (out.length >= 목표) break;
    const ref = (l.cites ?? [])[0];
    const 조각 = ref ? 색인.get(ref) : null;
    if (!조각) { 통계["회수 실패"] += 1; continue; }
    if (판정(조각.문서)) { 통계.라이선스 += 1; continue; }
    const 방해 = 방해조각고르기([조각], 후보풀, 1, 씨앗);
    if (!방해.length) { 통계["방해 없음"] += 1; continue; }
    out.push({
      question: l.question, answer: l.answer, cites: [ref],
      origin: l.origin ?? "distill", teacher: l.teacher ?? null,
      chunk: 조각.text, chunkRef: ref,
      distractor: 방해[0].text, distractorRef: 방해[0].ref,
      회수: "성공", 출처: "holdout-vuln-o",
    });
  }
  return { 문항: out, 통계 };
}

/**
 * 관문에 걸린 행을 **본문 없이** 들여다본다 — 어디가 걸렸나(근거 블록인가 답인가)와 그 행이 인용한
 * 문서 제목만 적는다. ★ 왜 본문을 안 찍나: 걸린 글은 「C일 수도 있는 글」이다. 진단하겠다고 그것을
 * 화면·기록에 찍으면, 막으려던 그 일을 진단이 대신 한다.
 */
export function 걸린행살피기(rows, 창집합, 자리들) {
  return 자리들.map((i) => {
    const r = rows[i] ?? {};
    const 제목 = [...String(r.system ?? "").matchAll(/《([^》]+)》/g)].map((m) => m[1]);
    return {
      자리: i,
      근거블록적중: 창적중수(r.system, 창집합),
      답적중: 창적중수(r.answer, 창집합),
      인용문서: 제목,
      답글자: String(r.answer ?? "").length,
    };
  });
}

/** 사람이 읽는 구성 표 — 「무엇을 왜 뺐나」가 한 장에 보여야 한다. */
export function 구성표(보고) {
  const 줄 = (k, v) => `| ${k} | ${v} |`;
  const 재 = 보고.재료;
  return [
    "| 칸 | 값 |", "|---|---|",
    줄("승인 문답(등급 O)", `${보고.원천.O} / 승인 ${보고.원천.승인} (C ${보고.원천.등급셈.C ?? 0} · ? ${보고.원천.등급셈["?"] ?? 0})`),
    줄("홀드아웃(맨 먼저 뗌)", `${보고.홀드아웃.행}행 · 질문 ${보고.홀드아웃.질문} · 주제 ${보고.홀드아웃.주제}`),
    줄("긴 형식", `${보고.긴형식.행}행 (근거 조각 묶음 ${보고.긴형식.후보묶음}개 중)`),
    줄("v6 재료 행", `${재.행} (한국어 원천 ${재.한국어원천} · ${(재.한국어비중 * 100).toFixed(1)}%)`),
    줄("거절로 시작하는 행", `${재.거절시작} (${(재.거절비중 * 100).toFixed(1)}%) · 목표 띠 ${(보고.거절띠[0] * 100).toFixed(0)}~${(보고.거절띠[1] * 100).toFixed(0)}% · ${보고.띠안 ? "들어감" : "**못 맞춤**"}`),
    줄("pOracle(띠를 맞추느라 움직인 값)", `${보고.pOracle.toFixed(4)} (회전 4는 0.8)`),
    줄("사실 주장 행(27B 되묻기 대상)", 재.사실주장),
    줄("표본 문항(관문 ⑬·⑭ 모집단)", `${보고.표본.행} (목표 ${보고.표본.목표})`),
    줄("주제 구성(O 문답)", Object.entries(보고.원천.주제).map(([k, v]) => `${k} ${v}`).join(" · ")),
    "",
    "⚠ **v6는 주제가 다섯이다** — v1~v5는 취약점 한 주제였다. 회전 5의 목적이 「원격 없는 설치본의 14B 바닥 올리기」로",
    "바뀌었으므로(§12.12) 주제를 좁히지 않았다. 그래서 **회전 4와 주제 구성이 다르다** — 표를 나란히 읽을 때 이 칸을 함께 본다.",
    "⚠ **홀드아웃은 새 시험지다** — 회전 4 이전의 eval_loss와 **견줄 수 없다**(시험지가 다르면 손실 값은 다른 것을 뜻한다).",
  ].join("\n");
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("material-v6.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const MODE = String(opt("--mode", "")).trim();
  const OUT = String(opt("--out-dir", "")).trim();
  if (!MODE || !OUT) {
    console.error("쓰는 법: node tools/team-bench/material-v6.mjs --mode <dump|corpus|bake> --out-dir <dir> [...]");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const 쓰기 = (이름, 값) => { const p = path.join(OUT, 이름); fs.writeFileSync(p, JSON.stringify(값, null, 2)); return p; };
  const 읽기 = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const 지문 = (p) => (p && fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16) : null);

  if (MODE === "dump") {
    const DB = String(opt("--db", "/home/gijo/gijo-as/server/data/gijo-as.sqlite"));
    const { createRequire } = await import("node:module");
    // ⚠ better-sqlite3는 **운영 서버의 것**을 쓴다(win에는 리눅스용 native가 없다). 쓰기 옵션은 안 준다.
    const require = createRequire(String(opt("--require-base", "/home/gijo/gijo-as/server/package.json")));
    // 코퍼스를 함께 주면 **공개 원천 창을 뺀 좁은 C 집합**이 나온다(위 뽑기() ②의 그 자리).
    const cpP0 = String(opt("--corpus", path.join(OUT, "corpus.json")));
    const 코퍼스조각들 = fs.existsSync(cpP0) ? (읽기(cpP0).chunks ?? []) : null;
    if (!코퍼스조각들) console.error(`⚠ 코퍼스가 없어 공개 원천 창을 못 뺀다(${cpP0}) — 이 집합으로 재면 정상 O 행이 거짓 빨강으로 찍힌다. 먼저 --mode corpus 를 돌려라.`);
    let db;
    try { const Database = require("better-sqlite3"); db = new Database(DB, { readonly: true, fileMustExist: true }); }
    catch (e) { console.error(`✗ 운영 DB를 못 열었다(읽기 전용): ${DB} — ${e.message}`); process.exit(3); }
    const r = 뽑기(db, { 코퍼스조각들 });
    db.close();
    const qaP = 쓰기("o-qa.json", { 만든때: new Date().toISOString(), 셈: r.셈, 등급셈: r.등급셈, 주제: r.주제, 문답: r.문답들 });
    const cwP = 쓰기("cwin.json", r.창);
    쓰기("counts.json", { 때: new Date().toISOString(), ...r.셈, 등급셈: r.등급셈 });
    console.log(`[dump] 승인 ${r.셈["chat_logs rating=1"]} · 등급 ${JSON.stringify(r.등급셈)} · O ${r.문답들.length}행`);
    console.log(`[dump] C 창 ${r.창.cwin} · O 창 ${r.창.owin} · 원천 ${r.창.원천글자}자(파일 ${r.창.원천파일} · 뺌 ${r.창.코퍼스뺌}) · C에만 ${r.창.onlyC}(생성걸음 ${r.창.생성걸음})`);
    console.log(`[dump] ${qaP} (${지문(qaP)}) · ${cwP} (${지문(cwP)})`);
    process.exit(0);
  }

  if (MODE === "corpus") {
    const SERVER = String(opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
    const AGENT = String(opt("--agent", "normaltic"));
    const user = process.env.GIJO_ADMIN_USER, password = process.env.GIJO_ADMIN_PASSWORD;
    if (!user || !password) { console.error("✗ GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 가 필요하다(창구 둘 다 admin)"); process.exit(3); }
    // ⚠ 계정당 1세션이다 — **밀어내지 않는다**(--force-login 없음). 그리고 끝나는 자리에서 반드시 닫는다.
    let 세션 = null;
    const 로그아웃 = async () => {
      if (!세션) return;
      const s = 세션; 세션 = null;
      // ⚠ **못 돌려준 것을 「완료」라 적지 않는다**(2026-09-10 저녁 · 검토관 적발). 앞선 판은 실패를
      //   삼키고도(catch) 무조건 완료를 찍었다 — 계정당 1세션이라 반납이 실패하면 다음 사람이 막히는데
      //   로그에는 반납된 것처럼 남는다. audit_log에 login/logout 기록이 없어 이 줄 말고 확인할 길도 없다.
      const 답 = await fetch(s.server + "/api/auth/logout", {
        method: "POST", headers: s.auth, redirect: "error", body: JSON.stringify({ refreshToken: s.refreshToken }),
      }).then((res) => ({ ok: res.ok, 상태: String(res.status) }), (e) => ({ ok: false, 상태: e.message }));
      if (답.ok) console.log("[corpus] 세션 반납(logout) 완료");
      else console.error("⚠ [corpus] 세션 반납 **실패**(" + 답.상태 + ") — 이 계정은 아직 로그인 상태일 수 있다. 다음 작업 전에 사람이 확인해라");
    };
    try {
      const lr = await fetch(SERVER + "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
        body: JSON.stringify({ username: user, password }),
      });
      const lj = await lr.json();
      if (!lj.accessToken) throw new Error("로그인 실패(계정당 1세션 — 밀어내지 않는다): " + JSON.stringify(lj).slice(0, 120));
      const auth = { "Content-Type": "application/json", Authorization: "Bearer " + lj.accessToken };
      세션 = { server: SERVER, auth, refreshToken: lj.refreshToken };
      const pr = await fetch(SERVER + `/api/learnloop/raft/prompt?agentId=${encodeURIComponent(AGENT)}`, { headers: auth, redirect: "error" });
      const prompt = await pr.json();
      if (!pr.ok || !prompt.ragBlockSample) throw new Error("근거 꼴 창구가 ragBlockSample을 안 준다 — 대조 없이 구우면 학습 꼴과 추론 꼴이 갈려도 아무도 모른다");
      const cr = await fetch(SERVER + "/api/learnloop/distill/corpus", {
        method: "POST", headers: auth, redirect: "error",
        body: JSON.stringify({ maxChunks: 20000, maxPerDoc: 2000 }),
      });
      const corpus = await cr.json();
      if (!cr.ok) throw new Error(`코퍼스 창구 ${cr.status}: ${JSON.stringify(corpus).slice(0, 200)}`);
      const p = 쓰기("corpus.json", {
        만든때: new Date().toISOString(), server: SERVER, agent: AGENT,
        docs: corpus.docs, skipped: corpus.skipped, chunks: corpus.chunks ?? [],
        prompt: { system: prompt.system, ragHeader: prompt.ragHeader, ragBlockSample: prompt.ragBlockSample },
      });
      console.log(`[corpus] 문서 ${corpus.docs} · 조각 ${(corpus.chunks ?? []).length} · 거름 ${JSON.stringify(corpus.skipped)}`);
      console.log(`[corpus] ${p} (${지문(p)})`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      await 로그아웃();
      process.exit(3);
    }
    await 로그아웃();
    process.exit(0);
  }

  if (MODE !== "bake") { console.error(`✗ 모르는 모드: ${MODE}`); process.exit(2); }

  // ── bake ────────────────────────────────────────────────────────────
  const qaP = String(opt("--qa", path.join(OUT, "o-qa.json")));
  const cpP = String(opt("--corpus", path.join(OUT, "corpus.json")));
  const cwP = String(opt("--cwin", path.join(OUT, "cwin.json")));
  const specP = String(opt("--prompt-spec", path.join(여기, "prompt-spec.json")));
  for (const p of [qaP, cpP, cwP]) if (!fs.existsSync(p)) { console.error(`✗ 원천이 없다: ${p} — 먼저 --mode dump / --mode corpus 를 돌려라`); process.exit(3); }
  const qa = 읽기(qaP), cp = 읽기(cpP);
  const 창파일 = 읽기(cwP);
  // ⚠ 공개 원천 창을 안 뺀 집합으로는 재지 않는다 — 그 집합은 정상 O 행을 C로 찍는다(뽑기() ② 참조).
  //   「못 잰 것」을 초록으로 세지 않듯, **틀리게 잰 것**도 판정으로 세지 않는다.
  if (!창파일.코퍼스뺌) { console.error(`✗ ${cwP} 는 공개 원천 창을 안 뺀 집합이다 — --mode corpus 뒤에 --mode dump 를 다시 돌려라`); process.exit(3); }
  const 창집합 = new Set(창파일.windows);
  const 규격 = 규격읽기(specP);
  // 창구가 준 머리말과 저장소 규격이 어긋나면 **여기서 멈춘다** — 학습 꼴과 추론 꼴이 갈리면 오류 없이 모델만 나빠진다.
  if (cp.prompt?.ragHeader && cp.prompt.ragHeader !== 규격.ragHeader) {
    console.error("✗ 코퍼스 회차의 ragHeader가 저장소 규격과 다르다 — tools/ladder/export-prompt-spec.mjs 로 다시 뽑아라");
    process.exit(3);
  }
  const 팀원프롬프트 = cp.prompt?.system || 규격.system;
  const ragHeader = 규격.ragHeader;

  const 레시피 = {                                   // 회전 4(r5a round.json) 그대로 — pOracle만 아래에서 움직인다
    distractors: 2, quoteRule: "strict", quoteStyle: "product", maxQuoteChars: 160, maxQuoteShare: 0.35,
    maxCopyRatio: 0.6, refusalStyle: "by-kind", noblockRatio: 0.1, noevidenceFromUncited: true, closedbookRatio: 0,
  };
  const 씨앗 = sha12("raft-vuln-v6|전주제");
  const 시험 = 시험문항목록();
  // ★ 표본 하네스의 문항도 **재료에서 뺀다**(2026-09-10 실측: 옛 표본 12개 중 3개가 v6 재료에 들어 있었다).
  //   관문 ⑬·⑭는 「배운 것이 옮겨붙었나」를 재는 자리인데, 그 문항이 재료에 있으면 재는 것이 **외웠나**가 된다.
  //   ⚠ 시험문항목록()은 build-raft-dataset.mjs 것이고 samples-questions.json은 그 목록에 없다 —
  //     목록을 저쪽에서 고치는 대신 **부르는 자리에서 합친다**(잣대는 그대로 한 곳, 범위만 넓힌다).
  //   ⚠ 홀드아웃 굽기에는 이 합집합을 **안 쓴다**. 새 표본은 홀드아웃에서 뽑으므로, 여기에 걸면
  //     시험지가 제 문항을 스스로 지운다.
  const 표본파일 = String(opt("--samples-in", path.join(여기, "samples-questions.json")));
  const 표본질문 = fs.existsSync(표본파일)
    ? new Set(읽기(표본파일).map((x) => 문항정규화(x.question)).filter(Boolean))
    : new Set();
  const 시험재료 = new Set([...시험, ...표본질문]);
  const 판정기 = await 라이선스판정기();

  // ① 색인 — 홀드아웃과 남은 문답 **둘 다**의 근거가 필요하다(홀드아웃 행도 근거 블록을 실어야 한다)
  const 파일필요 = new Set();
  for (const l of qa.문답) for (const ref of l.cites ?? []) { const p = refParse(ref); if (p?.kind === "file") 파일필요.add(p.id); }
  const { 색인, 파일 } = 색인만들기(cp.chunks, 파일필요);

  // ② 홀드아웃을 맨 먼저 뗀다 — **구운 행 수**로 목표를 센다(문답 수로 세면 라이선스·회수 실패만큼 모자란다)
  const HOLD_N = Number(opt("--holdout-n", "100"));
  const HOLD_TOPIC = String(opt("--holdout-topic", "취약점"));
  const 홀드레시피 = { ...레시피, noblockRatio: 0, noevidenceFromUncited: false };
  const 홀드굽기 = (문답들) => 한판굽기(문답들, 색인, {
    pOracle: 1, 팀원프롬프트, ragHeader, 판정: 판정기.판정, 씨앗: 씨앗 + "|holdout", 시험, 레시피: 홀드레시피,
  });
  const { 뭉치: 홀드뭉치, 차례: 홀드차례 } = 질문뭉치(qa.문답, { 주제: HOLD_TOPIC });
  // 뭉치를 차례대로 **하나씩** 더해 가며 굽고, 구운 행이 목표에 닿는 순간 멈춘다.
  // 그래서 시험지에 들어간 질문 = 재료에서 빠진 질문이고, 그 사이에 「뽑았지만 안 쓴 질문」이 안 생긴다.
  const 뗀질문 = new Set();
  let 홀드행 = [], 홀드판 = { rows: [], 통계: { 제외: {} } }, 홀드회차 = 0;
  for (const k of 홀드차례) {
    뗀질문.add(k);
    const 이번 = (홀드뭉치.get(k) ?? []).length;
    if (홀드행.length + 이번 < HOLD_N && 뗀질문.size % 5 !== 0) continue;   // 다섯 뭉치마다(또는 닿을 때) 굽는다
    홀드회차 += 1;
    홀드판 = 홀드굽기(qa.문답.filter((l) => 뗀질문.has(문항정규화(l.question))));
    // ⚠ 시험지도 인용을 잰다 — 근거가 반대말을 하는 행이 **기준선**이 되면 그 숫자가 뜻을 잃는다
    //   (실측 2026-09-10: 첫 판 100행 중 2행이 그런 행이었다 — 「knownRansomwareCampaignUse: Known」인데
    //   그 번호의 블록은 Unknown이었다).
    홀드행 = 인용걸러내기(창걸러내기(홀드판.rows.map((r) => ({ ...r, grade: "O" })), 창집합).rows).rows;
    if (홀드행.length >= HOLD_N) break;
  }
  // ★ 행 하나도 못 낸 뭉치는 **재료로 돌려보낸다.** 시험지에 안 실린 질문을 재료에서까지 빼면
  //   시험이 새는 것도 아닌데 재료만 얇아진다(실측: 뽑은 260 뭉치 중 행을 낸 것은 그 일부다).
  //   질문은 여전히 **뭉치째** 갈린다 — 반쪽이 양쪽에 남는 일은 없다.
  const 기여한질문 = new Set(홀드행.map((r) => 문항정규화(r.question)));
  const 되돌린뭉치 = 뗀질문.size - 기여한질문.size;
  const 홀드 = 홀드아웃뗀다(qa.문답, { 주제: HOLD_TOPIC, 뗄질문: 기여한질문, 목표: HOLD_N });

  // ④ 긴 형식 — 홀드아웃 **밖에서**
  const 긴 = 긴형식짓기(홀드.남은, 색인, {
    팀원프롬프트, ragHeader, 씨앗: 씨앗 + "|longform", 판정: 판정기.판정, 시험: 시험재료,
    목표행: Number(opt("--longform-n", "160")), 최소묶음: Number(opt("--longform-group", "3")),
    최소글자: Number(opt("--longform-chars", "450")),
  });

  // ⑤ v6 재료 — 거절 비율 띠를 맞추며 굽는다
  const 띠 = String(opt("--refusal-band", "0.40,0.50")).split(",").map(Number);
  const 목표한글 = Number(opt("--min-hangul", "0.5"));
  const 굽기 = (p) => {
    const 판 = 한판굽기(홀드.남은, 색인, { pOracle: p, 팀원프롬프트, ragHeader, 판정: 판정기.판정, 씨앗, 시험: 시험재료, 레시피 });
    const 딱지 = 판.rows.map((r) => ({ ...r, grade: "O" }));
    // ★ 창에 걸린 행을 **언어를 맞추기 전에** 뺀다. 순서가 뒤바뀌면 한국어 비중을 50%로 맞춰 놓고
    //   그 뒤에 한국어 행이 빠져 **49.5%로 끝난다**(실측). 「≥50%」라 적어 놓고 밑돌면 그 줄이 거짓이 된다.
    const { rows: 걸른판, 지운: 창지움 } = 창걸러내기(딱지, 창집합);
    const { rows: 인용판, 지운: 인용지움 } = 인용걸러내기(걸른판);
    const { rows, 보고: 언어보고 } = 언어맞추기(인용판, { 머리말: ragHeader, 목표한글 });
    return { rows, 통계: 판.통계, 종류들: 판.종류들, 언어보고, 창지움, 인용지움 };
  };
  const 맞춤 = 거절비율맞추기(굽기, { 띠 });
  const 재료 = 맞춤.판.rows;

  const { rows: 긴창판, 지운: 긴창지움 } = 창걸러내기(긴.rows, 창집합);
  const { rows: 긴행, 지운: 긴인용지움 } = 인용걸러내기(긴창판);

  // ⑥ 표본 문항(⑬·⑭ 모집단) — 홀드아웃 문답에서
  const 표본 = 표본문항짓기(홀드.뗀문답, 색인, { 목표: Number(opt("--samples-n", "28")), 씨앗: 씨앗 + "|samples", 판정: 판정기.판정 });

  // ⑦ 관문 — 만든 것을 **스스로의 감시**에 건다(빌더가 안 도는 경로까지 gradegate가 다시 잰다)
  const 관문 = 등급관문(재료, 창집합);
  const 홀드관문 = 등급관문(홀드행, 창집합);
  const 긴관문 = 등급관문(긴행, 창집합);

  const 한글행 = 재료.filter((r) => 원천언어(r, ragHeader).언어 === "ko").length;
  const 보고 = {
    원천: { 승인: qa.셈?.["chat_logs rating=1"] ?? null, O: qa.문답.length, 등급셈: qa.등급셈 ?? {}, 주제: qa.주제 ?? {} },
    색인: { 조각: 색인.size, 코퍼스문서: cp.docs, 파일 },
    홀드아웃: { ...홀드.보고, 행: 홀드행.length, 질문: 홀드.뗀질문.size, 굽기회차: 홀드회차, 뽑은뭉치: 뗀질문.size, 되돌린뭉치, 통계: 홀드판.통계.제외 },
    긴형식: {
      행: 긴행.length, 창지움: 긴창지움, 인용지움: 긴인용지움, ...긴.통계,
      // 길이는 이 갈래의 **존재 이유**다(관문 ⑪ 서술 길이). 행 수만 적고 길이를 안 적으면 「길게 쓰는 법」을
      // 가르친다는 말을 아무도 검산할 수 없다.
      길이: (() => {
        const L = 긴행.map((r) => String(r.answer).length).sort((a, b) => a - b);
        return L.length ? { 최소: L[0], 중앙: L[Math.floor(L.length / 2)], 최대: L[L.length - 1] } : null;
      })(),
      // ★ 같은 승인 답을 **짧은 행과 긴 행 양쪽에서** 보는 수 — 숨기면 「재료가 자기를 두 번 가르친다」를
      //   아무도 못 센다. 홀드아웃과는 0이라야 하고(시험지 오염), 재료와는 겹쳐도 된다(꼴을 가르치는 갈래다).
      재료겹침: (() => {
        const 질문 = new Map(qa.문답.map((l) => [l.id, 문항정규화(l.question)]));
        const 재료질문 = new Set(재료.map((r) => 문항정규화(r.question)));
        const 쓴 = new Set(긴행.flatMap((r) => r.meta?.문답 ?? []));
        let n = 0;
        for (const id of 쓴) if (재료질문.has(질문.get(id))) n += 1;
        return { 쓴문답: 쓴.size, 재료에도: n };
      })(),
      절: (() => {
        const S = 긴행.map((r) => r.meta?.절 ?? 0).sort((a, b) => a - b);
        return S.length ? { 최소: S[0], 중앙: S[Math.floor(S.length / 2)], 최대: S[S.length - 1] } : null;
      })(),
    },
    재료: {
      행: 재료.length, 한국어원천: 한글행, 한국어비중: 재료.length ? 한글행 / 재료.length : 0,
      거절시작: 재료.filter(거절로시작하나).length,
      거절비중: 재료.length ? 재료.filter(거절로시작하나).length / 재료.length : 0,
      사실주장: 재료.filter(사실주장인가).length,
      제외: 맞춤.판.통계.제외, 회수: 맞춤.판.통계.회수, 언어: 맞춤.판.언어보고, 인용지움: 맞춤.판.인용지움,
      인용규칙: 맞춤.판.통계.인용규칙, 베낀비율제외: 맞춤.판.통계.베낀비율제외,
      라이선스제외: 맞춤.판.통계.라이선스제외, 무블록: 맞춤.판.통계.무블록, 창지움: 맞춤.판.창지움,
    },
    표본: { 행: 표본.문항.length, 목표: Number(opt("--samples-n", "28")), 통계: 표본.통계 },
    pOracle: 맞춤.p, 거절띠: 띠, 띠안: 맞춤.띠안, 탐색이력: 맞춤.이력,
    시험문항: { 목록: 시험.size, 표본: 표본질문.size, 합집합: 시험재료.size, 표본파일: path.basename(표본파일) },
    레시피: { ...레시피, pOracle: 맞춤.p },
  };
  console.log(구성표(보고));
  console.log("");
  console.log(`등급 관문 — v6 재료   ${관문.ok ? "✅ 통과" : "❌ " + 관문.사유.join(" / ")}`);
  console.log(`등급 관문 — 홀드아웃  ${홀드관문.ok ? "✅ 통과" : "❌ " + 홀드관문.사유.join(" / ")}`);
  console.log(`등급 관문 — 긴 형식   ${긴관문.ok ? "✅ 통과" : "❌ " + 긴관문.사유.join(" / ")}`);
  if (args.includes("--diag")) {
    const 자리 = (rows, 창) => rows.map((r, i) => i).filter((i) => 창적중수(rows[i]?.system, 창) >= 2 || 창적중수(rows[i]?.answer, 창) >= 2);
    console.log("[diag] v6 재료 걸린 행", JSON.stringify(걸린행살피기(재료, 창집합, 자리(재료, 창집합)), null, 1));
    console.log("[diag] 긴 형식 걸린 행", JSON.stringify(걸린행살피기(긴행, 창집합, 자리(긴행, 창집합)), null, 1));
  }

  const 다초록 = 관문.ok && 홀드관문.ok && 긴관문.ok;
  if (args.includes("--dry-run")) {
    console.log("");
    console.log(JSON.stringify(보고, null, 2));
    process.exit(다초록 ? 0 : 1);
  }
  if (!다초록) {
    console.error("✗ 등급 관문 불합격 — 파일을 쓰지 않는다(C가 섞인 재료를 굽는 것이 이 회전이 막으려는 그것이다)");
    process.exit(1);
  }

  const v6P = 쓰기("raft-vuln-v6.json", 재료);
  const holdP = 쓰기("holdout-vuln-o.json", {
    "이 파일은": "회전 5의 **새 시험지**다 — 등급 O 승인 문답(주제 " + HOLD_TOPIC + ")에서 v6 재료를 굽기 **전에** 통째로 뗀 판이다.",
    "⚠ 회전 4 이전과 비교 불가": "옛 시험지(holdout-vuln-100.json)와 문항이 전혀 다르다. eval_loss 값을 r1~r4와 나란히 읽으면 안 된다 — 시험지가 다르면 그 숫자는 다른 것을 뜻한다.",
    "왜 갈았나": "옛 시험지는 지금 잣대로 재면 100행 중 97행이 등급 C다(§12.13 ⑦-2). 평가 전용이라 가중치로는 안 들어가지만, 등급 O만 쓰기로 한 결정(②ⓑ) 아래에서 시험지만 C로 두는 것은 앞뒤가 안 맞는다.",
    잣대: 잣대지문(),
    만든때: new Date().toISOString(),
    행: 홀드행,
  });
  const lfP = 쓰기("longform-vuln-v3-o.json", 긴행);
  const smpP = 쓰기("samples-questions-v6.json", 표본.문항);
  const repP = 쓰기("build-report.json", {
    만든때: new Date().toISOString(),
    // ⚠ 경로가 아니라 **이름과 지문**을 적는다 — 구운 자리는 스크래치패드라 나중에 없어진다. 지문이 있으면
    //   「이 파일이 그때 그 판인가」를 어디서든 대조할 수 있다(경로는 대조에 아무 힘이 없다).
    만든자리: OUT, 입력: { qa: path.basename(qaP), corpus: path.basename(cpP), cwin: path.basename(cwP) }, 규격: path.basename(specP),
    잣대: 잣대지문(), 창생성걸음,
    산출물: {
      재료: path.basename(v6P), 재료지문: 지문(v6P),
      홀드아웃: path.basename(holdP), 홀드아웃지문: 지문(holdP),
      긴형식: path.basename(lfP), 긴형식지문: 지문(lfP),
      표본문항: path.basename(smpP), 표본문항지문: 지문(smpP),
    },
    보고, 관문, 홀드관문, 긴관문,
  });
  console.log("");
  console.log(`재료:      ${v6P}`);
  console.log(`홀드아웃:  ${holdP}`);
  console.log(`긴 형식:   ${lfP}`);
  console.log(`표본 문항: ${smpP}`);
  console.log(`보고서:    ${repP}`);
  process.exit(0);
}
