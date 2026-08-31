// 「SBOM 대상인가」 잣대가 서버와 화면에서 **같은 뜻**인가 (2026-09-01 신설 · 재검토 [상])
//
// ★★ 왜 필요한가
//   이 물음을 **세 곳이 각자 세고 있었다** — 서버 assetcoverage.ts는 스캐너 IP 호스트·인프라
//   장비를 빼고, 화면 두 곳(sbom.html·inventory.html)은 전부 셌다. 그래서 담당자가 대화창에
//   「SBOM 없는 자산 알려줘」로 물으면 12건, 같은 순간 📦 화면 배지는 4,812건이었다.
//   **같은 물음에 두 숫자**가 나오면 어느 것도 못 믿는다.
//
//   화면은 서버 함수를 못 부르니 한 벌 더 적을 수밖에 없다. 그렇다면 **어긋나면 깨지게**
//   못 박는 것이 이 저장소의 방식이다(문서↔코드 짝 시험과 같은 꼴).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const 서버 = readFileSync(join(__dirname, "..", "src", "engine", "assetcoverage.ts"), "utf8");
const 화면규칙 = readFileSync(
  join(__dirname, "..", "..", "client", "src", "renderer", "pages", "assetrules.js"),
  "utf8",
);

describe("서버와 화면이 같은 잣대를 쓴다", () => {
  it("★ 서버 규칙이 거르는 두 가지를 화면도 거른다", () => {
    // 서버: id가 vuln:으로 시작하면 제외 · assetType이 infra-host면 제외
    expect(서버, "서버 규칙이 바뀌었다 — 이 시험이 낡았다").toContain('a.id.startsWith("vuln:")');
    expect(서버, "서버 규칙이 바뀌었다 — 이 시험이 낡았다").toContain("infra-host");
    expect(화면규칙, "화면이 스캐너 IP 호스트를 안 거른다").toContain("vuln:");
    expect(화면규칙, "화면이 인프라 장비를 안 거른다").toContain("infra-host");
  });

  it("★★ 서버가 거르는 유형이 늘면 여기서 걸린다", () => {
    // 서버의 NON_SOFTWARE_TYPES 집합에 든 값을 전부 뽑아 화면에도 있는지 본다.
    const m = 서버.match(/NON_SOFTWARE_TYPES\s*=\s*new Set\(\[([^\]]*)\]/);
    expect(m, "NON_SOFTWARE_TYPES를 못 찾았다 — 이 시험이 낡았다").not.toBeNull();
    const 유형들 = [...(m as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(유형들.length, "유형을 못 읽었다").toBeGreaterThan(0);
    for (const t of 유형들) {
      expect(화면규칙, `서버는 "${t}"를 SBOM 대상에서 빼는데 화면은 안 뺀다 — 두 수가 갈린다`)
        .toContain(t);
    }
  });

  it("화면이 실제로 그 규칙대로 센다(글자만 있는 게 아니다)", () => {
    // assetrules.js를 실행해 판정기를 꺼내 본다.
    const win: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function("window", 화면규칙)(win);
    const 대상 = win.gijoSbomApplies as (a: unknown) => boolean;
    const 세기 = win.gijoSbomMissingCount as (a: unknown[]) => number;
    expect(대상({ id: "vuln:192.168.0.1", assetType: "server" }), "스캐너 호스트를 대상으로 본다").toBe(false);
    expect(대상({ id: "fw-01", assetType: "infra-host" }), "방화벽을 대상으로 본다").toBe(false);
    expect(대상({ id: "app-01", assetType: "LLM 서비스" }), "소프트웨어 자산을 뺐다").toBe(true);
    expect(대상(null), "빈 값에 죽는다").toBe(false);
    expect(
      세기([
        { id: "vuln:1", assetType: "server" },
        { id: "fw", assetType: "infra-host" },
        { id: "app-01", assetType: "LLM 서비스" },
        { id: "app-02", assetType: "LLM 서비스", sbomGeneratedAt: 1 },
      ]),
      "대상만 세야 한다 — 여기서는 app-01 하나",
    ).toBe(1);
  });

  it("★ 화면 두 곳이 **각자 세지 않는다** — 공용 잣대를 부른다", () => {
    for (const 화면 of ["sbom.html", "inventory.html"]) {
      const src = readFileSync(
        join(__dirname, "..", "..", "client", "src", "renderer", "pages", 화면),
        "utf8",
      );
      expect(src, `${화면}이 assetrules.js를 안 읽는다`).toContain("assetrules.js");
      expect(src, `${화면}이 아직 스스로 센다 — 대화창과 다른 수를 말하게 된다`)
        .not.toMatch(/filter\(\(a\) => !a\.sbomGeneratedAt\)\.length/);
    }
  });
});
