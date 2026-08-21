// engine/urlingest.ts — URL 지식화 (2026-08-21 사장님 「링크를 걸면 지식화 — 일단 가능하게」)
//
// ■ 무엇: 웹 페이지(그리고 유튜브 자막)를 받아 본문만 발라 기존 반입 배관(ingestText)에 태운다.
//   3층 원칙의 ①층(형식 풀기)은 여기서도 결정적 코드다 — LLM 없이 태그를 걷어낸다.
// ■ 경계:
//   · 외부 접속이다 — EGRESS_POINTS에 등재돼 있고, 에어갭 봉인이 켜지면 전역 fetch 관문이
//     자동 차단한다(여기서 따로 뚫지 않는다 — default-deny 계약).
//   · 사설망·localhost 주소는 거절한다(SSRF 방어) — 지식화 기능이 내부망 정찰 도구가 되면 안 된다.
//   · 출처 표기는 사용자에게 요구하지 않지만 **문서 id=URL로 내부 꼬리표**를 남긴다 —
//     안 남기면 지우거나 갱신할 길이 없다. origin="external-web"으로 사내 근거와 갈래를 나눈다
//     (타사 문서가 지식 53%를 차지해 근거가 흔들린 실사고의 재발 방지).
//   · 유튜브는 자막이 있는 영상만 — 자막이 없으면 정직하게 못 읽는다고 말한다(STT는 실측 후).
import { ingestText } from "./memory";
import { isPrivateIp } from "./airgap";

const 최대바이트 = 3 * 1024 * 1024;
const 시간제한ms = 20000;

/** 사설망·루프백·링크로컬·메타데이터 거절(SSRF 방어). ⚠ 사설 IP 판정은 **airgap.isPrivateIp**를
 *  재사용한다 — 여기서 새로 짰다가 IPv6 대괄호([::1])·0.0.0.0·fc/fd 호스트명 오판을 다시 냈다
 *  (2026-08-21 검토관 상1~3, 중4). URL의 hostname은 IPv6일 때 대괄호를 포함하는데 isPrivateIp가
 *  그것을 떼고 콜론 유무로 이름/리터럴을 가른다(fcc.gov 같은 도메인 오차단도 그 함수가 안 낸다). */
export function isPrivateTarget(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // 0.0.0.0은 리눅스에서 로컬로 접속된다 — isPrivateIp의 IPv4 분기는 이걸 사설로 안 보므로 따로 막는다.
  if (h === "0.0.0.0" || h === "[::]") return true;
  if (isPrivateIp(url.hostname)) return true; // 대괄호·IPv6 리터럴은 이 함수가 처리
  return false;
}

/** HTML에서 본문 텍스트만 — 결정적 정제(스크립트·스타일·꾸밈 태그 제거 → 태그 걷기 → 공백 정리). */
export function extractMainText(html: string): { title: string; text: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside|svg|form)[\s\S]*?<\/\1>/gi, " ");
  // 본문 후보가 있으면 그 안만 쓴다 — 목록 페이지의 메뉴·꼬리말이 지식이 되는 것을 줄인다.
  const main = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  if (main && main[2].replace(/<[^>]+>/g, "").trim().length > 200) s = main[2];
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " ");
  for (const [a, b] of [["&lt;", "<"], ["&gt;", ">"], ["&amp;", "&"], ["&quot;", '"'], ["&#39;", "'"], ["&nbsp;", " "]] as const) s = s.split(a).join(b);
  const text = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

export function isYoutubeUrl(url: URL): boolean {
  return /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === "youtu.be";
}

/** 유튜브 자막 — 시청 페이지의 captionTracks에서 자막 주소를 찾아 받는다(ko→en→첫 번째). */
export async function fetchYoutubeTranscript(url: URL): Promise<{ title: string; text: string }> {
  const page = await fetchCapped(url.toString(), "text/html");
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] ?? "유튜브 영상").replace(/\s*-\s*YouTube\s*$/i, "").trim();
  const capRaw = /"captionTracks":(\[[\s\S]*?\])/.exec(page)?.[1];
  if (!capRaw) throw new Error("이 영상에는 받을 수 있는 자막이 없습니다 — 자막 없는 영상(음성 인식)은 아직 지원하지 않습니다.");
  let tracks: { baseUrl?: string; languageCode?: string }[] = [];
  try { tracks = JSON.parse(capRaw.replace(/\\u0026/g, "&")); } catch { throw new Error("자막 정보를 읽지 못했습니다(유튜브 응답 형식 변경 가능)."); }
  const pick = tracks.find((t) => t.languageCode?.startsWith("ko")) ?? tracks.find((t) => t.languageCode?.startsWith("en")) ?? tracks[0];
  if (!pick?.baseUrl) throw new Error("자막 주소를 찾지 못했습니다.");
  const xml = await fetchCapped(pick.baseUrl, "");
  const text = xml.replace(/<[^>]+>/g, "\n").split("&amp;").join("&").split("&#39;").join("'").split("&quot;").join('"')
    .replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (!text) throw new Error("자막이 비어 있습니다.");
  return { title, text };
}

async function fetchCapped(url: string, accept: string): Promise<string> {
  // ⚠ 리다이렉트를 **홉마다 재검사**한다(2026-08-21 검토관 상2). redirect:"follow"면 공개
  //   도메인이 302로 169.254.169.254(클라우드 메타데이터)·내부 콘솔로 튕겨도 그대로 따라가
  //   SSRF가 된다(에어갭 OFF가 표준 배치라 전역 fetch 관문만으론 안 막힌다). manual로 받아
  //   Location을 isPrivateTarget으로 검사하고서만 다음 홉으로 간다.
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(cur, {
      signal: AbortSignal.timeout(시간제한ms),
      headers: { "user-agent": "Mozilla/5.0 (GIJO-AS knowledge ingest)", ...(accept ? { accept } : {}) },
      redirect: "manual",
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error(`가져오기 실패(리다이렉트에 목적지가 없음, ${r.status})`);
      const next = new URL(loc, cur);
      if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error("리다이렉트가 http(s)가 아닙니다 — 중단합니다.");
      if (isPrivateTarget(next)) throw new Error("리다이렉트가 내부망·사설 주소로 향합니다 — 보안상 중단합니다.");
      cur = next.toString();
      continue;
    }
    if (!r.ok) throw new Error(`가져오기 실패(${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 최대바이트) throw new Error(`페이지가 너무 큽니다(${Math.round(buf.length / 1024)}KB > ${최대바이트 / 1024}KB)`);
    return buf.toString("utf8");
  }
  throw new Error("리다이렉트가 너무 많습니다(5회 초과) — 중단합니다.");
}

export async function ingestUrl(rawUrl: string, actor?: string): Promise<{ documentId: string; title: string; chunks: number; youtube: boolean }> {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("주소 형식이 아닙니다 — http(s)://로 시작하는 링크를 주세요."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("http(s) 링크만 지식화할 수 있습니다.");
  if (isPrivateTarget(url)) throw new Error("내부망·사설 주소는 이 기능으로 반입하지 않습니다(보안 경계).");
  const youtube = isYoutubeUrl(url);
  const { title, text } = youtube ? await fetchYoutubeTranscript(url) : extractMainText(await fetchCapped(url.toString(), "text/html"));
  if (text.length < 80) throw new Error("본문으로 볼 만한 글이 없습니다 — 이 페이지는 글이 거의 없거나 스크립트로만 그려집니다.");
  const documentId = url.toString().slice(0, 300); // 내부 꼬리표 = URL — 삭제·갱신·근거 배지의 열쇠
  const 본문 = (title ? `# ${title}\n\n` : "") + text;
  const r = await ingestText(documentId, 본문, undefined, undefined, true, actor, undefined, "external-web");
  return { documentId, title: title || documentId, chunks: r.chunks, youtube };
}
