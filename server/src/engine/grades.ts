// engine/grades.ts — 업무정보 등급(기밀 C · 민감 S · 공개 O)과 열람 권한.
//
// 국가 망 보안체계(N2SF)는 업무정보를 세 등급으로 나누고 등급마다 다른 통제를 걸도록 한다.
// 지금까지 우리 제품엔 등급이라는 개념 자체가 없어서, 조달 검토자에게 "한 대에 한 등급만
// 쓰세요"라고 안내했다 — 그건 기능이 아니라 회피다. (GIJO_AS_등급라벨_설계.md)
//
// ■ 이 파일이 지키는 두 가지
//   ① **모르면 닫는다.** 등급을 못 읽었으면 가장 높은 등급(기밀)으로, 열람 권한을 못 읽었으면
//      가장 낮은 권한(공개만)으로 본다. 빠뜨림이 "열림"이 되면 그 순간 유출이다.
//   ② **판단은 한 곳에서.** 등급 비교를 여기저기서 하면 한 곳만 고쳐 놓고 고쳤다고 믿게 된다.

/** 낮을수록 공개. 숫자로 비교하므로 순서를 바꾸면 안 된다. */
export const GRADES = ["O", "S", "C"] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_LABEL: Record<Grade, string> = { O: "공개", S: "민감", C: "기밀" };

const RANK: Record<Grade, number> = { O: 0, S: 1, C: 2 };

/**
 * 자료의 등급을 읽는다. **못 읽으면 기밀(C)** — 모르는 자료를 공개로 두면 새어 나간다.
 *
 * ⚠ 여기에 "없으면 공개"를 넣고 싶어질 때가 있다(기존 자료가 다 막히니까).
 *   그건 마이그레이션에서 기존 자료에 등급을 **명시적으로 부여**해 풀 문제다.
 *   기본값을 열어 두면 앞으로 들어올 자료까지 전부 열린다.
 */
export function gradeOf(value?: string | null): Grade {
  const v = String(value ?? "").trim().toUpperCase();
  return (GRADES as readonly string[]).includes(v) ? (v as Grade) : "C";
}

/** 사람의 열람 등급을 읽는다. **못 읽으면 공개만(O)** — 모르는 사람에게 열어 주지 않는다. */
export function clearanceOf(value?: string | null): Grade {
  const v = String(value ?? "").trim().toUpperCase();
  return (GRADES as readonly string[]).includes(v) ? (v as Grade) : "O";
}

/** 이 열람 등급으로 저 자료를 볼 수 있는가. */
export function canRead(clearance: Grade, grade: Grade): boolean {
  return RANK[clearance] >= RANK[grade];
}

/** 이 열람 등급이 **못 보는** 등급들 — 검색에서 미리 빼기 위한 목록. */
export function blockedGrades(clearance: Grade): Grade[] {
  return GRADES.filter((g) => !canRead(clearance, g));
}

/**
 * 새 자료의 기본 등급. **민감(S)** 이다.
 *
 * 공개로 두면 모르는 사이에 다 열리고, 기밀로 두면 아무도 못 봐서 담당자가 등급 기능 자체를
 * 꺼 버린다. 가운데가 실제로 지켜지는 자리다 — 안전하면서 일이 돌아간다.
 */
export const DEFAULT_DOC_GRADE: Grade = "S";
