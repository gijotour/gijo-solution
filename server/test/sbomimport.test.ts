// 타사 SBOM 읽기 — 계획서 중-7 확장(사장님 「우리 자산 정확도 + 타사 것 검수」).
//
// ★ 이 시험이 지키는 핵심: **라이선스가 실리는 자리가 다섯 개**이고,
//   우리 내보내기 코드는 각각 하나씩만 쓴다. 우리 코드를 보고 파서를 짜면 대부분을 놓친다.
import { describe, it, expect } from "vitest";
import { sbom읽기 } from "../src/engine/sbomimport.js";
import { 등급판정 } from "../src/engine/licenserisk.js";

describe("CycloneDX — 라이선스 세 형태를 다 읽는다", () => {
  it("★ license.id (정본 식별자)", () => {
    const r = sbom읽기(JSON.stringify({
      bomFormat: "CycloneDX", specVersion: "1.6",
      components: [{ name: "libfoo", version: "1.2.3", licenses: [{ license: { id: "AGPL-3.0-only" } }] }],
    }));
    expect(r.형식).toBe("CycloneDX");
    expect(r.부품[0].라이선스).toBe("AGPL-3.0-only");
    expect(r.부품[0].읽은자리).toContain("license.id");
  });

  it("★ license.name (자유 표기) — **우리 내보내기 코드가 만드는 유일한 형태**", () => {
    const r = sbom읽기(JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ name: "libbar", version: "2.0", licenses: [{ license: { name: "GNU Affero General Public License v3" } }] }],
    }));
    expect(r.부품[0].읽은자리).toContain("license.name");
    // 자유 표기라도 판정기가 읽어 준다 — 이게 우리가 PyMuPDF를 놓친 이유였다.
    expect(등급판정(r.부품[0].라이선스).등급).toBe("서비스도공개");
  });

  it("★ expression (식 전체) — 우리 코드는 이 형태를 안 만든다", () => {
    const r = sbom읽기(JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ name: "libbaz", version: "3", licenses: [{ expression: "Apache-2.0 AND AGPL-3.0-only" }] }],
    }));
    expect(r.부품[0].읽은자리).toContain("expression");
    expect(등급판정(r.부품[0].라이선스).등급, "AND니까 무거운 쪽").toBe("서비스도공개");
  });

  it("purl·공급사·대상도 읽는다", () => {
    const r = sbom읽기(JSON.stringify({
      bomFormat: "CycloneDX",
      metadata: { component: { name: "협력사 제품 A" } },
      components: [{ name: "x", version: "1", publisher: "어느회사", purl: "pkg:npm/x@1", licenses: [{ license: { id: "MIT" } }] }],
    }));
    expect(r.대상).toBe("협력사 제품 A");
    expect(r.부품[0].공급사).toBe("어느회사");
    expect(r.부품[0].purl).toBe("pkg:npm/x@1");
  });
});

describe("SPDX — 두 자리를 다 읽는다", () => {
  it("★ licenseDeclared와 licenseConcluded가 **둘 다** 읽힌다", () => {
    const r = sbom읽기(JSON.stringify({
      spdxVersion: "SPDX-2.3", name: "납품물 B",
      packages: [{ name: "libqux", versionInfo: "9", licenseDeclared: "MIT", licenseConcluded: "AGPL-3.0-only" }],
    }));
    expect(r.형식).toBe("SPDX");
    expect(r.부품[0].읽은자리).toEqual(expect.arrayContaining(["licenseConcluded", "licenseDeclared"]));
    // ★ 하나를 골라 버리면 「조사해 보니 사실은 AGPL이더라」를 놓친다.
    expect(등급판정(r.부품[0].라이선스).등급).toBe("서비스도공개");
  });

  it("★ 선언과 확정이 다르면 **말해 준다** — 조용히 하나를 고르지 않는다", () => {
    const r = sbom읽기(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      packages: [{ name: "libqux", licenseDeclared: "MIT", licenseConcluded: "GPL-3.0-only" }],
    }));
    expect(r.알림.join(" ")).toContain("선언");
    expect(r.알림.join(" ")).toContain("확정");
  });

  it("NOASSERTION은 안 센다 — 「모른다」가 라이선스가 되면 안 된다", () => {
    const r = sbom읽기(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      packages: [{ name: "libnone", licenseDeclared: "NOASSERTION", licenseConcluded: "NOASSERTION" }],
    }));
    expect(r.부품[0].라이선스).toBe("");
    expect(r.부품[0].읽은자리).toEqual([]);
    expect(등급판정(r.부품[0].라이선스).등급).toBe("판정불가");
  });

  it("purl은 externalRefs에서 읽는다(SPDX는 자리가 다르다)", () => {
    const r = sbom읽기(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      packages: [{ name: "p", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:pypi/p@1" }] }],
    }));
    expect(r.부품[0].purl).toBe("pkg:pypi/p@1");
  });

  it("supplier의 Organization: 접두를 벗긴다", () => {
    const r = sbom읽기(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      packages: [{ name: "p", supplier: "Organization: 어느재단" }],
    }));
    expect(r.부품[0].공급사).toBe("어느재단");
  });
});

describe("못 읽는 것은 못 읽는다고 말한다 — 조용히 0건으로 넘기지 않는다", () => {
  it("JSON이 아니면", () => {
    const r = sbom읽기("이건 그냥 글입니다");
    expect(r.형식).toBe("알수없음");
    expect(r.알림[0]).toContain("JSON");
  });

  it("두 형식이 아니면 무엇이 필요한지 말한다", () => {
    const r = sbom읽기(JSON.stringify({ hello: "world" }));
    expect(r.형식).toBe("알수없음");
    expect(r.알림.join(" ")).toContain("spdxVersion");
    expect(r.알림.join(" "), "태그-값·XML은 못 읽는다고 밝힌다").toContain("XML");
  });

  it("부품 목록이 비면 그렇게 말한다", () => {
    const r = sbom읽기(JSON.stringify({ bomFormat: "CycloneDX", components: [] }));
    expect(r.알림.join(" ")).toContain("비어 있");
  });

  it("이름 없는 항목이 몇 개인지 말한다", () => {
    const r = sbom읽기(JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ name: "a" }, { version: "1" }, {}],
    }));
    expect(r.부품).toHaveLength(1);
    expect(r.알림.join(" ")).toContain("이름이 없는 항목 2개");
  });

  // 2026-09-01 이전에는 겉만 세고 「안쪽은 아직 안 읽습니다」라고 정직하게 알렸다.
  // 이제는 **편다** — 안쪽 부품도 똑같이 라이선스 의무를 지우기 때문이다.
  // 시험의 목적은 그대로다: **다 센 척하지 않는다.** 다만 이제는 「안 셌다」가 아니라
  // 「이만큼 더 세서 숫자가 겉보다 많다」를 밝히는 것이 정직함이다.
  it("★ 중첩 부품을 펴서 세고, 숫자가 왜 겉보다 많은지 말한다", () => {
    const r = sbom읽기(JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ name: "겉", components: [{ name: "속1" }, { name: "속2" }] }],
    }));
    expect(r.부품.map((p) => p.이름).sort(), "안쪽 부품이 빠지면 라이선스 의무가 숨는다")
      .toEqual(["겉", "속1", "속2"]);
    expect(r.알림.join(" "), "숫자가 왜 겉보다 많은지 안 밝힌다").toContain("펴서 셌습니다");
  });

  it("SPDX의 파일 단위 항목도 안 셌다고 말한다", () => {
    const r = sbom읽기(JSON.stringify({
      spdxVersion: "SPDX-2.3", packages: [{ name: "p" }], files: [{ fileName: "a.c" }, { fileName: "b.c" }],
    }));
    expect(r.알림.join(" ")).toContain("파일 단위 항목 2개");
  });
});

describe("★ 우리 제품이 만든 SBOM을 우리가 다시 읽을 수 있다(왕복)", () => {
  it("우리 내보내기 형태(license.name만)도 그대로 읽힌다", () => {
    // sbom.ts의 buildCycloneDxJson은 Models.NamedLicense만 쓴다 = license.name만 생긴다.
    const 우리것 = {
      bomFormat: "CycloneDX", specVersion: "1.5",
      metadata: { component: { name: "우리 자산" } },
      components: [
        { name: "openssl", version: "3.0.2", licenses: [{ license: { name: "Apache-2.0" } }] },
        { name: "somelib", version: "1.0", licenses: [{ license: { name: "NOASSERTION" } }] },
      ],
    };
    const r = sbom읽기(JSON.stringify(우리것));
    expect(r.부품).toHaveLength(2);
    expect(등급판정(r.부품[0].라이선스).등급).toBe("고지만");
    expect(등급판정(r.부품[1].라이선스).등급, "NOASSERTION은 판정 불가").toBe("판정불가");
  });
});

describe("★ 실전 표본 — 우리가 오늘 걸린 그 부품이 섞인 문서", () => {
  it("AGPL 부품 하나가 300개 사이에 있어도 찾아낸다", () => {
    const comps = Array.from({ length: 300 }, (_, i) => ({
      name: `lib${i}`, version: "1.0", licenses: [{ license: { id: "MIT" } }],
    }));
    comps.splice(150, 0, {
      name: "PyMuPDF", version: "1.28.2",
      licenses: [{ license: { name: "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License" } }],
    });
    const r = sbom읽기(JSON.stringify({ bomFormat: "CycloneDX", components: comps }));
    const 무거운것 = r.부품.filter((c) => 등급판정(c.라이선스).등급 === "서비스도공개");
    expect(무거운것).toHaveLength(1);
    expect(무거운것[0].이름).toBe("PyMuPDF");
    expect(등급판정(무거운것[0].라이선스).받게되는요구).toContain("네트워크로 서비스만 해도");
  });
});
