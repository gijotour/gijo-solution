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
      // ⚠ 포트도 함께 막는다(2026-09-10). 자가 진단이 「지금 두뇌가 답하나」를 실제로 찌르게 되면서,
      //   이 값을 안 걸어 두면 시험이 개발·운영 머신의 진짜 llama-server(8080)에 요청을 보낸다 —
      //   작업 규칙 위반이고, 「WSL에선 초록·Windows에선 노랑」이라는 환경 의존 시험이 된다.
      GIJO_LOCAL_LLM_PORT: "59997",
      GIJO_EMBEDDING_URL: "http://127.0.0.1:59998/v1",
      // 겹 1 기억 성장(learnmemory)은 시험에서 끈다 — 승인 👍마다 임베딩(죽은 포트 → 50초 재시도)·LanceDB(data/)에
      // 닿는 것을 막는다(검토관 2026-09-03 중). memorygrowth.test는 사건 방송까지만 본다.
      GIJO_MEMORY_GROWTH: "0",
      GIJO_TI_INTERPRET: "0", // TI 해석은 모델을 부른다 — 시험엔 모델이 없다(scandrafts.test가 주입으로 따로 본다)
      GIJO_BOM_EXPLAIN: "0", // 라이선스 설명(부품 팀원)도 모델을 부른다 — 시험엔 모델이 없다(bomdrafts.test가 주입으로 따로 본다)
      GIJO_CASE_EXPLAIN: "0", // 스캔 초안의 「비슷한 사례」 부연(해설 팀원)도 모델을 부른다 — scandrafts.test가 주입으로 따로 본다
      GIJO_CASE_INGEST: "0", // 침해사고 사례 → 지식 문서 반입은 임베딩(죽은 포트 → 50초 재시도)·LanceDB에 닿는다 — incidentcases.test가 memory 모킹으로 따로 본다
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
      // 문서 인입 뿌리 — 업로드 원본(docs/uploads)·추출본(docs/extracted)이 여기 밑에 쌓인다.
      // 격리 안 하면 인입 시험이 실제 data/docs에 파일을 남긴다(2026-08-22, 원본 보관 토글 작업에서 발견).
      GIJO_INGEST_ROOT: "data/test-tmp/ingest",
    },
    testTimeout: 15000, // 실 spawn 회피해도 연결 실패 폴백까지 여유(기본 5s는 부하 시 빠듯).
  },
});
