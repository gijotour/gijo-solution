// 자격증명 탐지·마스킹 — **오탐이 더 위험하다.** 보안 문서는 비밀번호를 늘 이야기한다.
import { describe, it, expect } from "vitest";
import { findSecrets, maskSecrets, hasSecrets } from "../src/engine/secretscan";

describe("실제 자격증명을 찾는다", () => {
  const 진짜 = [
    ["초기 비밀번호: P@ssw0rd-Init-2026", "비밀번호"],
    ["관리자 암호 = Adm1n!SecureLine9", "비밀번호"],
    ["API 연동 키: sk-live-QA7788TESTKEYONLY0000", "API 키"],
    ["access_token: ghp_ABCdefGHIjklMNOpqrsTUVwxyz0123", "API 키"],
    ["AWS 키 AKIAIOSFODNN7EXAMPLE 사용", "AWS 액세스 키"],
    ["DB 접속: postgres://svc:Sup3rSecret@db.internal:5432/app", "접속 문자열 자격증명"],
    ["password=Winter2026!Strong", "비밀번호"],
  ] as const;

  it("대표 형식을 전부 잡는다", () => {
    for (const [문장, 종류] of 진짜) {
      const hits = findSecrets(문장);
      expect(hits.length, `놓침: ${문장}`).toBeGreaterThan(0);
      expect(hits.some((h) => h.kind === 종류), `종류 불일치: ${문장} → ${hits.map((h) => h.kind)}`).toBe(true);
    }
  });

  it("개인키 블록을 통째로 잡는다", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----";
    expect(findSecrets(`설정 파일 내용:\n${key}`).some((h) => h.kind === "개인키")).toBe(true);
  });
});

describe("정상 보안 문서를 오탐하지 않는다 — 이게 더 중요하다", () => {
  const 정상 = [
    "설치 후 반드시 비밀번호를 변경한다.",
    "비밀번호 정책은 최소 12자 이상으로 설정합니다.",
    "API 키는 안전한 곳에 보관하고 코드에 하드코딩하지 마세요.",
    "관리자 계정의 암호는 분기마다 교체하는 것을 권장합니다.",
    "password: <여기에 입력>",
    "비밀번호: ********",
    "api_key: your-api-key",
    "초기 비밀번호: changeme",
    "액세스 키 관리 절차는 보안팀이 정한다.",
    "2차 인증을 켜면 비밀번호가 새어도 들어올 수 없습니다.",
  ];

  it("설명·정책·자리표시자는 건드리지 않는다", () => {
    for (const 문장 of 정상) {
      expect(findSecrets(문장), `오탐: ${문장}`).toHaveLength(0);
    }
  });
});

describe("가릴 때 원본을 남기지 않는다", () => {
  it("값은 가려지고, 앞 2자만 남아 무엇이 가려졌는지는 안다", () => {
    const r = maskSecrets("초기 비밀번호: P@ssw0rd-Init-2026 입니다.");
    expect(r.text).not.toContain("P@ssw0rd-Init-2026");
    expect(r.text).toContain("가림");
    expect(r.text).toContain("초기 비밀번호:"); // 문맥은 남는다
  });

  it("같은 값이 여러 번 나와도 전부 가린다", () => {
    const r = maskSecrets("키: sk-live-QA7788TESTKEYONLY0000\n확인용으로 sk-live-QA7788TESTKEYONLY0000 재기재");
    expect(r.text.includes("sk-live-QA7788TESTKEYONLY0000")).toBe(false);
  });

  it("hits에 원본 값을 담지 않는다 — 이 목록이 로그로 나가도 안전해야 한다", () => {
    const r = maskSecrets("API 연동 키: sk-live-QA7788TESTKEYONLY0000");
    expect(JSON.stringify(r.hits)).not.toContain("QA7788TESTKEYONLY0000");
    expect(r.hits[0].kind).toBe("API 키");
  });

  it("자격증명이 없으면 원문을 그대로 돌려준다", () => {
    const t = "방화벽 정책은 최소 권한 원칙에 따라 구성한다.";
    const r = maskSecrets(t);
    expect(r.text).toBe(t);
    expect(r.hits).toHaveLength(0);
    expect(hasSecrets(t)).toBe(false);
  });

  it("빈 입력에서 터지지 않는다", () => {
    expect(maskSecrets("").text).toBe("");
    expect(findSecrets("")).toHaveLength(0);
  });
});

// ── 나가는 경로에 실제로 붙었는가 ──────────────────────────────────────────
// 함수가 있어도 **호출되지 않으면 아무 의미가 없다**(오늘 배운 유형: orderForSmallModel이
// 엉뚱한 함수에 붙어 죽어 있었다). 그래서 실제 경로로 확인한다.
describe("나가는 경로에 붙어 있다", () => {
  it("클라우드 유출 게이트가 자격증명을 차단한다", async () => {
    const { screenForCloud } = await import("../src/engine/cloudegress");
    const d = screenForCloud("이 설정에서 API 연동 키: sk-live-QA7788TESTKEYONLY0000 는 어떤 의미야?");
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(" ")).toContain("자격증명");
    // ⚠ 차단 사유에 **값 자체가 실리면 안 된다** — 사유는 로그·화면에 그대로 남는다.
    expect(d.reasons.join(" ")).not.toContain("QA7788TESTKEYONLY0000");
  });

  it("자격증명이 없는 일반 질문은 그대로 통과한다", async () => {
    const { screenForCloud } = await import("../src/engine/cloudegress");
    expect(screenForCloud("제로트러스트가 뭔가요?").allowed).toBe(true);
  });

  it("리포트 생성 코드가 마스킹을 실제로 부른다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "report.ts"), "utf8");
    // 주석이 아니라 **코드**에서 호출되는지 본다(내 시험이 주석에 속은 적이 있다).
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toMatch(/maskSecrets\(executiveSummary\)/);
    expect(code).toMatch(/executiveSummary\s*=\s*masked\.text/);
  });
});
