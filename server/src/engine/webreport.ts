// engine/webreport.ts — 국내 웹취약점 점검 결과보고서(PDF/DOCX 텍스트) 파서
//
// 배경(2026-07-25 사용자 지적): 국내 보안업체가 내는 "웹 취약점 진단 결과 보고서"를 올렸는데
// 자산·취약점으로 등록되지 않았다. 원인은 취약점 임포트가 Nessus 계열(XML/CSV/JSON/HTML)만
// 인식하고 PDF 서술형 보고서 파서가 없었기 때문. 이 모듈이 그 공백을 메운다.
//
// 하이브리드 설계 — 규칙이 뼈대, LLM은 폴백:
//   ① 자산: "수행 대상" 표의 `이름 (도메인) IP` 패턴 → 도메인·IP는 정규식으로 정확히 뽑는다.
//   ② 취약점: 상세 절의 `4.1.2. [IW-25] 서버 정보 노출` 헤딩 + 그 상위 `4.1. 서비스 (도메인)`.
//      KISA/업계 관행인 [IW-NN]·[WEB-NN] 코드 체계가 결정적이라 규칙으로 100% 잡힌다.
//   ③ 위험도: 문서가 스스로 제공하는 진단항목표(`취약점 [IW-20] … 위험도 하`)를 사전으로 만들어 매핑.
//   ④ 검증: "총 개수 : N 개" 같은 자체 합계와 추출 건수를 대조해 파싱 누락을 문서가 스스로 검증.
//   ⑤ 규칙이 0건이면 호출자가 LLM 폴백(구조화 초안)으로 넘어간다 — 데이터를 잃지 않되,
//      LLM 결과는 반드시 사람 승인(결재판)을 거치게 해 환각 등록을 구조적으로 막는다.
//
// PDF 텍스트 추출물은 줄바꿈·공백이 불규칙하다("[IW-20]"이 "[IW- 20]"으로 깨지는 등) — 정규식은
// 그 잡음을 견디도록 공백 관용으로 작성했다.

import type { ParsedVuln } from "./vulnscan";
// 표 술어 단일 출처 — tabletext는 **잎**(import 0)이라 파서가 부담 없이 문다(사본을 만들 이유가 없다).
import { 표줄, 구분선, 열수, 칸가르기 } from "./tabletext";

export interface WebReportAsset {
  host: string; // 도메인(자산 키) — 없으면 IP
  name: string; // 서비스 명 (예: "SafeKey 발급 웹 서버")
  ip?: string;
}

export interface WebReportParseResult {
  assets: WebReportAsset[];
  vulns: ParsedVuln[];
  // 문서가 명시한 취약점 총 개수(자체 합계) — 추출 건수와 대조해 누락을 감지한다.
  declaredTotal?: number;
  // 파싱 근거·경고(투명성) — 화면·결재판에 그대로 보여준다.
  notes: string[];
}

// 국내 보고서의 위험도 표기 → 제품 severity. "상=high"로 둔다(critical은 실제 악용·즉시위험에 예약).
const RISK_MAP: Record<string, string> = { 상: "high", 중: "medium", 하: "low", 정보: "info" };

// 도메인 후보 — 한글 보고서의 서비스명 괄호 안에 온다. 한글/공백을 포함하지 않는 FQDN만.
const DOMAIN_RE = /\(?\s*((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\s*\)?/i;
const IPV4_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\b/;

// 취약점 코드 — [IW-20] / [WEB-05] / [IW - 20](PDF 공백 깨짐) 모두 허용.
const CODE_RE = /\[\s*([A-Z]{2,4})\s*-\s*(\d{1,3})\s*\]/;

// 상세 절 헤딩: "4.1.2. [IW-25] 서버 정보 노출" — 번호·코드·이름을 함께 잡는다.
const DETAIL_HEADING_RE = /^\s*(\d+(?:\.\d+){1,3})\.?\s*\[\s*([A-Z]{2,4})\s*-\s*(\d{1,3})\s*\]\s*(.+?)\s*$/;

// 서비스 절 헤딩: "4.1. SafeKey 발급 웹 서버 (cert.aj-safe.co.kr)"
const SERVICE_HEADING_RE = /^\s*(\d+\.\d+)\.?\s+(.*\S)\s*$/;

// 진단항목표 행: "취약점 [IW-20] 디렉토리 인덱싱 위험도 하"
const ITEM_RISK_RE = /\[\s*([A-Z]{2,4})\s*-\s*(\d{1,3})\s*\]\s*([^\n]*?)\s*위험도\s*([상중하]|정보)/g;

// 자체 합계: "취약점 총 개수 : 5 개" / "총 5 개의 취약점"
const TOTAL_RE = /(?:총\s*개수|취약점\s*총\s*개수)\s*[:：]?\s*(\d+)\s*개|(\d+)\s*개의\s*취약점이\s*확인/;

function normalizeSpaces(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

/* ── 파이프 표를 **종전의 평평한 줄로 되돌린다** (2026-09-09, 검토관 적발③ · 실행 재현) ────────
 *
 * ■ 무엇이 문제였나
 *   2026-09-09에 PDF 추출기가 「그려진 테두리」를 파이프 표로 살리기 시작했다(engine/pdftable.ts).
 *   RAG·화면에는 그게 이득이지만, **이 파일의 정규식은 「표가 평평하게 풀린 글」을 전제로 쓰였다.**
 *   같은 창구(autoupload.tryWebReport)가 같은 extractDocumentText를 쓰므로, 테두리를 그린
 *   보고서가 오면 입력이 통째로 바뀐다. WSL(Node 20)에서 제품의 파이프표()로 표만 복원해 실측:
 *     · 진단항목 사전 **5종 → 0종** — 위험도가 다른 칸으로 갈려 「… 위험도 하」가 한 줄에 안 남는다.
 *       그러면 문서가 「하」라고 적어 놓은 취약점이 전부 medium으로 등록된다(문서가 준 근거를 잃는다).
 *     · 자산 이름 "SafeKey 발급 웹 서버" → **"| SafeKey 발급 웹 서버"** — parseTargets가
 *       `line.slice(0, dm.index)`로 도메인 앞을 이름으로 삼는데 줄머리 파이프가 거기 들어온다.
 *       그 이름은 vulnscan.ts의 `dnsName`으로 **자산 등록에 그대로 실린다.**
 *
 * ■ 왜 추출기를 되돌리지 않나
 *   표는 지식으로선 이득이고, 되돌리면 이번 라운드가 통째로 사라진다. **읽는 쪽이 표를 풀어서 본다.**
 *   원문(RAG로 가는 글)은 표 그대로 남는다 — 여기서 푼 글은 이 파서 안에서만 산다.
 *
 * ■ 계약
 *   ⚠ **표가 없는 글은 한 글자도 안 바뀐다.** 「머리글 + 구분선」으로 제대로 선 표만 푼다.
 *     홑 파이프 줄(KISA 가이드 바닥글 「| 한국인터넷진흥원 |」 같은 것)은 손대지 않는다.
 *   ⚠ **표의 정의(표줄·구분선·열수·칸가르기)는 engine/tabletext.ts 한 곳이다** — 여기서 import한다.
 *     2026-09-09에는 그 정의가 memory.ts에 있었고 그 모듈이 DB·LanceDB를 물어서, 파서가 import하면
 *     통째로 딸려 오는 탓에 **여기 사본을 뒀다.** 2026-09-10에 정의를 잎 모듈로 옮겨 그 이유가 사라졌다.
 *     짝 시험은 그대로 남는다 — **추출기 파이프표()의 실제 출력을 여기 먹여** 두 규격이 갈리면 빨개진다
 *     (test/pdftableextract.test.ts 「추출기가 낸 표를 웹취약점 파서가 되푼다」). 계약은 사본이 아니라 결과다.
 */
/** 위험도 칸의 머리글 — 국내 보고서가 쓰는 이름들. */
const RISK_HEAD_RE = /위험도|위험\s*등급|심각도|중요도|등급/;
/** 위험도 칸의 값 — **이 넷일 때만** 위험도로 읽는다(딴 칸을 위험도로 오인하지 않게). */
const RISK_VAL_RE = /^(상|중|하|정보)$/;

/**
 * 제대로 선 표를 「한 행 = 한 줄」의 평평한 글로 되돌린다.
 * ★ 위험도 칸은 값만 남기면 `위험도` 낱말이 사라져 사전 규칙(ITEM_RISK_RE)이 안 걸린다.
 *   그래서 **코드([IW-20])가 든 칸 뒤에 「위험도 하」를 붙인다** — 그 자리가 종전 평문에서 그 말이
 *   있던 자리이고, 이름 캡처(`[^\n]*?`)가 뒤 칸의 설명 문장까지 삼키지 않는 유일한 자리다.
 *   코드가 없는 행이면 위험도 칸을 제자리에서 「위험도 하」로 적는다.
 */
export function 표풀기(text: string): string {
  if (!text.includes("|")) return text; // 표가 없는 흔한 길 — 아무 일도 안 한다
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!표줄(lines[i]) || i + 1 >= lines.length || !구분선(lines[i + 1])) { out.push(lines[i]); continue; }
    const 머리 = 칸가르기(lines[i]);
    const 위험열 = 머리.findIndex((h) => RISK_HEAD_RE.test(h));
    const 폭 = 열수(lines[i + 1]);
    out.push(normalizeSpaces(머리.join(" ")));
    let k = i + 2;
    // 본문 행 — **구분선과 열 수가 같은 줄까지**가 이 표다(memory.ts의 본문 행 판정과 같은 잣대).
    while (k < lines.length && 표줄(lines[k]) && 열수(lines[k]) === 폭) {
      const 칸 = 칸가르기(lines[k]);
      const 위험 = 위험열 >= 0 && RISK_VAL_RE.test(칸[위험열] ?? "") ? 칸[위험열] : "";
      if (위험) {
        const 코드칸 = 칸.findIndex((c, idx) => idx !== 위험열 && CODE_RE.test(c));
        if (코드칸 >= 0) { 칸[코드칸] = `${칸[코드칸]} 위험도 ${위험}`; 칸[위험열] = ""; }
        else 칸[위험열] = `위험도 ${위험}`;
      }
      out.push(normalizeSpaces(칸.join(" ")));
      k += 1;
    }
    // k-1로 두면 for의 +1이 **멈춘 그 줄**을 다시 본다 — 열 수가 어긋나 멈춘 줄이 곧 다음 표의
    // 머리글일 수 있어서다(memory.ts 표본문행자리와 같은 이유).
    i = k - 1;
  }
  return out.join("\n");
}

/** 이 텍스트가 국내 웹취약점 점검 보고서인지 — 자동 판별용(자산·코드 신호를 함께 본다). */
export function looksLikeWebVulnReport(raw: string): boolean {
  // 표를 먼저 풀고 자른다 — 자르고 풀면 20,000자 경계에서 표가 반 토막 난다.
  const head = 표풀기(raw).slice(0, 20000);
  const hasTitle = /웹\s*취약점\s*(진단|점검)|웹취약점|모의\s*해킹/.test(head);
  const hasCode = CODE_RE.test(head);
  const hasVulnWord = /취약점/.test(head);
  // 제목 + (코드체계 또는 진단표) 가 함께 있어야 한다 — 단순히 "취약점" 단어만 있는 문서는 배제.
  return hasVulnWord && (hasTitle || hasCode) && /진단|점검/.test(head);
}

/** 진단항목표에서 코드→(이름, 위험도) 사전을 만든다. 문서가 스스로 제공하는 근거. */
function buildRiskDictionary(text: string): Map<string, { name: string; risk: string }> {
  const dict = new Map<string, { name: string; risk: string }>();
  for (const m of text.matchAll(ITEM_RISK_RE)) {
    const code = `${m[1].toUpperCase()}-${String(Number(m[2])).padStart(2, "0")}`;
    const name = normalizeSpaces(m[3]).replace(/\s*위험도.*$/, "");
    const risk = RISK_MAP[m[4]] ?? "medium";
    // 같은 코드가 여러 번 나오면(목차·본문) 이름이 더 긴 쪽을 신뢰한다.
    const prev = dict.get(code);
    if (!prev || name.length > prev.name.length) dict.set(code, { name: name || prev?.name || code, risk });
  }
  return dict;
}

// 도메인처럼 보이지만 자산이 아닌 것 — 파일명·설정파일·확장자. 본문 예시("index1.html", "php.ini",
// "httpd.conf", "3f.jsp")가 FQDN 정규식에 걸려 자산으로 오인되던 실측 문제(2026-07-25)를 막는다.
const NON_HOST_TLD = /\.(html?|jsp|php|asp|aspx|zip|conf|ini|log|txt|xml|json|js|css|png|jpe?g|gif|pdf|docx?|xlsx?|bak|old|tmp|sh|bat|exe|jar|war)$/i;

/**
 * "수행 대상"류 표에서 자산(서비스명 + 도메인 + IP)을 뽑는다.
 * 점검 대상 표는 문서 앞부분(개요·수행 대상)에 있다 — 본문 전체를 훑으면 조치 가이드의 파일 경로까지
 * 자산으로 잡히므로, 상세 장(4장) 시작 전까지로 범위를 제한한다.
 */
function parseTargets(text: string): WebReportAsset[] {
  const out = new Map<string, WebReportAsset>();
  const allLines = text.split(/\r?\n/).map(normalizeSpaces);
  // 상세 장 이전까지만 본다(없으면 전체).
  const detailIdx = allLines.findIndex((l) => /취약점\s*(진단\s*)?상세\s*(내용|결과)/.test(l) && !/\.{5,}/.test(l));
  const lines = detailIdx > 0 ? allLines.slice(0, detailIdx) : allLines;
  for (const line of lines) {
    if (!line || line.length > 200) continue;
    const dm = DOMAIN_RE.exec(line);
    if (!dm) continue;
    const host = dm[1].toLowerCase();
    // 목차 줄(점선 다수)·URL 경로 예시·파일명은 자산이 아니다.
    if (/\.{5,}/.test(line)) continue;
    if (NON_HOST_TLD.test(host)) continue;
    // 서비스명 = 도메인 괄호 앞 텍스트. 없으면 도메인 자체를 이름으로.
    const before = normalizeSpaces(line.slice(0, dm.index).replace(/[(\[]$/, ""));
    const ip = IPV4_RE.exec(line)?.[1];
    const name = before && before.length <= 80 && /[가-힣A-Za-z]/.test(before) ? before : host;
    const prev = out.get(host);
    // 이름이 더 구체적이거나 IP가 새로 확인되면 갱신.
    if (!prev || (name !== host && prev.name === host) || (ip && !prev.ip)) {
      out.set(host, { host, name: prev?.name && prev.name !== host && name === host ? prev.name : name, ip: ip ?? prev?.ip });
    }
  }
  // PDF 줄바꿈 파편 제거 — "certify.aj-safe.co.kr"이 줄 끝에서 "certify.aj-" / "safe.co.kr"로
  // 쪼개지면 둘 다 FQDN처럼 보인다(실측 2026-07-25). 다른 자산의 부분문자열이면서 IP가 없는 것은
  // 파편으로 보고 버린다. 서비스명이 붙은 온전한 자산(IP 확인분)은 그대로 남는다.
  const list = [...out.values()];
  return list.filter((a) => {
    if (a.ip) return true; // 대상 표에서 IP까지 확인된 자산은 확실하다
    const isFragment = list.some((b) => b !== a && b.host.length > a.host.length && b.host.includes(a.host));
    return !isFragment;
  });
}

/**
 * 상세 절(4.x.y [CODE-NN] 이름)에서 "어느 서비스의 어떤 취약점인지"를 뽑는다.
 * 상세 절이 서비스 단위로 묶여 있어 신뢰도가 가장 높다(결과 요약표는 표 구조가 깨지기 쉬움).
 */
function parseDetails(
  text: string,
  dict: Map<string, { name: string; risk: string }>,
  targets: WebReportAsset[]
): { vulns: ParsedVuln[]; notes: string[] } {
  const lines = text.split(/\r?\n/).map(normalizeSpaces);
  const notes: string[] = [];
  const vulns: ParsedVuln[] = [];
  const seen = new Set<string>(); // host::code 중복 제거(목차·본문에 같은 헤딩이 반복됨)
  let currentHost: string | null = null;
  let currentService = "";
  // 상세 장(예: "4. 취약점 진단 상세 내용") 이후부터만 본다 — 목차의 동일 패턴을 배제.
  const detailStart = lines.findIndex((l) => /취약점\s*(진단\s*)?상세\s*(내용|결과)/.test(l) && !/\.{5,}/.test(l));
  const startIdx = detailStart >= 0 ? detailStart : 0;
  if (detailStart < 0) notes.push("상세 장 제목을 찾지 못해 전체 텍스트에서 추출했습니다.");
  // 상세 장 다음에 오는 "보안 대책/조치 방안" 장은 같은 [CODE-NN] 헤딩을 쓰지만 조치 가이드라
  // 취약점 발견 건이 아니다 — 여기서 멈춘다(실측: 5장 때문에 5건이 6건으로 중복 집계됨).
  const remedyStart = lines.findIndex(
    (l, i) => i > startIdx && /^\d+\.\s*.*(보안\s*대책|조치\s*(방안|가이드|방법)|대응\s*방안)/.test(l) && !/\.{5,}/.test(l)
  );
  const endIdx = remedyStart > startIdx ? remedyStart : lines.length;
  if (remedyStart > startIdx) notes.push(`조치 가이드 장(${lines[remedyStart].slice(0, 24)}…) 이후는 발견 건에서 제외`);

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    if (!line || /\.{5,}/.test(line)) continue; // 목차 줄 제외

    // 서비스 절: "4.2. 안전대부 본인인증 웹 서버 (certify.aj-safe.co.kr)"
    const sm = SERVICE_HEADING_RE.exec(line);
    if (sm && !CODE_RE.test(line)) {
      const dm = DOMAIN_RE.exec(sm[2]);
      if (dm) {
        currentHost = dm[1].toLowerCase();
        currentService = normalizeSpaces(sm[2].slice(0, dm.index)) || currentHost;
        continue;
      }
    }

    // 상세 항목: "4.1.2. [IW-25] 서버 정보 노출"
    const dmh = DETAIL_HEADING_RE.exec(line);
    if (!dmh) continue;
    const code = `${dmh[2].toUpperCase()}-${String(Number(dmh[3])).padStart(2, "0")}`;
    const rawName = normalizeSpaces(dmh[4]);
    const known = dict.get(code);
    const name = rawName || known?.name || code;
    // 서비스 절을 못 만났으면(단일 대상 보고서) 유일 자산으로 귀속, 그것도 없으면 스킵하지 않고 보고서명 자산.
    const host = currentHost ?? (targets.length === 1 ? targets[0].host : null);
    if (!host) {
      notes.push(`[${code}] ${name} — 소속 서비스를 특정하지 못해 건너뜀`);
      continue;
    }
    const key = `${host}::${code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 증적: 헤딩 다음 줄부터 다음 헤딩 전까지(최대 12줄) — 설명·경로 표가 여기 온다.
    const evidence: string[] = [];
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      const l2 = lines[j];
      if (!l2) continue;
      if (DETAIL_HEADING_RE.test(l2) || SERVICE_HEADING_RE.test(l2)) break;
      if (/\.{5,}/.test(l2)) continue;
      evidence.push(l2);
      if (evidence.join(" ").length > 700) break;
    }

    vulns.push({
      host,
      name: `[${code}] ${name}`,
      risk: known?.risk ?? "medium",
      cve: "",
      description: evidence.join("\n").slice(0, 900),
      pluginId: code, // 상태 추적 키로 쓰인다(같은 코드=같은 취약점)
      port: "",
      protocol: "tcp",
    });
    if (currentService) {
      // 서비스명을 증적 머리에 남겨 화면에서 맥락이 보이게.
      const last = vulns[vulns.length - 1];
      last.description = `대상: ${currentService} (${host})\n${last.description}`;
    }
  }
  return { vulns, notes };
}

/** 국내 웹취약점 보고서 텍스트를 파싱한다(규칙 기반). 0건이면 호출자가 LLM 폴백으로 넘어간다. */
export function parseWebVulnReport(raw: string): WebReportParseResult {
  // ★ 표로 온 글을 평평하게 되돌린 뒤에 본다 — 아래 정규식들이 전부 그 꼴을 전제한다(위 표풀기 참조).
  const text = 표풀기(raw);
  const dict = buildRiskDictionary(text);
  const targets = parseTargets(text);
  const { vulns, notes } = parseDetails(text, dict, targets);

  const tm = TOTAL_RE.exec(text);
  const declaredTotal = tm ? Number(tm[1] ?? tm[2]) : undefined;

  const allNotes = [
    `진단항목 사전 ${dict.size}종 인식`,
    `점검 대상 ${targets.length}개 자산 인식`,
    `상세 절에서 취약점 ${vulns.length}건 추출`,
    ...notes,
  ];
  if (declaredTotal !== undefined) {
    allNotes.push(
      vulns.length === declaredTotal
        ? `✓ 문서 자체 합계(${declaredTotal}건)와 일치 — 누락 없음`
        : `⚠ 문서 자체 합계는 ${declaredTotal}건인데 ${vulns.length}건만 추출됐습니다. 결재판에서 확인·보완이 필요합니다.`
    );
  }
  // 취약점이 붙은 자산만 등록 대상으로 좁히지 않는다 — 점검했으나 취약점 0건인 자산도 관리 대상.
  return { assets: targets, vulns, declaredTotal, notes: allNotes };
}
