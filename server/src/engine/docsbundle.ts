// engine/docsbundle.ts — 제품 문서 기본 코퍼스 부트스트랩.
//
// 최초 기동 시 docs-manifest.json에 열거된 제품 문서를 장기기억(RAG)에 자동 인입한다.
//
// 왜 필요한가(실측 2026-07-19): 지식베이스가 완전히 비어 있었다(data/memory.lancedb 자체가
// 없음). 그 상태에서 "AI-BOM이 뭐냐"고 물으면 모델이 'AI 기술을 적용한 BOM'이라고 정의를
// 뒤집어 답했다. 같은 모델·같은 질문에 AIBOM 검토 가이드 1,491토큰만 근거로 붙이자 5영역
// 구성요소와 SBOM ⊂ AI-BOM 관계를 정확히 답했다 — 모델 용량이 아니라 근거 자료의 부재였다.
// 사용자가 제품을 깔자마자 "이 화면 뭐예요"를 물어도 답할 수 있으려면 이 코퍼스가 기본 탑재여야 한다.
//
// 무엇을 넣는지는 코드가 아니라 docs-manifest.json이 정한다 — '고객사에 나가는 문서'의
// 경계를 사람이 리뷰할 수 있는 한 곳에 모으기 위해서다. 판단 근거는 그 파일 주석 참조.

import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";

import { db } from "../db";
import { GLOBAL_SCOPE, ingestText, listDocuments, deleteDocument, markDocumentsBuiltin, 추출필요, CHUNKER_VERSION } from "./memory";
import { 대장과같음 } from "./docledger"; // 「이미 같은 판이 들어가 있나」 판정 한 곳(잎 · import 0)

// 프로젝트 관례(localengine의 MODELS_DIR, memory의 DB_PATH)대로 cwd 기준 상대경로 + 환경변수
// 오버라이드. 다만 저 둘과 달리 모듈 로드 시점에 상수로 굳히지 않고 호출할 때마다 읽는다 —
// 이 함수는 재시도 루프로 여러 번 불리고 테스트가 경로를 바꿔가며 검증하는데, 상수로 두면
// import 이후의 환경변수 변경이 조용히 무시된다(실제로 테스트가 이 결함을 잡았다).
function manifestPath(): string {
  return process.env.GIJO_DOCS_MANIFEST ?? "docs-manifest.json";
}

// 문서 원본 위치는 실행 형태에 따라 다르다. 패키징본은 build-server-dist.mjs가 큐레이션된
// 사본을 server-dist/docs/에 만들어 두고(리포지토리가 없으므로), 개발 환경에서는 리포지토리
// 루트(server/의 상위)에 원본 .md가 그대로 있다. 사본을 커밋해 두면 원본과 조용히 어긋나므로
// 후보 경로를 순서대로 찾는 방식을 택했다 — 진실 원천은 언제나 리포지토리 루트의 원본이다.
function docDirCandidates(): string[] {
  return process.env.GIJO_DOCS_DIR ? [process.env.GIJO_DOCS_DIR] : ["docs", ".."];
}

interface ManifestEntry {
  file: string;
  why?: string;
}

interface Manifest {
  scope?: string;
  files: ManifestEntry[];
  /**
   * **다시 넣지 않을 뿐 아니라, 이미 들어간 것도 지운다.**
   *
   * 실측(2026-08-03): `GIJO_AS_AIBOM_검토_가이드.md`를 2026-08-02에 이 목록으로 옮겼는데
   *   지식 검색에서 **여전히 1위로 나왔다**(조각 10개가 그대로 남아 있었다).
   *   목록에서 빼는 것을 "다시 안 넣는다"로만 구현했고, **아무도 지우지 않았다.**
   *   이 문서에는 소스 경로와 개발 사정이 들어 있어 언제든 담당자 답에 실릴 수 있었다.
   */
  _제외?: { file: string; removed?: string; why?: string }[];
}

export interface DocsBundleResult {
  ingested: string[];
  skipped: string[]; // 이미 지식베이스에 있고 내용도 그대로라 건너뛴 문서
  updated: string[]; // 내용이 바뀌어 옛 조각을 지우고 다시 넣은 문서
  missing: string[]; // 매니페스트에 있지만 파일을 찾지 못한 문서
  removed: string[]; // _제외에 있어 저장소에서 지운 문서 (다시 안 넣는 것만으로는 안 지워진다)
  failed: { file: string; reason: string }[];
}

async function readManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(), "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

// 후보 디렉터리를 순서대로 뒤져 실제로 존재하는 첫 경로를 돌려준다.
async function resolveDocPath(file: string): Promise<string | null> {
  for (const dir of docDirCandidates()) {
    const candidate = path.resolve(dir, file);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

// 이미 인입된 문서는 다시 넣지 않는다(재기동마다 중복 청크가 쌓이는 것을 막는다).
// 사용자가 화면에서 지운 문서도 '없음'으로 보이므로 재기동 시 되살아나는데, 기본 코퍼스는
// 제품이 스스로 설명하기 위한 최소 자료라 그 편이 맞다(원치 않으면 매니페스트에서 뺀다).
//
// ★ 단, **내용이 바뀌었으면 다시 넣는다**(2026-07-31 실측 사고).
//   예전에는 문서 id만 보고 건너뛰어서, 용어사전을 고쳐 올려도 AI는 영원히 옛 내용을 알았다.
//   "서랍이 뭐야?"에 운영 AI가 "물리적인 도구"라고 지어냈다 — 문서는 새것인데 지식은 헌것이었다.
//   문서를 고치는 일은 앞으로도 계속 있으므로, 사람이 기억해서 지웠다 넣는 절차로 두지 않는다.
//
// ★ 해시에 **청커 판**을 섞는다 (2026-09-08, ⓐ3).
//   같은 사고의 청커판이다 — 원문이 그대로여도 **자르는 규칙이 바뀌면 조각이 달라진다.**
//   그런데 해시는 원문만 보므로 「그대로다」로 건너뛰고, 고친 청커는 영영 안 돈다
//   (표 머리글을 되찾는 이번 수리가 배포돼도 지식은 옛 조각 그대로였을 것이다).
//   판을 섞어 두면 판이 오른 다음 기동에서 매니페스트 문서가 자동으로 다시 들어간다.
//   ⚠ 판이 안 바뀐 기동에서는 해시도 그대로라 종전처럼 skipped다(매번 갈아엎지 않는다).
//   ⚠ 사용자가 올린 문서는 매니페스트 밖이라 여기 안 걸린다 — 다음 인입부터 새 청커를 쓴다.
//   ⚠ 판을 넣는 자리는 **여기 하나**다. HASH_KEY(키 이름)에 넣으면 옛 키가 쓰레기로 남고,
//     매니페스트에 넣으면 코드와 데이터 두 곳을 맞춰야 해서 어긋날 자리가 하나 는다.
const hashOf = (raw: string) => createHash("sha256").update(`${raw}\n#chunker:${CHUNKER_VERSION}`, "utf8").digest("hex").slice(0, 16);
const HASH_KEY = (docId: string) => `docsbundle:hash:${docId}`;

// 추출필요(추출이 필요한 형식) — 2026-08-31 일원화(설계관): memory.ts의 정본을 import해 쓴다.
// 사본 시절 「한쪽만 고치면 번들 인입이 이미지를 바이트로 읽는다」 계약 주석이 있던 자리다.

/**
 * 번들 문서 한 편을 **읽을 수 있는 글자로** 가져온다.
 * PDF·한글·오피스 문서는 추출기를 거친다 — 안 그러면 압축 바이트가 지식이 된다
 * (2026-08-08 실사고: 저장소 조각의 73%가 그렇게 들어왔다).
 */
async function readBundleDoc(docPath: string): Promise<string> {
  const ext = path.extname(docPath).toLowerCase();
  if (!추출필요.has(ext)) return fs.readFile(docPath, "utf-8");
  const buf = await fs.readFile(docPath);
  const { extractDocumentText } = await import("./dataset.js");
  const text = await extractDocumentText(path.basename(docPath), buf.toString("base64"));
  if (!text.trim()) throw new Error(`텍스트를 추출하지 못했습니다(${path.basename(docPath)})`);
  return text;
}
const getHashStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setHashStmt = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

export async function bootstrapDocsBundle(): Promise<DocsBundleResult> {
  const result: DocsBundleResult = { ingested: [], skipped: [], updated: [], missing: [], removed: [], failed: [] };
  const manifest = await readManifest();
  if (!manifest?.files?.length) return result;

  const scope = manifest.scope ?? GLOBAL_SCOPE;
  const 목록 = await listDocuments();
  // existing = **이름이 목록에 있나**. 아래 _제외 삭제 루프가 이 집합을 쓴다 —
  //   여기를 좁히면 「지워야 할 문서인데 판이 어긋나 있어서」 안 지워진다(2026-08-03 실사고의 되풀이).
  const existing = new Set(목록.map((d) => d.documentId));
  // ── ★ 건너뛰기 판정은 **따로** 둔다 (2026-09-07) ───────────────────────────────
  //
  // ■ 왜 나눴나 — 안 나누면 이 라운드가 **손해**가 된다
  //   오늘까지 조각을 잃은 내장 문서는 listDocuments에 **아예 안 떠서** existing에 없었고,
  //   그래서 기동 때마다 조용히 **다시 인입돼 스스로 나았다**(아무도 그 자가치유를 모르고 있었다).
  //   그런데 이번에 listDocuments가 유령까지 담게 되면서 이름이 existing에 들어온다 —
  //   해시가 같으면 `skipped`로 빠져 **영영 안 낫는다.** 유령을 보이게 하려다 유령을 고정시키는
  //   되치기라, 「이름이 있다」와 「같은 판이 들어가 있다」를 여기서 갈라 둔다.
  // ⚠ ok가 **아닌 것은 전부** 다시 넣는다. missing이면 되살리고, short/extra(반쪽 유령)면 판을 맞춘다.
  //   `조각없음`으로 좁히면 조각 수가 어긋난 문서는 이름이 있으니 계속 건너뛴다.
  // ⚠ 다시 넣어도 ingestText가 멱등이라(옛 조각 선삭제) 두 판이 겹치지 않고, 인입이 끝나면
  //   대장 chunks가 실제 값으로 갱신돼 **다음 기동에는 ok**가 된다(무한 재인입이 아니다).
  const 판이같음 = new Set(목록.filter((d) => 대장과같음(d.docState)).map((d) => d.documentId));

  // ── ① 제외 목록을 **실제로 지운다** ──────────────────────────────────────────
  // 실측(2026-08-03): `GIJO_AS_AIBOM_검토_가이드.md`를 2026-08-02에 _제외로 옮겼는데
  //   지식 검색에서 **여전히 1위로 나왔다**(조각 10개가 그대로 남아 있었다).
  //   "목록에서 뺀다"를 **다시 안 넣는다**로만 구현했고 아무도 지우지 않았다 —
  //   그 문서에는 소스 경로와 개발 사정이 들어 있어 언제든 담당자 답에 실릴 수 있었다.
  // ⚠ **_제외에 적힌 것만** 지운다. 담당자가 올린 문서(목록에 없는 76건)는 손대지 않는다 —
  //   "목록에 없으면 지운다"로 만들면 담당자 자료가 기동 때마다 사라진다.
  for (const 뺀것 of manifest._제외 ?? []) {
    const docId = path.basename(String(뺀것.file ?? ""));
    if (!docId || !existing.has(docId)) continue;
    try {
      await deleteDocument(docId);
      existing.delete(docId);
      판이같음.delete(docId); // 두 집합을 함께 비운다 — 한쪽만 지우면 지운 문서가 아래 루프에서 되살아난다
      result.removed.push(docId);
      console.log(`[docs-bundle] 제외 목록에 있어 지식베이스에서 지움 — ${docId}${뺀것.why ? ` (${String(뺀것.why).slice(0, 60)}…)` : ""}`);
    } catch (e) {
      result.failed.push({ file: docId, reason: `제외 삭제 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  for (const entry of manifest.files) {
    // 문서 id는 **파일명**이다 — 매니페스트 항목이 하위 폴더 경로(knowledge/…)여도 id에
    // 접두를 남기면 안 된다(2026-07-29 실측 함정: 운영에 파일명 id로 이미 인입된 지식 문서가
    // 경로 id로 한 번 더 들어가 중복 문서 = 검색 경합이 될 뻔했다).
    const docId = path.basename(entry.file);
    const docPath = await resolveDocPath(entry.file);
    if (!docPath) {
      // 파일이 없으면 '없음'이다. 이미 인입돼 있다면 지우지 않는다 — 문서를 잠깐 못 찾은 것과
      // 문서를 뺀 것은 다르다(경로 문제로 지식이 통째로 날아가면 복구가 어렵다).
      result.missing.push(entry.file);
      continue;
    }
    let raw: string;
    try {
      // ⚠ 여기도 PDF를 **글자로 그냥 읽고 있었다**(2026-08-08). 부팅 때마다 압축 바이트가
      //   지식으로 들어가, 담당자가 아무것도 안 해도 저장소가 오염됐다. 경로 인입
      //   (memory.ingestDocument)과 같은 관문을 쓰게 한다 — 추출이 필요한 형식은 추출기로.
      raw = await readBundleDoc(docPath);
    } catch (err) {
      result.failed.push({ file: entry.file, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const hash = hashOf(raw);
    // ⚠ existing이 아니라 **판이같음**을 본다(위 ★). 이름만 같고 조각이 없거나 판이 다르면
    //   해시가 같아도 건너뛰지 않고 아래 재인입으로 내려간다.
    if (판이같음.has(docId)) {
      const known = (getHashStmt.get(HASH_KEY(docId)) as { value?: string } | undefined)?.value;
      if (known === hash) {
        result.skipped.push(entry.file);
        continue;
      }
      // 바뀌었다 → 옛 조각을 지우고 다시 넣는다. 지우지 않으면 옛 내용과 새 내용이 함께 검색돼
      // 서로 다른 답이 번갈아 나온다(중복 청크는 눈에 안 보여서 더 나쁘다).
      try {
        await deleteDocument(docId);
      } catch (err) {
        result.failed.push({ file: entry.file, reason: `옛 조각 정리 실패: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      result.updated.push(entry.file);
    }
    try {
      // classify=false로 넣는다. ① 분류는 LLM을 호출하는데 부팅 직후엔 아직 안 떠 있을 수 있고,
      // ② '매뉴얼'로 분류되면 보안제품 등록부에 자동 연결되는데(memory.linkManualToProduct)
      // GIJO 자체 매뉴얼이 남의 벤더 제품 매뉴얼로 붙는 건 등록부 오염이다.
      await ingestText(docId, raw, scope, docPath, false, undefined, undefined, "builtin"); // origin=내장(①ⓑ)
      // 해시는 **인입에 성공한 뒤에만** 남긴다 — 실패했는데 기록해 두면 다음 기동에서
      // "그대로다"라고 판단해 영영 안 들어간다(조용한 지식 공백).
      setHashStmt.run(HASH_KEY(docId), hash);
      if (!result.updated.includes(entry.file)) result.ingested.push(entry.file);
    } catch (err) {
      result.failed.push({ file: entry.file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  // ①ⓑ 소급(2026-08-10) — 매니페스트 문서(이미 인입돼 위에서 skip된 것 포함)의 origin을 'builtin'으로
  // 굳힌다. 189행은 skip되면 안 돌아 「앞으로 것부터」가 번들엔 영영 안 오므로, 이 소급이 유일한 경로다.
  const 표시 = markDocumentsBuiltin(manifest.files.map((e) => path.basename(String(e.file))));
  if (표시 > 0) console.log(`[docsbundle] 내장(builtin) 표시 소급 ${표시}건 — 검색에서 우리 지식 우선(①ⓑ)`);
  return result;
}

// 부팅 시 호출용 래퍼 — 임베딩 서버(별도 llama-server)가 아직 기동 중이면 인입이 통째로
// 실패하므로 몇 차례 물러서며 재시도한다. 끝내 실패해도 서버 자체는 정상 동작해야 하니
// 예외를 밖으로 던지지 않고 로그만 남긴다(코퍼스는 화면에서 수동 인입으로도 채울 수 있다).
export async function bootstrapDocsBundleWithRetry(attempts = 5, delayMs = 20_000): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    const r = await bootstrapDocsBundle();
    const done = r.ingested.length + r.skipped.length + r.updated.length;
    if (r.failed.length === 0) {
      // 갱신은 따로 말한다 — "몇 건 인입"에 묻히면 문서를 고친 사람이 반영됐는지 알 수 없다.
      if (r.updated.length > 0) console.log(`[docsbundle] 바뀐 문서 ${r.updated.length}건 다시 인입: ${r.updated.join(", ")}`);
      if (r.ingested.length > 0) console.log(`[docsbundle] 제품 문서 ${r.ingested.length}건 인입 완료 (기존 ${r.skipped.length}건 유지)`);
      else if (r.updated.length === 0 && done > 0) console.log(`[docsbundle] 제품 문서 ${r.skipped.length}건 이미 인입됨 — 건너뜀`);
      if (r.missing.length) console.warn(`[docsbundle] 파일을 찾지 못함: ${r.missing.join(", ")}`);
      return;
    }
    const reason = r.failed[0].reason;
    if (i === attempts) {
      console.error(`[docsbundle] 제품 문서 인입 실패(${r.failed.length}건) — 임베딩 서버 상태를 확인하세요: ${reason}`);
      return;
    }
    console.warn(`[docsbundle] 인입 재시도 ${i}/${attempts - 1} (${Math.round(delayMs / 1000)}초 후) — ${reason}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
