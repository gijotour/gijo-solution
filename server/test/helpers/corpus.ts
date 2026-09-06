// 시험용 — **RAG 코퍼스 문서를 매니페스트대로 훑어 온다** (2026-09-07 신설)
//
// ■ 왜 만들었나 — 같은 훑기 코드가 **두 벌**이었다
//   corpusleak.test.ts(개발 문서가 섞이지 않는가)와 corpusnumowner.test.ts(밖에서 온 백분율에
//   주인이 붙었는가)가 각자 제 손으로 매니페스트를 훑고 있었다. 뒤에 만든 쪽은 머리글에
//   「corpusleak.test.ts와 **같은 방식**으로 훑는다 — 두 시험이 보는 모집단이 갈리면 안 된다」고
//   **적어 두고도 복사**했다. 적어 둔 약속은 코드가 아니라 지켜지지 않는다.
//
//   두 벌이면 반드시 어긋난다. 한쪽만 `_제외`를 반영하거나 docs/ 갈래를 고치면, 다른 시험은
//   **다른 모집단을 보면서 초록**이 된다 — 이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면
//   어긋난다」이고, 하필 두 시험 다 **고객 답변에 무엇이 나가는가**를 지키는 자리다.
//
// ■ 무엇이 규칙인가 — 아래는 두 시험이 **함께** 따르는 단일 출처다
//   ① `.md`로 끝나는 `file` 값만 코퍼스로 본다(매니페스트 구조가 중첩이라 통째로 훑는다)
//   ② `_제외`(일부러 뺀 문서)는 보지 않는다 — 뺀 문서를 검사하면 영영 못 고친다
//   ③ 저장소 뿌리 → `docs/` 순으로 찾아 **처음 있는 것**을 읽는다(없으면 조용히 건너뛴다)
//
// ⚠ 여기를 고치면 **두 감시가 함께** 바뀐다. 훑기가 조용히 좁아지면 둘 다 눈이 먼 채 초록이
//   되므로, corpusleak.test.ts의 「이 감시가 헛돌고 있지 않다」가 결과 개수를 숫자로 못 박는다.
import fs from "node:fs";
import path from "node:path";

/** 저장소 뿌리 — helpers/ 기준으로 두 단계 위(server/test/helpers → server → 뿌리). */
const 뿌리 = path.join(__dirname, "../../..");

export interface 코퍼스문서항목 {
  file: string;
  본문: string;
}

/** docs-manifest.json 원문 — `_제외`처럼 문서 목록 밖의 칸을 볼 때 쓴다. */
export function 코퍼스매니페스트(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(뿌리, "server/docs-manifest.json"), "utf8"));
}

/** 매니페스트에 실린 코퍼스 문서를 **본문까지** 읽어 온다(위 머리글 ①②③ 규칙). */
export function 코퍼스문서(): 코퍼스문서항목[] {
  const manifest = 코퍼스매니페스트();
  const 목록: string[] = [];
  (function 훑기(o: unknown): void {
    if (Array.isArray(o)) { o.forEach(훑기); return; }
    if (o && typeof o === "object") {
      const f = (o as { file?: unknown }).file;
      if (typeof f === "string" && f.endsWith(".md")) 목록.push(f);
      Object.values(o as Record<string, unknown>).forEach(훑기);
    }
  })({ ...manifest, _제외: undefined });   // ⚠ _제외(뺀 문서)는 보지 않는다
  const out: 코퍼스문서항목[] = [];
  for (const f of 목록) {
    for (const d of [뿌리, path.join(뿌리, "docs")]) {
      const p = path.join(d, f);
      if (fs.existsSync(p)) { out.push({ file: f, 본문: fs.readFileSync(p, "utf8") }); break; }
    }
  }
  return out;
}
