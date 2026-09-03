// 라이선스 의무 등급 판정 — 계획서 중-7 확장(우리 자산 SBOM 정확도 + 타사 것 검수).
//
// ★ 이 시험의 1번 케이스는 **2026-08-22에 우리가 실제로 걸린 그 건**이다.
//   PyMuPDF(AGPL-3.0)를 설치본에 동봉했다가 게시 직전 검토에서 잡혔다.
//   기계가 그때 있었으면 사람이 놓친 것을 잡았을 것이다 — 그래서 그 건을 첫 시험으로 박는다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 등급판정, 등급요약, 라이선스모름, 상용사용금지, 변경금지조건, 면책문구 } from "../src/engine/licenserisk.js";

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

  it("★★ 쉼표·슬래시·세미콜론도 가른다 — 안 가르면 첫 토큰만 보고 나머지를 버린다", () => {
    // 2026-08-22 게시 전 검토관 [높음]. 규칙이 접두 매칭이라 안 가르면 첫 조각에서 걸리고 끝난다.
    // ★ 우리가 **지금 출하하는** pypdfium2의 실제 표기다(dist-info 실측).
    const r = 등급판정("BSD-3-Clause, Apache-2.0, dependency licenses");
    expect(r.등급).toBe("고지만");
    expect(r.확인필요, "「dependency licenses」를 못 알아봤으니 사람이 봐야 한다").toBe(true);
    expect(r.spdxId, "원문 문장이 식별자 칸에 들어가면 안 된다").toBe("");

    // ★ 더 나쁜 갈래 — 이게 「고지만」으로 통과하면 카피레프트가 관문을 그냥 지나간다.
    expect(등급판정("MIT, AGPL-3.0").등급).toBe("서비스도공개");
    expect(등급판정("BSD-3-Clause/GPL-2.0").등급).toBe("전체소스공개");
    expect(등급판정("MIT; LGPL-2.1-only").등급).toBe("고친파일공개");
  });

  it("★ HPND를 CC0로 읽지 않는다 — 고지 의무가 있는데 「의무없음」이면 정반대다", () => {
    // Pillow가 실제로 쓰는 라이선스라 우리 동봉물에 들어 있다.
    for (const 표기 of ["Historical Permission Notice and Disclaimer", "HPND"]) {
      expect(등급판정(표기).등급, 표기).toBe("고지만");
      expect(등급판정(표기).등급, "고지 의무가 있는 것을 의무없음으로 세면 안 된다").not.toBe("의무없음");
    }
    // 진짜 퍼블릭 도메인은 그대로 의무없음이어야 한다(수리가 반대쪽을 깨지 않았나).
    expect(등급판정("CC0-1.0").등급).toBe("의무없음");
    expect(등급판정("public domain").등급).toBe("의무없음");
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
      const s = String(pj.scripts[사슬]);
      // ⚠ **stage-python 뒤**여야 한다 — 동봉 파이썬까지 재야 한다.
      expect(s.indexOf("license-gate"), `${사슬}: 관문이 stage-python보다 앞이면 동봉 파이썬을 못 잰다`)
        .toBeGreaterThan(s.indexOf("stage-python"));
      // ⚠ **build-server-dist 뒤**여야 한다 — 그것이 `npm ci --omit=dev`로 **실제 배포 집합**을
      //   만든다. 앞에 두면 개발 트리를 재게 되고, 실측상 그건 543개 중 절반이 개발 도구다
      //   (2026-08-22 검토관 [높음]: 안 나가는 것을 「포함」이라 고지하고 나가는 것은 빠뜨렸다).
      expect(s.indexOf("license-gate"), `${사슬}: 관문이 build-server-dist보다 앞이면 개발 트리를 잰다`)
        .toBeGreaterThan(s.indexOf("build-server-dist"));
      // 그리고 electron-builder **앞**이어야 막을 수 있다.
      expect(s.indexOf("license-gate"), `${사슬}: 관문이 electron-builder 뒤면 못 막는다`)
        .toBeLessThan(s.indexOf("electron-builder"));
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

// ── 「모른다」 잣대가 서버·화면에서 같은가 ────────────────────────────────────
//
// ⚠ 이 값은 **나눠 가질 길이 없어** 두 곳에 적혀 있다(서버 licenserisk.ts · 화면 sbom.html).
//   그래서 시험이 대조한다 — 이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」의
//   실제 사례가 바로 이 잣대였다(서버는 NOASSERTION을 「안다」로, 화면은 「미상」으로 셌다).
describe("★ 「모른다」 목록이 서버·화면에서 같다", () => {
  it("sbom.html의 모름표기가 licenserisk와 어긋나지 않는다", () => {
    const 루트 = path.resolve(__dirname, "..", "..");
    const html = fs.readFileSync(path.join(루트, "client", "src", "renderer", "pages", "sbom.html"), "utf8");
    const m = html.match(/const\s+모름표기\s*=\s*\[([^\]]*)\]/);
    expect(m, "sbom.html에서 모름표기 목록을 못 찾았다 — 이름이 바뀌었으면 이 시험도 고칠 것").toBeTruthy();
    const 화면목록 = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => s !== "");
    // 서버가 「모른다」로 보는 값은 화면도 모두 「미상」으로 봐야 한다.
    for (const v of ["", "-", "noassertion", "none", "unknown", "n/a", "na", "미상", "확인필요"]) {
      expect(라이선스모름(v), `서버가 "${v}"를 모름으로 안 본다`).toBe(true);
      if (v !== "") expect(화면목록, `화면이 "${v}"를 미상으로 안 본다 — 두 숫자가 갈린다`).toContain(v);
    }
    // 반대로 화면이 모름으로 보는 것을 서버가 안다고 하면 안 된다.
    for (const v of 화면목록) {
      expect(라이선스모름(v), `화면은 "${v}"를 미상으로 보는데 서버는 안다고 한다`).toBe(true);
    }
  });

  it("packagescan이 「-」 직접 비교를 안 쓴다 — 잣대를 한 곳으로 모았다", () => {
    const 루트 = path.resolve(__dirname, "..", "..");
    const src = fs.readFileSync(path.join(루트, "server", "src", "engine", "packagescan.ts"), "utf8");
    const 코드 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const 남은것 = 코드.match(/license\s*(!==|===)\s*"-"/g) ?? [];
    expect(남은것, `옛 잣대가 남아 있다(${남은것.length}곳) — 라이선스모름()을 쓸 것`).toEqual([]);
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

// ── 게시 전 2차 검토 수리 (2026-08-22 검토관 [높음]·[중]) ───────────────────────
describe("★ 상용 라이선스로 풀 수 있으면 그렇게 말한다", () => {
  it("★★ PyMuPDF의 실제 표기 — 「살 수 있다」를 함께 말한다", () => {
    // ⚠ ⓘ 패널과 도구 설명이 「상용 라이선스 구매 요구」를 약속해 놓고 코드엔 그 말이 없었다.
    //   하필 이 기능의 계기인 PyMuPDF가 정확히 그 경우다 — 담당자가 **살 수 있는 부품을
    //   못 쓰는 부품으로** 판단하게 된다.
    const r = 등급판정("Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License");
    expect(r.등급).toBe("서비스도공개");
    expect(r.받게되는요구, "상용 선택지를 말해야 한다").toContain("상용 라이선스를 구매하면");
  });

  it("가벼운 등급에는 안 붙인다 — 「고지만 하면 되는데 돈 내라」로 읽히면 안 된다", () => {
    expect(등급판정("MIT OR Commercial").받게되는요구).not.toContain("상용 라이선스를 구매하면");
    expect(등급판정("Apache-2.0").받게되는요구).not.toContain("상용");
  });

  it("상용 신호가 없으면 안 지어낸다", () => {
    expect(등급판정("AGPL-3.0-only").받게되는요구).not.toContain("상용 라이선스를 구매하면");
  });
});

describe("★ OR 갈래도 모르는 조각을 말한다 — AND에만 있던 경고의 대칭", () => {
  it("모르는 조각이 섞이면 「더 무거울 수도」를 붙이고 확인 필요로 둔다", () => {
    const r = 등급판정("MIT OR 알수없는벤더라이선스");
    expect(r.등급).toBe("고지만");
    expect(r.근거, "조용히 버리면 「이보다 무거운 건 없다」로 읽힌다").toContain("알아보지 못한");
    expect(r.확인필요).toBe(true);
  });

  it("전부 아는 것이면 경고를 안 붙인다", () => {
    const r = 등급판정("GPL-2.0-only OR MIT");
    expect(r.근거).not.toContain("알아보지 못한");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2026-08-22 잔여 수리 — **오늘 우리가 라이선스를 바로잡으면서 빠뜨린 것들**
// ══════════════════════════════════════════════════════════════════════════════

describe("★★ 상용 못 씀(NC)과 고칠 수 없음(ND) — 등급 5단계와 다른 축, 서로도 다른 축", () => {
  // 우리는 이날 CC BY-NC-ND 문서 7종을 상용 제품에 실어 배포하다가 **사람 눈으로** 잡았다.
  // 그것이 부품이었다면 판정기는 「아는 라이선스가 아닙니다」라고만 답했을 것이다.
  //
  // ⚠ 처음엔 NC와 ND를 **한 덩어리로** 묶어 「상용 사용 금지」라고 했는데 그것이 틀렸다
  //   (2026-08-22 검토관 [중]). **ND는 상업적 이용을 막지 않는다** — 원본 그대로면 팔아도 된다.
  //   우리 사고가 하필 둘 다 걸린 경우(BY-NC-ND·공공누리 4유형)라 하나로 착각한 것이다.
  it("NC는 「상용 못 씀」 — 소스를 공개해도 안 풀린다", () => {
    for (const s of ["CC-BY-NC-ND-2.0-KR", "CC BY-NC-ND 2.0", "CC-BY-NC-4.0", "공공누리 제4유형", "공공누리 제2유형"]) {
      const r = 등급판정(s);
      expect(상용사용금지(s), `${s} — 상용 금지로 잡혀야 한다`).toBe(true);
      expect(r.근거, `${s} — 「모르는 라이선스」로 끝내면 안 된다`).toContain("상용 제품에 쓸 수 없");
      expect(r.확인필요).toBe(true);
    }
  });

  it("★★ ND는 **상용을 막지 않는다** — 막으면 정당한 게시가 멈추고 없는 계약을 하러 간다", () => {
    for (const s of ["CC-BY-ND-4.0", "공공누리 제3유형", "KOGL Type 3"]) {
      expect(상용사용금지(s), `${s} — ND는 상업적 이용이 허용된다`).toBe(false);
      expect(변경금지조건(s), `${s} — 대신 「고칠 수 없다」로 잡아야 한다`).toBe(true);
      expect(등급판정(s).근거, `${s}`).toContain("고쳐서 내보낼 수 없");
    }
  });

  it("★ 같은 조건에 두 답을 내지 않는다 — CC의 ND와 공공누리의 ND가 같게 판정된다", () => {
    // 옛 패턴은 CC-BY-ND는 잡고 공공누리 제3유형(같은 ND)은 놓쳤다.
    expect(상용사용금지("CC-BY-ND-4.0")).toBe(상용사용금지("공공누리 제3유형"));
    expect(변경금지조건("CC-BY-ND-4.0")).toBe(변경금지조건("공공누리 제3유형"));
  });

  it("★ 반례 — 상업적으로 **쓸 수 있는** 것을 막지 않는다", () => {
    // 이것이 이 규칙의 위험한 쪽이다. `CC-BY-`만 보고 자르면 CC-BY-4.0까지 막혀
    // 우리가 실제로 동봉한 Font Awesome 아이콘이 게시를 막는다.
    for (const s of ["CC-BY-4.0", "CC-BY-3.0", "공공누리 제1유형", "KOGL Type 1", "MIT", "Apache-2.0",
                     "OFL-1.1", "SIL OFL-1.1", "CC-BY-4.0 (icons) / SIL OFL-1.1 (fonts) / MIT (code)"]) {
      expect(상용사용금지(s), `${s} — 막으면 안 된다`).toBe(false);
      expect(변경금지조건(s), `${s} — 변경금지도 아니다`).toBe(false);
    }
  });

  it("★ 어형이 넓다 — CC를 안 붙인 약칭·풀어 쓴 이름·영문 공공누리도 잡는다", () => {
    // 실제 SBOM·모델 카드에 이 표기들이 온다. 하나라도 새면 관문이 뚫린다.
    for (const s of ["Creative Commons BY-NC 4.0", "BY-NC-SA-4.0", "KOGL Type 2", "KOGL Type 4", "NonCommercial"]) {
      expect(상용사용금지(s), `${s} — 잡아야 한다`).toBe(true);
    }
  });

  it("★ 순서가 뒤집혀도 안 깨진다 — 자리 번호가 아니라 이름으로 묶여 있다", () => {
    // FORCED_INTENTS가 자리 번호로 가리키다 18줄 밀린 적이 있다. 같은 함정을 여기 두지 않는다.
    expect(등급판정("CC-BY-NC-4.0").등급).toBe("판정불가");
    expect(등급판정("CC-BY-4.0").등급, "NC 규칙이 CC-BY를 삼키면 안 된다").toBe("고지만");
  });
});

describe("★★ 여럿을 이어 붙인 표기에서 NC가 삼켜지지 않는다", () => {
  // 실측한 거짓 출력(2026-08-22 검토관 [중]):
  //   `MIT AND CC-BY-NC-4.0` → 등급 🟢고지만 + 근거 「그중 1개는 **알아보지 못한 표기**」
  // 알아봤다. 그것도 가장 중요한 조각을 알아봤는데 「못 읽었다」고 말했다.
  // SPDX 반입은 선언≠확정이면 AND로 이어 붙이므로 이 조합은 드물지 않고 **흔하다**.
  it("AND·쉼표로 이어져도 NC를 말한다 — 등급이 초록이어도", () => {
    for (const s of ["MIT AND CC-BY-NC-4.0", "MIT, CC-BY-NC-ND-2.0-KR", "Apache-2.0 AND 공공누리 제4유형"]) {
      const r = 등급판정(s);
      expect(r.받게되는요구, `${s} — 요구 문장에 NC가 있어야 한다`).toContain("비영리(NC)");
      expect(r.확인필요, `${s}`).toBe(true);
      expect(상용사용금지(s), `${s} — 관문도 막아야 한다`).toBe(true);
    }
  });

  it("★★ 알아본 조각을 「알아보지 못했다」고 말하지 않는다 — 판정기가 거짓말을 하면 안 된다", () => {
    for (const s of ["MIT AND CC-BY-NC-4.0", "MIT AND LicenseRef-Custom", "MIT AND CC-BY-ND-4.0"]) {
      expect(등급판정(s).근거, `${s} — 알아본 조각이다`).not.toContain("알아보지 못한");
    }
    // 반례 — 정말 모르는 것은 그대로 「알아보지 못한」이라고 해야 한다(감시가 헛돌면 안 된다).
    expect(등급판정("MIT AND 알수없는벤더표기XYZ").근거).toContain("알아보지 못한");
  });

  it("★ OR(고를 수 있음)이면 막지 않는다 — 헛경보로 게시를 멈추면 안 된다", () => {
    // 「AGPL 또는 상용」처럼 NC가 **선택지 중 하나**면 다른 쪽을 고르면 된다.
    expect(상용사용금지("MIT OR CC-BY-NC-4.0"), "고를 수 있으면 막지 않는다").toBe(false);
    expect(등급판정("MIT OR CC-BY-NC-4.0").받게되는요구, "대신 선택지가 있다고 말한다")
      .toContain("그쪽을 고르면");
  });
});

describe("★ 우리가 배포하는 글꼴·아이콘 라이선스", () => {
  it("SIL OFL-1.1 — 발행처가 앞에 붙어도 알아본다", () => {
    // 규칙은 `/^OFL-/`라 접두 매칭인데 실제 표기는 `SIL OFL-1.1`이다.
    // 판정불가로 떨어져 **고지 목록에서 조용히 빠져 있었다** — 고지가 의무인 라이선스인데.
    expect(등급판정("SIL OFL-1.1").등급).toBe("고지만");
    expect(등급판정("SIL Open Font License 1.1").등급).toBe("고지만");
  });

  it("★ Font Awesome의 **실제 표기 그대로** — 슬래시로 이은 세 라이선스", () => {
    const r = 등급판정("CC-BY-4.0 (icons) / SIL OFL-1.1 (fonts) / MIT (code)");
    expect(r.등급).toBe("고지만");
    expect(r.근거, "세 조각을 다 읽었으면 「알아보지 못한」이 없어야 한다").not.toContain("알아보지 못한");
  });
});

// ── 2026-09-03 검토관 [중] ×5 — **알아본 판정불가에 「알 수 없습니다」를 붙이지 않는다** ─────────
//   규칙에서 구운 등급표의 NC·ND 줄이 「라이선스를 알 수 없습니다 — 공급사에 확인해야 합니다」로 시작했다.
//   CC-BY-NC-4.0은 아는 라이선스다. 등급판정()이 판정불가 전부에 요구문장.판정불가를 붙이고, NC말을
//   요구 칸과 근거 칸에 **둘 다** 덧붙여 같은 조건이 세 번 읽혔다. 원천에서 가른다(표 조립에서 깎지 않는다).
describe("★★ 알아본 판정불가 — 요구 칸은 그 조건, 근거 칸은 규칙의 근거만", () => {
  it("단일 NC — 「알 수 없습니다」가 아니라 「상용 제품에 쓸 수 없습니다」", () => {
    const r = 등급판정("CC-BY-NC-4.0");
    expect(r.등급).toBe("판정불가");
    expect(r.받게되는요구, "아는 라이선스를 모른다고 하면 담당자가 공급사에 헛물음을 보낸다").not.toContain("알 수 없습니다");
    expect(r.받게되는요구).toContain("상용 제품에 쓸 수 없습니다");
    expect(r.받게되는요구, "같은 조건을 요구 칸에 두 번 적지 않는다").not.toContain("함께 걸려 있습니다");
    // 근거 칸은 규칙의 근거 하나 — NC말을 덧붙여 겹치게 하지 않는다.
    expect(r.근거.match(/비영리\(NC\)/g)?.length ?? 0, "근거에 같은 조건이 두 번").toBe(1);
    expect(r.근거).not.toContain("함께 걸려 있습니다");
    expect(r.확인필요).toBe(true);
  });

  it("단일 ND — 「고쳐서 내보낼 수 없습니다」, 상용 배포는 막지 않는다", () => {
    const r = 등급판정("CC-BY-ND-4.0");
    expect(r.받게되는요구).not.toContain("알 수 없습니다");
    expect(r.받게되는요구).toContain("고쳐서 내보낼 수 없습니다");
    expect(r.받게되는요구, "ND는 상용을 막지 않는다").not.toContain("상용 제품에 쓸 수 없습니다");
    expect(r.근거.match(/변경금지\(ND\)/g)?.length ?? 0).toBe(1);
  });

  it("★ NC와 ND가 **둘 다** 걸린 것(우리가 실제로 걸린 모양)은 둘 다 말한다 — NC 규칙이 먼저 걸려도 ND를 잃지 않는다", () => {
    for (const s of ["CC-BY-NC-ND-4.0", "CC BY-NC-ND 2.0 KR", "공공누리 제4유형"]) {
      const r = 등급판정(s);
      expect(r.받게되는요구, `${s} — NC`).toContain("비영리(NC)");
      expect(r.받게되는요구, `${s} — ND도 함께`).toContain("변경금지(ND)");
    }
    // 반례 — NC만 붙은 것에 ND를 지어내지 않는다.
    expect(등급판정("CC-BY-NC-4.0").받게되는요구).not.toContain("변경금지(ND)");
    expect(등급판정("공공누리 제2유형").받게되는요구).not.toContain("변경금지(ND)");
  });

  it("LicenseRef — 「원문을 받아 읽어야 합니다」, 「알 수 없습니다」가 아니다", () => {
    const r = 등급판정("LicenseRef-Vendor-EULA");
    expect(r.등급).toBe("판정불가");
    expect(r.받게되는요구).not.toContain("알 수 없습니다");
    expect(r.받게되는요구).toContain("원문");
    expect(r.받게되는요구, "「의무 없음」이 아니라는 말은 남긴다").toContain("의무 없음");
  });

  it("반례 — 진짜 모르는 것은 그대로 「알 수 없습니다」 (감시가 헛돌면 안 된다)", () => {
    for (const s of ["NOASSERTION", "", "Weird-Vendor-License-1.0", "See LICENSE file"]) {
      expect(등급판정(s).받게되는요구, JSON.stringify(s)).toContain("알 수 없습니다");
    }
  });

  it("이어 붙인 표기 — 조건은 요구 칸에 한 번, 근거 칸에는 규칙의 근거와 셈만", () => {
    const r = 등급판정("MIT AND CC-BY-NC-4.0");
    expect(r.등급).toBe("고지만");
    expect(r.받게되는요구.match(/비영리\(NC\)/g)?.length ?? 0, "요구 칸에 NC 한 번").toBe(1);
    expect(r.근거, "근거 칸은 「왜 이 등급인가」 — 조건은 요구 칸이 말한다").not.toContain("비영리(NC)");
    expect(r.근거).toContain("함께 지켜야");
    // OR(고를 수 있음)이면 강제 문장 대신 「선택지」로만 — 헛경보 금지(종전 계약 유지).
    const o = 등급판정("MIT OR CC-BY-NC-4.0");
    expect(o.받게되는요구).toContain("그쪽을 고르면");
    expect(o.받게되는요구).not.toContain("상용 제품에는 쓸 수 없습니다");
  });
});

describe("★ LicenseRef- 는 「표기가 틀린 것」이 아니다", () => {
  it("개별 라이선스라고 말하고 원문을 받으라고 안내한다", () => {
    // 「아는 라이선스가 아닙니다 — 표기가 정확한지 확인하세요」라고 하면 담당자는
    // SBOM이 잘못 적힌 줄 알고 공급사에 **표기를 고쳐 달라**고 한다. 할 일이 다르다.
    const r = 등급판정("LicenseRef-Microsoft-VC-Redist");
    expect(r.등급).toBe("판정불가");
    expect(r.근거).toContain("개별 라이선스");
    expect(r.근거, "원문을 받으라고 해야 한다").toContain("원문");
    expect(r.근거, "표기가 틀렸다고 하면 안 된다").not.toContain("표기가 정확한지");
  });
});

describe("★ 알아봄 — 판정불가 중 「알아본 것」과 「진짜 모름」을 가른다(요약 셈의 거짓 방지, 2026-09-03)", () => {
  it("NC·ND·LicenseRef는 판정불가여도 알아봄=true, NOASSERTION·빈 값·모르는 표기는 false", () => {
    expect(등급판정("CC-BY-NC-4.0").알아봄).toBe(true);
    expect(등급판정("LicenseRef-Vendor-EULA").알아봄).toBe(true);
    expect(등급판정("MIT").알아봄).toBe(true);
    expect(등급판정("NOASSERTION").알아봄).toBe(false);
    expect(등급판정("").알아봄).toBe(false);
    // 조각 하나를 못 읽으면 전체도 「못 읽은 것」 — 무거운 조각이 숨어 있을 수 있다
    expect(등급판정("MIT AND SunPro").알아봄).toBe(false);
  });
  it("등급요약.알아본판정불가는 판정불가 중 알아본 것만 센다 — 「알 수 없는 부품」에서 빼는 수", () => {
    const r = 등급요약([등급판정("CC-BY-NC-4.0"), 등급판정("NOASSERTION"), 등급판정("MIT")]);
    expect(r.등급별.판정불가).toBe(2);
    expect(r.알아본판정불가).toBe(1);
  });
});
