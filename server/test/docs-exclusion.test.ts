// 제외 목록은 **다시 안 넣는다**가 아니라 **이미 들어간 것도 지운다**여야 한다.
//
// 실측(2026-08-03): `GIJO_AS_AIBOM_검토_가이드.md`를 2026-08-02에 docs-manifest.json의
//   `_제외`로 옮겼는데, 지식 검색에서 **여전히 1위로 나왔다**(조각 10개가 그대로 남아 있었다).
//   "목록에서 뺀다"를 다시 안 넣는 것으로만 구현했고 **아무도 지우지 않았다.**
//   그 문서에는 소스 경로와 개발 사정이 들어 있어 언제든 담당자 답에 실릴 수 있었다.
//
// ⚠ 이 시험은 **약속과 코드의 일치**를 본다. 제외 목록에 이유까지 적어 두고
//   코드가 아무것도 안 하면, 적어 둔 사람은 처리됐다고 믿는다 — 그게 제일 위험하다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 매니페스트경로 = path.join(__dirname, "../docs-manifest.json");
const 소스 = fs.readFileSync(path.join(__dirname, "../src/engine/docsbundle.ts"), "utf8");

describe("★ 제외 목록을 코드가 강제한다", () => {
  it("인입기가 _제외를 읽어 실제로 지운다", () => {
    expect(소스, "_제외를 아예 안 본다 — 목록은 문서일 뿐 아무것도 안 지킨다").toContain("_제외");
    expect(소스, "지우는 호출이 없다").toMatch(/deleteDocument\(/);
    // 결과에 남긴다 — 조용히 지우면 무엇이 사라졌는지 아무도 모른다.
    expect(소스, "무엇을 지웠는지 결과에 안 남긴다").toContain("removed");
  });

  it("★ 목록에 없다고 지우지는 않는다 — 담당자가 올린 자료를 지우면 안 된다", () => {
    // 실측 시점 저장소 85건 중 76건이 담당자 반입·업로드분이었다.
    // "목록에 없으면 지운다"로 만들면 기동 때마다 그게 다 사라진다.
    expect(소스, "제외 목록이 아니라 전체를 훑어 지우고 있다").not.toMatch(/for \(const .* of existing\)[\s\S]{0,200}deleteDocument/);
    expect(소스).toContain("담당자가 올린 문서");
  });

  it("매니페스트의 제외 항목에 **왜 뺐는지**가 적혀 있다", () => {
    const m = JSON.parse(fs.readFileSync(매니페스트경로, "utf8"));
    const 제외 = m._제외 ?? [];
    expect(제외.length, "제외 목록 자체가 없다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    for (const x of 제외) {
      expect(x.file, "파일명이 없다").toBeTruthy();
      expect(String(x.why ?? "").length, `${x.file}: 왜 뺐는지가 없다 — 이유 없는 제외는 나중에 되돌려진다`).toBeGreaterThan(15);
    }
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    expect(소스.length, "docsbundle.ts를 못 읽었다").toBeGreaterThan(3000);
    expect(fs.existsSync(매니페스트경로), "매니페스트를 못 찾았다").toBe(true);
  });
});
