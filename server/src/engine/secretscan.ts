// engine/secretscan.ts — 자격증명(비밀번호·API 키·개인키)이 **밖으로 나가는 것**을 막는다.
// (계획서 후-1 "AI 견고성/자체 보안" 잔여 — 출력 방향 마지막 관문)
//
// ■ 무엇이 문제인가 (2026-07-30 실측)
//   담당자가 올리는 문서에는 자격증명이 실제로 들어 있다 — 벤더 매뉴얼의 초기 비밀번호,
//   점검 보고서의 계정, 설정 파일의 API 키. 실측해 보니 질문 한 번에 그대로 답변에 나왔다:
//     "FW-2000 초기 접속 절차 알려줘" → "초기 비밀번호: P@ssw0rd-… / API 연동 키: sk-live-…"
//
// ■ 그런데 화면에 보이는 것 자체는 유출이 아니다 — 여기서 선을 긋는다
//   그 문서를 올린 사람이 담당자 본인이고, 지식베이스를 볼 권한이 있다. 화면 답변까지
//   가려 버리면 "매뉴얼을 물어봐도 안 알려주는 제품"이 된다 — 본말전도다.
//   **위험한 것은 그 값이 이 시스템 밖으로 나가거나, 오래 남는 경우다:**
//     ① 리포트 파일(DOCX·PDF) — 경영진·감사·협력사에게 그대로 전달된다
//     ② 클라우드 LLM — 외부 사업자 서버로 전송된다(기존 egress 게이트는 IP·자산명만 봤다)
//     ③ 감사·세션 기록 — DB에 평문으로 오래 쌓인다
//   그래서 **나가는 자리와 남는 자리에서만** 가린다.
//
// ■ 오탐이 더 위험하다
//   보안 문서에는 "비밀번호 정책", "API 키를 안전하게 보관", "<password>" 같은 자리표시자가
//   널려 있다. 값처럼 보이는 실제 문자열만 잡고, 설명·정책·자리표시자는 건드리지 않는다.

export interface SecretHit {
  kind: string; // 사람이 읽을 종류("API 키", "비밀번호" 등)
  match: string; // 원본(로그에 남기지 않는다 — 호출자가 마스킹해 쓴다)
  index: number;
}

// 자리표시자·예시 — 이런 값은 진짜 비밀이 아니다.
// ⚠ 자리표시자는 하이픈으로 이어진 여러 낱말이 흔하다("your-api-key") — \w*로는 못 잡는다
//   (시험이 오탐으로 잡았다, 2026-07-30).
const PLACEHOLDER_RE =
  /^(\*+|x+|\.+|-+|<[^>]*>|\[[^\]]*\]|여기에?|입력|(your|my|the)[-_ ][\w-]*|example[\w-]*|sample[\w-]*|changeme|test[-_]?(key|password)?|password|passwd|비밀번호|암호)$/i;

function isPlaceholder(v: string): boolean {
  const t = v.trim().replace(/^["'`]|["'`]$/g, "");
  if (t.length < 6) return true; // 너무 짧으면 값으로 보지 않는다(오탐이 훨씬 많다)
  if (PLACEHOLDER_RE.test(t)) return true;
  if (/^[*x·•]{3,}$/i.test(t)) return true;
  return false;
}

interface Rule {
  kind: string;
  re: RegExp;
  /** 값이 몇 번째 캡처 그룹인지(자리표시자 판정용). 없으면 전체. */
  valueGroup?: number;
}

const RULES: Rule[] = [
  // 개인키 블록 — 통째로 잡는다. 이건 오탐이 사실상 없다.
  { kind: "개인키", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // 널리 쓰이는 발급 키 형식 — 접두어가 특징적이라 오탐이 낮다.
  { kind: "API 키", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "API 키", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: "AWS 액세스 키", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "슬랙 토큰", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // "이름: 값" 꼴 — 값이 실제로 있을 때만. 설명문("비밀번호를 변경한다")은 콜론이 없어 안 걸린다.
  {
    kind: "비밀번호",
    re: /(?:비밀번호|패스워드|암호|password|passwd|pwd)\s*(?:는|은)?\s*[:=]\s*["'`]?([^\s"'`,\n]{6,64})/gi,
    valueGroup: 1,
  },
  {
    kind: "API 키",
    re: /(?:api[\s_-]?key|액세스\s*키|엑세스\s*키|api\s*토큰|access[\s_-]?token|secret[\s_-]?key|연동\s*키)\s*(?:는|은)?\s*[:=]\s*["'`]?([^\s"'`,\n]{8,128})/gi,
    valueGroup: 1,
  },
  // 접속 문자열 안의 자격증명 — user:pass@host
  { kind: "접속 문자열 자격증명", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@]{4,})@[^\s/]+/gi, valueGroup: 1 },
];

/** 텍스트에서 자격증명으로 보이는 것들을 찾는다. 값이 자리표시자면 무시한다. */
export function findSecrets(text: string): SecretHit[] {
  const out: SecretHit[] = [];
  if (!text) return out;
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = rule.valueGroup ? m[rule.valueGroup] : m[0];
      if (!value || isPlaceholder(value)) continue;
      out.push({ kind: rule.kind, match: value, index: m.index });
      if (re.lastIndex === m.index) re.lastIndex++; // 0폭 매치 방어
    }
  }
  return out;
}

/** 값을 가린다. 앞 2자만 남겨 "무엇이 가려졌는지"는 알 수 있게 한다(조사에 필요). */
function maskValue(v: string): string {
  const head = v.slice(0, 2);
  return `${head}${"•".repeat(Math.min(10, Math.max(4, v.length - 2)))}(가림)`;
}

export interface MaskResult {
  text: string;
  hits: { kind: string; masked: string }[]; // 원본 값은 담지 않는다 — 이걸 로그에 써도 안전하게
}

/**
 * 자격증명을 가린 사본을 만든다. 원본은 건드리지 않는다.
 * 나가는 자리(리포트·클라우드)와 남는 자리(감사·세션)에서만 쓴다.
 */
export function maskSecrets(text: string): MaskResult {
  if (!text) return { text: text ?? "", hits: [] };
  const hits = findSecrets(text);
  if (hits.length === 0) return { text, hits: [] };

  // 뒤에서부터 치환해야 앞선 index가 밀리지 않는다.
  let out = text;
  const seen = new Set<string>();
  const list = [...hits].sort((a, b) => b.index - a.index);
  for (const h of list) {
    // 같은 값이 여러 번 나오면 전부 가린다(위치별 치환 대신 값 단위 전역 치환).
    if (seen.has(h.match)) continue;
    seen.add(h.match);
    out = out.split(h.match).join(maskValue(h.match));
  }
  return {
    text: out,
    hits: [...seen].map((v) => {
      const kind = hits.find((h) => h.match === v)?.kind ?? "자격증명";
      return { kind, masked: maskValue(v) };
    }),
  };
}

/** 자격증명이 있는지만 빠르게 본다(차단 판정용). */
export function hasSecrets(text: string): boolean {
  return findSecrets(text).length > 0;
}
