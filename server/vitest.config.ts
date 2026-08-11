import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // in-memory SQLite for tests (db.ts) — no data/gijo-as.sqlite file left behind, and each
    // test worker gets its own isolated DB just like the old in-memory Map/array state did.
    // Fixed dummy key so cryptopack.ts never touches data/encryption.key during tests.
    // LLM/임베딩 URL은 아무도 안 듣는 포트로 고정 — 개발 머신에서 진짜 llama-server가
    // 8080에 떠 있어도 테스트가 실제 모델 추론에 붙잡히지 않고 즉시 연결 실패로 떨어진다.
    // LLAMA_SERVER_PATH도 없는 경로로 막아 ensureAgentModel이 실제 llama-server를 spawn·대기
    // (수 초)하지 않게 한다 — 안 막으면 draft/triage 테스트가 실 프로세스 기동 대기로 간헐 타임아웃.
    env: {
      GIJO_DB_PATH: ":memory:",
      GIJO_ENCRYPTION_KEY: "0".repeat(64),
      GIJO_LOCAL_LLM_URL: "http://127.0.0.1:59999/v1",
      GIJO_EMBEDDING_URL: "http://127.0.0.1:59998/v1",
      GIJO_LLAMA_SERVER_PATH: "__no_llama_server_in_tests__",
      // 테스트가 실제 데이터셋·골드 파일을 건드리지 않게 임시 경로로 격리(운영 orchestrator-tools.json 보호).
      GIJO_DATASETS_DIR: "data/test-tmp/datasets",
      GIJO_ORCH_GOLD_PATH: "data/test-tmp/orchestrator-gold.json",
      // report.test.ts가 개별 파일에서 mkdtempSync로도 격리하지만, 그것만 믿지 않는다 — 실측(2026-07-21):
      // 전체 스위트로 돌리면 report.test.ts가 만든 [mock] 리포트가 실제 data/reports에 새어나가 리포트
      // 이력 100건 상한 밖으로 실제 사용자 리포트가 밀려나는 사고가 있었다. 여기서 기본값 자체를
      // 막아두면 개별 파일이 격리를 깜빡하거나 워커 간 모듈 캐시 타이밍이 어긋나도 운영 데이터는 안전하다.
      GIJO_REPORT_DIR: "data/test-tmp/reports",
      // merge.ts의 산출물 기본 경로는 cwd의 outputs/다 — 운영과 같은 cwd(WSL /home/gijo/gijo-as/server)에서
      // 시험을 돌리면 merge.test.ts가 만든 설정 파일이 **운영 outputs/에 생겼다 지워졌다** 한다(2026-07-17 실사고).
      // merge.ts 쪽은 그때 env를 읽도록 고쳤는데 여기서 값을 안 걸어줘 반쪽만 수리돼 있었다(2026-08-12 발견).
      GIJO_OUTPUTS_DIR: "data/test-tmp/outputs",
    },
    testTimeout: 15000, // 실 spawn 회피해도 연결 실패 폴백까지 여유(기본 5s는 부하 시 빠듯).
  },
});
