import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
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
    },
    testTimeout: 15000, // 실 spawn 회피해도 연결 실패 폴백까지 여유(기본 5s는 부하 시 빠듯).
  },
});
