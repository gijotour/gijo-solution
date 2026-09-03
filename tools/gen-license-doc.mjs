// tools/gen-license-doc.mjs — 지식 문서 「오픈소스 라이선스 — 무엇을 요구받게 되는가」의 등급표를 **판정 규칙에서 굽는다.**
//
// ■ 왜 생겼나 (2026-09-03, 부품표 팀원 증류 재료 — 계획서 §3.3.1 bom)
//   그 문서의 등급표를 사람이 손으로 적어 두었더니 규칙과 어긋나 있었다 — 「LGPL(정적 링크 시)=제품 전체 소스 공개」라
//   적었는데 규칙은 LGPL을 언제나 고친 파일 공개 + 확인 필요로 판정한다. 문서는 고객 답변의 근거이고 부품표 팀원이
//   배울 재료라, 어긋난 채 두면 규칙은 맞는데 팀원이 틀린 말을 배운다. 「같은 것을 두 곳에 적으면 반드시 하나가
//   낡는다」의 문서판이다. 그래서 표는 규칙(licenserisk)이 만들고, 이 도구는 문서의 표식 사이를 그 출력으로
//   갈아 끼울 뿐이다 — 규칙이 바뀌면 표도 따라 바뀐다.
//
// 쓰는 법:  node tools/gen-license-doc.mjs           → 문서의 표식 사이를 규칙의 표로 갱신
//           node tools/gen-license-doc.mjs --check   → 쓰지 않고 대조만, 다르면 exit 1
//   (server/test/licensedoc.test.ts가 문서와 규칙을 글자 단위로 대조한다 — 규칙을 고치고 안 돌리면 시험이 잡는다.
//    server/scripts/gen-exam-questions.mjs + examquestions.test.ts 짝과 같은 본보기.)
//
// ⚠ 등급 이름·요구 문장을 여기 적지 않는다 — 판정기(dist)를 불러 그 출력만 쓴다(gen-sbom-self.mjs와 같은 계약,
//   licensedoc.test의 소스 감시가 지킨다).
// ⚠ 외부 꾸러미를 쓰지 않는다(toolsdeps 계약) — node 내장만. dist 상대경로 require는 그 대조의 대상이 아니다.
// ⚠ 표식은 HTML 주석이다 — 지식 반입(memory.ts)이 HTML 주석을 색인에서 빼므로 고객 답변에 새지 않는다.
//   표식 글자 자체에도 파일명·명령을 넣지 않는다(corpusleak 계약 — 코퍼스 문서에 소스 경로·빌드 명령 금지).
// ⚠ 판정기를 **직접 실행할 때만** 부른다 — 시험이 표식 도우미만 가져다 쓰는데, 모듈 로드 시점에 dist를 요구하면
//   dist 없는 시험 사본에서 도우미까지 죽는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 굽는 대상 — 저장소 뿌리 기준 경로. docs-manifest.json에 같은 경로로 등록돼 있다(시험이 대조한다). */
export const 문서경로 = "knowledge/오픈소스_라이선스_의무_등급.md";

/** 표식 한 쌍 — 이 사이만 갈아 끼운다. 사람 글(앞뒤 서사)은 손대지 않는다. */
export const 표식 = { 시작: "<!-- 등급표 시작 -->", 끝: "<!-- 등급표 끝 -->" };

/** 문서 원문에서 표식 사이를 찾는다. 없거나 순서가 뒤집혔으면 null — 빈 표를 조용히 끼우지 않는다. */
export function 표식사이(원문) {
  const a = 원문.indexOf(표식.시작);
  const b = 원문.indexOf(표식.끝);
  if (a < 0 || b < 0 || b < a) return null;
  return {
    앞: 원문.slice(0, a + 표식.시작.length),
    사이: 원문.slice(a + 표식.시작.length, b),
    뒤: 원문.slice(b),
    // CRLF/LF는 문서의 것을 따른다 — 도구가 개행을 바꾸면 diff가 통째로 난다.
    개행: 원문.includes("\r\n") ? "\r\n" : "\n",
  };
}

/** 표식 사이의 표 본문 — 표식 바로 뒤·바로 앞의 개행 하나씩을 뺀 것. 표식이 없으면 null. */
export function 표본문(원문) {
  const r = 표식사이(원문);
  if (!r) return null;
  return r.사이.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

/** 표식 사이를 새 표로 바꾼 원문. 표는 LF로 들어오고 문서 개행으로 바꿔 넣는다. */
export function 표끼우기(원문, 표) {
  const r = 표식사이(원문);
  if (!r) throw new Error(`표식(${표식.시작} … ${표식.끝}) 한 쌍을 찾지 못했습니다`);
  return r.앞 + r.개행 + 표.split("\n").join(r.개행) + r.개행 + r.뒤;
}

function 직접실행인가() {
  if (!process.argv[1]) return false;
  const 나 = fileURLToPath(import.meta.url);
  const 부른것 = path.resolve(process.argv[1]);
  // 윈도우는 드라이브 글자 대소문자가 갈릴 수 있다(D:\ vs d:\) — 경로 비교는 대소문자를 무시한다.
  return process.platform === "win32" ? 부른것.toLowerCase() === 나.toLowerCase() : 부른것 === 나;
}

if (직접실행인가()) {
  const 검사만 = process.argv.includes("--check");

  // ── 판정기를 가져온다 — **여기서 규칙을 다시 쓰지 않는다** ─────────────────────────
  //   dist가 있으면 그걸 쓰고, 없으면 안내하고 멈춘다(규칙을 복사해 두면 반드시 어긋난다).
  const 판정기경로 = path.join(루트, "server", "dist", "engine", "licenserisk.js");
  if (!fs.existsSync(판정기경로)) {
    console.error(`★ 판정기가 없습니다: ${판정기경로}`);
    console.error("  먼저 서버를 빌드하세요:  cd server && npx tsc -p tsconfig.json");
    console.error("  ⚠ 여기에 규칙이나 표를 손으로 적지 마세요 — 잣대가 두 벌이 되면 반드시 하나가 낡습니다.");
    process.exit(2);
  }
  // ⚠ 서버는 CommonJS로 빌드된다 — ESM import()로는 못 읽는다(exports is not defined). createRequire로 부른다.
  const 판정기 = createRequire(import.meta.url)(판정기경로);
  if (typeof 판정기.등급표문서 !== "function") {
    console.error("★ dist가 낡았습니다 — 등급표 함수가 없습니다. 서버를 다시 빌드하세요:  cd server && npx tsc -p tsconfig.json");
    process.exit(2);
  }
  const 표 = 판정기.등급표문서();

  const 문서 = path.join(루트, 문서경로);
  if (!fs.existsSync(문서)) {
    console.error(`★ 문서가 없습니다: ${문서경로}`);
    process.exit(2);
  }
  const 원문 = fs.readFileSync(문서, "utf8");
  const 지금 = 표본문(원문);
  if (지금 === null) {
    console.error(`★ 문서에 표식 한 쌍이 없습니다: ${표식.시작} … ${표식.끝}  (${문서경로})`);
    process.exit(2);
  }
  const 같다 = 지금.split(/\r?\n/).join("\n") === 표;

  if (검사만) {
    if (같다) {
      console.log(`✓ 등급표가 규칙과 같습니다 — ${문서경로}`);
      process.exit(0);
    }
    console.error(`✗ 등급표가 규칙과 다릅니다 — ${문서경로}`);
    console.error("  → node tools/gen-license-doc.mjs 를 돌려 표를 갱신하고, 규칙 변경과 함께 커밋하세요.");
    process.exit(1);
  }

  if (같다) {
    console.log(`변경 없음 — 표가 이미 규칙과 같습니다 (${문서경로})`);
    process.exit(0);
  }
  fs.writeFileSync(문서, 표끼우기(원문, 표), "utf8");
  console.log(`✓ 등급표 갱신 → ${문서경로} (${표.split("\n").length - 2}줄)`);
}
