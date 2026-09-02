// 시험이 **운영 데이터를 건드리지 않는가**를 지키는 감시.
//
// 실사고 계보 — 같은 결함이 네 번 났다:
//   ① 2026-07-17 merge.test.ts가 운영 `outputs/`의 설정 파일을 지웠다
//   ② 2026-07-21 report.test.ts가 만든 [mock] 리포트가 운영 `data/reports`로 새어 실제 리포트를
//      100건 상한 밖으로 밀어냈다
//   ③ 데이터셋·골드 파일(orchestrator-tools.json)도 같은 방식으로 덮일 뻔했다
//   ④ 2026-08-12 ①의 수리가 **반쪽이었음**이 드러났다 — merge.ts는 env를 읽도록 고쳤는데
//      vitest.config.ts가 그 값을 안 걸어줘서, 3주 동안 격리가 없는 채였다
//
// ⚠ 이 시험은 값을 고쳐 주지 않는다. **분류를 강제**한다 — 새 경로 env가 생기면 아래 표에
//   「어떻게 격리되나」를 적어야 통과한다. 적을 곳이 없으면 그때 격리를 만들게 된다.
//   ④가 알려준 것: 한쪽만 고치고 「고쳤다」고 적으면 아무도 나머지 반쪽을 안 본다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 서버루트 = path.join(__dirname, "..");
const 설정소스 = fs.readFileSync(path.join(서버루트, "vitest.config.ts"), "utf8");

type 격리 =
  | { how: "config" } //            vitest.config.ts의 env가 전 시험에 걸어 준다(가장 안전)
  | { how: "each"; tests: string[] } // 쓰는 시험이 스스로 임시 경로로 돌린다
  | { how: "readonly"; why: string }; // 읽기만 해서 운영 데이터가 상하지 않는다

// ★ 새 GIJO_*_DIR / *_PATH / *_ROOT 를 만들었다면 여기에 한 줄 추가해야 시험이 통과한다.
const 표: Record<string, 격리> = {
  GIJO_DB_PATH: { how: "config" },
  GIJO_DATASETS_DIR: { how: "config" },
  // ⚠ ROOT로 끝나 예전 정규식(DIR|PATH)에 안 걸렸다 — 감시 밖이라 **표에도 없었다**(2026-08-22 발견).
  //   이 값이 안 걸리면 문서 인입 시험이 실제 data/docs/{extracted,uploads}에 파일을 쓴다.
  GIJO_INGEST_ROOT: { how: "config" },
  GIJO_ORCH_GOLD_PATH: { how: "config" },
  GIJO_REPORT_DIR: { how: "config" },
  GIJO_OUTPUTS_DIR: { how: "config" }, // ④의 수리(2026-08-12)
  GIJO_LLAMA_SERVER_PATH: { how: "config" }, // 실 프로세스를 못 띄우게 없는 경로로 막는다

  GIJO_BACKUP_DIR: { how: "each", tests: ["backup.test.ts", "observability.test.ts"] },
  GIJO_MEMORY_DB_PATH: { how: "each", tests: ["memory.test.ts", "backup.test.ts", "docsbundle.test.ts"] },
  GIJO_SESSION_ARCHIVE_DIR: { how: "each", tests: ["sessionarchive.test.ts", "moatslices.test.ts", "memorygrowth.test.ts"] },
  GIJO_LORA_DIR: { how: "each", tests: ["adapterimport.test.ts"] },
  GIJO_CLIENT_RELEASE_DIR: { how: "each", tests: ["clientrelease.test.ts"] },
  GIJO_MODELS_DIR: { how: "each", tests: ["agents.test.ts", "localengine.test.ts"] },
  GIJO_DOCS_DIR: { how: "each", tests: ["docsbundle.test.ts", "packageddatapath.test.ts"] },
  GIJO_DB_KEY_PATH: { how: "each", tests: ["dbkey.test.ts", "dbencrypt.test.ts"] },

  GIJO_SERVER_ROOT: { how: "readonly", why: "파이썬 스크립트 자리를 **찾기만** 한다 — 시험은 그 뿌리에 아무것도 안 쓴다(설정 안 하면 cwd)" },

  GIJO_TLS_CERT_PATH: { how: "readonly", why: "인증서를 읽기만 한다 — 시험은 HTTPS를 안 켠다" },
  GIJO_TLS_KEY_PATH: { how: "readonly", why: "개인키를 읽기만 한다 — 시험은 HTTPS를 안 켜서 파일을 만들지도 지우지도 않는다" },
  GIJO_LLAMA_CPP_DIR: { how: "readonly", why: "실행파일 위치만 찾는다 — 시험에서는 spawn 자체를 막아 둔다" },
};

function 소스전체(): string {
  const 조각: string[] = [];
  const 훑기 = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) 훑기(p);
      else if (e.name.endsWith(".ts")) 조각.push(fs.readFileSync(p, "utf8"));
    }
  };
  훑기(path.join(서버루트, "src"));
  return 조각.join("\n");
}

// ⚠ ROOT를 2026-08-22에 더했다 — GIJO_INGEST_ROOT(문서 원본·추출본 보관 뿌리)가 DIR|PATH로 안 끝나
//   감시를 통째로 비켜 갔다. 경로 env를 새로 만들 때 이름 끝을 무엇으로 짓든 걸리게 한다.
const 발견 = [...new Set(소스전체().match(/process\.env\.GIJO_[A-Z0-9_]*(?:DIR|PATH|ROOT)/g) ?? [])].map((s) =>
  s.replace("process.env.", ""),
);

describe("★ 시험 격리 — 경로 env는 전부 분류돼 있어야 한다", () => {
  it("소스에 있는 모든 경로 env가 표에 있다", () => {
    const 미분류 = 발견.filter((k) => !(k in 표));
    expect(
      미분류,
      `분류 안 된 경로 env: ${미분류.join(", ")} — 시험이 이 경로로 운영 데이터를 건드릴 수 있다. ` +
        "vitest.config.ts에서 격리하거나, 읽기 전용이면 표에 이유와 함께 적을 것.",
    ).toEqual([]);
  });

  it("표에만 있고 소스에 없는 항목은 남겨두지 않는다 — 낡은 표는 거짓 안심을 준다", () => {
    const 유령 = Object.keys(표).filter((k) => !발견.includes(k));
    expect(유령, `소스에서 사라진 env가 표에 남아 있다: ${유령.join(", ")}`).toEqual([]);
  });

  it("config 격리라고 적힌 것은 vitest.config.ts에 실제로 있다", () => {
    for (const [k, v] of Object.entries(표)) {
      if (v.how !== "config") continue;
      expect(설정소스, `${k}: config 격리라고 적혀 있는데 vitest.config.ts에 없다(④와 같은 반쪽 수리)`).toContain(
        `${k}:`,
      );
    }
  });

  it("개별 시험 격리라고 적힌 것은 그 시험이 실제로 env를 건다", () => {
    for (const [k, v] of Object.entries(표)) {
      if (v.how !== "each") continue;
      for (const t of v.tests) {
        const p = path.join(__dirname, t);
        expect(fs.existsSync(p), `${k}: 격리한다고 적힌 시험 ${t}가 없다`).toBe(true);
        expect(fs.readFileSync(p, "utf8"), `${k}: ${t}가 이 env를 안 건다 — 표가 사실과 다르다`).toContain(k);
      }
    }
  });

  it("읽기 전용 예외에는 이유가 적혀 있다", () => {
    for (const [k, v] of Object.entries(표)) {
      if (v.how !== "readonly") continue;
      expect(v.why.length, `${k}: 예외인데 이유가 없다 — 이유 없는 예외는 다음 사람이 그냥 늘린다`).toBeGreaterThan(15);
    }
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    expect(발견.length, "소스에서 경로 env를 하나도 못 찾았다 — 훑기가 깨졌다").toBeGreaterThan(10);
    expect(설정소스.length, "vitest.config.ts를 못 읽었다").toBeGreaterThan(500);
  });
});

describe("★ merge 산출물 격리 — 2026-07-17 실사고의 재발 방지", () => {
  it("시험이 도는 동안 outputs 기본값(cwd/outputs)을 쓰지 않는다", () => {
    expect(process.env.GIJO_OUTPUTS_DIR, "격리가 안 걸렸다 — merge 시험이 운영 outputs/를 건드린다").toBeTruthy();
    expect(process.env.GIJO_OUTPUTS_DIR).toContain("test-tmp");
  });
});
