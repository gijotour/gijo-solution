// engine/learnpolicy.ts — **무엇으로 모델을 가르치지 않을 것인가.**
//
// 실측(2026-07-31): 학습 후보 385건 중 한 질문이 66회였고 그중 62건이 대화로그였다.
// QA 하네스는 qa:true로 잘 격리돼 있었고 **범인은 배포 계정(claude-deploy)의 손 검증**이었다.
// 사람이 업무로 쓰는 계정이 아니라 검증하느라 같은 질문을 수십 번 던지는 계정이다.
// 그대로 학습시키면 제품이 아니라 **시험을 배운다.**
//
// ■ 왜 llm.ts가 아니라 여기인가
//   처음엔 llm.ts에 두었다가 시험 4개가 깨졌다 — 그 파일을 vi.mock으로 통째로 바꿔치기하는
//   시험이 많아, export 하나를 더할 때마다 목을 같이 고쳐야 했다.
//   "어떤 계정을 학습에서 뺄까"는 애초에 LLM의 관심사가 아니다. 정책은 정책 자리에 둔다.

/**
 * 이 계정들의 문답은 학습에 넣지 않는다(동작은 그대로 — 학습 수집만 건너뛴다).
 *
 * ⚠ qa 플래그와 다르다. qa는 "이건 시험이다"라 단기 기억까지 끊어 문항 간 독립을 만든다.
 *   여기서 필요한 건 **사람이 쓰는 것과 똑같이 동작하되 학습에만 안 들어가는 것**이다 —
 *   그래야 배포 계정으로 한 검증이 실제 사용과 같은 경로를 지난다.
 * ⚠ 이 판단은 **서버가 한다.** 요청이 "나는 학습에서 빼 줘"라고 주장할 수 있으면
 *   담당자 문답을 빼돌려 학습을 굶길 수 있다(trusted를 서버가 정하는 것과 같은 이유).
 */
const NON_LEARNING_ACCOUNTS = new Set(["claude-deploy", "gijo-publish"]);

export function isNonLearningAccount(username?: string | null): boolean {
  return !!username && NON_LEARNING_ACCOUNTS.has(username);
}

/**
 * 작업 내역(세션)을 연 사람이 자동화 계정인가 — **후보함이 보는 판별자.**
 *
 * ⚠ 세션에는 계정 아이디가 아니라 **표시 이름**이 적힌다(createdBy = displayName).
 *   그래서 위 아이디 집합만으로는 못 거른다. 실제로 이 구멍으로 QA·리허설 문답 7건이
 *   후보함에 올라왔다(2026-08-08 — 대화 로그 경로는 막혀 있었는데 세션 경로만 뚫려 있었다).
 *   정책이 있어도 **부르지 않으면 소용없다**는 이 저장소의 반복 교훈이 또 나온 자리다.
 * ⚠ 사람 이름을 넣지 말 것 — 담당자 문답이 학습에서 통째로 빠진다.
 */
const NON_LEARNING_SESSION_OWNERS = new Set([
  "배포 자동화 전용", // claude-deploy
  "게시 전용", // gijo-publish
  "인수인계-자동검증",
  "redteam-effective",
  "시스템",
]);

export function isNonLearningSessionOwner(createdBy?: string | null): boolean {
  if (!createdBy) return false;
  const 이름 = createdBy.trim();
  return NON_LEARNING_SESSION_OWNERS.has(이름) || NON_LEARNING_ACCOUNTS.has(이름);
}
