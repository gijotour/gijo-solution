// 라이선스 의무 등급 판정 — 계획서 중-7 확장(우리 자산 SBOM 정확도 + 타사 것 검수).
//
// ★ 이 시험의 1번 케이스는 **2026-08-22에 우리가 실제로 걸린 그 건**이다.
//   PyMuPDF(AGPL-3.0)를 설치본에 동봉했다가 게시 직전 검토에서 잡혔다.
//   기계가 그때 있었으면 사람이 놓친 것을 잡았을 것이다 — 그래서 그 건을 첫 시험으로 박는다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 등급판정, 등급요약, 라이선스모름, 면책문구 } from "../src/engine/licenserisk.js";

describe("라이선스 등급 — 우리가 실제로 걸린 건", () => {
  it("★ PyMuPDF의 AGPL-3.0 — 「서비스만 해도 공개」로 잡는다", () => {
    const r = 등급판정("AGPL-3.0-only");
    expect(r.등급).toBe("서비스도공개");
    expect(r.받게되는요구, "네트워크 서비스만 해도 의무가 생긴다는 말이 나와야 한다").toContain("네트워크로 서비스만 해도");
    expect(r.근거).toContain("§13");
  });

  it("★★ 그 부품의 **실제 표기**를 잡는다 — 정본 식별자가 아니었던 것이 우리가 놓친 이유다", () => {
    // dist-info 실측 문구 그대로: "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License"
    // 정본 식별자(AGPL-3.0-only)였으면 진작 걸렸을 것이다. 자유 표기라서 놓쳤다.
    const r = 등급판정("Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License");
    expect(r.등급, "AFFERO를 읽어 「서비스만 해도 공개」로 세워야 한다").toBe("서비스도공개");
    expect(r.확인필요, "자유 표기에서 읽은 것은 짐작이니 사람이 봐야 한다").toBe(true);
    expect(r.근거).toContain("AGPL-3.0-only로 읽었습니다");
  });

  it("★ 자유 표기 — 실제 부품 582개에서 나온 것들", () => {
    // 실측으로 「판정불가」에 떨어졌던 표기들. 관문이 소음을 내면 아무도 안 본다.
    const 표 : Array<[string, string]> = [
      ["Apache 2.0", "고지만"],
      ["Apache Software License", "고지만"],
      ["BSD License", "고지만"],
      ["3-Clause BSD License", "고지만"],
      ["BlueOak-1.0.0", "고지만"],
      ["MIT License", "고지만"],
      ["GNU General Public License v3", "전체소스공개"],
      ["GNU Lesser General Public License v2 or later (LGPLv2+)", "고친파일공개"],
      ["Mozilla Public License 2.0 (MPL 2.0)", "고친파일공개"],
    ];
    for (const [표기, 기대] of 표) expect(등급판정(표기).등급, 표기).toBe(기대);
  });

  it("★ 자유 표기 순서 — AFFERO가 GPL보다, LGPL이 GPL보다 먼저 걸린다", () => {
    expect(등급판정("GNU Affero General Public License v3").등급).toBe("서비스도공개");
    expect(등급판정("GNU Lesser General Public License v3").등급).toBe("고친파일공개");
    expect(등급판정("GNU General Public License v2").등급).toBe("전체소스공개");
  });

  it("정말 모르는 것은 그대로 판정불가 — 자유 표기 읽기가 아무거나 삼키면 안 된다", () => {
    for (const v of ["UNKNOWN", "Proprietary", "See LICENSE file", "Weird-Vendor-1.0"]) {
      expect(등급판정(v).등급, v).toBe("판정불가");
    }
  });

  it("★ 대체재 pypdfium2는 고지만 하면 된다", () => {
    for (const id of ["BSD-3-Clause", "Apache-2.0"]) {
      expect(등급판정(id).등급).toBe("고지만");
    }
  });
});

describe("라이선스 등급 — 계열별", () => {
  it("네트워크까지: AGPL·SSPL·OSL", () => {
    for (const id of ["AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0", "OSL-3.0"]) {
      expect(등급판정(id).등급, id).toBe("서비스도공개");
    }
  });

  it("배포 시 전체: GPL 계열", () => {
    for (const id of ["GPL-2.0-only", "GPL-3.0-or-later", "GPL-2.0", "EUPL-1.2"]) {
      expect(등급판정(id).등급, id).toBe("전체소스공개");
    }
  });

  it("고친 파일만: MPL·EPL·CDDL", () => {
    for (const id of ["MPL-2.0", "EPL-2.0", "EPL-1.0", "CDDL-1.0"]) {
      expect(등급판정(id).등급, id).toBe("고친파일공개");
    }
  });

  it("고지만: MIT·Apache·BSD·ISC 등", () => {
    for (const id of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "PostgreSQL"]) {
      expect(등급판정(id).등급, id).toBe("고지만");
    }
  });

  it("의무 없음: 퍼블릭 도메인 계열", () => {
    for (const id of ["CC0-1.0", "Unlicense", "0BSD"]) {
      expect(등급판정(id).등급, id).toBe("의무없음");
    }
  });

  it("★ AGPL이 GPL보다 먼저 걸린다 — 순서가 뒤집히면 AGPL이 한 단계 가벼워진다", () => {
    expect(등급판정("AGPL-3.0-only").등급).toBe("서비스도공개");
    expect(등급판정("GPL-3.0-only").등급).toBe("전체소스공개");
  });

  it("LGPL은 링크 방식 때문에 사람 확인이 붙는다", () => {
    const r = 등급판정("LGPL-3.0-only");
    expect(r.등급).toBe("고친파일공개");
    expect(r.확인필요, "동적/정적 링크로 결론이 갈리니 확인이 필요하다").toBe(true);
    expect(r.근거).toContain("링크");
  });
});

describe("라이선스 식(expression) — AND·OR·WITH", () => {
  it("★ AND는 둘 다 지켜야 하니 **무거운 쪽** — 뒤에 붙은 AGPL을 놓치면 안 된다", () => {
    // 실제로 이렇게 온다. 앞만 보고 「Apache니까 괜찮다」로 판정하면 조용히 뒤집힌다.
    const r = 등급판정("Apache-2.0 AND AGPL-3.0-only");
    expect(r.등급).toBe("서비스도공개");
    expect(r.근거).toContain("함께 지켜야");
  });

  it("★ 긴 식에서도 맨 뒤의 무거운 것을 잡는다(자르고 판정하면 안 되는 이유)", () => {
    // 실제 표기는 이렇게 온다 — 실측 571자짜리도 있었다. 60자에서 자르면 AGPL이 날아간다.
    const 긴것 = "LGPL-2.1-or-later AND SunPro AND BSD-3-Clause AND MIT AND ISC AND Zlib AND AGPL-3.0-only";
    expect(긴것.length, "짧게 자르면 뒤가 날아가는 길이여야 시험의 뜻이 산다").toBeGreaterThan(60);
    const r = 등급판정(긴것);
    expect(r.등급).toBe("서비스도공개");
    // ⚠ 이 시험이 설계 결함 하나를 잡았다: 「SunPro」처럼 못 알아본 조각이 섞이면
    //   판정불가가 가장 무거운 것으로 뽑혀 **「여기 AGPL이 있다」를 통째로 삼켰다.**
    //   담당자가 가장 알아야 할 것이 사라지는 셈이라, 아는 것 중 무거운 쪽을 세우고
    //   모르는 조각은 확인 필요로 **함께** 말하게 고쳤다.
    expect(r.확인필요, "못 알아본 조각이 있으니 사람이 봐야 한다").toBe(true);
    expect(r.근거, "모르는 조각이 있다는 사실도 말해야 한다").toContain("알아보지 못한");
  });

  it("OR는 고를 수 있으니 **가벼운 쪽**", () => {
    const r = 등급판정("GPL-2.0-only OR MIT");
    expect(r.등급).toBe("고지만");
    expect(r.근거).toContain("고를 수 있어");
  });

  it("OR에서 판정불가를 「가벼운 쪽」으로 고르지 않는다", () => {
    // 판정불가는 순위상 가장 크지만, 「모른다」가 「가볍다」가 되면 안 된다는 뜻이 아니라
    // 아는 것이 있으면 그것으로 판정해야 한다는 뜻이다.
    const r = 등급판정("MIT OR 알수없는라이선스XYZ");
    expect(r.등급).toBe("고지만");
  });

  it("WITH(예외)가 붙으면 확인 필요로 표시한다", () => {
    const r = 등급판정("GPL-2.0-only WITH Classpath-exception-2.0");
    expect(r.등급).toBe("전체소스공개");
    expect(r.확인필요).toBe(true);
    expect(r.근거).toContain("예외");
  });

  it("AND와 OR가 섞이면 무거운 쪽 + 확인 필요", () => {
    const r = 등급판정("(MIT OR Apache-2.0) AND GPL-3.0-only");
    expect(r.등급).toBe("전체소스공개");
    expect(r.확인필요).toBe(true);
  });
});

describe("모른다 — 「의무 없음」과 절대 섞지 않는다", () => {
  it("NOASSERTION·NONE·빈 값은 전부 판정불가", () => {
    for (const v of ["NOASSERTION", "NONE", "", "  ", "-", "unknown", null, undefined]) {
      const r = 등급판정(v as string);
      expect(r.등급, JSON.stringify(v)).toBe("판정불가");
      expect(r.등급, "모르는 것을 「의무 없음」으로 세면 가장 위험하다").not.toBe("의무없음");
    }
  });

  it("★ 「모른다」 잣대가 한 곳이다 — 서버와 화면이 다르게 세던 그 자리", () => {
    // 실사고 계보: packagescan은 NOASSERTION을 「안다」로 세고, sbom.html은 「미상」으로 접었다.
    // 타사 SBOM에는 이 값이 거의 반드시 들어온다 — 그날 두 숫자가 다른 말을 하게 된다.
    expect(라이선스모름("NOASSERTION")).toBe(true);
    expect(라이선스모름("NONE")).toBe(true);
    expect(라이선스모름("-")).toBe(true);
    expect(라이선스모름("MIT")).toBe(false);
  });

  it("아는 라이선스가 아니면 확인 필요를 붙인다", () => {
    const r = 등급판정("Weird-Vendor-License-1.0");
    expect(r.등급).toBe("판정불가");
    expect(r.확인필요).toBe(true);
  });
});

describe("요약 — 화면·카드·리포트가 쓰는 단 하나의 숫자", () => {
  it("등급별로 세고 무거운 것을 따로 준다", () => {
    const 판정들 = ["AGPL-3.0-only", "MIT", "MIT", "GPL-3.0-only", "NOASSERTION", "Apache-2.0"].map(등급판정);
    const s = 등급요약(판정들);
    expect(s.전체).toBe(6);
    expect(s.등급별.서비스도공개).toBe(1);
    expect(s.등급별.고지만).toBe(3);
    expect(s.등급별.전체소스공개).toBe(1);
    expect(s.등급별.판정불가).toBe(1);
    // 지금 당장 봐야 하는 것 = 전체소스공개 이상 + 판정불가
    expect(s.무거운것).toHaveLength(3);
  });

  it("빈 목록도 터지지 않는다", () => {
    const s = 등급요약([]);
    expect(s.전체).toBe(0);
    expect(s.무거운것).toEqual([]);
  });
});

// ── 관문이 게시 사슬에 실제로 물려 있나 ──────────────────────────────────────
//
// ⚠ 판정기가 아무리 정확해도 **아무도 안 부르면 소용이 없다.** 이 저장소는 그 부류를 겪었다
//   (「부품 로드 누락 5화면 = 거짓 초록」). 배선을 시험으로 못 박는다.
describe("★ 라이선스 관문이 게시 사슬에 물려 있다", () => {
  const 루트 = path.resolve(__dirname, "..", "..");

  it("dist·dist:lite가 license-gate를 부른다", () => {
    const pj = JSON.parse(fs.readFileSync(path.join(루트, "client", "package.json"), "utf8"));
    expect(pj.scripts["license-gate"], "license-gate 스크립트가 있어야 한다").toBeTruthy();
    for (const 사슬 of ["dist", "dist:lite"]) {
      expect(pj.scripts[사슬], `${사슬}이 라이선스 관문을 안 부른다 — AGPL이 그대로 출하된다`)
        .toContain("license-gate");
      // ⚠ **stage-python 뒤**여야 한다 — 동봉 파이썬까지 재야 하므로 앞에 두면 그 부분을 못 본다.
      const s = String(pj.scripts[사슬]);
      expect(s.indexOf("license-gate"), `${사슬}: 관문이 stage-python보다 앞에 있다 — 동봉 파이썬을 못 잰다`)
        .toBeGreaterThan(s.indexOf("stage-python"));
    }
  });

  it("★ 서드파티 고지가 **고객 설치본에 실린다** — 570개가 고지 의무인데 자리가 없었다", () => {
    // MIT·Apache·BSD는 저작권 고지를 배포물에 함께 실어야 한다. 목록만 만들고 안 실으면
    // 「고지 안 함」과 같다 — 라이선스를 지키려고 만든 것이 지키지 않는 모양이 된다.
    for (const 설정 of ["package.json", "electron-builder.lite.json"]) {
      const j = JSON.parse(fs.readFileSync(path.join(루트, "client", 설정), "utf8"));
      const build = 설정 === "package.json" ? j.build : j;
      const 실리나 = JSON.stringify(build.extraResources ?? []).includes("THIRD-PARTY-NOTICES");
      expect(실리나, `${설정}: 고지 파일이 설치본에 안 실린다`).toBe(true);
    }
  });

  it("관문 도구가 판정기를 **가져다 쓴다** — 규칙을 복사해 두지 않았다", () => {
    const src = fs.readFileSync(path.join(루트, "tools", "gen-sbom-self.mjs"), "utf8");
    expect(src, "판정기를 불러 써야 한다").toMatch(/licenserisk/);
    // 규칙을 복사하면 반드시 하나가 낡는다 — 등급 이름이 이 파일에 직접 적혀 있으면 안 된다.
    const 코드만 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(코드만.match(/서비스도공개/g)?.length ?? 0,
      "등급 이름이 관문 쪽에 여러 번 적혀 있다 — 규칙이 복사됐는지 확인할 것").toBeLessThanOrEqual(2);
  });
});

describe("면책 — 빼면 안 되는 것", () => {
  it("법률 자문이 아니라고 분명히 말한다", () => {
    expect(면책문구).toContain("법률 자문이 아닙니다");
    expect(면책문구, "어떻게 쓰느냐로 결론이 달라진다는 말이 있어야 한다").toContain("배포하나");
  });

  it("모든 등급에 「받게 되는 요구」 문장이 있다", () => {
    for (const id of ["AGPL-3.0-only", "GPL-3.0-only", "MPL-2.0", "MIT", "CC0-1.0", "NOASSERTION"]) {
      const r = 등급판정(id);
      expect(r.받게되는요구.length, id).toBeGreaterThan(10);
      expect(r.원문, "판정 근거가 된 원문을 그대로 들고 다녀야 한다").toBe(id);
    }
  });
});
