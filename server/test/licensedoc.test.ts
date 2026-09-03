// 라이선스 지침 문서의 등급표가 **판정 규칙과 같은가** (2026-09-03 신설 — 부품표 팀원 증류 재료, 계획서 §3.3.1 bom)
//
// ■ 왜 생겼나
//   knowledge/오픈소스_라이선스_의무_등급.md 의 등급표를 사람이 손으로 적어 두었더니 규칙(licenserisk.ts)과
//   어긋나 있었다 — 「LGPL(정적 링크 시)=제품 전체 소스 공개」. 규칙은 LGPL을 언제나 고친파일공개 + 확인필요로
//   판정한다. 문서는 고객 답변의 근거이고 부품표 팀원이 배울 재료라, 어긋난 채 두면 규칙은 맞는데 팀원이 틀린 말을 배운다.
//   같은 문서가 「타사 SBOM 검수 화면은 아직 없습니다」라고도 적고 있었다 — 공급망 점검 화면이 있는데.
//   corpusleak.test는 「미구현·아직 없습니다만」만 잡아 이 문장(「아직 없습니다.」)을 놓쳤다.
//
// ★ 지키는 것
//   ① 표식 사이 === 등급표문서() — 규칙을 고치고 생성기를 안 돌리면 여기서 빨개진다(examquestions.test와 같은 본보기).
//   ② 등급 이름 전부 · NC · ND · LicenseRef · NOASSERTION 줄이 표에 있다.
//   ③ 「검수 화면은 아직 없습니다」류의 거짓 자백이 없다.
//   ④ 표가 문서 머리 2500자 안에서 시작한다(docslicense.test의 판권면 창 — 아래 설명).
//   ⑤ 생성기에 등급 이름이 없다(규칙을 복사해 두지 않았다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 등급표문서, 등급순위 } from "../src/engine/licenserisk.js";
import { 문서경로, 표식, 표본문, 표식사이 } from "../../tools/gen-license-doc.mjs";

const 뿌리 = path.resolve(__dirname, "..", "..");
const 문서 = path.join(뿌리, 문서경로);
const 원문 = () => fs.readFileSync(문서, "utf8");
const 돌릴명령 = "node tools/gen-license-doc.mjs";

describe("★ 라이선스 지침 문서의 등급표는 규칙에서 나온다", () => {
  it("문서가 코퍼스 목록에 있고 실재한다 — 목록에 없으면 이 대조는 아무도 안 보는 문서를 지킨다", () => {
    const m = JSON.parse(fs.readFileSync(path.join(뿌리, "server", "docs-manifest.json"), "utf8")) as { files: { file: string }[] };
    expect(m.files.some((f) => f.file === 문서경로), `docs-manifest.json에 ${문서경로}가 없다`).toBe(true);
    expect(fs.existsSync(문서), `${문서경로}가 없다`).toBe(true);
  });

  it("★★ 표식 사이의 표가 등급표문서()와 글자 단위로 같다", () => {
    const 지금 = 표본문(원문());
    expect(지금, `문서에 표식 한 쌍(${표식.시작} … ${표식.끝})이 없다`).not.toBeNull();
    expect(
      String(지금).split(/\r?\n/).join("\n"),
      `문서의 등급표가 규칙과 다르다 — ${돌릴명령} 를 돌려 갱신하고 규칙 변경과 함께 커밋할 것`,
    ).toBe(등급표문서());
  });

  it("등급 이름 전부가 표에 나온다 — 이름은 등급순위에서 가져온다(여기 복사하지 않는다)", () => {
    const 표 = 등급표문서();
    for (const 이름 of Object.keys(등급순위)) {
      expect(표, `등급 「${이름}」 줄이 표에 없다 — 대표 목록이 규칙 갈래를 다 덮지 못한다`).toContain(`**${이름}**`);
    }
  });

  it("NC · ND · LicenseRef · NOASSERTION 줄이 있다 — 우리가 실제로 걸린 조건과 「모른다」의 두 얼굴", () => {
    const 줄들 = 등급표문서().split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 등급"));
    const 찾기 = (id: string) => 줄들.find((l) => l.includes(`| ${id}`)) ?? "";
    expect(찾기("CC-BY-NC-4.0"), "NC 줄이 없다").toMatch(/⛔/);
    expect(찾기("CC-BY-NC-4.0"), "NC 줄이 비영리 조건을 말하지 않는다").toMatch(/비영리\(NC\)/);
    expect(찾기("CC-BY-ND-4.0"), "ND 줄이 없다").toMatch(/⛔/);
    expect(찾기("CC-BY-ND-4.0"), "ND 줄이 변경금지 조건을 말하지 않는다").toMatch(/변경금지\(ND\)/);
    expect(찾기("LicenseRef-"), "LicenseRef 줄이 없다").toMatch(/LicenseRef/);
    expect(찾기("NOASSERTION"), "NOASSERTION 줄이 없다").toMatch(/NOASSERTION/);
    // LGPL은 확인필요를 숨기지 않는다 — 문서가 어긋났던 바로 그 줄이다.
    expect(찾기("LGPL-"), "LGPL 줄이 링크 방식 확인을 드러내지 않는다").toContain("(링크 방식 확인)");
  });

  it("표가 결정적이고 칸이 비지 않는다 — 0칸 표가 조용히 통과하지 않게", () => {
    const a = 등급표문서();
    expect(a, "같은 규칙인데 표가 달라진다 — 시험이 문서와 글자 단위로 대조하므로 결정적이어야 한다").toBe(등급표문서());
    const 줄들 = a.split("\n").slice(2);
    expect(줄들.length, "표가 너무 짧다 — 규칙 갈래를 다 덮지 못했다").toBeGreaterThanOrEqual(12);
    for (const l of 줄들) {
      const 칸 = l.split("|").slice(1, -1).map((s) => s.trim());
      expect(칸.length, `칸 수가 4가 아니다: ${l}`).toBe(4);
      expect(칸.every((c) => c.length > 0), `빈 칸이 있다: ${l}`).toBe(true);
    }
  });

  it("★ 「검수 화면은 아직 없습니다」류의 거짓 자백이 없다 — corpusleak가 못 잡는 부류", () => {
    const 나쁨 = 원문().split(/\r?\n/).filter(
      (l) => /SBOM|검수|화면/.test(l) && /아직\s*(없습니다|안 하|못 하)|아직 안 하는 것/.test(l),
    );
    expect(나쁨, "공급망 점검 화면(타사 SBOM 라이선스 검수)이 있는데 없다고 적혀 있다").toEqual([]);
    expect(원문(), "있는 기능을 안내해야 한다 — 공급망 점검 화면").toContain("공급망 점검");
  });

  it("표가 문서 머리 2500자 안에서 시작한다 — docslicense.test의 판권면 창", () => {
    // ⚠ docslicense.test는 파일명에 GIJO가 없는 문서에 머리 2500자 안의 판권면 근거(CC 식별자 등)를 요구한다.
    //   이 문서는 우리가 쓴 글이라 판권면이 없고, 표의 CC0·CC-BY 줄이 그 창을 채워 통과한다.
    //   우연에 맡기지 않고 계약으로 못 박는다 — 표를 아래로 옮기면 그 시험이 빨개진다.
    //   정식 해법(「우리 글」 선언으로 면제)은 docslicense 쪽 결정이다.
    const s = 원문();
    expect(s.indexOf(표식.시작), "표식이 없다").toBeGreaterThan(0);
    expect(s.indexOf(표식.시작), "표가 머리 2500자 창 밖으로 밀렸다").toBeLessThan(2300);
  });

  it("생성기에 등급 이름이 없다 — 규칙을 복사해 두지 않았다(gen-sbom-self와 같은 계약)", () => {
    const src = fs.readFileSync(path.join(뿌리, "tools", "gen-license-doc.mjs"), "utf8");
    expect(src, "판정기를 불러 써야 한다").toMatch(/licenserisk/);
    const 코드만 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const 이름 of Object.keys(등급순위)) {
      expect(코드만, `생성기에 등급 이름 「${이름}」이 적혀 있다 — 규칙이 복사됐는지 확인할 것`).not.toContain(이름);
    }
  });

  it("표식 없는 글에는 null을 준다 — 빈 표를 조용히 끼우지 않는다", () => {
    expect(표식사이("# 표식 없음\n")).toBeNull();
    expect(표본문(`${표식.시작}\r\n| a |\r\n${표식.끝}`), "CRLF 문서에서도 표 본문만 뽑는다").toBe("| a |");
  });
});
