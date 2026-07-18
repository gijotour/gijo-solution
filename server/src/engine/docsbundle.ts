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

import { GLOBAL_SCOPE, ingestText, listDocuments } from "./memory";

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
}

export interface DocsBundleResult {
  ingested: string[];
  skipped: string[]; // 이미 지식베이스에 있어 건너뛴 문서
  missing: string[]; // 매니페스트에 있지만 파일을 찾지 못한 문서
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
export async function bootstrapDocsBundle(): Promise<DocsBundleResult> {
  const result: DocsBundleResult = { ingested: [], skipped: [], missing: [], failed: [] };
  const manifest = await readManifest();
  if (!manifest?.files?.length) return result;

  const scope = manifest.scope ?? GLOBAL_SCOPE;
  const existing = new Set((await listDocuments()).map((d) => d.documentId));

  for (const entry of manifest.files) {
    if (existing.has(entry.file)) {
      result.skipped.push(entry.file);
      continue;
    }
    const docPath = await resolveDocPath(entry.file);
    if (!docPath) {
      result.missing.push(entry.file);
      continue;
    }
    try {
      const raw = await fs.readFile(docPath, "utf-8");
      // classify=false로 넣는다. ① 분류는 LLM을 호출하는데 부팅 직후엔 아직 안 떠 있을 수 있고,
      // ② '매뉴얼'로 분류되면 보안제품 등록부에 자동 연결되는데(memory.linkManualToProduct)
      // GIJO 자체 매뉴얼이 남의 벤더 제품 매뉴얼로 붙는 건 등록부 오염이다.
      await ingestText(entry.file, raw, scope, docPath, false);
      result.ingested.push(entry.file);
    } catch (err) {
      result.failed.push({ file: entry.file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

// 부팅 시 호출용 래퍼 — 임베딩 서버(별도 llama-server)가 아직 기동 중이면 인입이 통째로
// 실패하므로 몇 차례 물러서며 재시도한다. 끝내 실패해도 서버 자체는 정상 동작해야 하니
// 예외를 밖으로 던지지 않고 로그만 남긴다(코퍼스는 화면에서 수동 인입으로도 채울 수 있다).
export async function bootstrapDocsBundleWithRetry(attempts = 5, delayMs = 20_000): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    const r = await bootstrapDocsBundle();
    const done = r.ingested.length + r.skipped.length;
    if (r.failed.length === 0) {
      if (r.ingested.length > 0) console.log(`[docsbundle] 제품 문서 ${r.ingested.length}건 인입 완료 (기존 ${r.skipped.length}건 유지)`);
      else if (done > 0) console.log(`[docsbundle] 제품 문서 ${r.skipped.length}건 이미 인입됨 — 건너뜀`);
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
