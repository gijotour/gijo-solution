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

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = process.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite");

if (DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);
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
  -- llm.ts chat()의 remember:true 경로에서만 기록한다. rating: NULL=미평가, 1=긍정(학습 채택),
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

  -- 장기기억(RAG/LanceDB) 문서 메타데이터. LanceDB 행에는 documentId·chunk·vector만 있어
  -- 업로드 시각·원본 경로를 담을 수 없다(새 필드 추가 시 스키마 드리프트로 테이블이 재생성됨).
  -- 문서 단위 메타데이터는 여기 SQLite에 둔다. chunks/scope의 진실 원천은 LanceDB이고 여기 값은
  -- 참고·백필용. 이 테이블에 없는(과거 수집) 문서는 목록에서 ingestedAt=null('이전 업로드')로 표시.
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
