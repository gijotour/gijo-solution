// engine/securityproducts-catalog.ts — 보안제품 종류·자료 갈래 **순수 데이터**. 잎 모듈이다.
//
// ★ 왜 갈랐나 (2026-08-27, 의존 수리 화살 #5)
//   이 두 상수는 원래 securityproducts.ts(express 라우트·DB·지식베이스까지 무는 큰 모듈)에
//   살았다. 온톨로지 씨앗(ontology-seed.ts)이 **상수 하나** 때문에 그 전체를 정적으로 물었고,
//   그게 61개 순환 덩어리의 한 변이었다 — 씨앗은 가장 낮은 층이어야 한다.
//   본가(securityproducts.ts)가 재수출하므로 기존 호출부는 한 줄도 안 바뀐다.

// 보안제품 종류 카탈로그 — 대시보드/등록 폼에서 공용으로 쓴다. 한국 중소기업 보안팀이 흔히
// 운영하는 제품군 위주(과한 세분화 지양). "기타"로 흡수 가능.
export const PRODUCT_CATEGORIES = [
  { id: "방화벽", label: "방화벽", icon: "🧱" },
  { id: "EDR", label: "EDR (단말탐지대응)", icon: "🖥" },
  { id: "DLP", label: "DLP (정보유출방지)", icon: "🔒" },
  { id: "WAF", label: "WAF (웹방화벽)", icon: "🌐" },
  { id: "VPN", label: "VPN", icon: "🔑" },
  { id: "IPS", label: "IPS/IDS (침입방지)", icon: "🛡" },
  { id: "SIEM", label: "SIEM (통합로그관리)", icon: "📊" },
  { id: "백신", label: "백신 (안티바이러스)", icon: "🦠" },
  { id: "NAC", label: "NAC (접근제어)", icon: "🚪" },
  { id: "기타", label: "기타", icon: "📦" },
] as const;

// 제품 문서 종류 — 제품 매뉴얼 / 로그(분석) 매뉴얼 / 기타.
export const DOC_KINDS = [
  { id: "manual", label: "제품 매뉴얼" },
  { id: "logManual", label: "로그 매뉴얼" },
  { id: "etc", label: "기타 문서" },
] as const;
