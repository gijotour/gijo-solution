// engine/grades.ts — 업무정보 등급(기밀 C · 민감 S · 공개 O)과 열람 권한.
//
// 국가 망 보안체계(N2SF)는 업무정보를 세 등급으로 나누고 등급마다 다른 통제를 걸도록 한다.
// 지금까지 우리 제품엔 등급이라는 개념 자체가 없어서, 조달 검토자에게 "한 대에 한 등급만
// 쓰세요"라고 안내했다 — 그건 기능이 아니라 회피다. (GIJO_AS_등급라벨_설계.md)
//
// ■ 이 파일이 지키는 두 가지
//   ① **모르면 닫는다** — 단, 무엇을 "모른다"고 할지는 갈라 봐야 한다(gradeOf 주석 참고).
//      사람의 열람 권한을 못 읽으면 가장 낮은 권한(공개만)으로 본다. 이 원칙은 그대로다.
//   ② **판단은 한 곳에서.** 등급 비교를 여기저기서 하면 한 곳만 고쳐 놓고 고쳤다고 믿게 된다.

// ★ 개발 모드(2026-08-23) — 등급 게이트를 **개발 기간에만** 푼다.
//   환경변수 GIJO_DEV_MODE=1로만 켜지고 기본은 꺼짐이다(util/devmode.ts 머리주석에 이유).
import { 개발모드 } from "../util/devmode";

/** 낮을수록 공개. 숫자로 비교하므로 순서를 바꾸면 안 된다. */
export const GRADES = ["O", "S", "C"] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_LABEL: Record<Grade, string> = { O: "공개", S: "민감", C: "기밀" };

const RANK: Record<Grade, number> = { O: 0, S: 1, C: 2 };

/**
 * 등급을 아직 안 매긴 자료를 어떻게 볼 것인가. **공개(O)** 다.
 *
 * ⚠ 처음엔 민감(S)으로 뒀다가 되돌렸다(2026-08-01 실측). 이유:
 *   사람의 열람 등급 기본값이 공개만(O)이라, 문서 기본이 S면 **새 문서를 아무도 못 본다.**
 *   설계에는 "가운데라 안전하면서 일이 돌아간다"고 적어 놨는데, 짝이 되는 기본값을 같이
 *   보지 않아 실제로는 기밀과 똑같이 동작했다. 기본값은 **둘을 곱해서** 판단해야 한다.
 *
 * 이렇게 두면 등급 운영을 시작하기 전 기관은 지금까지처럼 그대로 쓰고,
 * 등급을 매기기 시작한 자료부터 막힌다 — 통제를 **켜는** 순서와 맞는다.
 */
export const DEFAULT_DOC_GRADE: Grade = "O";

/**
 * 자료의 등급을 읽는다.
 *
 * ★ **"안 매겼다"와 "값이 깨졌다"는 다르다** — 실사고로 배웠다(2026-08-01).
 *
 *   처음엔 둘 다 기밀(C)로 봤다("모르면 닫는다"). 그런데 등급 칸은 새 문서에 비어 있고,
 *   사람의 열람 등급 기본값은 공개만(O)이다. 두 기본값을 곱하면 **새로 올린 문서를
 *   올린 사람조차 못 본다.** 실측: 파일을 넣고(200 OK) 바로 물었더니 "못 찾음" —
 *   제품의 핵심 기능(문서를 올려 AI가 쓰게)이 조용히 죽어 있었다. 오류도 안 났다.
 *
 *   등급 라벨은 **켜는 기능**이다. 기관이 등급 운영을 시작하기 전까지는 아무것도
 *   막히면 안 된다. 그래서 갈라 놓는다:
 *     · 비어 있음(null·공백) = **아직 안 매겼다** → 공개(O). 통제 대상이 아니다.
 *     · 모르는 값("XX", 깨진 글자) = **뭔가 잘못됐다** → 기밀(C). 여기선 닫는다.
 *
 *   "모르면 닫는다"는 **읽는 쪽**(clearanceOf)에 그대로 살아 있다 — 사람의 권한을 모르면
 *   공개만 보여 준다. 자료 쪽까지 닫으면 제품이 안 돌아간다.
 */
export function gradeOf(value?: string | null): Grade {
  if (value == null || String(value).trim() === "") return DEFAULT_DOC_GRADE; // 아직 안 매김
  const v = String(value).trim().toUpperCase();
  return (GRADES as readonly string[]).includes(v) ? (v as Grade) : "C"; // 값이 깨졌다 → 닫는다
}

/** 사람의 열람 등급을 읽는다. **못 읽으면 공개만(O)** — 모르는 사람에게 열어 주지 않는다. */
export function clearanceOf(value?: string | null): Grade {
  const v = String(value ?? "").trim().toUpperCase();
  return (GRADES as readonly string[]).includes(v) ? (v as Grade) : "O";
}

/** 이 열람 등급으로 저 자료를 볼 수 있는가.
 *
 *  ★ **개발 모드에서는 언제나 참**(2026-08-23 사장님 「개발 동안 제약사항은 다 풀고 하자 ·
 *    등급도 개발 끝나면 지정」). 판정이 **이 한 곳**을 지나므로 여기서만 풀면 된다 —
 *    호출부마다 예외를 두면 한 곳이 빠져 「푼 줄 알았는데 안 풀린」 자리가 생긴다.
 *  ⚠ 환경변수로만 켜지고 기본은 꺼짐이다(util/devmode.ts). 켜져 있으면 부팅과 자가 진단이 말한다.
 */
export function canRead(clearance: Grade, grade: Grade): boolean {
  if (개발모드()) return true;
  return canReadStrict(clearance, grade);
}

/** 개발 모드를 **무시하고** 진짜 규칙만 본다 — 자가 진단·시험이 「원래 규칙」을 재는 데 쓴다. */
export function canReadStrict(clearance: Grade, grade: Grade): boolean {
  return RANK[clearance] >= RANK[grade];
}

/** 이 열람 등급이 **못 보는** 등급들 — 검색에서 미리 빼기 위한 목록. */
export function blockedGrades(clearance: Grade): Grade[] {
  return GRADES.filter((g) => !canRead(clearance, g));
}
