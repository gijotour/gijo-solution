// engine/airgap.ts — 에어갭(air-gap) 봉인 스위치. (계획서 후-4 v1, 2026-08-04)
//
// ■ 왜 필요한가
//   N2SF 기밀·방산 배치는 "인터넷으로 아무것도 안 나간다"를 **증명**할 수 있어야 한다.
//   지금은 외부 호출마다 켜고 끄는 토글이 흩어져 있어(키·설정·기본 OFF) "전부 막혔나"를
//   한눈에 못 본다. 그래서 **단일 관문**을 둔다: 에어갭 모드면 globalThis.fetch가
//   비-내부 호스트 요청을 전량 거부한다. 관문이 하나라 감사도 증명도 한 곳이다.
//
// ■ default-deny
//   호스트가 **내부(루프백·사설 IP·명시 허용)로 확인될 때만** 통과시킨다. 공개 호스트명은
//   물론이고 판단이 안 서는 것도 막는다 — 봉인은 "확실히 내부일 때만 통과"여야 구멍이 안 생긴다.
//   외부 호스트명은 에어갭에서 DNS로 못 풀 수도 있어 IP 대역만으로 내부를 판정한다.
//
// ■ 스위치는 env(GIJO_AIRGAP)다 — 런타임 토글이 아니다.
//   침해된 admin이 화면에서 봉인을 풀지 못하게. 배치(에디션) 성격의 결정이라 기동 환경이 정한다.
import { recordAudit } from "./audit";

export interface EgressPoint {
  id: string;    // 코드상 식별(파일)
  label: string; // 사람이 읽는 이름
  host: string;  // 대표 외부 호스트
  대체: string;  // 에어갭에서 무엇으로 대체하나
}

// 제품이 인터넷으로 나가는 통로 — 자가확인·상태 조회가 이 목록을 보여준다.
// ⚠ 새 외부 호출(fetch)을 추가하면 **여기에도 적는다.** airgap.test.ts가 소스를 훑어
//   실제 외부 호스트가 이 목록에 있는지 대조한다 — 빠지면 시험이 막는다(봉인의 사각지대 방지).
export const EGRESS_POINTS: EgressPoint[] = [
  { id: "cloudllm", label: "클라우드 LLM", host: "api.anthropic.com · api.openai.com · generativelanguage.googleapis.com", 대체: "로컬 LLM(llama.cpp)로 전량 처리" },
  { id: "cti", label: "위협 인텔 피드", host: "otx.alienvault.com", 대체: "오프라인 위협 지식(온톨로지 표준)" },
  { id: "kev", label: "CISA KEV 자동 갱신", host: "www.cisa.gov", 대체: "지식 번들(후-3)의 오프라인 KEV 스냅샷" },
  { id: "lawinfo", label: "법제처 법령 조회", host: "www.law.go.kr", 대체: "사내 규정 문서(RAG)" },
  { id: "hfmodels", label: "HuggingFace 모델 검색·다운로드", host: "huggingface.co", 대체: "사전 반입한 모델 파일(오프라인 이식)" },
  { id: "reposcan", label: "외부 저장소 스캔", host: "api.github.com", 대체: "사내 저장소(사설망 IP·명시 허용)" },
];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** 사설/내부 IP 대역인가 — 이 대역은 에어갭에서도 허용(내부망 SIEM·git 등). */
export function isPrivateIp(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;          // 192.168.0.0/16
    if (a === 127) return true;                       // 루프백
    if (a === 169 && b === 254) return true;          // link-local
    return false;
  }
  const h = host.replace(/^\[|\]$/g, "").toLowerCase(); // IPv6 대괄호 제거
  if (h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80")) return true;                     // link-local
  return false;
}

function 명시허용(): string[] {
  return (process.env.GIJO_AIRGAP_ALLOW ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAirgapOn(): boolean {
  const v = (process.env.GIJO_AIRGAP ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** 이 URL이 에어갭에서 나가도 되는가. default-deny — 내부로 확인될 때만 허용. */
export function egressAllowed(urlString: string): { allowed: boolean; host: string; reason: string } {
  let host = "";
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    // 상대경로·비정상 URL은 나갈 호스트가 없다 — fetch가 알아서 처리하게 둔다(우리가 막을 것이 없다).
    return { allowed: true, host: "", reason: "호스트 없음" };
  }
  if (LOOPBACK.has(host)) return { allowed: true, host, reason: "루프백" };
  if (isPrivateIp(host)) return { allowed: true, host, reason: "사설 IP 대역(내부망)" };
  if (명시허용().includes(host)) return { allowed: true, host, reason: "명시 허용(GIJO_AIRGAP_ALLOW)" };
  return { allowed: false, host, reason: "외부 호스트 — 에어갭 봉인" };
}

let 설치됨 = false;
let 차단수 = 0;

/** globalThis.fetch를 감싸 에어갭 봉인을 강제한다. 부팅 아주 이른 시점에 한 번 부른다(멱등). */
export function installAirgapGuard(): void {
  if (설치됨) return;
  설치됨 = true;
  if (!isAirgapOn()) {
    console.log("[airgap] 에어갭 모드 꺼짐 — 외부 통로 열림(일반 배치).");
    return;
  }
  const 원래fetch = globalThis.fetch;
  if (typeof 원래fetch !== "function") return;
  const guarded: typeof fetch = async (input, init) => {
    const urlStr =
      typeof input === "string" ? input :
      input instanceof URL ? input.href :
      (input as Request)?.url ?? String(input);
    const v = egressAllowed(urlStr);
    if (!v.allowed) {
      차단수++;
      // 봉인 위반 시도는 그 자체가 사건이다 — 감사에 남긴다. 캐치되어 조용히 사라지지 않게.
      recordAudit({
        kind: "block", actor: "시스템(에어갭)",
        action: "에어갭 외부 요청 차단", target: v.host,
        detail: `막은 요청: ${urlStr.slice(0, 120)}`, result: "blocked",
      });
      throw new Error(`에어갭 모드: 외부 호스트(${v.host}) 요청이 봉인으로 차단됐습니다.`);
    }
    return 원래fetch(input, init);
  };
  globalThis.fetch = guarded;
  console.log(`[airgap] 봉인 ON 🔒 — 비-내부 fetch 전량 차단(외부 통로 ${EGRESS_POINTS.length}종). 명시 허용: ${명시허용().join(", ") || "(없음)"}`);
}

export interface AirgapStatus {
  on: boolean;
  blockedCount: number;
  allow: string[];
  points: EgressPoint[];
}
export function airgapStatus(): AirgapStatus {
  return { on: isAirgapOn(), blockedCount: 차단수, allow: 명시허용(), points: EGRESS_POINTS };
}
