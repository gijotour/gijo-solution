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
import { cleanForTraining, 데이터종류들, type 데이터종류 } from "./datasethygiene";
// 낱말 사이를 채운 제어문자를 공백으로 되돌린다 — **판정기(isBinaryLikeChunk) 옆에 두었다.**
// 걷는 규칙과 판정하는 규칙이 갈리면 「어제는 들어오던 문서가 오늘은 안 들어오는」 회귀가 난다.
import { stripLayoutControls } from "./ragsanitize";

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

/** XML 태그를 걷고 엔티티를 되돌린다 — 2026-08-22에 extract_doc.py의 `_strip_tags`를 **1:1로**
 *  옮겨 온 것이다. 그 파이썬 쪽은 2026-09-08에 **지웠다**(한 번도 안 불리는 죽은 갈래였다) —
 *  이제 오피스 태그 걷기는 **여기가 유일한 구현**이다.
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

/* ── 표(OOXML <w:tbl>·<a:tbl>)를 파이프 표로 되살린다 (2026-09-08, 갈래 T) ─────────────
 *
 * ■ 왜: 지식 조각 4,703개 중 파이프 표를 가진 것이 **0개**였다. 운영 추출본 21편에도 표
 *   구분자가 아예 없다(탭 0줄·2칸 이상 정렬 0줄). 그런데 원본 오피스 파일에는 표 구조가
 *   **무손실**로 들어 있다 — 제품소개_발표자료.pptx 표10·셀183, AI_보안제품_기획_v11.docx 표5·셀92,
 *   GSTS_AICC_PoC_제안요약.pptx 표9·셀391. 아래 갈래가 <w:t>/<a:t>만 긁어서, 표 183칸이 공백으로
 *   이어붙은 한 덩어리가 되고 「어느 칸이 무슨 열인가」가 통째로 사라지고 있었다.
 *   (표 안 글자 비중 실측: 발표자료 22.3% · 기획 docx 26.4% · GSTS pptx 47.5%)
 *
 * ■ 무엇을 안 하나 — **표 밖 글은 종전과 글자 하나까지 같다.** 표가 없는 문서는 아예 옛 갈래로
 *   지나가고(아래 `!구간.some(…표)`), 짝 시험(test/tableextract.test.ts)이 골든 문자열로 잰다.
 * ■ 못 하는 것 — **도형으로 그린 「표처럼 보이는 것」은 복원 불가**다(운영에 보관된 유일한 pptx
 *   원본 ASM 수지비가 그 꼴이다: OOXML 표 0개). 「표가 살아났다」는 **OOXML 표를 쓴 문서에 한해서**다.
 */

/** 같은 이름이 겹쳐 있어도 **깊이를 세어** 최상위 구간만 가른다 — 표·행·칸 자르기의 바탕.
 *
 *  ⚠ 비탐욕 정규식(`<w:tbl>[\s\S]*?</w:tbl>`)을 쓰면 **표 안의 표**에서 어긋난다: 안쪽 닫는
 *    태그에서 끊겨 바깥 표의 뒷부분이 본문으로 샌다. 실물 3편은 중첩 깊이가 1이라 **실물로는
 *    이 결함이 안 드러난다** — 그래서 픽스처(table.docx)에 중첩 표를 일부러 넣었다.
 *  ⚠ 이름 뒤에 반드시 공백·`/`·`>`가 와야 센다. 안 그러면 `<w:tblPr>`·`<w:tblGrid>`·`<a:tcPr>`를
 *    표·칸으로 세어 구조가 통째로 어긋난다.
 *  ⚠ 닫는 태그가 모자라면(망가진 XML) 그 구간을 **표로 안 보고 본문으로** 돌린다 — 종전 동작이다.
 */
function 구간나누기(xml: string, tag: string): { 표: boolean; xml: string }[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?(/?)>|</${tag}\\s*>`, "g");
  const out: { 표: boolean; xml: string }[] = [];
  let 깊이 = 0;
  let 끝난자리 = 0;
  let 시작 = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith("</")) {
      if (깊이 > 0) {
        깊이 -= 1;
        if (깊이 === 0) {
          out.push({ 표: true, xml: xml.slice(시작, re.lastIndex) });
          끝난자리 = re.lastIndex;
        }
      }
    } else if (m[1] !== "/") {
      if (깊이 === 0) {
        out.push({ 표: false, xml: xml.slice(끝난자리, m.index) });
        시작 = m.index;
        // ★ 여는 태그 자리에서 **끝난자리도 함께 옮긴다**(자체 검토 2026-09-08에 잡은 결함).
        //   안 옮기면 표가 끝내 안 닫히는 망가진 XML에서 마지막 push가 `slice(0)`이 되어
        //   **표 앞 본문이 통째로 두 번** 나온다(같은 글이 조각으로 두 벌 들어간다).
        //   지금은 안 닫히면 「표 시작부터 끝까지」가 본문으로 한 번만 나온다 = 종전 동작.
        끝난자리 = m.index;
      }
      깊이 += 1;
    }
  }
  out.push({ 표: false, xml: xml.slice(끝난자리) });
  return out;
}

/** 최상위 자식(행·칸)만 순서대로 준다 — 중첩된 같은 이름은 바깥 것 **안에** 남는다. */
const 최상위요소들 = (xml: string, tag: string) => 구간나누기(xml, tag).filter((s) => s.표).map((s) => s.xml);

/** 칸 하나의 글 — **엔티티는 여기서 안 푼다.** 조립이 끝난 뒤 태그걷기()가 한 번에 푼다.
 *  미리 풀면 `&lt;script&gt;`가 `<script>`가 되고, 마지막 태그걷기가 그것을 **태그로 보고 통째로
 *  지운다**(칸 내용이 사라진다). 지금 파이프라인은 「조립 → 딱 한 번 푼다」가 계약이다.
 *  ⚠ `|`는 열 구분자라 이스케이프한다 — 안 하면 열 수가 어긋나 구분선과 안 맞고 표 인지가 깨진다
 *    (실측: AI_보안제품_기획_v11.docx 추출본에 파이프가 이미 2개 있다).
 *  ⚠ 공백 압축은 `[ \t\r\n]+`만 — `\s`로 넓히면 줄바꿈아님공백(NBSP)까지 바꿔 종전 글과 갈린다. */
const 칸글 = (raw: string) => raw.replace(/[ \t\r\n]+/g, " ").replace(/\|/g, "\\|").trim();

/** 한 행의 열 수 상한 — 워드가 실제로 허용하는 열은 63개다. 512는 그 8배로 넉넉하고,
 *  **자리 채우기가 폭주하는 것을 막는다**: 병합 칸(gridSpan 최대 64)을 잔뜩 넣은 파일 하나가
 *  「빈 칸 수만 곱해」 원본의 수백 배짜리 글을 만들 수 있다(자체 검토 2026-09-08). */
const 표_최대열 = 512;

/** 행들을 마크다운 파이프 표로 낸다 — **memory.ts의 표 술어(표줄·구분선·표머리글들)가 읽는 규격**.
 *  ⚠ 그 잣대를 여기 베끼지 않는다. 정의는 저쪽이 갖고, 추출기는 규격에 맞춰 **내기만** 한다.
 *  ⚠ 자리 맞춤(패딩)은 안 넣는다 — 꼬리 정규화가 `[ \t]+`를 한 칸으로 접어 어차피 사라진다.
 *  ⚠ 칸마다 공백을 넣는다 — `|a|b|`처럼 붙여 내면 라틴·숫자 표가 공백비율 0.05 관문
 *    (ragsanitize.isBinaryLikeChunk)에 걸려 **바이너리로 몰릴** 수 있다.
 *
 *  ⚠⚠ **아직 안 닫힌 접점이 하나 있다 — 반복줄 제거가 표 본문 행을 지운다**(2026-09-08 검토관
 *    적발①②, 여기서는 못 고쳤다). memory.ts:cleanExtractedText는 「3회 이상 반복되는 60자 이하
 *    줄」을 페이지 머리글/바닥글로 보고 지우는데, 예외가 **구분선과 표 머리글까지**다. 그래서
 *    같은 점검표가 한 문서에 3번 이상 들어 있으면 **본문 행만 지워지고 머리글+구분선만 남는다**
 *    (재현: 점검표 3벌짜리 docx → 조각에 「방화벽 정책」이 하나도 안 남는다). 표를 한 줄 덩어리로
 *    내던 종전에는 60자를 넘겨 원리상 안 걸리던 갈래라, **이 파일의 변경이 새로 연 노출**이다.
 *    실물에서도 났다: GSTS pptx에서 표 옆 짧은 설명 줄 1종(3벌)이 새 추출본에서만 사라진다.
 *    ★ 고칠 자리는 **memory.ts 한 곳**이다(표 술어의 단일 출처가 저기다) — 여기서 출력 꼴을
 *      비틀어 피하면 잣대가 두 곳으로 갈린다. 고칠 때 CHUNKER_VERSION을 함께 올려야 하고,
 *      그러면 내장 문서 35편이 재인입된다(배포와 묶인 일이라 이 갈래에서 손대지 않았다).
 *
 *  ⓘ 표가 개행을 얻어 블록이 갈리므로 **같은 문서라도 조각 수가 달라진다 — 늘 수도, 줄 수도
 *    있다**(2026-09-08 실물 3편 실측). 제품 기본값(800/100)에서는 기획 docx 11→14 · 제품소개
 *    pptx 32→32 · GSTS pptx 17→21로 준 문서가 없었지만, 자를 크기를 1200/120으로 바꾸면
 *    제품소개 pptx가 26→**24**로 준다 — 빈 줄로 한 블록에 뭉치면서 경계가 옮겨가기 때문이다.
 *    즉 「늘어난다」는 자를 크기에 딸린 말이라 계약으로 삼지 않는다. **내용 손실은 아니다**:
 *    같은 3편의 낱말 다중집합이 앞뒤로 똑같다(표 기호를 걷어낸 지문 7403·18076·10904 동일). */
function 파이프표(행들: string[][]): string {
  const 열수 = Math.min(행들.reduce((a, r) => Math.max(a, r.length), 0), 표_최대열);
  if (열수 === 0 || 행들.length === 0) return "";
  // 글자가 하나도 없는 표(빈 격자·자리잡기용)는 지식이 아니다 — 구분선만 남기지 않는다.
  if (!행들.some((r) => r.some((c) => c !== ""))) return "";
  const 줄 = (칸들: string[]) => `| ${Array.from({ length: 열수 }, (_, i) => 칸들[i] ?? "").join(" | ")} |`;
  const 구분 = `| ${Array.from({ length: 열수 }, () => "---").join(" | ")} |`;
  return [줄(행들[0]), 구분, ...행들.slice(1).map(줄)].join("\n");
}

/** 워드 표 — `<w:tc>`는 **가로로 병합된 칸을 하나로 접는다**(`<w:gridSpan w:val="n"/>`). 그래서
 *  뒤에 빈 칸 n-1개를 채워야 다른 행과 열 수가 맞는다. 세로 병합(`<w:vMerge/>`)은 이어지는 행에도
 *  빈 `<w:tc>`가 그대로 있어 따로 채울 것이 없다.
 *  ⚠ 병합은 **픽스처로만** 검증됐다 — 실물 3편에는 gridSpan·vMerge·hMerge가 0개다(2026-09-08 실측). */
function 워드표(xml: string): string {
  return 파이프표(최상위요소들(xml, "w:tr").map((tr) => {
    const 칸들: string[] = [];
    for (const tc of 최상위요소들(tr, "w:tc")) {
      if (칸들.length >= 표_최대열) break;
      칸들.push(칸글([...tc.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(" ")));
      for (let i = 1; i < 워드가로병합(tc) && 칸들.length < 표_최대열; i += 1) 칸들.push("");
    }
    return 칸들;
  }));
}
/** 이 칸이 몇 열을 차지하나. ⚠ **안쪽 표의 gridSpan을 이 칸 것으로 읽지 않게** 안쪽 표 앞만 본다. */
function 워드가로병합(tc: string): number {
  const m = /<w:gridSpan\s[^>]*w:val="(\d+)"/.exec(tc);
  if (!m) return 1;
  const 안쪽표 = tc.search(/<w:tbl(?:\s[^>]*?)?>/);
  if (안쪽표 >= 0 && m.index > 안쪽표) return 1;
  return Math.min(Math.max(Number(m[1]) || 1, 1), 64); // 64열이면 이미 표가 아니다(폭주 방지)
}

/** pptx 표 — DrawingML은 **격자의 모든 칸에 `<a:tc>`를 둔다.** 병합된 뒤칸은 `hMerge`/`vMerge`
 *  표시가 붙은 (보통 빈) 칸이라, 워드와 달리 gridSpan으로 칸을 늘리면 **열이 두 배가 된다.**
 *  그래서 여기서는 칸을 늘리지도 줄이지도 않는다 — `<a:tc>` 하나가 열 하나다.
 *
 *  ⚠ **병합 표시가 붙었다고 글을 버리지 않는다**(2026-09-08 검토관 적발③ 수리). 첫 판은
 *    `hMerge`/`vMerge`가 붙은 칸의 `<a:t>`를 통째로 버렸는데, 파워포인트가 아닌 도구(내보내기·
 *    변환기)가 만든 pptx에는 그 뒤칸에 **글이 남아 있는** 경우가 있다. 그 파일에서는 종전
 *    추출기가 살리던 글이 조용히 사라져 이 라운드의 「낱말 손실 0」 계약이 이 갈래에서만
 *    깨졌다. 파워포인트가 만든 정상 파일은 뒤칸이 비어 있어 결과가 같으므로, 버릴 이유가 없다.
 *    (짝 픽스처 table.pptx 슬라이드 3이 「글이 남은 병합 뒤칸」을 담고 있다.) */
function 피피티표(xml: string): string {
  return 파이프표(최상위요소들(xml, "a:tr").map((tr) => 최상위요소들(tr, "a:tc").map((tc) =>
    칸글([...tc.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join(" ")))));
}

/** 오피스 4종(zip+xml)에서 글자를 뽑는다 — 2026-08-22에 extract_doc.py의 형식별 함수를 **1:1로**
 *  옮긴 것이다(그 파이썬 갈래는 2026-09-08에 지웠다 — 여기가 유일한 오피스 추출기다).
 *
 *  ⚠ 「더 잘 뽑기」를 하지 않았다. 범위·정규식·엔티티 목록을 원본과 똑같이 맞춘다 —
 *    다르게 뽑으면 예전에 넣은 문서와 새로 넣는 문서의 조각이 갈려 검색 결과가 흔들린다.
 *    개선(예: docx 문단 경계 살리기)은 그 자체로 별도 판단거리다(아래 docx 주석 참조).
 *  ★ 예외가 하나 생겼다(2026-09-08): **표는 표로 낸다**(위 표 갈래 주석). 표를 버리는 것은
 *    「원본과 똑같이」가 아니라 원본에 있던 구조를 잃는 것이라, 이 원칙이 지키려던 것과 반대였다.
 *    ⚠ 그래서 **표가 있는 문서만** 결과가 바뀐다 — 표가 없으면 위 원칙 그대로다.
 */
/** 파이썬 main()이 **모든 형식에** 마지막으로 거는 정규화 — extract_doc.py 꼬리(`# 낱말 사이를
 *  채운 제어문자` 주석 아래 세 줄)와 같은 동작이어야 한다.
 *  ⚠ 이걸 빠뜨리면 「글자 하나까지 일치」가 성립하지 않는다(검토관 2026-08-22 확정).
 *    재현: Word가 앞뒤 공백 있는 런에 붙이는 `xml:space="preserve"` → 파이썬 「글자 다음」,
 *    이걸 안 걸면 「글자  다음」(공백 둘). 조각 본문·경계가 갈려 옛 문서와 어긋난다.
 *  ⚠ **줄번호로 가리키지 않는다** — 2026-08-22에 적어 둔 「extract_doc.py:236-238」은 파일이
 *    자라면서 이미 틀린 자리를 가리키고 있었다(실제 345~347). 사람이 찾을 수 있는 **표식**으로 가리킨다.
 *
 *  ★ 순서가 계약이다(2026-09-07): **제어문자 → 공백이 먼저**다. `[ \t]+` 압축보다 뒤에 두면
 *    "1 /␇␇사이버"가 "1 /  사이버"(공백 둘)로 남는다 — 실측으로 확인한 순서다. */
function 파이썬꼬리정규화(t: string): string {
  return stripLayoutControls(t).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
    const 본문글 = (x: string) => [...x.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(" ");
    for (const n of 이름들) {
      const low = n.toLowerCase();
      if (low !== "word/document.xml" && !/^word\/(header|footer)\d*\.xml$/.test(low)) continue;
      const xml = (await 읽기(n)).replace(/<\/w:p>/g, "\n");
      const 구간 = 구간나누기(xml, "w:tbl");
      // 표가 하나도 없으면 **종전 코드 그대로 한 줄**로 지나간다 — 「표 없는 문서는 글자 하나까지
      //   같다」를 주석이 아니라 **갈래**로 못박는 자리다(짝 시험이 골든 문자열로 잰다).
      if (!구간.some((s2) => s2.표)) { parts.push(본문글(xml)); continue; }
      const 블록: string[] = [];
      for (const s of 구간) {
        const 글 = s.표 ? 워드표(s.xml) : 본문글(s.xml).trim();
        if (글) 블록.push(글);
      }
      // 표 앞뒤에 **빈 줄**을 둔다 — 붙여 놓으면 뒤 표의 머리글이 앞 표의 본문 행으로 읽히고
      //   (마크다운 표는 빈 줄에서 끝난다), 청커도 두 표를 한 블록으로 뭉뚱그린다.
      parts.push(블록.join("\n\n"));
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
    const 본문글 = (x: string) => [...x.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
    for (const n of 대상) {
      const xml = await 읽기(n);
      const 구간 = 구간나누기(xml, "a:tbl");
      if (!구간.some((s2) => s2.표)) {   // 표 없음 — 종전 그대로 지나간다(위 docx와 같은 이유)
        const texts = 본문글(xml);
        if (texts.length) parts.push(texts.join(" "));
        continue;
      }
      const 블록: string[] = [];
      for (const s of 구간) {
        const 글 = s.표 ? 피피티표(s.xml) : 본문글(s.xml).join(" ").trim();
        if (글) 블록.push(글);
      }
      if (블록.length) parts.push(블록.join("\n\n"));
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
  /** 선택 — 학습 때 system 자리에 실을 근거 블록(RAFT형). 종류 「근거」에서만 살아남는다(datasethygiene Example 주석). */
  system?: string;
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

// ── 이 서버가 문서를 어디까지 읽을 수 있나 — **화면이 약속하기 전에 물어보는 자리** ──────────
//
// ■ 왜 (2026-08-22 게시 전 검토관 [높음])
//   라이트 두 화면이 「사진·스캔 문서도 읽습니다 — OCR이 함께 들어 있습니다」라고 **조건 없이**
//   단언했는데, OCR 동봉은 **Windows 설치본 전용**이다(mac 빌드는 스크립트가 그냥 건너뛴다).
//   mac 라이트 사용자는 「들어 있다」는 화면을 보고 사진을 넣었다가 거절당한다 — 가짜 안내다.
//
// ⚠ **클라이언트 OS로 가르면 안 된다**(정찰 2026-08-22). 이 제품에는 클라와 서버가 다른 기계인
//   **분산 모드**가 있어서(GIJO_SERVER_URL), mac 클라가 win 서버에 붙는 조합이 실제로 가능하다.
//   그때 클라 OS로 판단하면 능력을 **정반대로** 표시한다. 읽는 일은 서버가 하니 서버가 답한다.
//
// ⚠ 파이썬을 띄워 보는 일이라 **캐시한다** — 화면이 열릴 때마다 프로세스를 띄우면 안 된다.
let 추출능력캐시: { ocr: boolean; 잰때: number; 사유: string } | null = null;
// ⚠ **도는 중인 약속을 함께 쓴다**(2026-08-22 검토관 [높음]). 캐시 대입은 프로세스가 **끝난 뒤**에만
//   일어나므로, 그 사이에 온 요청은 전부 캐시 미스로 **각자 파이썬을 띄운다.** 이 일은 가볍지 않다 —
//   rapidocr import + OCR 엔진 생성(모델 2개 적재)까지 간다. 화면 두 개만 동시에 열려도 곱절이 된다.
//   이 저장소에 이미 있는 처방이다(「가드는 Promise 공유」).
let 추출능력도는중: Promise<{ ocr: boolean; 사유: string }> | null = null;
const 능력캐시수명ms = 5 * 60 * 1000;

export async function 문서추출능력(): Promise<{ ocr: boolean; 사유: string }> {
  if (추출능력캐시 && Date.now() - 추출능력캐시.잰때 < 능력캐시수명ms) {
    return { ocr: 추출능력캐시.ocr, 사유: 추출능력캐시.사유 };
  }
  if (추출능력도는중) return 추출능력도는중;
  추출능력도는중 = new Promise<{ ocr: boolean; 사유: string }>((resolve) => {
    // ⚠ **import만 보고 「된다」고 하지 않는다** — 이 제품이 실제로 데인 자리다(모델 자리를 Path로
    //   넘겨 엔진 **생성**에서 거부당했는데 import는 멀쩡했다). 엔진을 만들어 보는 데까지 간다.
    // ⚠ 경로를 **파이썬 코드 문자열에 끼워 넣지 않는다**(검토관 [높음]). 예전엔 따옴표를
    //   `.replace(/'/g,"")`로 **지워서** 넣었는데, 지우는 것은 이스케이프가 아니라
    //   경로가 바뀌는 것이고 설치 경로에 따옴표가 있으면 엉뚱한 자리를 보게 된다.
    //   이제 **환경변수로 건넨다** — 문자열 조립 자체가 없으니 주입될 자리도 없다.
    const 코드 = [
      "import sys, os",
      "try:",
      "    sys.path.insert(0, os.environ['GIJO_SCRIPTS_DIR'])",
      "    import extract_doc",
      "    extract_doc._ocr_engine()",
      "    print('OCR_OK')",
      "except Exception as e:",
      "    print('OCR_NO ' + type(e).__name__ + ': ' + str(e)[:200])",
    ].join("\n");
    execFile(
      serverPython("docs"),
      ["-c", 코드],
      { timeout: 120_000, env: { ...process.env, GIJO_SCRIPTS_DIR: serverScript("scripts"), PYTHONUTF8: "1" } },
      (err, stdout, stderr) => {
        const 답 = String(stdout || "").trim();
        if (답.startsWith("OCR_OK")) return resolve({ ocr: true, 사유: "" });
        const 원문 = 답.replace(/^OCR_NO\s*/, "") || String(stderr || err?.message || "").trim().slice(0, 200);
        // 원인 원문은 **서버 기록에만** 남긴다 — 관리자가 볼 자리다. 화면에는 갈래만 나간다.
        if (원문) recordProcessOutput("extract-capability", "warn", `OCR 사용 불가: ${원문}`);
        resolve({ ocr: false, 사유: 원문 || "확인하지 못했습니다" });
      }
    );
  });
  try {
    const 결과 = await 추출능력도는중;
    추출능력캐시 = { ...결과, 잰때: Date.now() };
    return 결과;
  } finally {
    추출능력도는중 = null;
  }
}

/** OCR을 못 쓰는 이유를 **경로를 빼고** 갈래로만 말한다 — 화면에 나가는 값이다.
 *  원인 원문은 서버 기록에만 남긴다(관리자가 본다). */
function 능력사유요약(원문: string): string {
  const t = String(원문 || "");
  if (/ModuleNotFoundError|No module named/i.test(t)) return "OCR 구성요소가 설치돼 있지 않습니다.";
  if (/DLL load failed|specified module could not be found/i.test(t)) return "OCR 구성요소는 있으나 실행 라이브러리가 없어 뜨지 못했습니다.";
  if (/timed out|ETIMEDOUT/i.test(t)) return "OCR 구성요소를 확인하는 데 시간이 너무 걸렸습니다.";
  if (/ENOENT|not recognized|command not found/i.test(t)) return "문서 추출용 파이썬을 찾지 못했습니다.";
  if (!t) return "확인하지 못했습니다.";
  // 그 밖의 원인 — **원문을 흘리지 않는다.** 자세한 것은 서버 기록에 있다.
  return "OCR 구성요소를 쓸 수 없습니다(자세한 원인은 서버 기록에 남습니다).";
}

export function registerDatasetRoutes(app: Express): void {
  // 화면이 「무엇을 읽을 수 있다」고 말하기 전에 부르는 자리. 로그인만 있으면 된다(관리자 전용 아님) —
  // 업로드 화면의 안내 문구가 쓰므로 담당자도 볼 수 있어야 한다.
  app.get(
    "/api/extract/capability",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      const c = await 문서추출능력();
      res.json({
        // 파이썬 없이 되는 것들 — 이건 서버 코드에 붙박이라 늘 참이다.
        office: true,
        pdf: true,
        // 스캔·사진은 OCR이 있어야 한다.
        ocr: c.ocr,
        // ⚠ **원문을 그대로 내보내지 않는다**(2026-08-22 검토관). 파이썬 예외 원문에는
        //   설치 절대 경로(사용자 이름이 든 자리)가 섞여 나온다. 화면이 쓰는 것은
        //   「되나 안 되나」뿐이고 원인은 관리자가 서버 기록에서 본다.
        ocr사유: c.ocr ? "" : 능력사유요약(c.사유),
      });
    })
  );
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
  // 몸통 { id, examples, kind? } — kind는 위생 종류(datasethygiene 데이터종류). 안 주면 예전대로 「지식」이다.
  // ⚠ 창구 키는 **영문**으로 둔다(이 저장소의 모든 API가 그렇다) — 값만 한글이다.
  //   왜 받게 했나: RAFT형 데이터셋(종류 「근거」)은 행마다 system 칸을 싣는데, 종류를 못 주면
  //   위생이 「지식」으로 돌아 그 칸을 **말없이 버린다**(cleanForTraining이 {question,answer}로 재구성).
  //   그러면 근거 없이 학습돼, 「배운 자리 = 쓰는 자리」가 깨진 채로 아무 오류도 안 난다.
  app.post("/api/dataset/save", authMiddleware, (req, res) => {
    try {
      const kind = String(req.body?.kind ?? "지식");
      if (!(데이터종류들 as readonly string[]).includes(kind)) {
        res.status(400).json({ error: `kind는 ${데이터종류들.join("·")} 중 하나여야 합니다 (받은 값: ${kind})` });
        return;
      }
      res.json(saveDataset(String(req.body.id ?? ""), req.body.examples ?? [], kind as 데이터종류));
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
        // ⚠ **시간 상한을 둔다**(2026-08-22 검토관 [중]). 예전엔 없었다.
        //   OCR이 고객 기계에서 실제로 돌기 시작한 판이라, 스캔 문서 30쪽을 300dpi로 렌더해
        //   한 장씩 읽으면 요청을 몇 분간 붙잡을 수 있다. 상한이 없으면 실패가 **「멈춤」으로 보이고**
        //   담당자는 앱이 죽은 줄 알고 같은 문서를 여러 번 올린다(단독 모드는 그 CPU가 곧 고객 PC다).
        //   상한에 걸리면 execFile이 프로세스를 죽이고 err로 돌아오며, 아래 분기가 한글로 안내한다.
        { env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60 * 1000 },
        (err, stdout, stderr) => {
          if (stderr) recordProcessOutput("extract-doc", "warn", stderr);
          if (err) {
            // ★ 「추출 도구가 아예 없다」와 「이 문서를 못 읽겠다」를 가려서 말한다(2026-08-22).
            //   설치본에 스크립트나 파이썬이 없으면 ENOENT·"can't open file" 같은 **영어 메시지가
            //   그대로 화면에 나가** 담당자가 무엇을 해야 할지 알 수 없었다. 문구는 memory.ts의
            //   같은 상황 안내와 **일부러 같은 표현**을 쓴다 — 잣대가 둘이 되면 서로 어긋난다.
            const 원문 = (stderr.trim() || err.message || "").trim();
            // 시간 상한에 걸린 경우 — 「실패」가 아니라 「너무 오래 걸림」이라고 말해야
            // 담당자가 할 일을 안다(쪼개서 올리기). 영어 SIGTERM이 그대로 나가면 아무것도 못 한다.
            if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed || (err as { signal?: string }).signal === "SIGTERM") {
              return reject(new Error(
                `문서를 읽다가 시간이 너무 걸려 멈췄습니다(${filename}) — 스캔 문서는 쪽수가 많으면 오래 걸립니다. ` +
                `쪽을 나눠 올리시거나, 글자가 들어 있는 PDF로 저장해 다시 올려 주세요.`
              ));
            }
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
