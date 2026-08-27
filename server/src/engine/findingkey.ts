// engine/findingkey.ts — 취약점 항목의 안정 키(내용 해시). **잎 모듈**이다.
//
// ★ 왜 이 파일인가 (2026-08-27, 의존 수리 화살 #2)
//   이 함수는 원래 approvals.ts에 살았다. 본체가 쓰는 것은 crypto와 타입뿐인데 —
//   결재 엔진(express 라우트·DB·이메일까지 달린 모듈)에 살았던 탓에, 해시 **하나**를
//   얻으려고 네 모듈(assets·datacard·remrequest·verifyengine)이 approvals 전체를 물고
//   들어갔고, assets 쪽은 순환을 피하려고 동적 import까지 썼다. 순수 함수를 잎으로
//   내리면 그 고리가 전부 사라진다. approvals.ts는 재수출해서 옛 호출부(시험 8곳 포함)는
//   한 줄도 안 바뀐다.
//
// ⚠⚠ **해시 조립 문자열을 한 글자도 바꾸지 말 것.** 이 값이 finding_approvals의
//   기본키(assetId, findingKey)다 — 구분자(\0)·필드 다섯·slice(0,16)이 바뀌면
//   운영 DB의 검토 이력 전부가 제 짝을 잃는다(반증 검토 2026-08-23 경고).
import * as crypto from "crypto";
import type { StandardFinding } from "./bridge";

// finding 내용으로 안정적인 키를 만든다 — 같은 finding이면 재스캔 후에도 검토 상태가 유지된다.
export function findingKey(assetId: string, f: StandardFinding): string {
  return crypto
    .createHash("sha1")
    .update(`${assetId}\0${f.finding_type}\0${f.severity}\0${f.evidence}\0${f.source_tool}`)
    .digest("hex")
    .slice(0, 16);
}
