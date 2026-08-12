// engine/lawinfo.ts — IT·보안 관련 법령 조회 (법제처 국가법령정보 공개 API)
//
// 왜 만드나(2026-07-26 사용자 제안): 담당자가 "이거 무슨 법에 걸려?"를 물을 곳이 없었다.
// 개인정보보호법·정보통신망법 같은 법은 자주 개정돼 문서로 넣어두면 금세 낡는다 — 조회가 맞다.
//
// 왜 외부 MCP 서버를 쓰지 않고 직접 부르나: 공개된 한국 법령 MCP가 여럿 있지만 제품에 외부
// 코드를 들이면 통제가 어렵다. 우리는 이미 외부 연결 승인 게이트가 있으므로 그 안에 넣는 편이
// 일관된다. API 규격은 단순하다(GET + 파라미터).
//
// ⚠ 이 기능은 인터넷이 필요하다 — 폐쇄망 고객은 못 쓴다. 그래서 기본 꺼짐이고,
//   키를 넣어야 켜진다. 키는 법제처에서 무료로 발급받는다(가입 후 신청).
//
// ⚠ 법률 자문이 아니다. 조문 원문과 링크를 찾아주는 데까지만 하고 판단은 담당자·법무 몫이다.
//   답변에 항상 면책 한 줄을 붙인다(LEGAL_DISCLAIMER).

import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import { encryptString, decryptString, getEncryptionKey } from "./cryptopack";

const API_BASE = "https://www.law.go.kr/DRF";
const TIMEOUT_MS = Number(process.env.GIJO_LAW_TIMEOUT_MS ?? 12_000);

export const LEGAL_DISCLAIMER =
  "※ 법령 원문을 찾아드린 것이며 법률 자문이 아닙니다. 적용 여부는 법무 검토를 받으세요.";

// 조회 대상 — 조례(자치법규)는 기본에서 뺐다. IT보안 담당자에게 걸릴 일이 드물고,
// 정작 중요한 건 행정규칙(고시)이다 — ISMS-P 인증고시·안전성 확보조치 기준이 전부 고시다.
// 공공기관·지자체 고객이 필요해지면 "ordin"을 여기 더하면 된다.
export const LAW_TARGETS = {
  law: { label: "법령", searchKey: "law", listKey: "LawSearch" },
  admrul: { label: "행정규칙(고시·훈령)", searchKey: "admrul", listKey: "AdmRulSearch" },
  prec: { label: "판례", searchKey: "prec", listKey: "PrecSearch" },
} as const;
export type LawTarget = keyof typeof LAW_TARGETS;

// IT·보안 담당자가 실제로 마주치는 법. 챗봇이 "무슨 법이 걸리나" 물을 때 후보로 쓴다.
export const IT_SECURITY_LAWS = [
  "개인정보 보호법",
  "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
  "정보통신기반 보호법",
  "전자금융거래법",
  "신용정보의 이용 및 보호에 관한 법률",
  "클라우드컴퓨팅 발전 및 이용자 보호에 관한 법률",
  "지능정보화 기본법",
  "산업기술의 유출방지 및 보호에 관한 법률",
];

migrate(
  "law-info-2026-07-26",
  `CREATE TABLE IF NOT EXISTS law_config (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     encryptedKey TEXT,          -- 법제처 OC 인증값(암호화 보관)
     enabled INTEGER NOT NULL DEFAULT 0,
     updatedAt INTEGER
   );
   INSERT OR IGNORE INTO law_config (id, enabled) VALUES (1, 0);`
);

// 신청 도메인 — 법제처는 OC만으로 인증하지 않는다. 요청 헤더 Referer가 활용신청서의
// "도메인주소"와 맞는지까지 본다(2026-08-09 실측). 비밀이 아니므로 평문으로 둔다.
migrate("law-referer-domain-2026-08-09", `ALTER TABLE law_config ADD COLUMN domain TEXT`);

interface ConfigRow { encryptedKey: string | null; enabled: number; updatedAt: number | null; domain: string | null }

export interface LawConfigPublic {
  enabled: boolean;
  hasKey: boolean;
  domain: string;
  /** 화면이 그릴 「자주 걸리는 법」 한 벌 — 목록을 화면에 또 적지 않으려고 여기서 준다. */
  laws: string[];
  updatedAt: number | null;
}

/**
 * 신청 도메인을 호스트만 남겨 정규화한다.
 * 담당자는 신청현황 화면에서 본 것을 그대로 붙여넣는다 — "www.gijo.ai"일 수도,
 * "https://www.gijo.ai/"일 수도 있다. 어느 쪽이든 받아준다.
 * ⚠ 하위 도메인은 법제처가 다른 곳으로 본다(sub.gijo.ai 거부 실측) — 여기서 손대지 않는다.
 */
export function normalizeLawDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z]+:\/\//i, "") // 스킴 제거
    .replace(/\/.*$/, "")          // 경로 제거
    .replace(/:\d+$/, "")          // 포트 제거
    .trim()
    .toLowerCase();
}

export function getLawConfig(): LawConfigPublic {
  const r = db.prepare(`SELECT * FROM law_config WHERE id = 1`).get() as ConfigRow;
  return {
    enabled: r.enabled === 1,
    hasKey: Boolean(r.encryptedKey),
    domain: r.domain ?? "",
    laws: IT_SECURITY_LAWS,
    updatedAt: r.updatedAt,
  };
}

/**
 * 키를 넣으면 켜지고, 빈 값을 넣으면 지우고 꺼진다(CTI 피드와 같은 계약).
 * 도메인은 키와 한 벌이다 — 둘 다 있어야 법제처가 응답한다.
 */
export function setLawConfig(key: string, domain = ""): LawConfigPublic {
  const t = key.trim();
  const d = normalizeLawDomain(domain);
  if (!t) {
    db.prepare(`UPDATE law_config SET encryptedKey = NULL, enabled = 0, domain = NULL, updatedAt = ? WHERE id = 1`)
      .run(Date.now());
  } else {
    db.prepare(`UPDATE law_config SET encryptedKey = ?, enabled = 1, domain = ?, updatedAt = ? WHERE id = 1`)
      .run(encryptString(t, getEncryptionKey()), d || null, Date.now());
  }
  return getLawConfig();
}

function decryptedKey(): string | null {
  const r = db.prepare(`SELECT * FROM law_config WHERE id = 1`).get() as ConfigRow;
  if (r.enabled !== 1 || !r.encryptedKey) return null;
  return decryptString(r.encryptedKey, getEncryptionKey());
}

export interface LawHit {
  target: LawTarget;
  title: string;
  id: string; // 본문 조회용 일련번호
  meta: string; // 시행일·소관부처·법원 등 한 줄
  link: string; // 국가법령정보센터 원문 링크
}

/**
 * 법제처가 주는 두 거절 문구는 짚어야 할 곳이 서로 다르다. 뭉뚱그리면 담당자가 헤맨다.
 *  · "사용자 정보 검증에 실패"     → OC 자체를 못 알아봄(오타·미등록)
 *  · "필수입력요소 검증에 실패"    → OC는 통과, Referer(신청 도메인)가 안 맞음
 * 후자의 문구는 "필수 입력값이 존재하지 않습니다"라 파라미터 탓처럼 읽히므로 특히 갈라줘야 한다.
 */
function 진단(원문: string, domain: string): string {
  if (원문.includes("사용자 정보 검증")) {
    return (
      "→ 법제처가 인증키(OC)를 알아보지 못했습니다. " +
      "open.law.go.kr → 마이페이지 → API인증키관리의 「현재 API인증키(OC)」 값을 대소문자까지 그대로 넣으세요."
    );
  }
  if (원문.includes("필수입력요소")) {
    return domain
      ? `→ 인증키(OC)는 확인됐지만 신청 도메인(${domain})이 맞지 않습니다. ` +
        "open.law.go.kr → 마이페이지 → OPEN API 신청현황의 「도메인주소」 값과 같은지 확인하세요(하위 도메인은 인정되지 않습니다)."
      : "→ 인증키(OC)는 확인됐지만 신청 도메인이 비어 있습니다. " +
        "법제처는 인증키와 도메인을 함께 봅니다 — 설정 → 연동 → 법령·판례 조회의 「신청 도메인」에 " +
        "OPEN API 신청현황의 「도메인주소」를 넣으세요.";
  }
  return "→ 설정 → 연동 → 법령·판례 조회의 인증키(OC)와 신청 도메인을 확인하세요.";
}

async function callApi(path: string, params: Record<string, string>): Promise<unknown> {
  const key = decryptedKey();
  if (!key) throw new Error("법령 조회가 꺼져 있습니다 — 설정에서 법제처 인증키를 넣으세요.");
  const domain = getLawConfig().domain;
  const url = `${API_BASE}/${path}?` + new URLSearchParams({ OC: key, type: "JSON", ...params }).toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // ⚠ 법제처는 OC만으로 인증하지 않는다. Referer가 활용신청서의 "도메인주소"와 맞아야 답을 준다.
    //   실사고(2026-08-09): OC·승인 모두 정상인데 조회가 계속 거부됐다. 원인은 우리가 Referer를
    //   안 보낸 것 — 그런데 법제처 응답은 "필수 입력값이 존재하지 않습니다. 요청 URL을 확인해 주세요"라
    //   URL 파라미터 탓처럼 읽혀 엉뚱한 데를 뒤지게 만들었다. 헤더 이야기다.
    //   실측: www.gijo.ai ✅ / gijo.ai ✅ / sub.gijo.ai ❌ / 그 외 도메인 ❌ / 없음 ❌
    const headers: Record<string, string> = {};
    if (domain) headers.Referer = `https://${domain}/`;
    const res = await fetch(url, { signal: ctl.signal, headers });
    if (!res.ok) throw new Error(`법제처 응답 오류 ${res.status}`);
    const data = await res.json();
    // ⚠ 법제처는 인증 실패·잘못된 요청에도 **HTTP 200**으로 답한다. 본문에만 result/msg가 담긴다.
    //   그걸 안 보면 목록 키가 없으니 그대로 "0건"이 되어, 담당자는 "법이 없나 보다"로 오해한다.
    //   실사고(2026-07-29): OC를 넣었는데 검색이 늘 0건이었다. 원인은 법제처가
    //   "필수입력요소 검증에 실패하였습니다"를 돌려주고 있었던 것 — 우리가 삼켰다.
    //   인증 문제는 결과 없음이 아니다. 있는 그대로 알린다.
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      if (d.result != null && d.msg != null) {
        const 원문 = `${String(d.result)} ${String(d.msg)}`.replace(/\s+/g, " ").trim();
        throw new Error(`법제처가 요청을 받지 않았습니다 — ${원문}\n${진단(원문, domain)}`);
      }
    }
    return data;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("법제처 응답이 없습니다(시간 초과)");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const arr = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const str = (v: unknown): string => (v == null ? "" : String(v));
// 20251002 → 2025-10-02
const ymd = (v: unknown): string => {
  const s = str(v).replace(/\D/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
};
// 원문 링크 — API가 주는 상세링크에는 우리 인증키가 박혀 있다. 그대로 두면 키가 화면·리포트에
// 새어나가고, 그렇다고 지우기만 하면 링크가 열리지 않는다(실측). 그래서 담당자가 브라우저로
// 바로 볼 수 있는 국가법령정보센터 공개 주소로 바꿔준다.
function publicLink(target: LawTarget, id: string, title: string): string {
  if (target === "prec") return `https://www.law.go.kr/precInfoP.do?precSeq=${encodeURIComponent(id)}`;
  if (target === "admrul") return `https://www.law.go.kr/admRulInfoP.do?admRulSeq=${encodeURIComponent(id)}`;
  // 법령은 이름으로 여는 주소가 가장 안정적이다(일련번호는 개정 때마다 바뀐다).
  return `https://www.law.go.kr/법령/${encodeURIComponent(title)}`;
}

export async function searchLaw(query: string, target: LawTarget = "law", limit = 5): Promise<LawHit[]> {
  const data = (await callApi("lawSearch.do", {
    target,
    query,
    display: String(Math.min(Math.max(limit, 1), 20)),
  })) as Record<string, Record<string, unknown>>;
  const root = data[LAW_TARGETS[target].listKey] ?? {};
  const rows = arr(root[target] as Record<string, unknown> | Record<string, unknown>[]);

  return rows.slice(0, limit).map((r) => {
    if (target === "prec") {
      return {
        target,
        title: str(r["사건명"]) || str(r["사건번호"]),
        id: str(r["판례일련번호"]),
        meta: [str(r["법원명"]), str(r["사건번호"]), ymd(r["선고일자"])].filter(Boolean).join(" · "),
        link: publicLink("prec", str(r["판례일련번호"]), str(r["사건명"])),
      };
    }
    if (target === "admrul") {
      return {
        target,
        title: str(r["행정규칙명"]),
        id: str(r["행정규칙일련번호"]),
        meta: [str(r["소관부처명"]), str(r["행정규칙종류"]), `시행 ${ymd(r["시행일자"])}`].filter(Boolean).join(" · "),
        link: publicLink("admrul", str(r["행정규칙일련번호"]), str(r["행정규칙명"])),
      };
    }
    return {
      target,
      title: str(r["법령명한글"]),
      id: str(r["법령일련번호"]),
      meta: [str(r["소관부처명"]), `시행 ${ymd(r["시행일자"])}`, str(r["제개정구분명"])].filter(Boolean).join(" · "),
      link: publicLink("law", str(r["법령일련번호"]), str(r["법령명한글"])),
    };
  });
}

export interface LawArticle { no: string; title: string; text: string }

/**
 * 조문 한 칸의 **본문 전체**를 편다 — 머리줄(조문내용) + 항 + 호 + 목.
 *
 * ⚠ 2026-08-13 실사고(max 발견): `조문내용`만 읽으면 **항이 여럿인 조문은 제목 줄만 남는다.**
 *   법제처는 본문을 `항[].항내용`, 그 아래를 `호[].호내용` · `목[].목내용`에 따로 담는다.
 *   실측: 개인정보 보호법 조문 126건 중 **97건(77%)이 본문 0자** · 시행령 140건 중 96건(69%).
 *   빠진 자리에 「유출 신고 **72시간**」(시행령 제40조①)이 있어, 제품이
 *   "법령에 명시되어 있지 않다"고 **단정**했다 — 과태료가 걸린 법정 기한을 없다고 한 것이다.
 *   제1조(목적)처럼 항 없는 단항 조문만 살아남아, 시험 몇 개로는 안 잡혔다.
 * (export는 시험용 — 실데이터 없이 법제처 응답 모양 픽스처로 이 함수를 그대로 잰다.)
 */
export function 조문본문(u: Record<string, unknown>): string {
  const 머리 = arr(u["조문내용"] as string | string[]).map(str).join("\n").trim();
  const 몸 = arr(u["항"] as Record<string, unknown>[]).map((h) => {
    const 호들 = arr(h["호"] as Record<string, unknown>[]).map((o) => {
      const 목들 = arr(o["목"] as Record<string, unknown>[])
        .map((m) => arr(m["목내용"] as string | string[]).map(str).join("\n"))
        .filter(Boolean);
      return [str(o["호내용"]).trim(), ...목들].filter(Boolean).join("\n");
    }).filter(Boolean);
    return [str(h["항내용"]).trim(), ...호들].filter(Boolean).join("\n");
  }).filter(Boolean);
  return [머리, ...몸].filter(Boolean).join("\n").trim();
}

/** 법령 본문 조문. article을 주면 그 조문만(예: "29"), 없으면 앞에서부터 몇 개. */
export async function getLawArticles(mst: string, article?: string, limit = 5): Promise<LawArticle[]> {
  const data = (await callApi("lawService.do", { target: "law", MST: mst })) as Record<string, Record<string, unknown>>;
  const body = data["법령"] ?? {};
  const units = arr((body["조문"] as Record<string, unknown> | undefined)?.["조문단위"] as Record<string, unknown>[]);
  // 편·장·절 제목 칸("제4장 개인정보의 안전한 관리")은 조문이 아니다.
  // ⚠ 이 칸들도 **조문번호를 갖고 있다** — 뒤따르는 조문의 번호가 그대로 박혀 있어서
  //   "번호가 있으면 조문"으로 거르면 안 걸러진다. 실제로 제29조를 물으면 장 제목이
  //   함께 딸려 나왔다(2026-08-09 실측: 개인정보 보호법 140칸 중 전문 14 · 조문 126).
  //   법제처가 조문여부 필드로 갈라 주므로 그것을 본다. 필드가 없는 옛 응답만 옛 방식으로 뒤를 받친다.
  const 조문칸 = units.filter((u) => {
    const kind = str(u["조문여부"]);
    return kind ? kind === "조문" : !/^\s*제\d+[편장절관]\s/.test(str(u["조문내용"]));
  });
  const mapped = 조문칸.map((u) => ({
    no: str(u["조문번호"]),
    title: str(u["조문제목"]),
    text: 조문본문(u),
  }));
  const real = mapped.filter((m) => m.no && m.text);
  if (article) {
    const want = article.replace(/\D/g, "");
    return real.filter((m) => m.no.replace(/\D/g, "") === want);
  }
  return real.slice(0, limit);
}

/** 챗봇 답변용 — 사람이 그대로 읽는 형식. 원문 링크를 반드시 함께 준다. */
export async function lawAnswer(query: string, target: LawTarget = "law"): Promise<string> {
  const hits = await searchLaw(query, target, 5);
  if (!hits.length) {
    return [
      `🔎 찾지 못했습니다 — "${query}"로는 ${LAW_TARGETS[target].label} 검색 결과가 없습니다.`,
      "(없다는 뜻이 아니라 이 말로는 못 찾았다는 뜻입니다. 법령 이름을 정확히 쓰면 잘 찾습니다.)",
      "",
      `IT·보안 관련 법: ${IT_SECURITY_LAWS.slice(0, 4).join(" · ")} 등`,
    ].join("\n");
  }
  const lines = [`${LAW_TARGETS[target].label} 검색 — "${query}" (상위 ${hits.length}건)`, ""];
  hits.forEach((h, i) => {
    lines.push(`${i + 1}. ${h.title}`);
    if (h.meta) lines.push(`   ${h.meta}`);
    lines.push(`   원문: ${h.link}`);
  });
  lines.push("", LEGAL_DISCLAIMER);
  return lines.join("\n");
}

/**
 * 물음에 든 조문 번호("제29조"·"29조") — 없으면 null.
 * ⚠ 「제30조 3년」처럼 숫자가 이어 붙는 문장이 있어 **조/항 표기가 붙은 것만** 본다.
 */
export function 조문번호(text: string): string | null {
  const m = /제?\s*(\d{1,3})\s*조/.exec(String(text ?? ""));
  return m ? m[1] : null;
}

/**
 * 조문 원문 답 — 「개인정보 보호법 제29조 알려줘」에 **본문**을 준다(2026-08-09, 계획서 후-3).
 *
 * 왜: getLawArticles는 어제 고쳤는데 **부르는 곳이 0**이었다(호출부 없는 기능 = 없는 기능).
 * 담당자가 "제29조 알려줘"라고 물으면 지금까지는 법령 목록만 돌아왔다.
 *
 * ⚠ 조문 본문은 지어내면 가장 위험한 영역이라 **받은 그대로** 옮기고 원문 링크를 반드시 붙인다.
 * ⚠ 못 찾으면 목록 답으로 물러난다 — 빈손으로 끝내지 않는다.
 */
export async function lawArticleAnswer(query: string, article: string): Promise<string> {
  const hits = await searchLaw(query, "law", 3);
  if (!hits.length) return lawAnswer(query, "law");
  const 법 = hits[0];
  // 본문 조회용 일련번호는 LawHit.id다(mst 아님 — 이름이 달라 헛짚기 쉬운 자리).
  const mst = String(법.id ?? "").trim();
  if (!mst) return lawAnswer(query, "law");
  // ⚠ 실패와 없음을 가른다(2026-08-13). 전에는 `.catch(() => [])`가 API 실패를 「조문 없음」으로
  //   뭉갰고, 아랫줄이 「조문 번호를 확인해 주세요」라고 **담당자 탓**을 했다. 조회가 죽은 것과
  //   그 조문이 없는 것은 다른 사실이고, 뭉개면 모델이 그 빈자리를 「법에 없다」로 메운다 —
  //   77% 누락 사고에서 이 삼킴이 오진을 한 단계 더 굳혔다.
  let 조회실패: string | null = null;
  const articles = await getLawArticles(mst, article, 3).catch((e) => {
    조회실패 = e instanceof Error ? e.message : String(e);
    return [] as LawArticle[];
  });
  if (조회실패) {
    return [
      `⚠ 「${법.title}」 조문 원문을 가져오지 못했습니다(${조회실패}) — **법에 없다는 뜻이 아닙니다.** 원문 링크에서 직접 확인해 주세요.`,
      `   원문: ${법.link}`,
      "",
      LEGAL_DISCLAIMER,
    ].join("\n");
  }
  if (!articles.length) {
    return [
      `🔎 「${법.title}」에서 제${article}조 본문을 찾지 못했습니다 — 조문 번호를 확인해 주세요.`,
      `   원문: ${법.link}`,
      "",
      LEGAL_DISCLAIMER,
    ].join("\n");
  }
  const lines = [`${법.title} — 제${article}조`, ""];
  for (const a of articles) {
    lines.push(`제${a.no}조${a.title ? `(${a.title})` : ""}`);
    lines.push(a.text);
    lines.push("");
  }
  lines.push(`원문: ${법.link}`, "", LEGAL_DISCLAIMER);
  return lines.join("\n");
}

export function registerLawRoutes(app: Express): void {
  app.get("/api/law/config", authMiddleware, (_req, res) => res.json(getLawConfig()));

  // 키 설정은 관리자만 — 외부로 나가는 연결을 켜는 행위다.
  app.post(
    "/api/law/config",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const body = req.body as { key?: string; domain?: string };
      const key = String(body?.key ?? "");
      const domain = String(body?.domain ?? "");
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      const cfg = setLawConfig(key, domain);
      recordAudit({
        kind: "write",
        action: "law_config",
        target: "법령 조회",
        detail: cfg.enabled
          ? `법제처 인증키 설정 — 법령 조회 켜짐(외부 연결, 신청 도메인 ${cfg.domain || "없음"})`
          : "법령 조회 끔",
        actor,
      });
      res.json(cfg);
    })
  );

  app.get(
    "/api/law/search",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const q = String(req.query.query ?? "").trim();
      if (!q) { res.status(400).json({ error: "query가 필요합니다" }); return; }
      const t = String(req.query.target ?? "law") as LawTarget;
      if (!LAW_TARGETS[t]) { res.status(400).json({ error: "target은 law·admrul·prec 중 하나" }); return; }
      res.json({ hits: await searchLaw(q, t, Number(req.query.limit) || 5), disclaimer: LEGAL_DISCLAIMER });
    })
  );

  app.get(
    "/api/law/articles",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const mst = String(req.query.mst ?? "").trim();
      if (!mst) { res.status(400).json({ error: "mst(법령일련번호)가 필요합니다" }); return; }
      const article = req.query.article ? String(req.query.article) : undefined;
      res.json({
        articles: await getLawArticles(mst, article, Number(req.query.limit) || 5),
        disclaimer: LEGAL_DISCLAIMER,
      });
    })
  );
}
