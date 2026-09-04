#!/usr/bin/env node
// tools/distill-longform.mjs — 긴 형식(D갈래) 학습 재료 생성기 (증류 사다리 회전 2, 계획서 §12).
//
// 왜 있나(회전 1의 실패): RAFT 재료 1,297행의 답이 **평균 224자 · 최대 638자 · 단문단 90.5%**였다.
//   그 재료로 구운 어댑터는 6절 조치 요청서(report_draft·report_fix)에서 **절 5→1**로 무너졌다 —
//   길게 쓰는 법을 재료가 한 번도 안 보여 줬기 때문이다. 그래서 「긴 답」만 따로 만든다.
//
// ⚠ 이 산출물은 **학습 전용**이다. 승인함(learnloop)·RAG 지식 저장소에 **넣지 않는다** —
//   합성 문서를 지식으로 섞으면 근거 배지가 우리 스스로 지어낸 글을 가리키게 된다(RAG 오염 계보).
//   그래서 이 도구에는 서버 저장 창구(증류 편입·승인·데이터셋 저장) 경로 문자열이 **하나도 없다**.
//   그 사실을 시험이 소스로 감시한다(server/test/distilllongform.test.ts).
//   여기서 부르는 서버 창구는 **읽기 하나뿐**이다 — GET /api/learnloop/raft/prompt (팀원 프롬프트·근거 머리말).
//
// 재사용(새로 짓지 않는다):
//   · chunk() · sha12() · 참고자료블록() — tools/build-raft-dataset.mjs (조각 규칙·근거 조립 꼴의 단일 출처)
//   · overlap20() · 시점데이터() · 한글비율() · 인용뺀설명() — tools/distill-precheck.mjs (서버 잣대의 사본)
//   ⚠ tools/distill.mjs 는 최상위 await 스크립트라 import가 안 된다 — 그쪽에서 가져올 것이 없도록
//     조각 규칙·근거 조립은 위 두 파일에서만 받는다(복제 0). chunk()는 두 파일이 같은 원문임을
//     raftdataset.test.ts가 이미 대조하고 있다.
//
// ★ 조치 요청서 절 이름 — **정본은 제품 서식이다**(상위 결정 D1, 2026-09-04). 오간 경위를 남긴다:
//   ① 1차(v1)는 **벤치마크 채점기**(tasks-r2.mjs 필수절6)의 6절로 83행을 만들었다. 그건 폐기다 —
//      시험이 세는 서식을 재료로 가르치면 **시험을 답에 맞추는** 것이 된다(점수는 오르고 제품은 그대로).
//   ② 정본은 server/src/engine/remrequest.ts 의 buildRequestDraft() 가 실제로 찍는 서식이다:
//      요청 유형 / 수신처 / 요청일 / 조치 기한 / 재점검 조건 / 대상 취약점 / 요청 사항.
//      .ts 라 import가 안 되므로 시험이 그 소스에서 절 이름을 뽑아 아래 배열과 대조한다(소스 감시).
//   ③ 벤치 절 세트는 지우지 않고 **금지 목록**으로 남긴다 — 여섯이 다 줄 머리에 서면 심사가 떨어뜨린다.
//
// 사용:
//   GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… node tools/distill-longform.mjs \
//     [--limit 200] [--seed longform-vuln-v2] [--name longform-vuln-v2] [--resume] \
//     [--endpoint http://127.0.0.1:8300/v1] [--server http://localhost:4000] [--agent normaltic] \
//     [--concurrency 2] [--timeout-ms 300000] [--budget-min 100] [--dry-run]
//   --dry-run : 교사를 부르지 않고 **만들 질문 목록만** 찍는다(결정성 확인용).
//   --resume  : 같은 --name 산출 파일에 **이미 채택된 질문**은 건너뛰고 이어 붙인다(예산에 걸려 끊긴 회차 복구).
//
// ⚠ 로그인을 밀어내지 않는다(--force-login 없음) — 계정당 1세션이라 강제하면 남의 세션이 끊긴다.
//
// 산출:
//   server/data/datasets/<name>.json                                (학습용, 로컬 — .gitignore)
//   tools/team-bench/results-ladder/day2/build/<name>.json          (저장소 기록, 같은 내용)
//   tools/team-bench/results-ladder/day2/build/<name>.report.md     (구성비·길이·탈락 사유·인자·교사·시간)
//
// 표준 라이브러리만 쓴다(toolsdeps 감시).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunk, sha12, 참고자료블록, 저장소 } from "./build-raft-dataset.mjs";
import { overlap20, 시점데이터, 한글비율, 인용뺀설명 } from "./distill-precheck.mjs";

// ── 서식 ────────────────────────────────────────────────────────────
/** ★ ① 조치 요청서 — **정본은 제품 서식이다**(상위 결정 D1, 2026-09-04).
 *  server/src/engine/remrequest.ts 의 buildRequestDraft() 가 실제로 찍는 절이고, **순서·글자까지** 같아야 한다.
 *  그 파일은 .ts 라 여기서 import가 안 된다 — 대신 시험이 그 소스에서 절 이름을 뽑아 이 배열과 대조한다
 *  (server/test/distilllongform.test.ts ⑥). 제품 서식이 바뀌면 그 시험이 빨개진다.
 *
 *  ⚠ 회전 2의 1차(longform-vuln-v1)는 **벤치마크 채점기의 6절**로 83행을 만들었는데 그건 폐기다 —
 *    재료를 시험 답안지에 맞추면 점수는 오르고 제품은 안 는다. v1 파일은 기록으로 남기되 v2에 안 넣는다. */
export const 절_요청서 = ["요청 유형", "수신처", "요청일", "조치 기한", "재점검 조건", "대상 취약점", "요청 사항"];

/** ⚠ 벤치마크 채점기의 절 세트 — **재료에 쓰지 않는다**(D1). 남겨 두는 까닭은 둘이다.
 *  ① 심사가 이 세트를 **금지**로 거른다(6개가 전부 줄 머리 제목으로 서면 탈락 — 개별 낱말은 허용).
 *  ② 채점기가 바뀌면 시험이 알려 준다(두 곳에 적힌 것은 반드시 어긋난다). */
export const 절_벤치_2회차 = ["제목", "대상 자산", "위험 요약", "조치 방법", "조치 기한", "담당 부서"]; // tasks-r2.mjs 필수절6
export const 절_벤치_1회차 = ["제목", "대상 자산", "취약점 요약", "조치 방법", "조치 기한", "담당"];   // tasks.mjs 필수절
/** ② 취약점 요약 보고 5절 — 이 작업(2026-09-04)이 새로 정한 서식. 아직 제품 코드에 짝이 없다. */
export const 절_요약보고 = ["요약", "영향 범위", "우선순위 판단", "권고 조치", "일정"];

/** 「본문 2문장 이상」을 요구하는 **서술 절**. 나머지는 한 줄이 정상이라 ≥1줄만 본다.
 *  ⚠ 지시는 「절마다 2문장 이상」이었지만 그대로 재면 「요청 유형」·「요청일」에 군더더기를 채운 답만 통과한다
 *    (요청일이 두 문장인 요청서는 없다). 서식을 가르치려다 **군더더기를 가르치는** 재료가 되므로 갈라 둔다.
 *    이 판단은 실행자의 것이고, 되돌리려면 이 집합만 고치면 된다. */
export const 서술절 = new Set([
  "재점검 조건", "대상 취약점", "요청 사항",                 // 제품 서식 쪽
  "요약", "영향 범위", "우선순위 판단", "권고 조치",          // 요약 보고 쪽
]);

export const 형식 = {
  remreq: { kind: "remreq", 절: 절_요청서, 이름: "조치 요청서(제품 서식) 7절" },
  execsum: { kind: "execsum", 절: 절_요약보고, 이름: "취약점 요약 보고 5절" },
};

// ── 결정적 변형 재료 ─────────────────────────────────────────────────
export const 팀들 = ["인프라팀", "정보보안팀", "서비스개발팀", "네트워크운영팀", "시스템운영팀"];
export const 기한들 = [3, 5, 7, 10, 14];
/** 가짜 자산 — 전부 10.30.x.y 대역이다. team-bench 문항이 쓰는 10.20.1.x 와 **대역부터** 안 겹치게 했다. */
export const 자산들 = [
  { name: "was01.example.co.kr", ip: "10.30.2.11" },
  { name: "portal-api.example.co.kr", ip: "10.30.2.24" },
  { name: "vpn-gw.example.co.kr", ip: "10.30.3.5" },
  { name: "mail-relay.example.co.kr", ip: "10.30.3.18" },
  { name: "log-collector.example.co.kr", ip: "10.30.4.7" },
  { name: "build-ci.example.co.kr", ip: "10.30.4.22" },
  { name: "dns01.example.co.kr", ip: "10.30.5.3" },
  { name: "backup-nas.example.co.kr", ip: "10.30.5.40" },
  { name: "monitor.example.co.kr", ip: "10.30.6.12" },
  { name: "db-mgmt.example.co.kr", ip: "10.30.6.31" },
];
/** ⚠ 시험 문항이 쓰는 자산·CVE — 재료에 **절대** 들어오면 안 된다(시험을 답에 맞추는 짓).
 *  tasks-r2.mjs R6 / tasks.mjs report_draft 의 문항에서 그대로 옮겨 적은 값이다. */
export const 금지자산 = ["files.example.co.kr", "hr.example.co.kr", "10.20.1.40", "10.20.1.22"];
export const 금지CVE = ["CVE-2017-5638"];

// ── 재료 조각 ───────────────────────────────────────────────────────
export const 기본재료 = [
  "server/data/ladder/material/day1/nvd-ours",
  "server/data/ladder/material/day1/kev", // nvd-ours 만으로 모자랄 때만 쓴다(--material 로 순서를 바꿀 수 있다)
];

const 연결어 = new Set([
  "is", "was", "are", "were", "in", "on", "before", "allows", "allow", "contains", "contain", "versions",
  "version", "has", "have", "had", "does", "do", "did", "and", "or", "the", "a", "an", "for", "through",
  "prior", "up", "to", "when", "which", "that", "with", "by", "of", "from", "there", "this", "it", "as",
]);

/** 제품 이름이 될 수 없는 한 낱말 — NVD 설명 앞머리가 CWE 문구인데 상투구 걷기로 다 안 걸린 나머지다. */
const 일반어 = new Set([
  "improper", "flaw", "news", "authentication", "authorization", "unsafe", "remote", "insufficient",
  "incorrect", "missing", "use", "uncontrolled", "unrestricted", "cross", "server", "client", "buffer",
  "out", "null", "path", "code", "command", "sql", "os", "xml", "heap", "stack", "integer", "type",
]);

/** 제품 이름의 꼬리로 인정하는 소문자 낱말 — 「Linux kernel」·「Fax Server」는 살리고 「Cacti provides」는 자른다. */
const 제품꼬리말 = new Set(["kernel", "server", "client", "platform", "core", "studio", "manager", "agent", "framework", "library", "engine", "suite", "cms", "router", "firewall"]);

/** 영어 설명에서 제품 이름을 뽑는다 — SOURCE.md의 「제품 키 = 설명 앞머리 두 낱말」과 같은 취지.
 *  뽑히지 않으면 null을 준다(질문에서 제품 이름을 빼는 쪽이 지어내는 것보다 낫다). */
export function 제품이름(설명) {
  // 앞머리 상투구를 걷어낸다 — NVD 설명은 「An issue was discovered in X」·「Improper Check … vulnerability in X」
  //   처럼 제품 이름 앞에 CWE 문구가 붙는 일이 잦다. 안 걷으면 「Improper Check」가 제품 이름이 된다(실측).
  const s = String(설명 ?? "")
    .replace(/^.{0,160}?\b(?:vulnerabilit(?:y|ies)|issue|flaw|weakness)\s+(?:was\s+|is\s+|were\s+)?(?:discovered|found|identified|exists?|reported)?\s*(?:in|affecting)\s+/i, "")
    .replace(/^In\s+/i, "")
    .trim();
  const out = [];
  for (const t of s.split(/\s+/).slice(0, 4)) {
    const w = t.replace(/^["'(`“‘]+/, "").replace(/["'),.;:`”’]+$/, "");
    if (!w) break;
    if (연결어.has(w.toLowerCase())) { if (out.length) break; continue; } // 앞머리 관사·전치사는 건너뛴다(the crypto engine)
    if (!/^[A-Za-z0-9][A-Za-z0-9._+\-/]*$/.test(w)) break;
    // 두 번째 낱말부터는 **이름다운 것**만 받는다 — 대문자·숫자로 시작하거나 제품 꼬리말이어야 한다.
    //   안 그러면 「Cacti provides」·「Access Control issue」처럼 설명 문장이 제품 이름이 된다(2026-09-04 실측).
    if (out.length && !/^[A-Z0-9]/.test(w) && !제품꼬리말.has(w.toLowerCase())) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  const 이름 = out.join(" ").trim();
  // 한 낱말짜리 일반명사가 남으면 제품 이름이 아니다 — 「flaw」·「Improper」를 제품이라 부르느니 CVE만 쓴다.
  if (!이름 || (!이름.includes(" ") && 일반어.has(이름.toLowerCase()))) return null;
  return 이름.length >= 2 ? 이름 : null;
}

/** 조각 안 **첫 CVE 레코드**를 주인공으로 삼는다(결정적) — {cve, 설명, product, version}. */
export function 레코드파싱(text) {
  const t = String(text ?? "");
  // ⚠ 정규식 하나로 「레코드 끝」을 잡지 않는다 — /m 을 쓰면 $ 가 **줄 끝**이라 첫 줄만 잘려 나온다
  //   (2026-09-04 실측: 그 꼴로 짰다가 조각 96개에서 레코드 0개가 나왔다). 자리를 찾아 잘라 쓴다.
  //   조각은 앞 조각의 꼬리 100자를 물고 시작하므로 **줄 머리에 선 첫 CVE**를 주인공으로 삼는다.
  const i = t.search(/(?:^|\n)CVE-\d{4}-\d{4,7}\b/);
  if (i < 0) return null;
  const 뒤 = t.slice(t.indexOf("CVE-", i));
  const 끝 = 뒤.slice(1).search(/\n\nCVE-\d{4}-\d{4,7}\b/);
  const 레코드 = 끝 >= 0 ? 뒤.slice(0, 끝 + 1) : 뒤;
  const cve = (레코드.match(/^CVE-\d{4}-\d{4,7}/) || [])[0];
  if (!cve) return null;
  const 설명 = (레코드.match(/설명\([^)]*\):\s*([\s\S]*?)(?=\n참조:|\n\n|$)/) || [])[1]?.trim()
    || (레코드.match(/\n([A-Za-z][^\n]{40,})/) || [])[1]?.trim() || "";
  if (!설명) return null;
  const product = 제품이름(설명);
  // 버전은 아무 숫자나 쓰지 않는다 — **영향 버전 문구**(before·prior to·through·versions …)에서만 뽑는다.
  //   「Cacti provides …」의 1.3 같은 무관한 숫자를 질문에 실으면 우리가 사실을 지어내는 것이 된다.
  const version = (설명.match(/\b(?:before|prior\s+to|through|up\s+to\s+and\s+including|versions?)\s+v?(\d+\.\d+(?:\.\d+)*)/i) || [])[1] ?? null;
  return { cve, 설명, product, version };
}

/** 재료 폴더들에서 조각을 모은다 — 자르는 규칙은 build-raft-dataset.chunk() 하나뿐(distill.mjs와 같은 함수). */
export function 조각모으기(root = 저장소, 폴더들 = 기본재료, 최소 = Infinity) {
  // 폴더는 **순서대로** 쓴다 — 앞 폴더(nvd-ours, 우리 환경 CVE)만으로 필요한 만큼 모이면 뒤(kev)는 안 연다.
  const pool = [];
  for (const 폴더 of 폴더들) {
    if (pool.length >= 최소) break;
    const dir = path.resolve(root, 폴더);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.md$/i.test(f) || f === "SOURCE.md") continue;
      const abs = path.join(dir, f);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      for (const c of chunk(fs.readFileSync(abs, "utf8"))) {
        const rec = 레코드파싱(c);
        if (!rec) continue;                                   // CVE 레코드가 없는 조각은 주인공이 없다
        if (금지CVE.includes(rec.cve)) continue;               // 시험 문항 CVE는 재료에서 뺀다
        if (금지자산.some((x) => c.includes(x))) continue;      // 시험 문항 자산이 든 조각도 뺀다
        pool.push({ ref: `${rel}#${sha12(c)}`, sha: sha12(c), text: c, ...rec });
      }
    }
  }
  return pool;
}

// ── 결정적 고르기·변형 ───────────────────────────────────────────────
/** 씨앗이 같으면 늘 같은 순서 — distill.mjs는 **날짜**를 씨앗에 섞어 매일 달라지는데, 학습 재료는
 *  「같은 씨앗이면 같은 재료」여야 다시 만들 수 있으므로 날짜를 안 쓴다. */
export function 조각고르기(pool, kind, seed, 개수) {
  return [...pool]
    .map((c) => ({ c, k: sha12(seed + "|" + kind + "|" + c.ref) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, 개수)
    .map((x) => x.c);
}

export function 변형(kind, ref, seed) {
  const h = sha12(seed + "#" + kind + "#" + ref);
  const 뽑기 = (i, len) => parseInt(h.slice(i, i + 3), 16) % len;
  return { 자산: 자산들[뽑기(0, 자산들.length)], 팀: 팀들[뽑기(3, 팀들.length)], 기한: 기한들[뽑기(6, 기한들.length)] };
}

/** 질문 한 줄 — 조각의 사실(제품·버전·CVE)과 결정적 변형(자산·팀·기한)만 쓴다. */
export function 질문만들기(조각, kind, seed) {
  const v = 변형(kind, 조각.ref, seed);
  if (kind === "execsum") {
    return { question: `${조각.cve}에 대해 경영진 보고용 요약을 절을 나눠 써 줘.`, 변형: v };
  }
  const 제품 = [조각.product, 조각.version].filter(Boolean).join(" ");
  const 대상 = 제품 ? `${제품} ${조각.cve}` : 조각.cve;
  return {
    question: `${v.자산.name}(${v.자산.ip})의 ${대상}에 대한 조치 요청서를 써 줘. 담당 ${v.팀}, 기한 ${v.기한}일.`,
    변형: v,
  };
}

/** 일감 목록 — ★ 두 형식을 **번갈아** 둔다(D3, 2026-09-04).
 *  v1은 형식별로 몰아 두었더니 예산에 걸려 끊긴 자리가 execsum 한복판이었고, 그래서 83:38로 기울었다.
 *  번갈아 두면 어디서 끊겨도 두 형식이 ±1 안에서 고르게 남는다. */
export function 일감만들기(pool, seed, limit) {
  const 몫 = Math.ceil(limit / 2);
  const 갈래 = Object.keys(형식).map((kind) =>
    조각고르기(pool, kind, seed, 몫).map((c) => {
      const { question, 변형: v } = 질문만들기(c, kind, seed);
      return { kind, 조각: c, question, 변형: v };
    }));
  const 일감 = [];
  for (let i = 0; i < 몫; i++) for (const g of 갈래) if (g[i]) 일감.push(g[i]);
  return 일감;
}

/** 이어 붙이기(D5) — 이미 채택된 행의 **질문 sha12** 집합. 같은 질문은 교사를 다시 안 부른다. */
export function 이미채택된질문(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((r) => sha12(String(r?.question ?? ""))));
}

// ── 심사 ────────────────────────────────────────────────────────────
/** 줄 머리에 선 절 제목을 찾는다 — `## 요청 사항`·`**요청 사항**`·`3. 요청 사항`·`요청 사항:` 전부 인정.
 *  ★ 제목 뒤에 같은 줄로 값이 붙는 꼴(`- 요청 유형: 취약점 조치`)이면 그 **꼬리를 본문으로 돌려준다**(2026-09-04).
 *    제품 서식(remrequest.ts)의 앞 다섯 절이 실제로 그 꼴이라, 안 그러면 전부 「빈 절」로 떨어진다. */
export function 절자리(answer, 절이름들) {
  const lines = String(answer ?? "").split(/\r?\n/);
  const 찾음 = [];
  for (let i = 0; i < lines.length; i++) {
    // ⚠ 굵게 표시(**…**)를 **불릿보다 먼저** 걷는다 — 순서를 뒤집으면 `**대상 자산**`의 첫 `*`가
    //   불릿으로 먹혀 `*대상 자산`이 남고, 그 절을 「없다」고 읽는다(2026-09-04 시험이 잡음).
    const bare = lines[i]
      .replace(/^[\s>]*/, "").replace(/\*\*|__/g, "").replace(/^#{1,6}\s*/, "")
      .replace(/^[*\-•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (!bare || bare.length > 80) continue;
    for (const n of 절이름들) {
      if (찾음.some((x) => x.name === n)) continue;
      if (bare === n || (bare.startsWith(n) && /^[\s:：·—\-(]/.test(bare.slice(n.length)))) {
        // 같은 줄 꼬리 = 그 절의 본문. 「(3건)」처럼 개수만 붙은 꼴은 본문이 아니라 제목 장식이라 버린다.
        const 꼬리 = bare.slice(n.length).replace(/^[\s:：·—\-]+/, "").trim();
        찾음.push({ name: n, line: i, 꼬리: /^\(\s*\d+\s*건\s*\)$/.test(꼬리) ? "" : 꼬리 });
        break;
      }
    }
  }
  return { lines, 찾음: 찾음.sort((a, b) => a.line - b.line) };
}

/** 절별 본문(제목 줄 다음부터 다음 절 제목 앞까지). */
export function 절본문(answer, 절이름들) {
  const { lines, 찾음 } = 절자리(answer, 절이름들);
  const 본문 = {};
  for (let i = 0; i < 찾음.length; i++) {
    const 끝 = i + 1 < 찾음.length ? 찾음[i + 1].line : lines.length;
    const 아래 = lines.slice(찾음[i].line + 1, 끝).join("\n").trim();
    본문[찾음[i].name] = [찾음[i].꼬리 || "", 아래].filter(Boolean).join("\n").trim();
  }
  return { 본문, 있는절: 찾음.map((x) => x.name) };
}

export function 문장수(s) {
  return String(s ?? "")
    .split(/\r?\n/)
    .flatMap((l) => l.replace(/^[\s>*\-•]*/, "").replace(/^\d+[.)]\s*/, "").split(/(?<=[.!?])\s+/))
    .map((x) => x.trim())
    // 5자 — 「첫 문장입니다.」가 공백 빼고 7자다. 8자로 잡았더니 정상 문장이 세어지지 않았다(시험이 잡음).
    .filter((x) => x.replace(/\s/g, "").length >= 5).length;
}

/** ★ 백틱이 없는 **코드 식별자**(2026-09-04 D4 — 잣대 과엄 수리).
 *  실측: 「한글 비율 미달」 8건 중 표본 둘이 전부 이 꼴이었다 — `open_cached_dir()`·`cmd_realtime.php`·
 *  `register_argc_argv`·`CRITICAL`. 설명은 한국어인데 **함수 이름을 적었다는 이유로** 떨어졌다.
 *  그래서 분모에서 뺀다. 코드를 적는 답을 벌하면 재료가 「코드 이름을 안 쓰는 요청서」를 가르친다.
 *
 *  ⚠ 지시가 예시로 준 정규식 `[A-Za-z_][A-Za-z0-9_.]*\(\)?` 는 **글자 그대로 쓰면 예시 셋 중 하나만
 *    잡는다.** `\(\)?` 가 「괄호쌍이 있어도 되고 없어도 된다」가 아니라 「`(` 는 반드시 있고 `)` 만
 *    선택」이라서다. 실측(2026-09-04):
 *        open_cached_dir()  → 잡힘 ·  cmd_realtime.php → 안 잡힘 ·  register_argc_argv → 안 잡힘 ·  CRITICAL → 안 잡힘
 *    그래서 **적힌 예시들이 실제로 걸리도록** 규칙을 갈라 적었다 — 괄호쌍·밑줄·점 이음·경로·대문자 약어.
 *    평범한 영어 낱말(`This`·`section`)은 **분모에 그대로 남긴다**: 그것까지 빼면 「설명이 한국어인가」를
 *    묻는 잣대가 아무 일도 안 하게 된다. 통째로 영어인 답이 여전히 떨어지는 것을 시험이 지킨다. */
const 코드꼴 = [
  /(?:\.{0,2}\/)[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*/g, // 경로  ./private_gpt/components · /etc/x
  /\b[A-Za-z_][A-Za-z0-9_]*\s*\(\)/g,                       // 함수 호출  open_cached_dir()
  /\b[A-Za-z]*_[A-Za-z0-9_]+\b/g,                           // 밑줄 식별자  register_argc_argv
  /\b[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+\b/g,           // 점 이음·파일명  cmd_realtime.php · vLogin.py
  /\b[A-Z]{2,}(?:-[A-Z0-9]+)?\b/g,                          // 대문자 약어  CRITICAL · RCE · PHP · SMB
];

/** 한글 비율을 잴 때 빼는 것 — 인용·CVE·CVSS·CWE·URL·코드. 「설명이 한국어인가」만 남긴다. */
export function 설명부(answer) {
  let s = 인용뺀설명(answer)
    .replace(/^.*원문\s*[:：].*$/gm, " ")
    .replace(/CVE-\d{4}-\d{4,7}/g, " ")
    .replace(/\bCWE-\d+\b/g, " ")
    .replace(/CVSS[^\s]*/gi, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`[^`]*`/g, " ");
  for (const re of 코드꼴) s = s.replace(re, " ");
  return s;
}

export const 인용뽑기 = (answer) =>
  (String(answer ?? "").match(/원문\s*[:：]\s*["'“‘]([^"'”’]{20,})["'”’]/) || [])[1] ?? null;

export const 길이하한 = 1000, 길이상한 = 3000, 한글하한 = 0.6;

/**
 * 통과면 null, 아니면 **탈락 사유**(보고서 집계의 키).
 * ⚠ distill-precheck 의 사전검사()를 통째로 쓰지 않는 이유: 그 함수는 답 길이 상한이 **1,200자**다
 *   (짧은 문답용). 여기서 만드는 것은 1,000~3,000자짜리 긴 답이라 그대로 쓰면 전량 탈락한다.
 *   그래서 부품(overlap20·시점데이터·한글비율·인용뺀설명)만 가져와 같은 규칙을 긴 형식에 다시 건다.
 */
export function 심사(kind, question, answer, 조각, 변형값) {
  const a = String(answer ?? "").trim();
  if (!a) return "빈 답";
  if (a.length < 길이하한) return `길이 미달(<${길이하한})`;
  if (a.length > 길이상한) return `길이 초과(>${길이상한})`;

  const 절들 = 형식[kind].절;
  const { 본문, 있는절 } = 절본문(a, 절들);
  const 빠진 = 절들.filter((n) => !있는절.includes(n));
  if (빠진.length) return `절 누락(${빠진.join("·")})`;
  for (const n of 절들) {
    const b = (본문[n] ?? "").trim();
    if (!b) return `빈 절(${n})`;
    if (서술절.has(n) && 문장수(b) < 2) return `절 본문 2문장 미만(${n})`;
  }

  if (한글비율(설명부(a)) < 한글하한) return `한글 비율 미달(<${한글하한})`;
  if (시점데이터(a)) return "시점데이터(날짜·N건·식별자)";

  // CVE — 답에 나온 CVE는 전부 조각에 있어야 하고, 주인공 CVE는 반드시 나와야 한다.
  const cve들 = [...new Set(a.match(/CVE-\d{4}-\d{4,7}/g) ?? [])];
  if (!cve들.includes(조각.cve)) return "주인공 CVE 없음";
  for (const c of cve들) if (!조각.text.includes(c)) return "지어낸 CVE";

  // 원문 인용 — 조각과 20자 겹침(distill-precheck 의 서버 규칙 사본을 그대로 쓴다)
  const 인용 = 인용뽑기(a);
  if (!인용) return "원문 인용 없음";
  if (!overlap20(인용, 조각.text)) return "원문 인용이 조각과 안 겹침(20자)";

  // 지어낸 값 — 기한·담당은 질문이 준 값과 같아야 하고, 질문에 없는 IP·버전은 조각에 있는 것만.
  if (kind === "remreq") {
    if (!new RegExp(`${변형값.기한}\\s*(?:일|영업일)`).test(a)) return "기한 불일치";
    if (!a.includes(변형값.팀)) return "담당 불일치";
  }
  for (const ip of new Set(a.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])) {
    if (question.includes(ip) || 조각.text.includes(ip)) continue;
    return "지어낸 IP";
  }
  for (const v of new Set(a.match(/\b\d+\.\d+(?:\.\d+)*\b/g) ?? [])) {
    if (question.includes(v) || 조각.text.includes(v)) continue;
    return "지어낸 버전";
  }
  for (const x of 금지자산) if (a.includes(x) || question.includes(x)) return "시험 문항 자산 혼입";

  // ★ 벤치마크 절 세트 금지(D1) — 채점기가 세는 6절이 **전부** 줄 머리 제목으로 서 있으면 버린다.
  //   시험이 세는 서식을 재료로 가르치면 점수는 오르고 제품 서식은 그대로다(시험을 답에 맞추는 짓).
  //   개별 낱말(「조치 기한」은 제품 서식에도 있다)은 막지 않는다 — **여섯이 다 모인 것**만 본다.
  for (const 세트 of [절_벤치_2회차, 절_벤치_1회차]) {
    if (절자리(a, 세트).찾음.length === 세트.length) return "벤치마크 절 세트 혼입";
  }
  return null;
}

// ── 교사 지시 ────────────────────────────────────────────────────────
export function 교사지시(kind, 변형값) {
  const 절들 = 형식[kind].절;
  const 서술 = 절들.filter((n) => 서술절.has(n));
  const 단문 = 절들.filter((n) => !서술절.has(n));
  return [
    "── 쓰는 법(이 지시는 답에 옮겨 적지 말 것) ──",
    // ★ D6(2026-09-04) — 인용 지시를 **맨 앞으로** 올린다. v1에서 「원문 인용 없음」이 8건이었는데
    //   그 지시가 여덟 번째, 즉 목록 맨 끝에 있었다. 긴 지시의 꼬리는 교사가 흘린다는 가설이었다.
    //   ⚠ 실측 결과 — **효과 없음**: 「원문 인용 없음」은 v1 8/149(5.4%) → v2 7/136(5.1%)로 사실상 그대로다.
    //     (v2 보고서는 --resume 회차라 이 분모는 **그 회차에 새로 생성한 답**의 수다.)
    //     그래도 되돌리지 않는다: ①해로운 데가 없고 ②되돌리면 다음 회전에서 같은 가설을 또 세운다.
    //     대신 「가설이 틀렸다」를 여기 남겨, 인용 탈락을 줄이려면 **지시 자리가 아닌 다른 곳**을
    //     봐야 한다는 것을 다음 사람이 알게 한다(교사 모델·조각에 인용할 영어 문장이 있는가 쪽).
    '1) ★ 답의 **맨 끝 한 줄**은 반드시 「원문: "…"」 이다. 참고 자료 조각의 영어 문장 하나를 한 글자도',
    "   바꾸지 말고 그대로 옮겨 적는다. 고르는 문장은 40자보다 길고 날짜·「N건」이 없는 **설명 문장**이어야",
    "   한다(맨 윗줄의 공개일·점수 줄은 고르지 말 것). 이 줄이 없으면 그 답은 통째로 버려진다.",
    `2) 마크다운 절 제목을 **줄 머리에** 두고 순서대로 전부 쓴다: ${절들.map((n) => `## ${n}`).join(" / ")}`,
    // ⚠ 길이·문장 수를 **세게** 부른다(2026-09-04 실측): 「1,300~2,400자」로 시켰더니 답이 738~992자로
    //   내려앉아 아홉에 다섯이 길이에서 떨어졌다. 교사에게 「하한」을 말하면 그 언저리를 노린다 —
    //   그래서 하한을 우리가 원하는 값보다 위로 부른다(합격선 1,000자, 부르는 값 1,700자).
    `3) 서술 절(${서술.join("·")})은 본문을 **3문장 이상**, 각 문장을 충분히 풀어 쓴다. 짧은 절(${단문.join("·")})은 한 줄로 정확히 적는다.`,
    "4) 전체 길이는 **1,700자 이상** 2,600자 이하다. 1,700자에 못 미치면 서술 절을 더 풀어 써서 채운다.",
    // ⚠ 영어가 섞이는 답이 실제로 떨어졌다 — 인용 한 줄 말고는 한국어만 쓰라고 못을 박는다.
    "5) 영어 문장은 **맨 끝 원문 인용 한 줄뿐**이다. 그 밖의 본문은 한국어로만 쓴다(제품 이름·CVE 번호·함수 이름은 그대로 둔다).",
    "6) 참고 자료 조각에 적힌 사실(CVE 번호·제품·버전·영향·CWE)만 쓴다. 모르는 값은 「확인 필요」라고 적는다.",
    "7) 날짜(2026-01-02 같은 꼴)와 「N건」 같은 통계 나열은 쓰지 않는다. 기간은 「7일 안」처럼 상대 기간으로 적는다.",
    ...(kind === "remreq"
      ? [
          // 제품 서식(remrequest.ts)의 앞 다섯 절은 실제로 「- 이름: 값」 한 줄짜리다 — 그 꼴을 그대로 가르친다.
          `8) 「요청 유형」은 「취약점 조치」, 「수신처」는 「${변형값.팀}」, 「조치 기한」은 「${변형값.기한}일 안」이라고 그대로 적는다.`,
          "9) 「요청일」 절에는 **날짜를 쓰지 않는다** — 「본 요청서 발송일 기준」이라고만 적는다.",
          "10) 「대상 취약점」 절에는 자산 이름과 IP, 제품·버전, CVE 번호, 심각도를 먼저 적고 이어서 무엇이 왜 위험한지 풀어 쓴다.",
          "11) 「재점검 조건」 절에는 무엇을 다시 확인해야 조치가 끝난 것으로 보는지 적는다. 「요청 사항」 절에는 받는 쪽이 실제로 할 일을 적는다.",
          "12) 질문에 없는 IP·버전은 지어내지 않는다.",
        ]
      : [
          // ★ (2026-09-04 회전 2 실측) execsum 탈락 29건 중 「주인공 CVE 없음」이 **13건**으로 1위였다.
          //   경영진 보고 투로 쓰다 보니 번호를 「해당 취약점」·「본 건」으로 뭉뚱그린 답이 많았다.
          //   ⚠ 잣대(심사의 "주인공 CVE 없음")는 **그대로 둔다** — 재료에 CVE 번호가 없으면 학습이
          //     「무엇에 대한 답인가」를 못 배운다. 고칠 것은 잣대가 아니라 **교사에게 자리를 지정해 주는 것**이다.
          //   remreq 쪽은 질문에 자산·제품이 함께 있어 번호가 자연히 실린다 — 그래서 이 지시는 execsum에만 둔다.
          "8) 「요약」 절의 **첫 문장**에 질문에 적힌 CVE 번호(CVE-연도-번호 꼴)를 **그대로** 적는다. " +
            "「해당 취약점」·「본 건」처럼 번호를 빼고 가리키면 그 답은 통째로 버려진다.",
          "9) 질문에 없는 IP·버전은 지어내지 않는다. 「일정」 절도 날짜 없이 상대 기간으로 적는다.",
        ]),
  ].join("\n");
}

/** user 메시지 끝에 한 번 더 못을 박는 한 줄(D6) — 지시 목록의 1번과 **같은 것을 두 번** 말한다.
 *  같은 것을 두 곳에 적는 것은 평소 금기지만, 여기 두 자리는 「모델에게 거는 말」이라 단일 출처가 아니라
 *  **반복**이 목적이다. 문구가 갈리지 않도록 상수 하나로 두고 양쪽에서 가리킨다. */
export const 인용못박기 = '⚠ 마지막으로 한 번 더 — 답의 **마지막 줄**은 반드시 「원문: "…"」 한 줄이다. 참고 자료 조각의 영어 문장을 그대로 옮겨 적는다.';

// ── 본체 ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const has = (k) => args.includes(k);

  const NAME = String(opt("--name", "longform-vuln-v2")).trim();
  const SEED = String(opt("--seed", NAME)).trim();
  const LIMIT = Math.max(2, Number(opt("--limit", 200)));
  const AGENT = String(opt("--agent", "normaltic")).trim();
  const ENDPOINT = String(opt("--endpoint", "http://127.0.0.1:8300/v1")).replace(/\/+$/, "");
  const SERVER = String(opt("--server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
  const CONC = Math.max(1, Math.min(4, Number(opt("--concurrency", 2))));
  const TIMEOUT = Math.max(30_000, Number(opt("--timeout-ms", 300_000)));
  const BUDGET_MS = Math.max(1, Number(opt("--budget-min", 100))) * 60_000;
  const MATERIAL = String(opt("--material", 기본재료.join(","))).split(",").map((s) => s.trim()).filter(Boolean);
  const DRY = has("--dry-run");
  const RESUME = has("--resume");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(NAME)) { console.error(`--name 은 영문 소문자·숫자·하이픈만 (받은 값: ${NAME})`); process.exit(2); }

  const pool = 조각모으기(저장소, MATERIAL, Math.ceil(LIMIT / 2));
  if (!pool.length) { console.error("재료 조각이 없습니다 — --material 경로를 확인하세요"); process.exit(2); }
  const 몫 = Math.ceil(LIMIT / 2);
  let 일감 = 일감만들기(pool, SEED, LIMIT);

  // ── 이어 붙이기(D5) — 앞 실행이 남긴 산출 파일을 읽어 **이미 채택된 질문**을 건너뛴다.
  //   교사 시간이 가장 비싼 자원이라, 예산에 걸려 끊긴 회차를 처음부터 다시 돌리지 않는다.
  const 로컬경로 = path.join(저장소, "server", "data", "datasets", `${NAME}.json`);
  let 앞선행 = [];
  if (RESUME && fs.existsSync(로컬경로)) {
    try { 앞선행 = JSON.parse(fs.readFileSync(로컬경로, "utf8")); } catch (e) { console.error(`[longform] --resume 읽기 실패(${e.message}) — 빈 상태로 시작한다`); 앞선행 = []; }
    if (!Array.isArray(앞선행)) 앞선행 = [];
    const 이미 = 이미채택된질문(앞선행);
    const 전 = 일감.length;
    일감 = 일감.filter((w) => !이미.has(sha12(w.question)));
    console.log(`[longform] --resume — 앞 산출 ${앞선행.length}행(6절 ${앞선행.filter((r) => r?.meta?.kind === "remreq").length} · 5절 ${앞선행.filter((r) => r?.meta?.kind === "execsum").length}) 이어받음 · 일감 ${전}→${일감.length}`);
  } else if (RESUME) {
    console.log(`[longform] --resume 인데 앞 산출이 없다(${로컬경로}) — 처음부터 만든다`);
  }
  console.log(`[longform] 조각 ${pool.length} · 일감 ${일감.length}(형식별 최대 ${몫}, 번갈아) · 씨앗 ${SEED} · 교사 ${ENDPOINT} · 동시 ${CONC} · 예산 ${(BUDGET_MS / 60000).toFixed(0)}분${DRY ? " · DRY-RUN" : ""}`);
  if (DRY) {
    for (const w of 일감.slice(0, 6)) console.log(`-- [${w.kind}] ${w.question}`);
    const cve별 = new Set(일감.map((w) => w.조각.cve));
    console.log(`[longform] 서로 다른 CVE ${cve별.size} · 자산 ${new Set(일감.filter((w) => w.kind === "remreq").map((w) => w.변형.자산.name)).size}종 · 팀 ${new Set(일감.filter((w) => w.kind === "remreq").map((w) => w.변형.팀)).size}종 · 기한 ${new Set(일감.filter((w) => w.kind === "remreq").map((w) => w.변형.기한)).size}종`);
    process.exit(0);
  }

  // ── 제품이 쓰는 프롬프트·근거 머리말을 **받아 온다**(베끼지 않는다). 읽기 창구 하나뿐이다.
  const 사용자 = process.env.GIJO_ADMIN_USER, 비번 = process.env.GIJO_ADMIN_PASSWORD;
  if (!사용자 || !비번) { console.error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다"); process.exit(3); }
  const 로그인 = async () => {
    const r = await fetch(SERVER + "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      // ⚠ --force-login 은 **자기 유령 세션을 치울 때만** 쓴다. 이 도구가 중간에 죽으면 세션 기록이
      //   유휴 30분 동안 남아 다음 실행을 막는데, 그건 남의 세션이 아니라 **내가 남긴 것**이다.
      //   쓰기 전에 반드시 「기존접속.since」가 내 앞 실행의 로그인 시각인지 확인할 것 — 남의 것이면 기다린다.
      body: JSON.stringify({ username: 사용자, password: 비번, force: has("--force-login") }), redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json();
    if (!j.accessToken) throw new Error("로그인 실패: " + String(j.error ?? "") + " — 같은 계정 세션이 물고 있으면 끝나기를 기다린다(밀어내지 않는다)");
    return { "Content-Type": "application/json", Authorization: "Bearer " + j.accessToken };
  };
  // 세션이 남의 것이면 **기다린다**(밀어내지 않는다) — 유휴 30분이면 저절로 풀린다.
  //   기다린 시간은 생성 예산(BUDGET_MS)에 안 들어간다 — 예산 시계는 아래 `시작`부터 돈다.
  const 대기시작 = Date.now();
  let auth = null;
  for (let i = 0; auth === null; i++) {
    try { auth = await 로그인(); }
    catch (e) {
      if (Date.now() - 대기시작 > 40 * 60_000) { console.error(`[longform] 로그인 대기 40분 초과 — ${e.message}`); process.exit(3); }
      if (i % 3 === 0) console.log(`[longform] 로그인 대기 중(${((Date.now() - 대기시작) / 60000).toFixed(1)}분) — 같은 계정 세션이 물고 있다. 20초 뒤 다시.`);
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  const pr = await fetch(`${SERVER}/api/learnloop/raft/prompt?agentId=${encodeURIComponent(AGENT)}`, { headers: auth, redirect: "error", signal: AbortSignal.timeout(60_000) });
  const 프롬프트 = await pr.json();
  if (!pr.ok || !프롬프트.system) throw new Error(`프롬프트 창구 ${pr.status}: ${JSON.stringify(프롬프트).slice(0, 200)}`);
  // 조립 꼴이 서버와 같은지 즉시 대조 — 어긋나면 학습 꼴과 추론 꼴이 갈리는데 **오류가 안 난다**(빌더와 같은 관문).
  if (프롬프트.ragBlockSample && 참고자료블록(프롬프트.ragHeader, ["<조각 본문>"]) !== 프롬프트.ragBlockSample) {
    throw new Error("참고 자료 블록 조립 꼴이 서버(llm.ts ragBlock)와 다릅니다");
  }

  const 보고 = {
    name: NAME, seed: SEED, kinds: Object.keys(형식), agent: AGENT, endpoint: ENDPOINT, server: SERVER,
    material: MATERIAL, concurrency: CONC, timeoutMs: TIMEOUT, budgetMin: BUDGET_MS / 60000,
    startedAt: new Date().toISOString(), 조각: pool.length, 일감: 일감.length,
    생성: 0, 채택: 0, 탈락: {}, 탈락표본: {}, 교사: null,
    이어받음: 앞선행.length, resume: RESUME,
    형식별: { remreq: 앞선행.filter((r) => r?.meta?.kind === "remreq").length, execsum: 앞선행.filter((r) => r?.meta?.kind === "execsum").length },
    토큰: { prompt: 0, completion: 0 }, 교사ms: 0, 호출: 0, 실패: [], 예산초과: false,
    연속실패: 0, 버림: 0, 교사끊김: false,
  };
  /** 교사가 잠깐 자리를 비웠을 때 일감을 몇 번까지 줄 뒤로 돌리나 · 몇 번 연속 실패하면 회차를 접나. */
  const 재시도한도 = 3, 연속실패한도 = 40;
  const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
  // 이어받은 행이 먼저 온다 — 산출 파일은 늘 **파일 전체**이고, 「채택」은 **이번 회차**의 숫자다(둘을 안 섞는다).
  const rows = [...앞선행];
  /**
   * 이번 회차에 **떨어진 답의 전문**. 파일로 따로 뺀다(<name>.rejected.json).
   *
   * ★ 왜 필요했나(2026-09-04): 보고서에는 사유마다 앞 2건 · 앞 400자만 남겼다. 그런데 회전 2에서
   *   「주인공 CVE 없음 13건」을 다시 재려 하자 **13건 중 2건의 머리 400자밖에** 없어서, 어느 형식이
   *   몇 건인지·번호를 어떻게 뭉뚱그렸는지를 **다시 구워야만** 알 수 있었다(교사 시간이 가장 비싼 자원인데).
   *   숫자는 「무엇이 떨어졌나」를 말하지만 「왜」는 전문에만 있다.
   * ⚠ 학습 재료가 아니다 — 산출 데이터셋(rows)에 절대 안 섞는다. 다음 회차에서 무엇을 고칠지 보는 자료다.
   */
  const 탈락기록 = [];
  const 시작 = Date.now();
  const queue = [...일감];

  async function 교사부르기(system, user) {
    const body = { model: "local", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.7, max_tokens: 1900 };
    const headers = { "Content-Type": "application/json" };
    if (process.env.GIJO_SERVE_TOKEN) headers["x-gijo-serve-token"] = process.env.GIJO_SERVE_TOKEN;
    const t0 = Date.now();
    const r = await fetch(ENDPOINT + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(TIMEOUT) });
    const j = await r.json();
    if (!r.ok) throw new Error(`교사 ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    return { text: String(j.choices?.[0]?.message?.content ?? ""), model: String(j.model ?? ""), usage: j.usage ?? {}, ms: Date.now() - t0 };
  }

  function 진행저장(rows) {
    // 중간 저장 — 예산에 걸려 끊기거나 사람이 멈춰도 **된 행까지는 남는다**(교사 시간이 사라지지 않게).
    const 로컬 = path.join(저장소, "server", "data", "datasets", `${NAME}.json`);
    fs.mkdirSync(path.dirname(로컬), { recursive: true });
    fs.writeFileSync(로컬, JSON.stringify(rows, null, 2), "utf8");
  }

  async function worker(n) {
    while (queue.length) {
      if (Date.now() - 시작 > BUDGET_MS) { 보고.예산초과 = true; return; }
      const w = queue.shift();
      const system = [프롬프트.system, 참고자료블록(프롬프트.ragHeader, [w.조각.text])].join("\n\n");
      const user = `${w.question}\n\n${교사지시(w.kind, w.변형)}\n\n${인용못박기}`;
      let t;
      try {
        t = await 교사부르기(system, user);
      } catch (e) {
        try { await 잠깐(3_000); t = await 교사부르기(system, user); }
        catch (e2) {
          // ★ 버리지 않는다 — **줄 뒤로 돌리고 쉬었다 온다**(2026-09-04 실사고).
          //   그날 교사(gb10 llama-server)를 누가 다시 올렸다. 84GB 3조각을 무는 데 몇 분이 걸리는데,
          //   그 사이 두 일꾼이 남은 일감 209개를 **몇 초 만에 전부 실패로 버렸다** — 예산 75분 중 20분만
          //   쓰고 끝났고 재료 209건이 사라졌다. 교사가 잠깐 자리를 비운 것과 일감이 나쁜 것은 다르다.
          w.실패 = (w.실패 ?? 0) + 1;
          보고.연속실패 += 1;
          if (보고.실패.length < 40) 보고.실패.push(`${w.kind} ${w.조각.cve}(${w.실패}회): ${e2.message}`);
          if (w.실패 <= 재시도한도) {
            queue.push(w);                                   // 줄 뒤로 — 다른 일감을 먼저 하고 돌아온다
            await 잠깐(Math.min(60_000, 5_000 * 2 ** (w.실패 - 1))); // 5s → 10s → 20s
          } else { 보고.버림 += 1; }
          // 교사가 아주 갔으면 예산을 헛되이 태우지 않는다 — 연속으로 이만큼 실패하면 회차를 접는다.
          if (보고.연속실패 >= 연속실패한도) { 보고.교사끊김 = true; return; }
          continue;
        }
      }
      보고.연속실패 = 0;
      보고.호출 += 1; 보고.교사ms += t.ms;
      보고.토큰.prompt += t.usage.prompt_tokens || 0; 보고.토큰.completion += t.usage.completion_tokens || 0;
      if (!보고.교사 && t.model) 보고.교사 = t.model;
      const answer = t.text.trim();
      보고.생성 += 1;
      const 사유 = 심사(w.kind, w.question, answer, w.조각, w.변형);
      if (사유) { 보고.탈락[사유] = (보고.탈락[사유] ?? 0) + 1;
        // 보고서(md)에는 사유마다 앞 2건 · 앞 400자만 싣는다 — 사람이 읽는 자리라 길면 안 읽힌다.
        const 표본 = (보고.탈락표본[사유] ??= []);
        if (표본.length < 2) 표본.push({ cve: w.조각.cve, 길이: answer.length, 답머리: answer.slice(0, 400) });
        // 전문은 **전부** 파일로 남긴다(위 탈락기록의 ★) — 재측정이 다시 굽지 않아도 되게.
        탈락기록.push({
          사유, kind: w.kind, cve: w.조각.cve, chunkSha12: w.조각.sha,
          길이: answer.length, 교사ms: t.ms, question: w.question, answer,
        });
        console.log(`[longform#${n}] x ${w.kind} ${w.조각.cve} — ${사유} (${answer.length}자, ${(t.ms / 1000).toFixed(0)}s, 남은 ${queue.length})`); continue; }
      rows.push({ question: w.question, answer, system, meta: { kind: w.kind, cve: w.조각.cve, chunkSha12: w.조각.sha } });
      보고.채택 += 1; 보고.형식별[w.kind] += 1;
      if (보고.채택 % 10 === 0) 진행저장(rows);
      console.log(`[longform#${n}] o ${w.kind} ${w.조각.cve} (${answer.length}자, ${(t.ms / 1000).toFixed(0)}s, 채택 ${보고.채택}, 남은 ${queue.length})`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));

  // ── 저장(서버 창구가 아니라 파일이다 — 이 재료는 승인함·지식 저장소에 안 들어간다) ──
  보고.finishedAt = new Date().toISOString();
  보고.소요분 = Number(((Date.now() - 시작) / 60000).toFixed(1));
  보고.총행 = rows.length;
  const 길이들 = rows.map((r) => r.answer.length).sort((a, b) => a - b);
  const 분위 = (p) => (길이들.length ? 길이들[Math.min(길이들.length - 1, Math.floor(길이들.length * p))] : 0);
  보고.길이 = { p50: 분위(0.5), p90: 분위(0.9), min: 길이들[0] ?? 0, max: 길이들[길이들.length - 1] ?? 0 };
  보고.한글비율평균 = rows.length ? Number((rows.reduce((s, r) => s + 한글비율(설명부(r.answer)), 0) / rows.length).toFixed(3)) : 0;
  보고.인용성립 = rows.length ? Number((rows.filter((r) => 인용뽑기(r.answer)).length / rows.length).toFixed(3)) : 0;

  const 로컬 = path.join(저장소, "server", "data", "datasets", `${NAME}.json`);
  const 기록 = path.join(저장소, "tools", "team-bench", "results-ladder", "day2", "build", `${NAME}.json`);
  for (const p of [로컬, 기록]) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(rows, null, 2), "utf8"); }
  const md = [
    `# ${NAME} — 긴 형식(D갈래) 학습 재료 보고`, "",
    `- 만든 때: ${보고.startedAt} → ${보고.finishedAt} (${보고.소요분}분)`,
    `- 교사 모델: ${보고.교사 ?? "(호출 없음)"} · 창구 ${ENDPOINT} · 동시 ${CONC} · 타임아웃 ${TIMEOUT / 1000}s + 재시도 1`,
    `- 실행 인자: --name ${NAME} --seed ${SEED} --limit ${LIMIT} --agent ${AGENT} --concurrency ${CONC} --timeout-ms ${TIMEOUT} --budget-min ${BUDGET_MS / 60000}`,
    `- 재료: ${MATERIAL.join(" · ")} → 조각 ${보고.조각} · 일감 ${보고.일감}`,
    `- 예산 초과로 중단: ${보고.예산초과 ? "예 (남은 일감은 안 돌렸다)" : "아니오"}`,
    `- 교사 끊김으로 중단: ${보고.교사끊김 ? `예 (연속 ${연속실패한도}회 실패 — 교사가 자리를 비웠다)` : "아니오"} · 끝내 못 부른 일감 ${보고.버림}건`, "",
    "## 숫자", "",
    "| 항목 | 값 |", "|---|---|",
    `| 이어받은 행(--resume) | ${보고.이어받음} |`,
    `| 생성(이번 회차 교사 답) | ${보고.생성} |`,
    `| 채택(이번 회차) | ${보고.채택} (${보고.생성 ? ((보고.채택 / 보고.생성) * 100).toFixed(0) : 0}%) |`,
    `| **파일 총 행수** | **${rows.length}** |`,
    `| ${형식.remreq.이름} | ${보고.형식별.remreq} |`,
    `| ${형식.execsum.이름} | ${보고.형식별.execsum} |`,
    `| 답 길이 p50 / p90 | ${보고.길이.p50} / ${보고.길이.p90} 자 (min ${보고.길이.min} · max ${보고.길이.max}) |`,
    `| 한글 비율 평균(인용·코드 제외) | ${보고.한글비율평균} |`,
    `| 「원문:」 인용 성립률 | ${(보고.인용성립 * 100).toFixed(0)}% |`,
    `| 교사 토큰 | prompt ${보고.토큰.prompt} · completion ${보고.토큰.completion} |`,
    `| 교사 호출 | ${보고.호출}회 · 합 ${(보고.교사ms / 60000).toFixed(1)}분 · 평균 ${보고.호출 ? (보고.교사ms / 보고.호출 / 1000).toFixed(0) : 0}s |`, "",
    "## 탈락 사유", "",
    ...(Object.keys(보고.탈락).length ? ["| 사유 | 건수 |", "|---|---|", ...Object.entries(보고.탈락).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`)] : ["(없음)"]), "",
    `- 탈락 답 **전문**(사유·형식·질문·답·조각 sha12)은 \`${NAME}.rejected.json\` 에 ${탈락기록.length}건 그대로 있다 —`,
    "  아래 표본은 사람이 읽으라고 추린 것이고, **다시 재는 자리는 그 파일**이다(회전 2에서 400자만 남아 재측정을 못 했다).", "",
    ...(Object.keys(보고.탈락표본).length
      ? ["## 탈락 표본(사유마다 앞 2건) — 다음 회차에서 무엇을 고칠지 보려고 남긴다", "",
         ...Object.entries(보고.탈락표본).flatMap(([사유, 목록]) => [`### ${사유}`, "", ...목록.map((x) => `- \`${x.cve}\` (${x.길이}자)\n\n  > ${String(x.답머리).replace(/\n/g, "\n  > ")}`), ""])]
      : []),
    ...(보고.실패.length ? [`## 교사 호출 실패(앞 ${보고.실패.length}건만 적는다)`, "", ...보고.실패.slice(0, 20).map((s) => `- ${s}`), ""] : []),
    "## 서식의 정본과 v1 폐기 (상위 결정 D1)", "",
    `- 조치 요청서의 정본은 **제품 서식**이다 — \`server/src/engine/remrequest.ts\` 의 buildRequestDraft() 가 찍는 ${절_요청서.length}절:`,
    `  ${절_요청서.join(" / ")}.`,
    "- ⚠ 1차 산출 `longform-vuln-v1.json` 의 조치 요청서 83행은 **폐기**한다. 그 83행은 벤치마크 채점기",
    `  (\`tools/team-bench/tasks-r2.mjs\` 필수절6 = ${절_벤치_2회차.join("·")})의 절 이름으로 쓰였다.`,
    "  시험이 세는 서식을 재료로 가르치면 **시험을 답에 맞추는** 것이 된다 — 점수는 오르고 제품 서식은 그대로다.",
    "  파일은 기록으로 남기되 이 v2에 넣지 않았다(이어 붙이기도 v2 산출에서만 한다).",
    "- 심사가 벤치 절 세트를 **금지**로 거른다 — 여섯이 전부 줄 머리 제목으로 서면 탈락(개별 낱말은 허용).",
    "- 절 이름이 제품과 갈라지지 않는지는 `server/test/distilllongform.test.ts` ⑥ 이 소스로 대조한다.", "",
    "## 이 재료를 어디에 쓰나", "",
    `- \`tools/build-raft-dataset.mjs --longform-dataset ${path.relative(저장소, 기록).replace(/\\/g, "/")}\` 의 입력이다.`,
    "- 행 스키마: `{question, answer, system, meta:{kind, cve, chunkSha12}}` — 파일 최상위는 **행 배열**이다.",
    `- \`system\` 은 제품 추론과 같은 꼴이다: 팀원(${AGENT}) 프롬프트 + 빈 줄 + 근거 블록(GET /api/learnloop/raft/prompt에서 받은 머리말).`,
    "- ⚠ 학습 전용이다. 승인함(learnloop)·RAG 지식 저장소에 넣지 않는다.", "",
  ].join("\n");
  fs.writeFileSync(path.join(저장소, "tools", "team-bench", "results-ladder", "day2", "build", `${NAME}.report.md`), md, "utf8");
  fs.writeFileSync(path.join(저장소, "tools", "team-bench", "results-ladder", "day2", "build", `${NAME}.build.json`), JSON.stringify(보고, null, 2), "utf8");
  // ⚠ **이번 회차에 떨어진 것만** 담긴다(--resume 이면 앞 회차 탈락은 여기 없다 — 앞 회차 파일에 있다).
  //   덮어쓰기라, 같은 이름으로 다시 돌리기 전에 앞 파일을 챙길 것.
  const 탈락파일 = path.join(저장소, "tools", "team-bench", "results-ladder", "day2", "build", `${NAME}.rejected.json`);
  fs.writeFileSync(탈락파일, JSON.stringify(탈락기록, null, 2), "utf8");

  console.log(`[longform] 끝 — 생성 ${보고.생성} · 채택 ${보고.채택}(6절 ${보고.형식별.remreq} · 5절 ${보고.형식별.execsum}) · 탈락 ${JSON.stringify(보고.탈락)} · 길이 p50 ${보고.길이.p50}/p90 ${보고.길이.p90} · 교사 ${보고.교사} · ${보고.소요분}분`);
  console.log(`[longform] 저장 — ${로컬} · ${기록}`);
  console.log(`[longform] 탈락 전문 ${탈락기록.length}건 — ${탈락파일}`);
}

// 짝 시험이 위 순수 함수들을 import한다 — **직접 실행할 때만** 본체가 돈다(import로는 안 돈다).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main().catch((e) => { console.error("[longform] 실패:", e.message); process.exit(1); });
}
