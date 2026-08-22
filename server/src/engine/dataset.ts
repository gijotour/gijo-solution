// engine/dataset.ts — 파인튜닝용 대화형 데이터셋 변환 · 증폭 · 저장 (6.2절 ②단계)
// 저장된 데이터셋(data/datasets/<id>.json)이 finetune_unsloth.py의 입력이 된다.

import type { Express } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";
import { recordProcessOutput } from "./logs";
import { serverPython, serverScript } from "../util/pythonbin";
// 학습 데이터가 디스크에 닿는 유일한 자리라, 위생을 여기서 건다(호출부마다 붙이면 또 빠뜨린다).
import { cleanForTraining, type 데이터종류 } from "./datasethygiene";

// 테스트가 실제 데이터셋(data/datasets/*.json)을 덮어쓰거나 지우지 않도록 경로를 env로 격리 가능하게 한다
// (vitest.config.ts가 임시 디렉터리로 지정). 미설정 시 운영 경로.
const DATASETS_DIR = process.env.GIJO_DATASETS_DIR ?? path.join("data", "datasets");

/** 「글자가 거의 없다 = 스캔본이다」를 가르는 값.
 *  ⚠ **scripts/extract_doc.py:51 `OCR_MIN_TEXT = 20`과 같은 값이어야 한다.** JS와 파이썬이
 *    상수를 나눠 가질 길이 없어 양쪽에 적는다 — 한쪽만 고치면 「오늘은 OCR로 가던 문서가
 *    내일은 안 가는」 조용한 회귀가 난다(같은 목록을 두 파일에 두는 memory.ts↔docsbundle.ts의
 *    `추출필요`와 같은 방식으로, 서로를 가리키는 주석을 단다).
 */
const 스캔판정_최소글자 = 20;

/** PDF에서 글자를 뽑는다 — unpdf(pdf.js 기반, MIT·의존성 0·2.5MB).
 *
 *  실측(2026-08-22): 제안서 2.0MB → pypdf 4,507자 / unpdf 4,635자, 한글 비율 47% 대 46%.
 *  제품소개서 3.2MB → 24,286자 / 24,295자. 즉 **현행과 사실상 동등하고 한글이 정확히 나온다.**
 *
 *  ⚠ mergePages를 빼면 text가 배열로 온다 — 그대로 이어붙이면 타입은 통과하는데 내용이 오염된다.
 *  ⚠ unpdf는 **영어로** 던진다(InvalidPDFException·PasswordException). 그대로 두면 담당자 화면에
 *    영어가 나가므로 한글로 감싼다(「모든 사용자 대상 텍스트는 한글로」).
 */
/* ── 자간 복원은 **일부러 하지 않는다** (2026-08-22, 세 번 시도하고 내린 결론) ────────────
 *
 * 무엇이 문제인가: pdf.js는 **글자 위치**를 보고 간격이 넓으면 공백을 넣는다. 그래서 디자인상
 * 자간을 벌린 제목이 「플 래 그 십」으로 뽑히고, 담당자가 「플래그십」을 찾으면 안 걸린다.
 * pypdf는 글리프를 순서대로 이어붙여 붙은 형태로 뽑았다(실측 회수율 97.4%, 낱말 11개 차이).
 *
 * 왜 안 고치나 — 고치려던 세 방법이 **전부 더 나빴다**(전부 실측):
 *   ① 조각(item)을 직접 이어붙이기 → 조각 사이 공백에 조사가 갈라졌다(「대신하고」→「대신 하고」).
 *      회수율 97.4% → **96.8%**.
 *   ② 문자열 전체에 「한 글자+공백」 정규식 → 「한 명 의 몫을」 같은 **정상 문장**을 자간으로 오인해
 *      통째로 붙였다. 회수율 **91~95%로 급락** — 멀쩡한 낱말이 사라지는 쪽이 훨씬 나쁘다.
 *   ③ 낱자 4연속으로 좁히기 → 실제 문서에서 **아무것도 안 잡혔다**(죽은 규칙).
 *
 * 그래서 **덜 잡는 쪽**을 골랐다. 지금 회수율은 5종 중 4종 99.9~100%, 1종 97.4%다.
 * 되살릴 방법이 없는 건 아니다 — pdf.js 조각의 좌표·폭을 보고 간격을 재면 정확히 가를 수 있다.
 * 다만 그건 별도 작업이고, 그전에 **잘못 붙이지 않는 것**이 더 중요하다.
 * ⚠ 이 주석을 지우고 「간단히 정규식으로 붙이면 되겠다」고 다시 시도하지 말 것 — 이미 두 번 밟았다.
 */

async function pdf추출(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  try {
    const { text } = await extractText(doc, { mergePages: true });
    // ⚠ mergePages:true면 문자열이다. 배열이 오면 **쉼표로 이어붙지 않게** 개행으로 잇는다
    //   (String([...])은 페이지 경계를 쉼표로 만든다 — 검토관 2026-08-22 지적).
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } finally {
    // ⚠ **우리가 만든 문서 객체는 우리가 닫는다** — unpdf는 호출자가 넘긴 객체를 일부러
    //   파괴하지 않는다(수명 관리를 호출자에게 맡긴다). 안 닫으면 운영처럼 오래 도는
    //   프로세스에서 PDF를 올릴 때마다 파서 상태가 쌓인다(검토관 2026-08-22 지적).
    //   ⚠ **`doc.destroy()`가 아니라 `doc.loadingTask.destroy()`다**(2026-08-22 재검토 [높음]).
    //     처음엔 `(doc as {destroy?}).destroy?.()`로 썼는데 그 객체엔 destroy가 아예 없어서
    //     **아무 일도 안 하고 조용히 지나갔다** — 캐스팅+옵셔널 조합이라 tsc도 런타임도 안 잡는다.
    //     실측으로 확인했다: doc.destroy=undefined · doc.loadingTask.destroy=function.
    //     unpdf 자신도 내부에서 loadingTask.destroy()를 쓴다.
    try { await doc.loadingTask?.destroy(); } catch { /* 이미 닫혔으면 그만 */ }
  }
}

/** XML 태그를 걷고 엔티티를 되돌린다 — extract_doc.py의 `_strip_tags`와 **같은 동작**.
 *
 *  ⚠ 서버에 비슷한 함수가 이미 셋 있는데(urlingest 두 곳·vulnscan) **일부러 안 쓴다.**
 *    vulnscan의 것은 숫자 엔티티(`&#54620;` 같은 한글)를 **공백으로 지우는데** 파이썬은 그대로 둔다 —
 *    재사용하면 같은 문서가 파이썬으로 넣었을 때와 다른 글이 되어, 옛 조각과 새 조각이 어긋난다.
 *    잣대를 늘리는 게 아니라 **옮겨 온 원본과의 동치**를 지키는 쪽을 골랐다(설계관 2026-08-22).
 */
function 태그걷기(xml: string): string {
  let t = xml.replace(/<[^>]+>/g, "");
  for (const [a, b] of [["&lt;", "<"], ["&gt;", ">"], ["&amp;", "&"], ["&quot;", '"'], ["&apos;", "'"]] as const) {
    t = t.split(a).join(b);
  }
  return t;
}

/** 오피스 4종(zip+xml)에서 글자를 뽑는다 — extract_doc.py의 형식별 함수를 **1:1로** 옮긴 것.
 *
 *  ⚠ 「더 잘 뽑기」를 하지 않았다. 범위·정규식·엔티티 목록을 원본과 똑같이 맞춘다 —
 *    다르게 뽑으면 예전에 넣은 문서와 새로 넣는 문서의 조각이 갈려 검색 결과가 흔들린다.
 *    개선(예: docx 문단 경계 살리기)은 그 자체로 별도 판단거리다(아래 docx 주석 참조).
 */
/** 파이썬 main()이 **모든 형식에** 마지막으로 거는 정규화 — extract_doc.py:236-238과 같은 세 줄.
 *  ⚠ 이걸 빠뜨리면 「글자 하나까지 일치」가 성립하지 않는다(검토관 2026-08-22 확정).
 *    재현: Word가 앞뒤 공백 있는 런에 붙이는 `xml:space="preserve"` → 파이썬 「글자 다음」,
 *    이걸 안 걸면 「글자  다음」(공백 둘). 조각 본문·경계가 갈려 옛 문서와 어긋난다. */
function 파이썬꼬리정규화(t: string): string {
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function 오피스추출(ext: string, buf: Buffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    // 손상된 zip·암호가 걸린 파일 — 파이썬도 같은 자리에서 죽는다. 문구는 사람이 읽을 말로.
    //   ⚠ 암호 걸린 엔트리는 loadAsync를 통과하고 읽을 때 죽는다(jszip이 영어로 던진다) —
    //     그래서 아래 읽기()도 같은 문구로 감싼다(검토관 2026-08-22: 영어가 화면에 나갔다).
    void e;
    throw new Error("문서를 열지 못했습니다 — 파일이 손상됐거나 암호가 걸려 있습니다");
  }
  const 이름들 = Object.keys(zip.files);
  const 읽기 = async (n: string) => {
    try {
      return await zip.files[n].async("string");
    } catch {
      throw new Error("문서를 열지 못했습니다 — 파일이 손상됐거나 암호가 걸려 있습니다");
    }
  };
  const parts: string[] = [];

  if (ext === ".hwpx") {
    // 원본: 이름에 "section"이 든 모든 .xml에서 <hp:t>. ⚠ 엔티티가 **4종**이다(&apos; 없음).
    for (const n of 이름들) {
      if (!n.toLowerCase().includes("section") || !n.endsWith(".xml")) continue;
      const xml = await 읽기(n);
      parts.push([...xml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((m) => m[1]).join(" "));
    }
    let t = parts.join(" ").replace(/<[^>]+>/g, "");
    for (const [a, b] of [["&lt;", "<"], ["&gt;", ">"], ["&amp;", "&"], ["&quot;", '"']] as const) t = t.split(a).join(b);
    return 파이썬꼬리정규화(t);
  }

  if (ext === ".docx") {
    // 원본: word/document.xml **또는** word/(header|footer)N.xml — 머리말·꼬리말을 빠뜨리면
    //   기존 시험(「사내 대외비」가 header1.xml에 있다)이 바로 깨진다.
    // ⚠ 원본은 </w:p>를 개행으로 바꾼 뒤 <w:t> 안쪽만 긁는다 — 그 개행은 태그 **밖**이라
    //   결과에 안 들어간다. 즉 주석의 「문단 경계를 살린다」는 실제로 동작하지 않는다.
    //   여기서도 **그대로 둔다**: 고치면 같은 문서가 예전과 다르게 쪼개진다(별도 판단거리).
    for (const n of 이름들) {
      const low = n.toLowerCase();
      if (low !== "word/document.xml" && !/^word\/(header|footer)\d*\.xml$/.test(low)) continue;
      const xml = (await 읽기(n)).replace(/<\/w:p>/g, "\n");
      parts.push([...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(" "));
    }
    return 파이썬꼬리정규화(태그걷기(parts.join("\n")));
  }

  if (ext === ".pptx") {
    // 원본: 슬라이드 먼저·노트 나중, 각각 번호순. ⚠ <a:t>는 **속성 없는 것만** 잡는다(원본과 동일).
    const 대상 = 이름들
      .filter((n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n))
      .sort((a, b) => {
        const 갈래 = (n: string) => (n.includes("/slides/") ? 0 : 1);
        const 번호 = (n: string) => Number((n.match(/(\d+)\.xml$/) ?? ["", "0"])[1]);
        return 갈래(a) - 갈래(b) || 번호(a) - 번호(b);
      });
    for (const n of 대상) {
      const xml = await 읽기(n);
      const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
      if (texts.length) parts.push(texts.join(" "));
    }
    return 파이썬꼬리정규화(태그걷기(parts.join("\n\n")));
  }

  // .xlsx — 원본: 공유 문자열 + 시트 안 인라인 문자열. 숫자 격자는 **일부러 버린다**
  //   (숫자만 이어붙이면 검색을 오염시키는 무의미 조각이 된다 — PDF 바이트 사고와 같은 부류).
  for (const n of 이름들) {
    const low = n.toLowerCase();
    if (low === "xl/sharedstrings.xml") {
      const xml = await 읽기(n);
      parts.push([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("\n"));
    } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(low)) {
      const xml = await 읽기(n);
      const inline = [...xml.matchAll(/<is>\s*<t(?:\s[^>]*)?>([\s\S]*?)<\/t>\s*<\/is>/g)].map((m) => m[1]);
      if (inline.length) parts.push(inline.join("\n"));
    }
  }
  return 파이썬꼬리정규화(태그걷기(parts.join("\n")));
}

// 업로드된 문서(PDF/이미지 등)에서 학습용 텍스트를 추출한다 — scripts/extract_doc.py(python) 사용.
// 파일을 임시 폴더에 쓴 뒤 확장자를 유지해 스크립트가 형식을 판별하게 한다. PYTHONUTF8=1(한국어).
// ⚠ 오피스 4종은 위 오피스추출()이 파이썬 없이 처리한다 — 여기로 오지 않는다.
export async function extractDocumentText(filename: string, base64: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase() || ".txt";
  // ★ 텍스트 계열은 파이썬 추출기(scripts/extract_doc.py)를 **거치지 않는다** — 이미 텍스트라 추출이
  //   필요 없고, 그 스크립트가 없는 환경에서 **텍스트까지 전량 실패**했다(max 발견#5 ★치명 2026-08-17:
  //   라이트 빌드의 server-dist가 scripts/를 안 담아 .md 넣기가 서버400). base64를 UTF-8로 바로 푼다.
  //   바이너리(PDF·HWPX·docx…)만 추출기로 보낸다.
  const 텍스트계열 = new Set([".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml"]);
  if (텍스트계열.has(ext)) {
    const text = Buffer.from(base64, "base64").toString("utf8");
    recordProcessOutput("extract-doc", "log", `${filename} — 텍스트 직접 읽음(${text.length.toLocaleString()}자, 파이썬 추출 생략)`);
    return text;
  }
  // ★ 오피스 4종(HWPX·DOCX·XLSX·PPTX)은 **파이썬 없이** 읽는다(2026-08-22).
  //   넷 다 zip 안의 XML이라 파이썬이 필요 없었는데(표준 라이브러리 zipfile+re만 썼다),
  //   그 때문에 **파이썬이 없는 기계에서 함께 죽고 있었다** — 특히 mac 설치본은 파이썬 동봉 전이라
  //   한글(HWPX) 문서가 통째로 안 읽혔다. zip 해석기(jszip)는 이미 출하본에 들어 있어 **추가 용량 0**이다.
  //   PDF·이미지(OCR)는 그대로 파이썬이다 — 그쪽은 진짜 부품이 필요하다.
  const 오피스 = new Set([".hwpx", ".docx", ".xlsx", ".pptx"]);
  if (오피스.has(ext)) {
    const text = await 오피스추출(ext, Buffer.from(base64, "base64"));
    recordProcessOutput("extract-doc", "log", `${filename} — zip+xml 직접 읽음(${text.length.toLocaleString()}자, 파이썬 불필요)`);
    return text;
  }
  // ★ PDF도 파이썬 없이 읽는다(2026-08-22) — 실측: pypdf 4,507자 vs unpdf 4,635자, 한글 비율 동일.
  //   이걸로 **mac에도 파이썬을 동봉할 이유가 사라졌다**(원래 그게 다음 작업이었다).
  //   ⚠ 다만 **스캔 PDF(글자가 없는 PDF)는 여전히 파이썬 몫**이다 — 거기에 OCR이 있다.
  //     글자가 거의 안 나오면 아래 파이썬 경로로 넘긴다(그 경로가 OCR 폴백을 이미 갖고 있다).
  if (ext === ".pdf") {
    // ⚠ **JS가 실패해도 파이썬으로 넘긴다**(검토관 2026-08-22). pdf.js는 pypdf보다 까다로워서
    //   구조가 조금 깨진 PDF를 거절하는 부류가 있다 — 여기서 던져 버리면 **예전에 잘 들어오던
    //   문서가 이제 안 들어오고**, 안내는 「PDF가 손상됐다」며 원인을 문서 탓으로 돌린다.
    //   실패도 「글자를 못 뽑았다」로 보고 아래 파이썬 경로에 한 번 더 기회를 준다.
    let 글 = "";
    try {
      글 = await pdf추출(Buffer.from(base64, "base64"));
    } catch (e) {
      const 원문 = e instanceof Error ? e.message : String(e);
      recordProcessOutput("extract-doc", "warn", `${filename} — JS 추출 실패(${원문}) · 파이썬 경로로 넘김`);
      // ⚠ **암호 걸린 PDF는 파이썬도 못 연다** — 넘겨 봐야 영어 오류가 화면에 나간다
      //   (pypdf의 「File has not been decrypted」가 도구없음 정규식에 안 걸려 그대로 전달된다).
      //   여기서 한글로 끊는다(2026-08-22 재검토 [중]: 감싸기를 지웠다가 회귀했다).
      if (/password|encrypt/i.test(원문)) {
        throw new Error("문서를 열지 못했습니다 — 암호가 걸린 PDF입니다. 암호를 푼 뒤 다시 올려 주세요.");
      }
    }
    if (글.trim().length >= 스캔판정_최소글자) {
      // ⚠ PDF에도 **같은 꼬리 정규화**를 건다 — 파이썬 main()은 형식과 무관하게 이걸 거친다.
      //   안 걸면 같은 PDF가 「JS로 읽혔을 때」와 「파이썬으로 넘어갔을 때」 다른 글이 되어,
      //   조각 경계와 추출본(.md)이 갈린다(2026-08-22 재검토 [중] — 오피스만 고치고 PDF를 빠뜨렸다).
      const 정리 = 파이썬꼬리정규화(글);
      recordProcessOutput("extract-doc", "log", `${filename} — PDF 직접 읽음(${정리.length.toLocaleString()}자, 파이썬 불필요)`);
      return 정리;
    }
    // 글자가 거의 없다 = 스캔본일 가능성 → 파이썬(OCR)에 맡긴다. 여기서 끊으면 스캔 문서가
    // 조용히 빈 결과가 된다 — 예전엔 파이썬 안에서 이 폴백이 일어났고, 그 길을 그대로 잇는다.
    recordProcessOutput("extract-doc", "log", `${filename} — 글자가 거의 없음(${글.trim().length}자) · 스캔본으로 보고 OCR 경로로 넘김`);
    // ⚠ 한때 「파이썬이 없으면 JS가 뽑은 1~19자라도 살린다」를 넣었다가 **되돌렸다**
    //   (2026-08-22 재검토 [높음]). 그 갈래가 타는 상태는 바로 위에서 스스로 「글자가 거의 없다」고
    //   판정한 상태이고, 정직 게이트(ingestText의 쓰레기 검사)는 원문이 3조각 이상일 때만 도는지라
    //   19자는 **원리상 통과**한다 — 쓰레기가 「반입 성공(1조각)」으로 들어간다.
    //   짧은 문서를 살리려면 「일부만 읽었다」를 응답에 실어야 하고, 그건 별도 설계다.
    //   여기서는 파이썬에 맡기고, 파이썬도 없으면 **정직하게 실패**한다.
  }
  return 파이썬추출(filename, base64, ext);
}

export interface ConversationExample {
  question: string;
  answer: string;
}

function isExample(item: unknown): item is ConversationExample {
  return typeof item === "object" && item !== null && "question" in item && "answer" in item;
}

// LLM 응답에서 Q&A 쌍을 최대한 견고하게 뽑는다. 로컬 7B 모델은 종종 배열 앞뒤에 설명을 붙이거나
// 응답이 잘리므로: (1) 코드펜스 제거 (2) 첫 '['~마지막 ']' 슬라이스 후 JSON.parse
// (3) 그래도 실패하면 개별 {"question":..,"answer":..} 객체를 정규식으로 긁어낸다(잘린 배열도 앞부분은 살림).
function parseExamples(raw: string): ConversationExample[] {
  let s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s) as unknown;
    if (Array.isArray(parsed)) {
      const items = parsed.filter(isExample);
      if (items.length > 0) return items;
    }
  } catch {
    /* 아래 정규식 폴백으로 */
  }
  // 폴백: 완전한 객체만 하나씩 추출 (배열이 잘렸어도 앞의 완성된 쌍은 건진다)
  const out: ConversationExample[] = [];
  const re = /\{\s*"question"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"answer"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      out.push({ question: JSON.parse(`"${m[1]}"`), answer: JSON.parse(`"${m[2]}"`) });
    } catch {
      out.push({ question: m[1], answer: m[2] });
    }
  }
  return out;
}

// 긴 문서는 로컬 7B의 컨텍스트/안정성을 넘겨 변환이 실패하므로, 문단 경계 기준으로 청크를 나눠
// 각각 변환한 뒤 합친다. 청크 하나가 실패해도 나머지는 살린다.
const CONVERT_CHUNK_SIZE = 2500;

function chunkForConvert(text: string, size = CONVERT_CHUNK_SIZE): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let buf = "";
  for (const p of paras) {
    if (buf && (buf + "\n\n" + p).length > size) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
    // 한 문단이 통째로 size를 넘으면 강제로 자른다
    while (buf.length > size) {
      chunks.push(buf.slice(0, size));
      buf = buf.slice(size);
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

async function convertChunk(chunk: string): Promise<ConversationExample[]> {
  const prompt = [
    "아래 보안 문서를 파인튜닝용 질문-답변(Q&A) 쌍으로 변환해줘.",
    '출력은 JSON 배열만: [{"question":"...","answer":"..."}, ...] 형식, 다른 텍스트 없이.',
    "문서 내용을 근거로 3~8개의 Q&A 쌍을 만들어줘.",
    "문서:",
    chunk,
  ].join("\n\n");
  // 긴 출력이 잘리지 않게 max_tokens를 넉넉히.
  return parseExamples(await chat({ agentId: "analysis", message: prompt, maxTokens: 2048, trusted: true }));
}

export async function convertToConversationFormat(rawText: string): Promise<ConversationExample[]> {
  const chunks = chunkForConvert(rawText.trim());
  const all: ConversationExample[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    for (const ex of await convertChunk(chunk)) {
      const key = ex.question.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        all.push(ex);
      }
    }
  }
  return all;
}

export async function amplifyDataset(examples: ConversationExample[], factor = 3): Promise<ConversationExample[]> {
  if (examples.length === 0) return [];
  const amplified: ConversationExample[] = [...examples];
  for (const example of examples) {
    const prompt = [
      `다음 질문-답변 쌍을 의미는 유지하면서 표현만 다르게 ${factor - 1}가지 버전으로 바꿔줘.`,
      "출력은 JSON 배열만: [{\"question\":\"...\",\"answer\":\"...\"}, ...] 형식, 다른 텍스트 없이.",
      `원본: ${JSON.stringify(example)}`,
    ].join("\n\n");
    const variants = parseExamples(await chat({ agentId: "analysis", message: prompt, trusted: true }));
    amplified.push(...variants);
  }
  return amplified;
}

// 파일명으로 그대로 쓰이므로 경로 조작이 불가능한 id만 허용한다.
const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function saveDataset(id: string, examples: ConversationExample[], 종류: 데이터종류 = "지식"): { id: string; examples: number } {
  if (!DATASET_ID_RE.test(id)) {
    throw new Error("데이터셋 ID는 영문 소문자/숫자/하이픈만 가능합니다 (예: incident-qa-v1)");
  }
  const valid = examples.filter((e) => e && typeof e.question === "string" && typeof e.answer === "string" && e.question && e.answer);
  if (valid.length === 0) throw new Error("유효한 question/answer 쌍이 없습니다");

  // ★ 위생은 **여기서** 건다 — 학습 데이터가 디스크에 닿는 곳이 이 함수뿐이기 때문이다.
  //
  // ⚠ 2026-08-01 검토에서 잡힌 것: 위생 주석은 "어느 길로 들어오든 거치는 마지막 관문"이라
  //   적어 놨는데 실제 호출은 learnloop 한 곳뿐이었다. `POST /api/dataset/save`,
  //   orchestrator-dataset, 그리고 학습 시작에 datasetId를 직접 넘기는 길이 **그냥 지나갔다.**
  //   담당자가 화면에서 「Q&A 변환」→「저장」 하고 그 ID로 파인튜닝을 걸면 시점 데이터·
  //   시험 문항·프롬프트 누출이 한 번도 안 걸러지고 학습된다.
  //   호출부마다 붙이면 또 빠뜨린다 — **저장 자체를 관문으로 만든다.**
  //   cleanForTraining은 멱등이라 learnloop가 이미 건 것을 다시 걸어도 결과가 같다.
  const 위생 = cleanForTraining(valid, 종류);
  if (위생.kept.length === 0) {
    const 사유 = Object.entries(위생.dropped).map(([k, v]) => `${k} ${v}건`).join(" · ") || "없음";
    throw new Error(`위생 검사를 통과한 문답이 없습니다 (${valid.length}건 전부 걸러짐).\n걸러진 것: ${사유}`);
  }
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATASETS_DIR, `${id}.json`), JSON.stringify(위생.kept, null, 2), "utf-8");
  return { id, examples: 위생.kept.length };
}

// 팀장이 "오늘 확인할 항목"에 직접 추가한 일과를 학습 데이터셋으로 축적한다(파인튜닝 반영 경로).
// routine-feedback.json에 Q&A로 쌓여 학습 루프에서 그대로 학습할 수 있고,
// 추천 가이드(tasks.routineSuggestions) 프롬프트에도 인용돼 다음 추천에 반영된다.
export function appendRoutineExample(text: string): void {
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  const file = path.join(DATASETS_DIR, "routine-feedback.json");
  let rows: ConversationExample[] = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf-8")) as ConversationExample[];
    if (!Array.isArray(rows)) rows = [];
  } catch {
    rows = [];
  }
  rows.push({ question: "보안 운영에서 오늘/이번 주 확인할 점검 항목을 추천해줘", answer: text });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf-8");
}

export function listDatasets(): { id: string; examples: number }[] {
  if (!fs.existsSync(DATASETS_DIR)) return [];
  return fs
    .readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const id = f.slice(0, -5);
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, f), "utf-8")) as unknown[];
        return { id, examples: Array.isArray(rows) ? rows.length : 0 };
      } catch {
        return { id, examples: 0 };
      }
    });
}

export function registerDatasetRoutes(app: Express): void {
  app.post(
    "/api/dataset/convert",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await convertToConversationFormat(req.body.rawText));
    })
  );
  app.post(
    "/api/dataset/amplify",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await amplifyDataset(req.body.examples, req.body.factor));
    })
  );
  app.post("/api/dataset/save", authMiddleware, (req, res) => {
    try {
      res.json(saveDataset(String(req.body.id ?? ""), req.body.examples ?? []));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get("/api/dataset/list", authMiddleware, (_req, res) => res.json(listDatasets()));

  // 문서 업로드 → 텍스트 추출 (PDF/HWPX/TXT 등). { filename, content(base64) } → { text }
  app.post(
    "/api/dataset/extract",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { filename, content } = req.body as { filename?: string; content?: string };
      if (!filename || !content) {
        res.status(400).json({ error: "filename과 content(base64)가 필요합니다" });
        return;
      }
      try {
        res.json({ text: await extractDocumentText(filename, content) });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
}

/** 파이썬 추출기(scripts/extract_doc.py)에 맡긴다 — **스캔 문서·이미지·구형 포맷**이 여기로 온다.
 *  ⚠ 별도 함수로 뺀 이유(2026-08-22): PDF 갈래가 「JS가 실패하거나 글자가 거의 없으면 파이썬에
 *    한 번 더」를 하려면 이 경로를 **두 자리에서** 불러야 한다. 같은 코드를 복사하면 어긋난다.
 */
async function 파이썬추출(filename: string, base64: string, ext: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `gijo-doc-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.promises.writeFile(tmp, Buffer.from(base64, "base64"));
  recordProcessOutput("extract-doc", "log", `$ extract_doc.py ${filename} (${ext})`);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      execFile(
        // ⚠ 맨 "python"을 부르면 안 된다 — 운영(WSL)에는 그 이름이 없어(python3만 존재)
        //   추출이 **한 번도 성공한 적 없었다**(2026-08-08 실측). 그 여파로 경로 인입이
        //   PDF를 글자로 그냥 읽어 저장소 조각의 73%가 압축 바이트였다.
        // "docs" — 문서 추출용 파이썬. 동봉본(pypdf 보유)을 시스템 파이썬보다 앞세우는 갈래다.
        //   장비 접속·모델 검사는 "tools"를 써서 예전 순서를 그대로 지킨다(동봉본엔 그 부품이 없다).
        serverPython("docs"),
        // ⚠ 스크립트 자리는 serverScript()가 고른다 — 패키징 설치본은 cwd(userData)와 스크립트가
        //   있는 자리(resources/server-dist)가 달라, 상대경로로 부르면 파일을 못 찾는다(2026-08-22).
        [serverScript("scripts/extract_doc.py"), tmp],
        { env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 256 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (stderr) recordProcessOutput("extract-doc", "warn", stderr);
          if (err) {
            // ★ 「추출 도구가 아예 없다」와 「이 문서를 못 읽겠다」를 가려서 말한다(2026-08-22).
            //   설치본에 스크립트나 파이썬이 없으면 ENOENT·"can't open file" 같은 **영어 메시지가
            //   그대로 화면에 나가** 담당자가 무엇을 해야 할지 알 수 없었다. 문구는 memory.ts의
            //   같은 상황 안내와 **일부러 같은 표현**을 쓴다 — 잣대가 둘이 되면 서로 어긋난다.
            const 원문 = (stderr.trim() || err.message || "").trim();
            const 도구없음 =
              (err as NodeJS.ErrnoException).code === "ENOENT" ||
              /can't open file|No such file or directory|is not recognized|command not found/i.test(원문) ||
              // ⚠ 동봉 파이썬에는 pypdf만 들어 있다(2026-08-22) — 다른 부품이 필요한 문서를 만나면
              //   ENOENT가 아니라 ModuleNotFoundError로 죽는다. 그 영어 원문이 그대로 화면에 나가면
              //   담당자는 무엇을 해야 할지 알 수 없다(설계관 적발). 같은 「도구 없음」으로 묶어 안내한다.
              /ModuleNotFoundError|No module named/i.test(원문);
            if (도구없음) {
              return reject(new Error(
                `문서를 읽지 못했습니다(${filename}) — 이 설치본에 문서 추출 도구가 없습니다. ` +
                // ⚠ 이제 여기로 오는 것은 **스캔 문서·이미지뿐**이다(2026-08-22) —
                //   PDF·한글·오피스는 파이썬 없이 읽는다. 문구가 옛 범위를 말하면 거짓이 된다.
                `스캔된 문서·이미지는 글자를 알아보는 도구(OCR)가 있어야 읽을 수 있습니다. 서버에 OCR이 준비돼 있는지 확인하세요.`
              ));
            }
            return reject(new Error(원문 || `문서를 읽지 못했습니다(${filename})`));
          }
          resolve(stdout);
        }
      );
    });
    recordProcessOutput("extract-doc", "log", `${filename} — ${text.length.toLocaleString()}자 추출`);
    return text;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}
