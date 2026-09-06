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
//
// ★ 목록의 **주인은 legalbasis.ts**다(2026-09-07 이관). 답 출구(llm.ts chat())가 근거 꼬리를
//   붙일 때 같은 목록이 필요한데, 이 파일은 모듈 로드 시점에 migrate()를 돌려(아래) 출구가
//   물기엔 무겁다. 그렇다고 저쪽에 그림자를 두면 **대조할 두 벌**이 생긴다 — 같은 주에 나온
//   선례(docorigin.승인문답_접두를 잎으로 내리고 learnmemory가 재수출)를 그대로 따라
//   **재수출**한다. 이 파일의 소비자(getLawConfig·법령이름찾기·챗봇 안내)는 한 글자도 안 바뀌고,
//   lawinfo.test의 동일성(toBe) 검사도 그대로 성립한다(재수출은 같은 배열을 가리킨다).
// ⚠ import와 export를 **둘 다** 적는다 — `export … from`만 쓰면 이 파일 안에서 이름을 못 쓴다.
//   아래 세 곳(getLawConfig·법령이름찾기·챗봇 안내)이 실제로 쓴다.
import { IT_SECURITY_LAWS } from "./legalbasis";
export { IT_SECURITY_LAWS };

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
  // ⚠ **가지번호(제40조의2)를 본다**(2026-08-13 운영 실측). 법제처는 「제40조」와 「제40조의2」에
  //   **같은 조문번호 40**을 주고 가지만 `조문가지번호`로 따로 준다. 그래서 「제40조 알려줘」에
  //   제40조의2가 함께 나왔고, 형식이 그것까지 「제40조」라 찍어 **엉뚱한 조문을 물어본 조문인 양**
  //   보여 줬다(노출 개인정보 삭제 요청 기관 조문이 유출 신고 조문 자리에 붙었다).
  //   조문 번호는 지어내면 안 되는 값이라, 있는 그대로 「40의2」로 만들고 정확히 대조한다.
  const mapped = 조문칸.map((u) => {
    const 가지 = str(u["조문가지번호"]).replace(/\D/g, "");
    const 번호 = str(u["조문번호"]).replace(/\D/g, "");
    return {
      no: 번호 && 가지 && 가지 !== "0" ? `${번호}의${가지}` : 번호,
      title: str(u["조문제목"]),
      text: 조문본문(u),
    };
  });
  const real = mapped.filter((m) => m.no && m.text);
  if (article) {
    // 「40」은 제40조만 · 「40의2」는 제40조의2만. 가지를 안 적었으면 가지 없는 본조를 뜻한다.
    const want = article.replace(/\s/g, "").replace(/조$/, "");
    const m = /^제?(\d+)(?:의(\d+))?$/.exec(want);
    const 원하는 = m ? (m[2] ? `${m[1]}의${m[2]}` : m[1]) : want.replace(/\D/g, "");
    return real.filter((a) => a.no === 원하는);
  }
  return real.slice(0, limit);
}

/**
 * 물음과 **제목이 겹치는 조문**을 골라 본문을 돌려준다. 못 고르면 null.
 *
 * ⚠ 겹침을 **제목 → 물음** 방향으로 본다. 반대로 하면 어미 때문에 거의 안 걸린다:
 *   물음 「유출되면」 ⊄ 제목 「유출 등의 통지·신고」  ·  제목 낱말 「유출」 ⊂ 물음 ✅
 *   조문 제목은 명사구라 어미가 없다 — 이쪽이 정확하다.
 * ⚠ 점수 0이면 **안 붙인다.** 무관한 조문을 붙이면 없느니만 못하다.
 */
export function 제목점수(title: string, 물음: string): number {
  const q = String(물음).replace(/\s+/g, "");
  const 낱말 = [...new Set(String(title).match(/[가-힣]{2,}/g) ?? [])];
  return 낱말.filter((w) => q.includes(w)).length;
}

/** 조문 본문 상한 — 프롬프트가 부풀어 최종답 생성이 멈추는 것을 막는다(MAX_FACT_CHARS와 같은 계열). */
const 붙일조문 = 2;
// ★ 상위 몇 개 **법령**까지 조문을 뒤질까 (2026-08-13).
//   실무 기한은 대개 **시행령**에 있는데(72시간 = 개인정보 보호법 시행령 제40조①),
//   검색 1위는 본법이다 — 「개인정보 보호법」 검색 실측: 1위 본법 · **2위 시행령**.
//   1위만 뒤지면 72시간이 컨텍스트에 영영 안 들어가고 모델이 빈자리를 지어낸다(max 정밀 진단).
//   ⚠ 늘릴 때는 법제처 호출이 법령당 1회씩 는다는 것을 함께 볼 것.
const 조회할법령 = 3;
const 조문본문상한 = 900;

/**
 * ★ 2026-08-13 — **조문 번호 없는 실무 질문에도 본문을 준다.**
 *
 * 무엇이 있었나(max 실측, 인계_win_법령조문_본문누락):
 *   파서 77% 누락을 고쳤는데도 「개인정보 유출되면 며칠 안에 신고해야 돼?」가 여전히 틀렸다.
 *   원인이 한 겹 더 있었다 — **본문은 질문에 조문 번호가 있을 때만**(`조문번호()` →
 *   `lawArticleAnswer`) 탄다. 담당자의 실무 질문에는 번호가 없다. 고친 파서에 **닿기 전에
 *   흐름이 끝나** 여기서 제목·링크만 나갔다.
 *
 *   그리고 본문이 없으니 모델이 빈자리를 지어냈다(실측):
 *     "실무에서는 … **최대 5일 이내**에 신고 … 이는 개인정보 보호법 **시행령 제16조**에 근거"
 *   5일도 제16조도 **없는 것을 지어낸 것**이다 — 조문 번호까지 조작했다.
 *   꼬리표(「원문 확인 못 함」)는 정직하게 붙었지만 담당자는 본문의 단정을 믿는다.
 *
 * → 상위 법령의 조문 목록을 받아 **물음과 제목이 겹치는 2건**의 본문을 붙인다.
 *   「유출·신고」 → 제34조(유출 등의 통지·신고)·시행령 제40조(유출 등의 신고)가 걸리고,
 *   72시간이 본문으로 들어와 **지어낼 자리가 없어진다.**
 *
 * ⚠ 덤이므로 실패해도 답을 죽이지 않는다. 다만 **감추지도 않는다** — 조회가 죽은 것과
 *   그 조문이 없는 것은 다른 사실이고, 뭉개면 모델이 그 빈자리를 「법에 없다」로 메운다
 *   (77% 누락 사고에서 `.catch(() => [])` 삼킴이 오진을 한 단계 더 굳혔다).
 */
async function 물음에맞는조문본문(물음: string, 법들: LawHit[]): Promise<string[]> {
  const 후보: { 법: LawHit; a: LawArticle; 점수: number }[] = [];
  const 실패: string[] = [];
  for (const 법 of 법들.slice(0, 조회할법령)) {
    const mst = String(법.id ?? "").trim();
    if (!mst) continue;
    let 조회실패: string | null = null;
    // limit을 크게 준다 — 앞에서 N건만 받으면 제34조처럼 뒤에 있는 조문을 **고를 기회조차 없다.**
    const articles = await getLawArticles(mst, undefined, 500).catch((e) => {
      조회실패 = e instanceof Error ? e.message : String(e);
      return [] as LawArticle[];
    });
    if (조회실패) { 실패.push(`「${법.title}」(${조회실패})`); continue; }
    for (const a of articles) {
      const 점수 = 제목점수(`${a.title ?? ""} ${a.text.slice(0, 40)}`, 물음);
      if (점수 > 0) 후보.push({ 법, a, 점수 });
    }
  }
  if (실패.length && !후보.length) {
    return ["", `⚠ 조문 원문을 가져오지 못했습니다 — ${실패.join(" · ")}. **법에 없다는 뜻이 아닙니다.** 위 원문 링크에서 확인해 주세요.`];
  }
  // ★ **법령마다 가장 잘 맞는 것 하나씩 먼저 고른다.**
  //   그냥 점수순으로 자르면 본법에서 두 건이 뽑혀 **시행령이 밀린다** — 그런데 실무 기한은
  //   대개 시행령에 있다(72시간 = 개인정보 보호법 **시행령** 제40조①).
  const 법령별최고 = new Map<string, { 법: LawHit; a: LawArticle; 점수: number }>();
  for (const c of 후보) {
    const k = String(c.법.id);
    const 이전 = 법령별최고.get(k);
    if (!이전 || 이전.점수 < c.점수) 법령별최고.set(k, c);
  }
  const 고른것 = [...법령별최고.values()].sort((x, y) => y.점수 - x.점수).slice(0, 붙일조문);
  if (!고른것.length) return [];
  const out = ["", `▸ 물음과 맞닿은 조문 원문 ${고른것.length}건 (법제처에서 받은 그대로):`];
  for (const { 법, a } of 고른것) {
    out.push("");
    out.push(`[${법.title}] 제${a.no}조${a.title ? `(${a.title})` : ""}`);
    out.push(a.text.slice(0, 조문본문상한));
  }
  return out;
}

/**
 * 물음에서 **아는 법령 이름**을 추려낸다. 없으면 null.
 *
 * ★ 왜 필요한가(2026-08-13 실측) — **법제처 검색은 「법령 제목」 검색이다.**
 *   주제어를 섞으면 0건이 나오는데, 모델은 질문을 거의 그대로 넣는다:
 *     「개인정보 보호법」                    → 2건 (본법 + 시행령)
 *     「개인정보 보호법**에서 유출 신고**」   → **0건**
 *     「개인정보 유출」                      → **0건**
 *   0건이면 조문을 붙이는 수리(물음에맞는조문본문)가 **발동조차 못 한다** —
 *   그래서 72시간이 컨텍스트에 안 들어가고 모델이 빈자리를 지어냈다.
 *   ⚠ 프롬프트로 「법령 이름만 넣어라」라고 타이르지 않는다 — 이 크기 모델에 그 방식은
 *     이 저장소에서 반복해 실패했다. **코드가 추려서 다시 찾는다.**
 * ⚠ 긴 이름부터 본다 — 「개인정보 보호법 시행령」이 「개인정보 보호법」보다 먼저 걸려야 한다.
 */
export function 법령이름추리기(query: string): string | null {
  const q = String(query ?? "").replace(/\s+/g, "");
  const 후보 = [...IT_SECURITY_LAWS].sort((a, b) => b.length - a.length);
  for (const 이름 of 후보) {
    if (q.includes(이름.replace(/\s+/g, ""))) return 이름;
  }
  return null;
}

/** 챗봇 답변용 — 사람이 그대로 읽는 형식. 원문 링크를 반드시 함께 준다. */
export async function lawAnswer(query: string, target: LawTarget = "law"): Promise<string> {
  let hits = await searchLaw(query, target, 5);
  // ★ 0건이면 **아는 법령 이름으로 한 번 더** 찾는다(위 법령이름추리기 머리말 참고).
  //   이 한 번이 「조문을 붙이는 수리」가 발동할 자리를 만든다.
  if (!hits.length) {
    const 이름 = 법령이름추리기(query);
    if (이름) hits = await searchLaw(이름, target, 5).catch(() => []);
  }
  // ★ 그래도 0건이면 **긴 낱말부터 한 낱말씩** 다시 찾는다(2026-08-13 실측).
  //   모델의 검색어는 「개인정보 유출 신고 기한」처럼 주제 문장이다 — 제목 검색이라 0건이다.
  //   그런데 「개인정보」 **한 낱말**은 5건(본법+시행령)을 돌려준다. 법령 제목에 들어가는
  //   낱말 하나면 충분한 것이다. 엉뚱한 법령이 걸려도 아래 조문 고르기(제목점수>0)가
  //   걸러 낸다 — 물음과 안 겹치는 조문은 안 붙는다.
  //   ⚠ 호출 상한 2회 — 재시도가 법제처를 두드리는 횟수를 묶는다.
  if (!hits.length && target === "law") {
    const 낱말들 = [...new Set(String(query).match(/[가-힣]{3,}/g) ?? [])]
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);
    for (const w of 낱말들) {
      hits = await searchLaw(w, target, 5).catch(() => []);
      if (hits.length) break;
    }
  }
  if (!hits.length) {
    return [
      // ⚠ 「찾지 못했습니다」를 쓰지 않는다(2026-08-13) — 서랍 점검(drawer-audit.mjs)의
      //   폴백 문구 목록(FAIL_MARKS)에 그 말이 있어 **제품이 정직하게 낸 답에 실패 딱지**가 붙는다.
      //   오늘 llm.ts·actioncheck.ts에 이어 **세 번째로 같은 함정**을 만난 자리다.
      //   ★ 이 첫 줄을 고치면 아래 `법령검색없음표지`와 시험을 함께 볼 것 — QA 회귀(fin-mangbunri)
      //     실사고: 이 문구 교체가 옛 표지(NO_HIT_PREFIX startsWith)와 어긋나 agentloop의
      //     사내지식 보강이 소리 없이 통째로 죽었다. 발신자와 판정자는 한 표지를 쓴다.
      `🔎 "${query}"로는 ${LAW_TARGETS[target].label} 검색 결과가 없습니다.`,
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
  // ★ 조문 번호가 없는 실무 질문에도 **본문**을 붙인다(위 물음에맞는조문본문 머리말 참고).
  //   ⚠ 법령일 때만 — 판례·행정규칙은 조문 조회(lawService.do target=law) 대상이 아니다.
  if (target === "law") lines.push(...(await 물음에맞는조문본문(query, hits)));
  lines.push("", LEGAL_DISCLAIMER);
  return lines.join("\n");
}

/**
 * 법령 0건 답의 표지 — agentloop `법령답이부족한가`가 이걸로 「부족」을 판정해 사내지식을 보강한다.
 * ⚠ 위 lawAnswer의 0건 첫 줄과 **한 몸**이다(2026-08-13 QA 회귀 fin-mangbunri에서 어긋남 실측).
 */
export const 법령검색없음표지 = /^🔎 "[^"\n]*"로는 [^\n]*검색 결과가 없습니다/;

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
  let hits = await searchLaw(query, "law", 3);
  // ★ 0건이면 긴 낱말로 한 번 더(2026-08-13 QA) — lawAnswer의 재시도 사다리와 같은 처방.
  //   여기서 바로 목록으로 물러나면 담당자가 물은 **조문 본문 의도가 사라진다**
  //   (「제40조 내용」→ 검색어에 낀 군말 하나로 0건 → 목록만 돌아온 실측).
  if (!hits.length) {
    const 낱말들 = [...new Set(String(query).match(/[가-힣]{3,}/g) ?? [])]
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);
    for (const w of 낱말들) {
      hits = await searchLaw(w, "law", 3).catch(() => []);
      if (hits.length) break;
    }
  }
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
      `🔎 「${법.title}」에서 제${article}조 본문이 검색되지 않았습니다 — 조문 번호를 확인해 주세요.`,
      `   원문: ${법.link}`,
      "",
      LEGAL_DISCLAIMER,
    ].join("\n");
  }
  const lines = [`${법.title} — 제${article}조`, ""];
  for (const a of articles) {
    // ⚠ 머리줄을 두 번 찍지 않는다(2026-08-13 운영 실측). 본문 조립이 「항」까지 읽게 되면서
    //   `조문내용`의 제목 줄이 text 앞에 들어왔고, 그 위에 이 줄을 또 찍어 **제목이 두 줄**로 나왔다.
    //   text에서 지우지 않고 여기서 건너뛴다 — 제1조처럼 제목과 본문이 한 줄인 조문이 있어
    //   text를 손대면 본문이 잘린다.
    const 머리 = `제${a.no}조${a.title ? `(${a.title})` : ""}`;
    if (!a.text.startsWith(`제${a.no}조`)) lines.push(머리);
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
