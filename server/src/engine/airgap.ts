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
  // ⚠ fetch가 아닌 통로 — SMTP·SIEM은 소켓(nodemailer·dgram/net/tls)이라 fetch 관문이 못 본다.
  //   그래서 email.ts·siem.ts가 연결 직전에 assertEgressAllowed로 **호스트를 따로** 검사한다.
  //   봉인 대상 호스트는 설정값이라 고정 이름이 없다(내부망만 허용, 외부는 차단).
  { id: "smtp", label: "메일 발송(SMTP)", host: "설정한 메일 서버(소켓)", 대체: "내부망 릴레이만 허용 · 외부 메일 서버는 봉인" },
  // 점검 서비스(2026-08-11) — 고객 AI 엔드포인트로 공격 문구를 보낸다. 호스트가 고정이 아니라
  // 요청마다 다르므로(smtp·siem과 같은 처지) redteam.ts가 호출 직전 assertEgressAllowed로 검사한다.
  { id: "redteam-remote", label: "외부 AI 엔드포인트 레드팀 점검", host: "점검 대상 주소(요청마다 다름)", 대체: "내부망 AI만 점검 · 외부 대상은 봉인(폐쇄망 고객은 현장에서 내부망으로 점검)" },
  { id: "siem", label: "SIEM 전달(syslog UDP·TCP·TLS)", host: "설정한 SIEM 서버(소켓)", 대체: "내부망 SIEM만 허용 · 외부는 봉인" },
  // ⚠ **SSH도 fetch가 아니다**(2026-08-18에 빠져 있던 것을 찾음). `execFile("ssh"/"sshpass")`라
  //   fetch 관문이 원리상 못 본다 — smtp·siem·redteam과 같은 처지인데 **이 목록에도, 관문에도**
  //   없었다. 폐쇄망 고객에게 내는 봉인 증명서에 이 통로가 안 실렸다는 뜻이다.
  //   이제 `hardeningscan.ts targetRunner`가 러너를 만들 때 assertEgressAllowed로 막는다.
  { id: "hardening-ssh", label: "장비 원격 점검(SSH)", host: "점검 대상 장비(설정값 · 내부망 IP만 등록 가능)", 대체: "이 서버 자신(local) 점검만 수행 · 원격 장비는 봉인" },
  // ⚠ 자식 프로세스는 우리 관문 **밖**이다(2026-08-05 검토 지적). 오프라인 환경변수로 눌러
  //   두지만 완전한 차단은 아니라, 카탈로그에 이렇게 **정직하게** 싣는다.
  { id: "child", label: "학습·병합 도구(python·HF CLI)", host: "자식 프로세스(관문 밖)", 대체: "HF 오프라인 강제(HF_HUB_OFFLINE 등) · 사전 반입한 캐시·모델만 사용" },
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
  // ⚠ **IPv6 리터럴일 때만** 접두사를 본다(2026-08-05 검토관이 잡은 구멍).
  //   그전엔 `startsWith("fc"|"fd"|"fe80")`를 호스트명에도 적용해 **fcm.googleapis.com·
  //   fd-cdn.example.com 같은 외부 도메인이 "사설 IP 대역"으로 통과**했다 —
  //   봉인의 default-deny("확실히 내부일 때만 통과")와 정면으로 어긋난다.
  //   IPv6는 콜론이 있어야 한다: 도메인 이름에는 콜론이 못 들어간다(포트는 호출자가 이미 뗀다).
  if (!h.includes(":")) return false; // 콜론 없음 = 호스트명 → 내부로 인정하지 않는다
  if (h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80")) return true;                     // link-local
  return false;
}

/**
 * VPN 안이라고 볼 IP인가 — **원격 LLM(BridgeAI) 전용 판정** (2026-08-13 사장님 「VPN 전용」 결정).
 *
 * isPrivateIp(에어갭 봉인용) + CGNAT 100.64.0.0/10(WireGuard·Tailscale류 오버레이가 쓰는 대역).
 * ⚠ 왜 isPrivateIp에 CGNAT를 **더하지 않았나**: 그 함수는 에어갭 봉인의 default-deny 잣대다.
 *   봉인 범위를 넓히는 일은 이 기능의 몫이 아니다 — 두 판정을 이 파일에 나란히 두어
 *   IP 대역 판단의 집이 한 곳(airgap.ts)이게 한다.
 * ⚠ 호스트명은 여기서도 false다(isPrivateIp가 콜론 없는 이름을 거부한다) — 이름은 어디로든
 *   풀릴 수 있어 「확실히 VPN 안」을 코드가 보증할 수 없다.
 */
export function isVpnRangeIp(host: string): boolean {
  if (isPrivateIp(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127; // CGNAT 100.64.0.0/10
}

function 명시허용(): string[] {
  return (process.env.GIJO_AIRGAP_ALLOW ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAirgapOn(): boolean {
  const v = (process.env.GIJO_AIRGAP ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** 호스트 하나가 에어갭에서 내부로 인정되는가(default-deny). fetch URL·소켓 공용 판정. */
export function hostAllowed(host: string): { allowed: boolean; reason: string } {
  const h = (host ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return { allowed: true, reason: "호스트 없음" };
  if (LOOPBACK.has(h)) return { allowed: true, reason: "루프백" };
  if (isPrivateIp(h)) return { allowed: true, reason: "사설 IP 대역(내부망)" };
  if (명시허용().includes(h)) return { allowed: true, reason: "명시 허용(GIJO_AIRGAP_ALLOW)" };
  return { allowed: false, reason: "외부 호스트 — 에어갭 봉인" };
}

/** 이 URL이 에어갭에서 나가도 되는가. default-deny — 내부로 확인될 때만 허용. */
export function egressAllowed(urlString: string): { allowed: boolean; host: string; reason: string } {
  let host = "";
  try {
    host = new URL(urlString).hostname;
  } catch {
    // 상대경로·비정상 URL은 나갈 호스트가 없다 — fetch가 알아서 처리하게 둔다(우리가 막을 것이 없다).
    return { allowed: true, host: "", reason: "호스트 없음" };
  }
  const d = hostAllowed(host);
  return { allowed: d.allowed, host: host.toLowerCase(), reason: d.reason };
}

let 설치됨 = false;
let 차단수 = 0;
const 감사된키 = new Set<string>(); // 같은 통로의 반복 차단으로 감사가 넘치지 않게 첫 1회만 남긴다

/** 첫 발생만 감사에 남긴다(true 반환). SIEM처럼 잦은 통로의 로그 폭주 방지. */
function 처음차단인가(key: string): boolean {
  if (감사된키.has(key)) return false;
  감사된키.add(key);
  return true;
}

/**
 * fetch가 아닌 통로(SMTP·SIEM 소켓 등)를 봉인하는 관문 — **연결 직전에** 호출한다.
 * 에어갭이고 호스트가 외부면 던진다. 봉인이 아니면 아무것도 안 한다(일반 배치 무영향).
 * fetch 관문이 못 보는 소켓 경로의 구멍을 이걸로 막는다(v1은 fetch만 덮어 SMTP·SIEM이 샜다).
 */
export function assertEgressAllowed(host: string, label: string): void {
  if (!isAirgapOn()) return;
  const d = hostAllowed(host);
  if (d.allowed) return;
  차단수++;
  if (처음차단인가(`${label}:${host}`)) {
    recordAudit({
      kind: "block", actor: "시스템(에어갭)",
      action: "에어갭 외부 연결 차단", target: `${label}:${host}`,
      detail: `막은 연결: ${label} → ${host} (소켓 통로)`, result: "blocked",
    });
  }
  throw new Error(`에어갭 모드: ${label}의 외부 호스트(${host}) 연결이 봉인으로 차단됐습니다.`);
}

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
      // 봉인 위반 시도는 그 자체가 사건이다 — 감사에 남긴다(같은 호스트는 첫 1회만, 폭주 방지).
      if (처음차단인가(`fetch:${v.host}`)) {
        recordAudit({
          kind: "block", actor: "시스템(에어갭)",
          action: "에어갭 외부 요청 차단", target: v.host,
          detail: `막은 요청: ${urlStr.slice(0, 120)}`, result: "blocked",
        });
      }
      throw new Error(`에어갭 모드: 외부 호스트(${v.host}) 요청이 봉인으로 차단됐습니다.`);
    }
    // ★ 리다이렉트 금지(2026-08-19 검토 지적). 검사는 첫 URL에만 걸리는데 redirect 기본값이
    //   "follow"라, 허용된 내부 호스트가 302로 외부를 가리키면 **재검사 없이** 따라나갔다 —
    //   요청 본문·토큰이 그대로 실려서다. 봉인 배치의 정당한 목적지는 내부뿐이므로 3xx는
    //   조용히 따라가는 대신 시끄럽게 깨지는 쪽이 default-deny 자세에 맞다.
    //   input이 Request 객체면 자체 redirect 값이 init보다 우선하므로 Request도 다시 감싼다.
    if (input instanceof Request) return 원래fetch(new Request(input, { redirect: "error" }), { ...init, redirect: "error" });
    return 원래fetch(input, { ...init, redirect: "error" });
  };
  globalThis.fetch = guarded;
  console.log(`[airgap] 봉인 ON 🔒 — 비-내부 fetch 전량 차단(외부 통로 ${EGRESS_POINTS.length}종). 명시 허용: ${명시허용().join(", ") || "(없음)"}`);
}

/**
 * 자식 프로세스(python 학습·병합, HF CLI)에 물릴 봉인 환경변수. 봉인이 아니면 **빈 객체**(무영향).
 *
 * ⚠ 왜 별도인가(2026-08-05 검토 지적): fetch 관문도 소켓 관문도 **우리 프로세스 안**에서만 돈다.
 *   spawn한 python은 부모의 globalThis.fetch 패치를 물려받지 않아 그대로 밖으로 나갈 수 있다.
 *   HF 계열은 표준 오프라인 스위치를 존중하므로 그것을 강제한다.
 * ⚠ **이건 완전한 차단이 아니다** — python이 임의 소켓을 열면 우리가 막을 수 없다.
 *   그래서 상태 문구도 "제품이 직접 여는 통로"라고 범위를 밝힌다(거짓 안심 금지).
 */
export function airgapChildEnv(): Record<string, string> {
  if (!isAirgapOn()) return {};
  return {
    HF_HUB_OFFLINE: "1",        // huggingface_hub — 네트워크 조회 거부(캐시만)
    TRANSFORMERS_OFFLINE: "1",  // transformers — 허브 조회 안 함
    HF_DATASETS_OFFLINE: "1",
    NO_PROXY: "*",
  };
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

/**
 * 봉인 증명서 — 감사관·조달 심사에 그대로 낼 수 있는 한 장짜리 기록. (후-4)
 *
 * ■ 왜 별도인가
 *   「에어갭 상태」는 담당자가 지금 확인하는 화면 글이고, 이건 **제출물**이다.
 *   심사자는 "무엇을 어떻게 막았고, 그것을 무엇으로 확인했는가"를 묻는다 —
 *   통로 목록·차단 방식·실제 차단 이력·확인 시각이 한 장에 있어야 한다.
 *
 * ■ 정직 원칙(이 문서가 팔려 나가므로 특히)
 *   · 봉인이 꺼져 있으면 **꺼져 있다고 첫 줄에 쓴다** — 증명서 모양만 갖춘 종이를 만들지 않는다.
 *   · 관문 밖(자식 프로세스)을 **한계 절에 명시**한다. 빠뜨리면 그게 거짓 증명이다.
 *   · 차단 이력은 **작업 기록 실측**을 센다(우리가 주장하는 수가 아니라 남은 기록).
 */
export function airgapCertificate(blocks: { at: number; target: string | null; detail: string | null }[]): string {
  const s = airgapStatus();
  const 이제 = new Date();
  const L: string[] = [];
  L.push("■ 에어갭 봉인 증명서 (GIJO AS)");
  L.push(`발행 시각: ${이제.toLocaleString("ko-KR")} · 이 문서는 발행 시점의 실측 상태입니다`);
  L.push("");
  L.push(s.on
    ? "1. 봉인 상태: 🔒 **적용됨(ON)** — 제품이 직접 여는 인터넷 통로가 관문에서 차단되고 있습니다."
    : "1. 봉인 상태: **적용 안 됨(OFF)** — 이 서버는 일반 배치입니다. 아래 통로가 열려 있습니다.");
  L.push(`   · 잠금 방식: 서버 기동 환경변수(GIJO_AIRGAP) — 화면·API로는 바꿀 수 없습니다(운영자만 지정).`);
  L.push(`   · 판정 기준: 기본 거부(default-deny) — 루프백·사설 IP 대역·명시 허용 호스트만 통과`);
  L.push(`   · 명시 허용: ${s.allow.length ? s.allow.join(", ") : "(없음)"}`);
  L.push("");
  L.push(`2. 봉인 대상 통로 ${s.points.length}종`);
  for (const p of s.points) L.push(`   · ${p.label} — ${p.host}\n     대체: ${p.대체}`);
  L.push("");
  L.push("3. 차단 실적(작업 기록 실측)");
  if (!blocks.length) {
    L.push("   · 기록된 차단 시도 없음" + (s.on ? " — 봉인 후 외부로 나가려 한 요청이 없었습니다." : " (봉인이 꺼져 있어 차단이 일어나지 않습니다)"));
  } else {
    L.push(`   · 총 ${blocks.length}건 (최근 순)`);
    for (const b of blocks.slice(0, 10)) {
      L.push(`   · ${new Date(b.at).toLocaleString("ko-KR")} · ${b.target ?? "?"} — ${(b.detail ?? "").slice(0, 80)}`);
    }
    if (blocks.length > 10) L.push(`   · … 외 ${blocks.length - 10}건 (전체는 설정 > 기록 보기에서 확인)`);
  }
  L.push("");
  L.push("4. 이 증명의 한계 (정직하게 밝힙니다)");
  L.push("   · 관문은 **제품이 직접 여는 통로**(HTTP 요청·메일/SIEM 소켓)를 덮습니다.");
  L.push("   · 봉인 중에는 HTTP 리다이렉트(3xx)를 따라가지 않습니다 — 내부 주소가 외부로 넘겨주는 길을 막기 위해서이며, 내부 서버가 3xx를 쓰면 해당 요청은 실패로 드러납니다.");
  L.push("   · 학습·모델 병합 등 **외부 프로그램(python)을 실행하는 기능은 제품 밖**에서 돌아 이 관문을 지나지 않습니다.");
  L.push("     봉인 시 오프라인 환경변수(HF_HUB_OFFLINE 등)로 누르지만 **완전한 차단은 아닙니다** —");
  L.push("     기밀 배치에서는 해당 기능을 쓰지 않거나 사전 반입 자료로만 쓰기를 권고합니다.");
  L.push("   · 이 문서는 **제품 자체 점검 결과**입니다. 망 분리 자체의 검증(방화벽·스위치)은 별도입니다.");
  return L.join("\n");
}
