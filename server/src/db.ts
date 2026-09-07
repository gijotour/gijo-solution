// db.ts — 서버 상태 영속화 (SQLite, better-sqlite3)
// 9.5절 "DB 영속화" 항목의 전제 조건 자체가 빠져 있었다: assets.ts/tasks.ts가 순수
// 인메모리(Map/배열)라 서버를 재시작하면 등록된 자산·스캔 이력·작업 큐가 전부 사라졌다.
// 이제 로컬 파일 기반 SQLite(data/gijo-as.sqlite, .gitignore에 이미 있던 경로)에 저장해
// 재시작 후에도 살아남는다. 프로세스당 동기 연결 1개(better-sqlite3, 커넥션 풀 없음)라
// 9.5절이 언급한 "JPA 커넥션 풀 WAL 동시성 이슈"는 이 스택에서는 애초에 발생하지 않는다.
//
// 테스트는 vitest.config.ts에서 GIJO_DB_PATH=:memory:로 실행해 디스크에 아무것도 남기지 않는다.
// agents.ts는 의도적으로 여기 포함하지 않았다 — 에이전트 상태(idle/working/watching)는
// "지금 누가 뭘 하고 있는지"를 나타내는 휘발성 라이브 신호라, 재시작 후에도 "working"이
// 남아있으면 오히려 죽은 작업을 살아있는 것처럼 보이게 하는 오해를 만든다.

// better-sqlite3 → better-sqlite3-multiple-ciphers (2026-07-30, 저장 암호화).
// 같은 12.11.1이라 API가 동일한 드롭인 교체다. 암호화를 안 켠 DB에서는 기존과 완전히 같게 동작한다.
import Database from "better-sqlite3-multiple-ciphers";
import * as fs from "fs";
import * as path from "path";
import { hasKeyFile, unsealWithMachine, toSqlcipherKey } from "./dbkey";

const DB_PATH = process.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite");

if (DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

// ── 저장 암호화(at-rest) ─────────────────────────────────────────────────────
// 열쇠 파일이 있으면 이 DB는 암호화된 것이다 — 기계 봉인을 풀어 연다(무인 재시작 가능).
// 켜는 방법: 서버를 멈추고 `node scripts/encrypt-db.mjs` (백업→열쇠 생성→전환→검증을 한 번에).
// ⚠ key pragma는 **다른 어떤 SQL보다 먼저** 실행해야 한다 — journal_mode보다도 먼저.
let dbEncrypted = false;
if (DB_PATH !== ":memory:" && hasKeyFile(DB_PATH)) {
  const dek = unsealWithMachine(DB_PATH);
  if (!dek) {
    // 여기서 멈추는 것이 맞다. 열쇠를 못 풀었는데 계속 가면 "file is not a database"로
    // 온갖 곳에서 알 수 없게 터지거나, 최악엔 새 평문 DB를 만들어 "데이터가 다 사라진" 것처럼 보인다.
    throw new Error(
      "DB 암호화 열쇠의 기계 봉인을 풀지 못했습니다. 서버 기계가 바뀌었거나 열쇠 파일이 손상됐습니다.\n" +
        "  복구: 서버를 멈추고  node scripts/recover-db-key.mjs  를 실행해 종이에 보관한 복구 열쇠를 입력하세요.\n" +
        "  (복구 열쇠까지 잃었다면 이 DB는 열 수 없습니다 — 백업에서 복원하세요.)"
    );
  }
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key="x'${toSqlcipherKey(dek)}'"`);
  dek.fill(0); // 쓰고 바로 지운다 — 메모리 덤프에 남는 시간을 줄인다
  dbEncrypted = true;
}
/** 지금 DB가 암호화 상태인가 — 자가 진단·설정 화면이 정직하게 표시하는 데 쓴다. */
export function isDbEncrypted(): boolean {
  return dbEncrypted;
}

db.pragma("journal_mode = WAL"); // :memory: DB는 이 pragma를 조용히 무시하고 memory 저널을 유지한다.

// 테스트 전용 리셋(reset*ForTests) 가드 — 스크래치 스크립트가 GIJO_DB_PATH 없이 실행되면
// 실 운영 DB를 향하므로, 리셋이 운영 데이터를 통째로 지우는 사고를 막는다
// (2026-07-17 실측: 운영 DB의 보안제품 등록부가 비워진 흔적 — in-memory DB에서만 허용).
export function assertTestDb(fnName: string): void {
  if (DB_PATH !== ":memory:") {
    throw new Error(`${fnName}는 테스트(GIJO_DB_PATH=:memory:)에서만 호출할 수 있습니다`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    assetType TEXT NOT NULL,
    owner TEXT NOT NULL,
    components TEXT NOT NULL,
    findings TEXT NOT NULL,
    registeredAt INTEGER NOT NULL,
    lastScannedAt INTEGER,
    sbomGeneratedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS scan_runs (
    id TEXT PRIMARY KEY,
    assetId TEXT NOT NULL REFERENCES assets(id),
    scannedAt INTEGER NOT NULL,
    findings TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scan_runs_assetId ON scan_runs(assetId);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    priority TEXT NOT NULL,
    text TEXT NOT NULL,
    agentId TEXT,
    done INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );

  -- encryptedApiKey: cryptopack.ts로 암호화된 JSON(iv/ciphertext/authTag, hex) — 평문 저장 안 함.
  CREATE TABLE IF NOT EXISTS cti_feeds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    encryptedApiKey TEXT,
    connected INTEGER NOT NULL
  );

  -- 단일 행(id='default')만 쓴다 — 이메일 발송용 SMTP 서버 1개 설정. encryptedPassword는
  -- cti_feeds.encryptedApiKey와 동일한 방식으로 암호화 저장(평문 저장 안 함).
  CREATE TABLE IF NOT EXISTS smtp_config (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    secure INTEGER NOT NULL,
    user TEXT,
    encryptedPassword TEXT,
    fromAddress TEXT NOT NULL
  );

  -- 선택적 클라우드 LLM 하이브리드(engine/cloudllm.ts). provider별 API 키를 암호화 저장한다.
  -- 온프렘 원칙상 기본 비활성이며(app_state의 'cloud:enabled'), encryptedApiKey는 cti_feeds와
  -- 동일하게 cryptopack.ts로 암호화한 JSON을 넣는다(평문 저장 안 함).
  CREATE TABLE IF NOT EXISTS cloud_llm_keys (
    provider TEXT PRIMARY KEY,     -- gemini | claude | openai
    encryptedApiKey TEXT,
    model TEXT
  );

  -- 클라우드 유출 방지 게이트(engine/cloudegress.ts) 판정 감사 로그. append-only.
  -- decision: allowed(클라우드로 나감) | blocked(내부정보 감지→로컬 폴백). reasons는 차단 사유 JSON 배열.
  -- questionPreview는 질문 앞부분만(전체 저장 안 함) — 감사엔 충분하고 저장 노출은 최소화.
  CREATE TABLE IF NOT EXISTS cloud_egress_log (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    userId TEXT,
    provider TEXT,
    decision TEXT NOT NULL,
    reasons TEXT,
    questionPreview TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cloud_egress_log_at ON cloud_egress_log(at);

  -- 클라우드 API 토큰 사용량 누적(요금 화면용). 제공자·모델별 호출 수·입출력 토큰을 upsert로 쌓는다.
  -- usage.ts(외부 서비스 호출 수 인메모리)와 달리 재시작에도 남게 영속화 — 비용 추적이 목적이라.
  CREATE TABLE IF NOT EXISTS cloud_usage (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    inTokens INTEGER NOT NULL DEFAULT 0,
    outTokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, model)
  );

  -- CTI 탐지 내역 캐시. 벤더 API를 요청마다 때리지 않도록 30분 게이트로 동기화하고(cti.ts),
  -- 외부 API 장애 시엔 이 캐시가 그대로 응답이 된다(경량 서킷 브레이커). collectedAt 인덱스는
  -- 90일 TTL 정리용 — 다음단계 가이드 3.1의 채택 항목.
  CREATE TABLE IF NOT EXISTS cti_findings (
    id TEXT PRIMARY KEY,
    feedId TEXT NOT NULL,
    detectedAt TEXT NOT NULL,
    type TEXT NOT NULL,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    severity TEXT NOT NULL,
    collectedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cti_findings_collectedAt ON cti_findings (collectedAt);

  -- 피드별 마지막 동기화 시각/에러 (cti_findings와 세트).
  CREATE TABLE IF NOT EXISTS cti_sync (
    feedId TEXT PRIMARY KEY,
    lastFetchAt INTEGER NOT NULL,
    lastError TEXT
  );

  -- 소소한 서버 상태 저장용 key-value (예: localengine.ts의 마지막 사용 모델).
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 보안담당자 계정. passwordHash는 bcrypt 해시(평문 저장 안 함). 최초 기동 시 이 테이블이
  -- 비어 있으면 auth/users.ts가 기본 관리자 계정 1개를 시드한다(9.5절 "설치 마법사" 전까지의
  -- 최소 조치 — 다음단계 가이드 1.3절).
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    displayName TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );

  -- 보안제품 유지보수 일정 · 점검서 · 승인(engine/maintenance.ts). scheduleDate는 "YYYY-MM-DD"
  -- 일 단위 예정일. intervalDays가 있으면 승인 시 같은 title로 다음 회차를 자동 생성한다.
  CREATE TABLE IF NOT EXISTS maintenance_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    productName TEXT NOT NULL,
    scheduleDate TEXT NOT NULL,
    intervalDays INTEGER,
    status TEXT NOT NULL,
    reportNote TEXT,
    reportDocName TEXT,
    reportedBy TEXT,
    reportedAt INTEGER,
    reviewedBy TEXT,
    reviewedAt INTEGER,
    reviewNote TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  -- 점검 상태 변경 이력(감사 추적). append-only — 한 항목의 등록→보고→승인/반려 전이를 시간순으로
  -- 남긴다(assets.ts의 scan_runs와 같은 "부모=최신상태 + 자식=이벤트 로그" 패턴). event는
  -- created | reported | approved | rejected. actor는 수행자 표시명, note는 보고 메모/반려 사유.
  CREATE TABLE IF NOT EXISTS maintenance_events (
    id TEXT PRIMARY KEY,
    itemId TEXT NOT NULL REFERENCES maintenance_items(id),
    event TEXT NOT NULL,
    actor TEXT,
    note TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_maintenance_events_itemId ON maintenance_events(itemId);

  -- 헤르메스 폐쇄형 학습 루프(engine/learnloop.ts) ① 수집: 실제 대화(질문/답변)를 영속 저장.
  -- 대화창 출구(dispatcher)와 직접 채팅 API(llm.ts chat())에서 기록한다. rating: NULL=미평가, 1=긍정(학습 채택),
  -- -1=부정(제외). usedInDataset: 데이터셋으로 이미 내보낸 로그는 재사용하지 않는다.
  CREATE TABLE IF NOT EXISTS chat_logs (
    id TEXT PRIMARY KEY,
    agentId TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    rating INTEGER,
    usedInDataset INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_logs_createdAt ON chat_logs(createdAt);

  -- AI 팀 감독(2026-08-20 ②) — llm:event의 일 단위 영속 집계. 실시간 로그(llmactivity)는
  -- 인메모리 최근 200건이라 재시작에 사라져 7일/30일 감독 숫자를 못 냈다(시안 제작 중 발견).
  -- 평균 응답 = latencyMsSum / calls. 숫자는 전부 실측 이벤트의 합 — 지어내는 칸이 없다.
  CREATE TABLE IF NOT EXISTS llm_activity_daily (
    day TEXT NOT NULL,
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    latencyMsSum INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, agent, kind)
  );

  -- ✂ 인용 제거 **사유별** 일 집계(2026-09-06 · 승인 시안 mockups/cite-reasons).
  -- ⚠ 위 llm_activity_daily(kind=cite)와 **다른 잣대**다: 저기는 「손댄 답의 개수」(답 하나에
  --   이벤트 하나), 여기는 「뗀 인용 건수」(답 하나에서 세 군데를 뗄 수 있다). 서로 더하거나
  --   나눌 수 없다 — 섞어 적으면 거짓이 된다(화면이 그 사실을 스스로 말한다).
  -- reason은 citeguard의 뗀사유종류(블록없음·범위밖·겹침없음·자기인용·출처미확인·통째교체) +
  --   경로 가드의 「내부 경로」·「내부 메타」 + 못 뗀 자리의 「못 뗌」. 세는 곳은
  --   citeguard.사유별집계() **하나**다(두 벌이면 반드시 갈라진다).
  -- ⚠ 인용 **원문은 안 담는다** — 사내 문서 본문이 감독 화면·WS로 새면 안 된다(개수만).
  CREATE TABLE IF NOT EXISTS cite_reason_daily (
    day TEXT NOT NULL,
    agent TEXT NOT NULL,
    reason TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, agent, reason)
  );

  -- 장기기억(RAG/LanceDB) 문서 메타데이터. LanceDB 행에는 documentId·chunk·vector만 있어
  -- 업로드 시각·원본 경로를 담을 수 없다(새 필드 추가 시 스키마 드리프트로 테이블이 재생성됨).
  -- 문서 단위 메타데이터는 여기 SQLite에 둔다. **조각 수·scope를 지금 실제로 갖고 있는 곳은
  -- LanceDB**이고, 여기 chunks/scope는 **반입하던 그때 적어 둔 대장 값**이다(2026-09-07 개정).
  --   ⚠ 이 줄은 오래 「참고·백필용」이라고만 적혀 있었다. 그 말은 「틀려도 된다」로 읽혀서,
  --   대장에는 21조각이라 적혀 있는데 저장소에는 한 조각도 없는 문서(유령)를 **아무도 안 봤다.**
  --   이제 둘의 차이 자체가 신호다 — 판정은 engine/docledger.ts 한 곳에서 하고,
  --   listDocuments가 ledgerChunks·docState 두 칸으로 그 차이를 실어 보낸다.
  --   ★ 값을 고치는 곳은 여전히 하나다(memory.ts upsertDocMetaStmt) — 새 생산자를 만들지 말 것.
  CREATE TABLE IF NOT EXISTS memory_documents (
    documentId TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    chunks INTEGER NOT NULL DEFAULT 0,
    embeddingModel TEXT,
    sourcePath TEXT,
    ingestedAt TEXT NOT NULL
  );

  -- 학습 루프 실행 이력(engine/learnloop.ts) — 한 번의 수집→정제→학습→배포 사이클이 한 행.
  -- stage: stopping-engines | training | exporting | deploying | restarting-engines | done | error
  CREATE TABLE IF NOT EXISTS learnloop_runs (
    id TEXT PRIMARY KEY,
    datasetId TEXT NOT NULL,
    baseModel TEXT NOT NULL,
    outputModelId TEXT NOT NULL,
    stage TEXT NOT NULL,
    error TEXT,
    startedAt INTEGER NOT NULL,
    finishedAt INTEGER
  );

  -- 승인 워크플로우(engine/approvals.ts) — 스캔 finding별 검토 상태. finding 자체는 안정 id가 없어
  -- (assetId + finding 내용 해시)를 키로 쓴다. status: approved(확정) | rejected(오탐). 저장된 행이
  -- 없는 finding은 pending(미검토)으로 본다. rejected=오탐은 SBOM 취약점 반영에서 제외한다.
  CREATE TABLE IF NOT EXISTS finding_approvals (
    assetId TEXT NOT NULL,
    findingKey TEXT NOT NULL,
    status TEXT NOT NULL,
    reviewedBy TEXT,
    reviewedAt INTEGER,
    note TEXT,
    assignee TEXT,        -- 조치 담당자(자유 텍스트)
    dueDate TEXT,         -- 조치 기한(SLA) 'YYYY-MM-DD'
    PRIMARY KEY (assetId, findingKey)
  );

  -- 통합 보안 KPI 일일 스냅샷(engine/kpi.ts) — 하루 한 행(date PK). 여러 도메인 지표를 metrics JSON에
  -- 담아 매일 쌓고, 이 이력으로 추세(시계열)를 그린다. 임원 보고·방향성 결정 지원.
  CREATE TABLE IF NOT EXISTS security_kpi_snapshots (
    date TEXT PRIMARY KEY,
    metrics TEXT NOT NULL,
    at INTEGER NOT NULL
  );

  -- 운영 중인 보안제품 등록부(engine/securityproducts.ts) — 유지보수 대상 제품을 종류(category:
  -- 방화벽/EDR/DLP/WAF/VPN/IPS/SIEM/백신/NAC/기타)별로 구분해 관리한다. maintenance_items의
  -- 자유텍스트 productName과 달리 제품을 1급 엔티티로 두어 대시보드에서 종류별로 한눈에 본다.
  CREATE TABLE IF NOT EXISTS security_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    vendor TEXT,
    model TEXT,
    assetId TEXT,
    note TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_security_products_category ON security_products(category);

  -- 보안제품별 문서(engine/securityproducts.ts) — 제품 매뉴얼·로그 매뉴얼 등. 파일을 첨부하면
  -- 텍스트를 추출해 지식베이스(RAG)에도 수집하므로(docName) "올린 문서 검색"에서 바로 찾아진다.
  -- kind: manual(제품 매뉴얼) | logManual(로그 매뉴얼) | etc(기타 문서).
  CREATE TABLE IF NOT EXISTS product_docs (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL REFERENCES security_products(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    docName TEXT,
    note TEXT,
    uploadedBy TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_product_docs_productId ON product_docs(productId);
`);

db.exec(`
  -- KISA 매뉴얼 위협 코드별 조직의 대응 현황(engine/compliance.ts). 위협 카탈로그 자체는
  -- 코드에 정적으로 있고, 여기엔 사용자가 지정한 상태/메모만 저장한다.
  CREATE TABLE IF NOT EXISTS compliance_status (
    threatCode TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    note TEXT,
    updatedAt INTEGER NOT NULL
  );
`);

db.exec(`
  -- 온톨로지(지식 그래프) — 하이브리드 지식모델의 의미 계층(engine/ontology.ts).
  -- 벡터 RAG(memory.ts/LanceDB)가 "의미가 비슷한 문장"을 찾는다면, 여기는 엔티티 사이의 명시적
  -- 관계·규칙을 트리플(주어-술어-목적어)로 저장해 "왜 이 판단인지"의 근거를 추적할 수 있게 한다.
  -- 예: (SQL인젝션, 완화기법, 입력검증) / (관리자API, 접근권한, 보안운영팀).
  -- scope: memory.ts와 동일 규칙 — 'global'은 모든 에이전트가, 그 외는 해당 agentId 전용 지식.
  CREATE TABLE IF NOT EXISTS ontology_triples (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    source TEXT,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ontology_subject ON ontology_triples(subject);
  CREATE INDEX IF NOT EXISTS idx_ontology_object ON ontology_triples(object);
  CREATE INDEX IF NOT EXISTS idx_ontology_scope ON ontology_triples(scope);
`);

// 마이그레이션: assets.aibom (AI-BOM 5영역 메타 JSON). CREATE TABLE에 직접 넣지 않고 ALTER로
// 추가해 기존 DB에도 적용되게 한다. 이미 있으면 SQLite가 duplicate column 에러를 던지므로 무시한다.
try {
  db.exec("ALTER TABLE assets ADD COLUMN aibom TEXT NOT NULL DEFAULT '{}'");
} catch {
  /* 컬럼이 이미 있으면 정상 — 무시 */
}

// 마이그레이션: assets.displayName — 담당자가 보기 쉽게 붙이는 표시 이름(별칭). 원래 name·id는
// 그대로 보관해 재점검·이력 추적에 영향이 없다(2026-07-25 사용자 요청).
try {
  db.exec("ALTER TABLE assets ADD COLUMN displayName TEXT");
} catch {
  /* 이미 있으면 무시 */
}

db.exec(`
  -- "오늘 확인할 항목"에 팀장이 직접 추가한 일과(engine/tasks.ts) — 추천 가이드의 학습 신호.
  -- 추천 프롬프트에 인용되고, datasets/routine-feedback.json(파인튜닝 데이터셋)에도 함께 축적된다.
  CREATE TABLE IF NOT EXISTS routine_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    addedAt INTEGER NOT NULL
  );
`);

// 마이그레이션: memory_documents.docClass — 문서 수집 시 Scan·Analyze Agent가 판별한 분류
// (매뉴얼/보고서/정책/기타). 탐색기·문서관리 화면에서 배지로 표시. nullable(분류 전 문서).
try {
  db.exec("ALTER TABLE memory_documents ADD COLUMN docClass TEXT");
} catch {
  /* 컬럼이 이미 있으면 정상 — 무시 */
}

// 마이그레이션: maintenance_items.assetId (점검을 등록된 AI 자산에 연결). 선택 항목이라 nullable.
try {
  db.exec("ALTER TABLE maintenance_items ADD COLUMN assetId TEXT");
} catch {
  /* 컬럼이 이미 있으면 정상 — 무시 */
}

// 마이그레이션: maintenance_items.productId (점검을 보안제품 등록부(security_products)에 연결).
// 미지정 시 생성 시점에 productName 유사 매칭으로 자동 해석한다(maintenance.ts). nullable.
try {
  db.exec("ALTER TABLE maintenance_items ADD COLUMN productId TEXT");
} catch {
  /* 컬럼이 이미 있으면 정상 — 무시 */
}

// 마이그레이션: finding_approvals.assignee/dueDate (조치 담당자·기한). 승인(오탐 판정)을 넘어
// "누가·언제까지 조치"를 관리하기 위한 조치 관리 필드. 기존 DB에도 적용되게 ALTER로 추가.
try { db.exec("ALTER TABLE finding_approvals ADD COLUMN assignee TEXT"); } catch { /* 이미 있으면 무시 */ }
try { db.exec("ALTER TABLE finding_approvals ADD COLUMN dueDate TEXT"); } catch { /* 이미 있으면 무시 */ }

// 마이그레이션(2026-07-22): Finding 검토 워크플로 확장 — 담당자 이원화(보안담당자/실수행담당자),
// 검증(재스캔) 단계, 반려 사유 보존. 전부 nullable이라 기존 행에 무해하게 추가된다.
for (const col of [
  "securityOwner TEXT",       // 보안담당자(감독)
  "rejectReason TEXT",        // 반려 사유(false_positive | compensating_control)
  "verifyRequestedAt INTEGER",// 조치완료 보고 시각(→검증)
  "verifyRequestedBy TEXT",
  "resolvedAt INTEGER",       // 재스캔에서 사라져 해결 확인된 시각(→완료)
  "snapshot TEXT",            // finding 내용 스냅샷(재스캔 후 목록 표시용)
  "acceptUntil TEXT",         // 위험수용 기한 'YYYY-MM-DD' — 지나면 재검토로 부상(2026-08-20)
  "acceptedBy TEXT",          // 위험수용 처리자 — reviewedBy는 이후 전이에 덮이므로 따로 보존
]) {
  try { db.exec(`ALTER TABLE finding_approvals ADD COLUMN ${col}`); } catch { /* 이미 있으면 무시 */ }
}

// 마이그레이션: assets.service (이 자산이 지원·보호하는 업무 서비스). 서비스 영향도(serviceimpact.ts)
// 산출용 — 자산에 문제가 생기면 어느 서비스가 영향받는지 집계한다. 선택 항목이라 nullable.
try {
  db.exec("ALTER TABLE assets ADD COLUMN service TEXT");
} catch {
  /* 컬럼이 이미 있으면 정상 — 무시 */
}

// 마이그레이션: tasks에 조치(remediation) 항목용 필드 — dueAt(SLA 기한, ms), assignee(담당자),
// ref(연결된 취약점/자산 참조). 전부 선택 항목이라 nullable. 취약점 → 조치 항목 전환에 쓴다.
for (const col of ["dueAt INTEGER", "assignee TEXT", "ref TEXT"]) {
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`);
  } catch {
    /* 컬럼이 이미 있으면 정상 — 무시 */
  }
}

// ── 스키마 마이그레이션 추적 ─────────────────────────────────────────────────
// 위쪽 ALTER들은 "이미 있으면 무시"라 멱등하지만 적용 이력이 남지 않아, 고객 버전 업그레이드 시
// 어떤 마이그레이션이 적용됐는지 알 수 없었다. 이제 적용된 마이그레이션 id를 기록해 버전을
// 추적한다(헬스 응답으로 노출). 새 마이그레이션은 migrate(id, sql)로 등록 — 한 번만 실행되고 기록된다.
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL)");
const appliedMigrations = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id));
const recordMigration = db.prepare("INSERT OR IGNORE INTO schema_migrations (id, appliedAt) VALUES (?, ?)");

export function migrate(id: string, sql: string): void {
  if (appliedMigrations.has(id)) return;
  db.exec(sql);
  recordMigration.run(id, Date.now());
  appliedMigrations.add(id);
}

export function schemaVersion(): { count: number; latest: string | null } {
  const row = db.prepare("SELECT id FROM schema_migrations ORDER BY appliedAt DESC, id DESC LIMIT 1").get() as { id: string } | undefined;
  return { count: appliedMigrations.size, latest: row?.id ?? null };
}

// 위의 초기 스키마 전체를 하나의 베이스라인으로 기록(이미 컬럼이 존재하므로 no-op SQL).
migrate("baseline-2026-07", "SELECT 1");

// 작업 기록(감사 로그) — 모든 작업(CLI 실행·챗봇 승인·쓰기·차단·로그인 등)을 한 타임라인에 남긴다.
// 흩어진 이벤트(협업/LLM활동/egress/가드레일)와 달리 "누가 무엇을 언제 실행/승인/차단했나"의
// 단일 감사 원천. CLI(①)의 실행·승인·차단이 여기에 강제로 기록된다(끌 수 없음).
migrate(
  "audit-log-2026-07-19",
  `CREATE TABLE IF NOT EXISTS audit_log (
     id TEXT PRIMARY KEY,
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,       -- cli | approval | write | block | auth | config
     actor TEXT,               -- 사용자 표시이름 또는 'chatbot'
     action TEXT NOT NULL,     -- 사람이 읽는 한 줄 요약
     target TEXT,              -- 대상(자산id·호스트·명령 등)
     detail TEXT,              -- 부가 상세(명령 전문 등)
     result TEXT               -- ok | blocked | error | pending
   );
   CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
   CREATE INDEX IF NOT EXISTS idx_audit_log_kind ON audit_log(kind);`
);

// 원격 SSH 정기점검 — 점검 대상(장비) 레지스트리 + 스케줄 + 실행 이력.
// 대상: local(서버 자신) 또는 ssh(원격 장비). 스케줄: interval_hours 마다 자동 점검.
// 이력: 매 실행의 준수율·취약 수를 남겨 추세(개선/악화)를 본다.
migrate(
  "hardening-remote-2026-07-20",
  `CREATE TABLE IF NOT EXISTS hardening_targets (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     host TEXT NOT NULL,           -- 'local' 또는 IP/호스트명
     port INTEGER NOT NULL DEFAULT 22,
     username TEXT,
     authMethod TEXT NOT NULL,     -- local | key | password
     -- ⚠ key: 개인키 **파일 경로**(비밀 아님, 평문) · password: **cryptopack으로 암호화한 JSON**
     --    (2026-08-18 정정 — 여기만 평문이었다. cti_feeds·cloud_llm_keys와 같은 방식으로 맞췄다.)
     --    옛 평문도 읽는다(복호 실패 시 평문으로 간주 — 하위호환). 다시 저장하면 암호문이 된다.
     secret TEXT,
     createdAt INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS hardening_schedules (
     id TEXT PRIMARY KEY,
     targetId TEXT NOT NULL,
     standard TEXT NOT NULL,       -- kisa | cis
     intervalHours INTEGER NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     lastRunAt INTEGER,
     nextRunAt INTEGER NOT NULL,
     lastRate INTEGER,
     lastFail INTEGER,
     createdAt INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS hardening_runs (
     id TEXT PRIMARY KEY,
     targetId TEXT NOT NULL,
     targetLabel TEXT NOT NULL,
     standard TEXT NOT NULL,
     at INTEGER NOT NULL,
     rate INTEGER NOT NULL,
     pass INTEGER NOT NULL,
     fail INTEGER NOT NULL,
     warn INTEGER NOT NULL,
     na INTEGER NOT NULL,
     source TEXT NOT NULL,         -- manual | scheduled | chatbot
     summary TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_hardening_runs_target ON hardening_runs(targetId, at);
   CREATE INDEX IF NOT EXISTS idx_hardening_sched_next ON hardening_schedules(nextRunAt);`
);

// 대상별 기본 점검 기준(장비 유형) — IP만 넣으면 항상 kisa(리눅스)로 돌던 문제 해소.
// 등록 시 리눅스/윈도우PC/네트워크장비를 골라 저장하면 수동 점검이 그 기준으로 실행된다.
migrate(
  "hardening-target-standard-2026-07-21",
  `ALTER TABLE hardening_targets ADD COLUMN standard TEXT NOT NULL DEFAULT 'kisa'`
);

// 조치 완료 시각 — MTTR(평균 조치 소요시간) 산출용. 완료 처리 시 채워지고, 다시 미완료로 되돌리면 비운다.
// 기존 완료 태스크는 NULL(완료시각 미상)이라 MTTR 집계에서 제외된다 — 배포 후 완료건부터 누적.
migrate(
  "tasks-completedAt-2026-07-22",
  `ALTER TABLE tasks ADD COLUMN completedAt INTEGER`
);

// 자산 화면 고도화(김도희 수정사항 ④⑥, 2026-07-23):
//  category   — 담당자가 지정하는 그룹(카테고리). 미지정=null → 화면에서 '미분류'.
//  updatedAt  — 자산 레코드 최종 수정 시각(등록·스캔·메타변경 시 갱신). registeredAt(등록일)과 별개.
//  hostname/ip— 호스트명·IP를 독립 컬럼으로 보여주기 위한 필드. 미지정이면 화면이 name에서 유도.
migrate(
  "assets-category-hostip-2026-07-23",
  `ALTER TABLE assets ADD COLUMN category TEXT;
   ALTER TABLE assets ADD COLUMN updatedAt INTEGER;
   ALTER TABLE assets ADD COLUMN hostname TEXT;
   ALTER TABLE assets ADD COLUMN ip TEXT;`
);

// 내 업무 화면(2026-07-31 사용자 지시 "가이드 받고 진행한다가 핵심"):
//  recur      — 반복 주기(weekly|monthly). 없으면 한 번만 하는 일.
//               완료하면 다음 주기 항목이 새로 생긴다(원본은 완료로 남아 기록이 끊기지 않는다).
//  origin     — 이 일이 어디서 왔나(me=직접 적음 · ai=AI가 찾음 · routine=자주 하는 업무에서 담음).
//               섞어 놓되 출처는 감추지 않는다 — 화면에서 색·배지로 구분한다.
//  guideKey   — 진행 가이드 템플릿 키(workguide.ts). 없으면 가이드 없는 단순 할 일.
//  guideDone  — 끝낸 단계 번호 JSON 배열(예 "[0,1]"). 화면을 닫았다 열어도 진행이 남는다.
migrate(
  "tasks-mywork-2026-07-31",
  `ALTER TABLE tasks ADD COLUMN recur TEXT;
   ALTER TABLE tasks ADD COLUMN origin TEXT;
   ALTER TABLE tasks ADD COLUMN guideKey TEXT;
   ALTER TABLE tasks ADD COLUMN guideDone TEXT;`
);

// 개인 문서함(2026-07-31 사용자 지시 "개인용 문서함") — 담당자가 자기 메모·연락처·
// 자주 쓰는 절차를 넣어 두는 자리.
//  ⚠ **만든 사람만 본다.** userId로 격리하며, 남의 문서는 "없다"고 답한다(존재 여부도 안 알린다).
//  ragOptIn — AI가 이 문서를 답변 근거로 쓸지. **기본 꺼짐**이다:
//    켜면 유용하지만(내가 적은 절차로 답한다) 그 순간 **더 이상 개인용이 아니다** —
//    다른 담당자 질문에도 내 메모가 근거로 나온다. 그래서 문서마다 담당자가 직접 켠다.
migrate(
  "personal-docs-2026-07-31",
  `CREATE TABLE IF NOT EXISTS personal_docs (
     id TEXT PRIMARY KEY,
     userId TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     ragOptIn INTEGER NOT NULL DEFAULT 0,
     createdAt INTEGER NOT NULL,
     updatedAt INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_personal_docs_user ON personal_docs(userId, updatedAt DESC);`
);
// LLM 위키(2026-08-20) — 개인 문서의 「회사에 공유」 표시. ragOptIn(내 AI가 읽게 — 나만)과
// 다르다: shared=1이면 전 담당자의 답변 근거가 될 수 있다(명시적 옵트인·비밀 마스킹 후 인입).
try { db.exec("ALTER TABLE personal_docs ADD COLUMN shared INTEGER NOT NULL DEFAULT 0"); } catch { /* 이미 있으면 무시 */ }

// 업무정보 등급(기밀 C · 민감 S · 공개 O)과 계정별 열람 등급 — N2SF 대응(engine/grades.ts).
//
//  · memory_documents.grade  — 지식 문서의 등급
//  · users.clearance         — 그 사람이 볼 수 있는 최고 등급
//
// ⚠ **기존 자료에는 '공개(O)'를 명시적으로 넣는다.** 이 마이그레이션을 쓰던 2026-07-31에는
//   코드 기본값이 "모르면 기밀"이었고, 그것을 이미 쌓인 문서에 그대로 적용하면 어제까지 되던
//   검색이 오늘 전부 막힌다(담당자는 제품이 고장 났다고 생각하고 등급 기능을 꺼 버린다).
//   지금 있는 자료는 등급 개념이 없던 시절의 것이라 **공개로 쓰이고 있었다** — 그 사실을
//   기록으로 남기는 것이지 등급을 낮추는 게 아니다.
// ⚠ **신규 문서의 기본 등급은 「공개(O)」다** — 이 주석이 2026-09-02까지 「민감(S)」이라 적어
//   두었으나 **사실이 아니다.** 단일 출처는 engine/grades.ts의 DEFAULT_DOC_GRADE("O")이고,
//   2026-08-01에 S에서 O로 되돌렸다(S가 기본이면 방금 올린 사람조차 자기 문서를 못 보는
//   사고가 났다 — 그 경위는 grades.ts 주석에 있다). 등급은 사람이 화면에서 올려야 잠긴다.
//   ⚠ 이 주석만 보고 고객에게 「기본이 민감」이라 답하면 거짓이 된다(2026-09-02 RAG 전수조사에서 발견).
// ⚠ 기존 계정에는 열람 등급을 넣지 않는다(NULL → 코드가 '공개만'으로 읽는다).
//   관리자가 설정에서 올려 주기 전까지는 닫혀 있는 쪽이 맞다.
migrate(
  "info-grades-2026-07-31",
  `ALTER TABLE memory_documents ADD COLUMN grade TEXT;
   UPDATE memory_documents SET grade = 'O' WHERE grade IS NULL;
   ALTER TABLE users ADD COLUMN clearance TEXT;`
);
// memory_documents.origin — 'builtin'(제품 내장)·'approved-qa'(승인 문답)·NULL(고객 업로드).
// 원래 engine/memory.ts가 같은 id로 더하던 칸인데, memory.ts를 안 싣는 모듈(observability·teamview·
// learnmemory)이 이 칸을 WHERE에 쓰게 되면서 **DB를 여는 자리(여기)**로 옮겼다(2026-09-03 실측:
// 자가진단 시험 15개가 `no such column: origin`으로 죽었다). memory.ts의 같은 id 호출은 이제 no-op이다.
migrate("memory_documents-origin", "ALTER TABLE memory_documents ADD COLUMN origin TEXT");

// 문서 ↔ 자산 연결(engine/memory.ts) — "이 보고서는 어느 자산 것인가".
//
// 왜 필요한가(2026-07-28~08-02 세 번 재발한 실사고):
//   "안전대부 웹서버 취약점 알려줘"에 사내 진단 보고서에는 5건(평문 전송·디렉토리 인덱싱 등)이
//   적혀 있는데 **"취약점 없습니다"**라고 답했다. 원인은 지식이 없어서가 아니다 —
//   보고서는 지식베이스에 잘 들어 있었고, 제목으로 물으면 정확히 답한다.
//   문제는 **자산 이름으로는 그 보고서를 찾을 길이 없다**는 것이었다. 검색은 문서 제목이
//   질문과 맞을 때만 발췌를 붙이는데, 자산 이름과 보고서 파일명은 원래 다르다.
//
// 제목이 안 맞아도 발췌를 붙이는 방법(느슨한 검색)은 **무관한 문서가 섞인다** —
//   보안 답변에 엉뚱한 근거가 붙는 것은 답이 없는 것보다 나쁘다.
//   그래서 **인입 시점에 이어 둔다**: 리포트를 올려 자산을 등록할 때 그 자산 id를 문서에 적는다.
//   그 순간에는 둘 다 확실히 알고 있다(ingestreport가 assetIds를 이미 들고 있다).
//
// ⚠ 기존 문서는 비워 둔다(NULL) — 없는 연결을 추측으로 채우면 틀린 근거가 된다.
//   다시 올리거나 나중에 이어 주는 도구를 만들 때 채운다.
migrate(
  "doc-asset-link-2026-08-02",
  `ALTER TABLE memory_documents ADD COLUMN assetIds TEXT;`
);


// ── 타사 SBOM 검수 대장 (2026-08-22, 계획서 중-7 확장) ────────────────────────
//
// ■ 왜 **자산의 components에 붙이지 않고** 따로 두나(사장님 「우리 자산 정확도 + 타사 것 검수」)
//   검수 대상이 「우리가 운영 중인 자산」이 아니라 **「납품받을 후보 제품」**일 수 있다.
//   그것을 자산 등록부에 넣으면 자산 수가 부풀고 취약점·조치 흐름에 끼어든다(AssetOrigin에도
//   그런 갈래가 없다: sample/scanner/registered). 또 SBOM 하나가 부품 수백~수천이라
//   자산 하나에 합치면 SBOM 화면 표·판(200행 상한)이 그것에 잠긴다.
//   대신 **자산과 잇고 싶으면 assetId로 가리킨다**(선택) — 우리 자산의 부품표 정확도를 올리는
//   쪽(중-7 본체)은 기존 components가 그대로 맡는다.
// ⚠ 새 표를 만들면 datacleanup.ts의 TARGETS·RESET_TARGETS에도 넣어야 한다 —
//   안 넣으면 「실사용 전환 리셋」 뒤에도 검수 데이터가 남는다(시험이 신규 표를 강제하지는 않는다).
migrate(
  "sbom-review-2026-08-22",
  `CREATE TABLE IF NOT EXISTS sbom_reviews (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,              -- 무엇을 검수했나(파일 이름 또는 문서가 말하는 대상)
     vendor TEXT,                     -- 공급사·납품 업체(사람이 적는다)
     assetId TEXT,                    -- 우리 자산과 잇고 싶을 때만(선택)
     format TEXT NOT NULL,            -- CycloneDX | SPDX
     formatVersion TEXT,
     componentCount INTEGER NOT NULL,
     summary TEXT NOT NULL,           -- 등급별 집계 JSON(licenserisk 등급요약 결과)
     notes TEXT,                      -- 못 읽은 것·주의 사항(파서 알림) JSON 배열
     reviewedBy TEXT,
     reviewedAt TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sbom_review_components (
     reviewId TEXT NOT NULL,
     name TEXT NOT NULL,
     version TEXT,
     license TEXT,                    -- **원문 그대로**(자르지 않는다 — 뒤에 붙은 AGPL이 잘리면 판정이 뒤집힌다)
     licenseFrom TEXT,                -- 어느 자리에서 읽었나(근거)
     tier TEXT NOT NULL,              -- licenserisk 등급(한글)
     needsCheck INTEGER NOT NULL,     -- 사람이 봐야 하나
     purl TEXT,
     supplier TEXT,
     FOREIGN KEY (reviewId) REFERENCES sbom_reviews(id) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_sbom_rc_review ON sbom_review_components(reviewId);
   CREATE INDEX IF NOT EXISTS idx_sbom_rc_tier ON sbom_review_components(tier);`
);

// ── 반입 영수증 (2026-08-22 사장님 「사용자가 넣는 파일 내문서에서 다 확인 가능해야 해. 취약점파일도」) ──
//
// ■ 왜 새 표인가 — `memory_documents`에 얹을 수 없다
//   「내 문서」 목록이 뜨는 조건은 **메타 행이 아니라 LanceDB 조각 ≥1**이다
//   (`memory.ts` listDocuments가 조각 집계를 돌면서 메타를 붙인다).
//   그런데 취약점 스캔·SBOM은 **일부러 지식에 안 넣는다**(수천 줄 표라 다른 질문의 근거를 밀어낸다 —
//   「스키마 551조각」 실사고). 즉 조각이 0이라 **메타 행을 만들어도 목록에 영영 안 뜬다.**
//
// ■ ★ 2026-09-07 개정 — 「listDocuments를 고치지 마라」는 **여기서 끝난다**
//   이 자리에는 오래 이렇게 적혀 있었다: 「억지로 뜨게 하려고 listDocuments를 고치면 「AI 지식」
//   화면과 지식 저장소 숫자에 조각 0 문서가 섞인다」. 그 걱정이 가리킨 것은 **취약점 스캔·SBOM**인데,
//   실제로 코드를 따라가 보면 그 갈래는 `upsertDocMetaStmt`(유일 호출 memory.ts ingestText 성공 뒤)를
//   **아예 안 탄다** — 즉 스캔·SBOM은 **대장에 줄 자체가 없다.** 목록에 섞일 수가 없다.
//   그래서 listDocuments가 대장 잔여를 담아도 들어오는 것은 딱 하나뿐이다:
//   **반입은 됐는데 벡터가 사라진 문서(유령)** — 그건 「섞이면 안 되는 잡음」이 아니라 **알려야 할 결함**이다
//   (실측 2026-09-07: 대장 3,921 · 저장소 3,920 — `2025년 사이버 위협 전망.pdf` 21조각이 통째로 없었다).
//   ⚠ 그래도 **이 표(upload_receipts)는 그대로 둔다.** 영수증이 답하는 물음(「누가·언제·어디로 보냈나」,
//     같은 파일 두 번 올리면 두 줄)은 문서 대장이 원리상 못 답한다 — 아래 PK 문단이 그 이유다.
//   ⚠ 숫자가 섞이는 걱정은 **없앤 게 아니라 이름을 붙였다** — 유령 줄은 docState="missing"으로 표시되고,
//     「지식 N건」을 세는 자리(runKnowledgeStatus·handover·kbhygiene)는 그 줄을 **안 센다.**
//     판정은 engine/docledger.ts 한 곳 — 손으로 조각 수를 비교하는 코드를 새로 적지 말 것.
//
// ■ ★ PK가 uuid인 이유 — basename이 아니다
//   문서 쪽 계약은 「같은 이름 = 같은 문서」(basename 1:1)다. 오늘 그 계약을 못 박았다(132f19c6).
//   하지만 **영수증은 사건 기록**이라 같은 파일을 두 번 올리면 **두 줄**이어야 한다.
//   basename을 PK로 두면 두 팀이 `2026-08-22_스캔.csv`를 올릴 때 서로를 덮어 **기록이 사라진다.**
//   → uuid PK + 파일명은 값. 두 계약이 서로를 안 건드린다.
//
// ■ 무엇을 담나
//   「누가·언제·무엇을·어디로 보냈나」 + 원본이 남았는지. **원본을 여기 담지 않는다**(파일은 디스크).
migrate(
  "upload-receipts-2026-08-22",
  `CREATE TABLE IF NOT EXISTS upload_receipts (
     id TEXT PRIMARY KEY,             -- uuid (파일명이 아니다 — 위 주석)
     filename TEXT NOT NULL,          -- 올린 그대로의 이름
     uploadedBy TEXT,                 -- 누가
     uploadedAt TEXT NOT NULL,        -- 언제 (ISO)
     kind TEXT NOT NULL,              -- 갈래: document|vulnreport|securitylog|opsreport|sbom|asset|log|guideline|unknown
     routedTo TEXT NOT NULL,          -- 어디로: memory|vulnscan|analysis|sbom|product-manual|decision|failed
     decidedBy TEXT,                  -- 갈래를 누가 정했나: auto | user  ★「사람이 정한 것」을 나중에 물을 수 있게
     category TEXT,                   -- 업무영역(정해졌으면)
     originalSaved INTEGER NOT NULL DEFAULT 0,  -- 원본이 디스크에 남았나
     mdSaved INTEGER NOT NULL DEFAULT 0,        -- 추출본(.md)이 생겼나
     ingested INTEGER NOT NULL DEFAULT 0,       -- AI 지식으로 들어갔나 (0이어도 정상인 갈래가 있다)
     bytes INTEGER,                   -- 파일 크기(보관 총량을 재는 근거)
     detail TEXT,                     -- 사람이 읽는 한 줄(무엇이 만들어졌나)
     note TEXT                        -- 주의·실패 사유
   );
   CREATE INDEX IF NOT EXISTS idx_upload_receipts_at ON upload_receipts(uploadedAt);
   CREATE INDEX IF NOT EXISTS idx_upload_receipts_kind ON upload_receipts(kind);`
);

// ── 개인 문서 첨부 + 버전 이력 (2026-08-22 사장님 「내 문서가 Smart MD 기능을 충분히 했으면 해」) ──
//
// ■ 왜 필요한가 — Smart MD Studio를 없애려면 그 일을 여기서 해야 한다
//   우리가 라이트 설치안내서·챗봇 안내에 **약속해 둔 목록**이 있다:
//     화면 캡처 Ctrl+V 삽입 · md/HTML/PDF/워드 4형식 · 템플릿 · **문서 이력** · 인터넷 불필요
//   그중 **캡처 삽입**과 **문서 이력**이 내 문서에 없었다.
//
// ■ ★ 왜 캡처를 본문에 안 박나 (실측)
//   개인 문서 본문 상한이 20만 자인데 **화면 캡처 1장이 base64로 약 16만 자**다.
//   → **1장이 한계, 2장은 원리상 불가.** 게다가 그대로 넣으면 지식 인입기가 「글자가 아니다」로
//     거절해 **저장이 500으로 실패하는데 본문은 이미 저장된 뒤**가 된다.
//   그래서 파일은 디스크에, 표에는 **참조만** 둔다.
//
// ⚠ 파일 이름은 **uuid**다(원본 이름이 아니다). basename 키잉이 같은 이름끼리 서로를 덮어
//   기밀이 샌 사고가 2026-08-22에 있었다(커밋 132f19c6) — 그 계보를 여기서 반복하지 않는다.
// ⚠ 저장 자리는 `data/docs/` **안**이어야 한다 — 백업(backup.ts)이 그 폴더를 통째로 복사하고
//   데이터 정리(datacleanup.ts)도 그 아래를 안다. 밖에 두면 **백업에서 조용히 빠진다.**
migrate(
  "personal-doc-attach-history-2026-08-22",
  `CREATE TABLE IF NOT EXISTS personal_doc_files (
     id TEXT PRIMARY KEY,              -- uuid = 디스크 파일 이름이기도 하다
     docId TEXT NOT NULL,              -- 어느 문서의 첨부인가
     userId TEXT NOT NULL,             -- 격리 — 남의 첨부는 원리상 못 연다
     name TEXT NOT NULL,               -- 사람이 보는 이름(원본 파일명 또는 "캡처 3")
     mime TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     createdAt TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_pdf_doc ON personal_doc_files(docId);
   CREATE INDEX IF NOT EXISTS idx_pdf_user ON personal_doc_files(userId);

   CREATE TABLE IF NOT EXISTS personal_doc_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     docId TEXT NOT NULL,
     userId TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,               -- 그때의 본문 전체(첨부는 참조라 여기 안 들어온다)
     savedAt TEXT NOT NULL,
     savedBy TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_pdv_doc ON personal_doc_versions(docId, savedAt DESC);`
);

// ── 반입 영수증에 **올린 이의 id** (2026-08-22 게시 전 검토관 [높음] 수리) ────────────────
//
// ■ 무엇이 잘못됐나 — `/api/upload/receipts`가 **전 사용자의 반입 목록을 필터 없이** 줬다.
//   그전에 그 탭이 쓰던 `/api/memory/documents`는 등급 필터(`!열람불가(d.documentId, req)`)를
//   지났는데, 원천을 갈아타면서 그 잣대가 빠졌다. 즉 **내가 새로 연 구멍**이다.
//   실패 모양: C(기밀) 「퇴사자명단_2026.xlsx」가 🏢 회사 지식 탭에는 안 보이는데
//   같은 화면 🩹 반입 탭에는 그대로 뜬다 — 한 화면 두 탭이 서로 다른 잣대가 된다.
//   ⚠ 제목만으로도 새는 것이 있다(gradeblock.test:169 「퇴사자명단_최종.xlsx는 열어 보지
//     않아도 알려 준다」). 「내용이 아니라 사실만 적는다」는 내 주석이 틀렸다.
//
// ■ 왜 새 칸이 필요한가 — 옛 칸 `uploadedBy`는 **표시 이름**(displayName)이다.
//   이름으로 사람을 가르면 동명이인·개명에서 어긋난다. 2026-08-22 오전에 **basename 키잉**으로
//   기밀이 샌 바로 그 부류다. 그래서 **바뀌지 않는 id**로 가른다.
//   ⚠ `db.exec(CREATE TABLE IF NOT EXISTS)`는 **이미 있는 표에 칸을 안 더한다** — 운영 DB에는
//     표가 이미 있으므로 반드시 이 마이그레이션(ALTER)이어야 한다.
//
// ■ 옛 줄(uploadedById IS NULL)은 어떻게 되나 — 「남의 것」으로 다룬다. 즉 등급 검사를 지나야
//   보인다. 안전한 쪽으로 기운다: 모르면 감춘다.
migrate(
  "upload-receipts-uploader-id-2026-08-22",
  `ALTER TABLE upload_receipts ADD COLUMN uploadedById TEXT;
   CREATE INDEX IF NOT EXISTS idx_upload_receipts_by ON upload_receipts(uploadedById);`
);
