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
`);
