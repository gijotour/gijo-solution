// engine/cloudegress.ts — 클라우드 유출 방지 게이트 (선택적 클라우드 LLM 하이브리드의 보안 핵심).
//
// 설계 원칙(2026-07-19 확정): 외부(클라우드 API)로 나가는 질문에 사내 정보가 한 조각도 섞이지
// 않도록 **결정적 규칙**으로 검사한다. LLM에게 "이거 민감해?"라고 묻지 않는다 — 그게 바로 못 믿는
// 그 모델이므로. 의심스러우면 무조건 차단하고 로컬로 답하게 한다(오차단은 허용, 유출은 절대 불가).
//
// 검사 대상은 "사용자가 클라우드로 보내려는 순수 질문 텍스트" 하나뿐이다. RAG 검색 결과·도구
// 결과·자산 상세 같은 내부 맥락은 애초에 클라우드 호출에 싣지 않는다(cloudllm.ts가 맨몸 질문만
// 보냄) — 이 게이트는 사용자 질문 자체에 내부 식별자가 들어간 경우를 잡는 2차 방어선이다.

import { listAssets } from "./assets";
import { findSecrets } from "./secretscan";
import { listUsers } from "../auth/users";

export interface EgressDecision {
  allowed: boolean;
  reasons: string[]; // 차단 사유(감사 로그·UI 표시용). allowed=true면 빈 배열.
}

// 사설/내부 IP 대역 — 이게 질문에 있으면 내부 자산을 가리키는 것이다(공인 IP는 통과).
// 10.0.0.0/8 · 172.16.0.0/12 · 192.168.0.0/16 · 127.0.0.0/8(loopback) · 169.254(link-local).
const PRIVATE_IP_RE =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/;

// 자산 id 형태 — vuln:<host> / ai-xxx-01 처럼 이 시스템이 만드는 식별자는 매우 고유해 오탐이 없다.
const ASSET_ID_SHAPE_RE = /\bvuln:[^\s]+/i;

// "우리/사내" 맥락을 강하게 암시하는 표현 — 일반 지식 질문이 아니라 내부 대상을 묻는 신호.
const INTERNAL_CONTEXT_TERMS = [
  "우리 자산",
  "우리 서버",
  "우리 회사",
  "우리 시스템",
  "사내 자산",
  "사내 서버",
  "내부 자산",
  "내부 서버",
  "우리 취약점",
  "우리 스캔",
  "우리 자산의",
];

// 자산명/직원명 매칭에서 제외할 너무 흔한 단어 — 이런 단어만으로는 내부 정보로 보지 않는다
// (예: 자산명이 "웹 서버"라고 해서 "웹 서버가 뭐야?" 일반 질문까지 막으면 오차단이 과하다).
const GENERIC_NAME_TOKENS = new Set([
  "서버", "시스템", "자산", "챗봇", "서비스", "테스트", "샘플", "웹", "모델",
  "server", "system", "asset", "service", "test", "sample", "web", "model", "the", "local",
]);

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

// 호스트명·식별자 형태의 토큰(oracle.local · web-01 · db.internal) — 점/하이픈으로 이어진 이런
// 토큰은 자산명 안에 IP와 함께 들어 있어도(예: "oracle.local (192.168.219.98)"), 사용자가 IP 없이
// 호스트명만 지목할 수 있다. 이 토큰들은 매우 고유해 오탐 없이 강하게 차단한다.
const HOSTNAME_OR_ID_RE = /^[a-z0-9]+(?:[.\-][a-z0-9]+)+$/;

// 자산명이 식별력 있는지 — 구분자를 떼고 남는 글자가 4자 이상이고, 제네릭 토큰만으로 이뤄지지
// 않았을 때만 매칭 대상으로 삼는다(오탐 억제).
function distinctiveName(name: string): string | null {
  const compact = norm(name);
  if (compact.length < 4) return null;
  const tokens = name.toLowerCase().split(/[\s()[\]/·,]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => t.length >= 2 && !GENERIC_NAME_TOKENS.has(t));
  if (meaningful.length === 0) return null;
  return compact;
}

// 자산명에서 호스트명·식별자형 토큰만 뽑는다(IP가 빠진 호스트명 단독 지목을 잡기 위해).
function hostLikeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s()[\]/·,]+/)
    .filter((t) => t.length >= 4 && HOSTNAME_OR_ID_RE.test(t) && !/^\d+(?:\.\d+)+$/.test(t));
}

// 클라우드로 보내도 되는지 결정적으로 판정한다. 내부 식별자가 하나라도 걸리면 차단.
export function screenForCloud(question: string): EgressDecision {
  const q = question ?? "";
  const nq = norm(q);
  const reasons: string[] = [];

  if (PRIVATE_IP_RE.test(q)) reasons.push("사설/내부 IP 주소가 포함됨");
  if (ASSET_ID_SHAPE_RE.test(q)) reasons.push("내부 자산 식별자(vuln:…)가 포함됨");

  // 실제 등록된 자산 id·자산명과 대조 — 이 시스템에 존재하는 대상을 지목하면 내부 질문이다.
  try {
    for (const a of listAssets()) {
      if (a.id && nq.includes(norm(a.id))) {
        reasons.push(`등록된 자산 id "${a.id}"와 일치`);
        break;
      }
    }
    for (const a of listAssets()) {
      const d = distinctiveName(a.name ?? "");
      const hostHit = hostLikeTokens(a.name ?? "").some((t) => nq.includes(t));
      if ((d && nq.includes(d)) || hostHit) {
        reasons.push(`등록된 자산명 "${a.name}"과 일치`);
        break;
      }
    }
  } catch {
    // 자산 목록 조회 실패 시엔 안전하게 차단 쪽으로 — 확인 못 하면 내보내지 않는다.
    reasons.push("내부 자산 대조를 확인할 수 없어 안전상 차단");
  }

  // 직원(사용자) 실명 — displayName이 질문에 그대로 있으면 내부 인물 지목으로 본다.
  try {
    for (const u of listUsers()) {
      const name = (u.displayName ?? "").trim();
      if (name.length >= 2 && !GENERIC_NAME_TOKENS.has(name.toLowerCase()) && nq.includes(norm(name))) {
        reasons.push("등록된 담당자 이름이 포함됨");
        break;
      }
    }
  } catch {
    reasons.push("담당자 대조를 확인할 수 없어 안전상 차단");
  }

  for (const term of INTERNAL_CONTEXT_TERMS) {
    if (nq.includes(norm(term))) {
      reasons.push(`내부 대상을 지시하는 표현("${term}")이 포함됨`);
      break;
    }
  }

  // 자격증명 — 여기까지는 IP·자산·사람 이름만 봤다. 그런데 담당자가 매뉴얼 한 대목을 붙여넣으면
  // 그 안에 초기 비밀번호·API 키가 딸려 온다(2026-07-30 실측: 문서의 자격증명이 답변에 그대로 나옴).
  // 자산명이 없어도 **비밀 그 자체는 절대 외부로 나가면 안 된다** — 종류만 밝히고 값은 안 적는다.
  // ⚠ 정적 import로 부른다. 처음에 require()로 썼더니 ESM에서 조용히 던지고 catch가 삼켜
  //   **검사가 아예 안 돌았다**(시험이 잡았다, 2026-07-30). 보안 검사는 실패하면 안 걸린
  //   것과 구분되지 않으므로, 실패할 수 있는 방식으로 부르지 않는다.
  const secrets = findSecrets(q);
  if (secrets.length > 0) {
    const kinds = [...new Set(secrets.map((s) => s.kind))].join("·");
    reasons.push(`자격증명(${kinds})이 포함됨 — 값은 기록하지 않습니다`);
  }

  return { allowed: reasons.length === 0, reasons };
}
