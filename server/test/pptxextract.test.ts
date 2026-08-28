// pptxextract.test.ts — pptx 추출의 **주제별 재료** 계약(2026-08-29).
//
// ★ 사장님 지시(2026-08-23) 「데이터 파일 파싱을 잘해야 하는 게 핵심, 문서함에 주제별로」.
//   주제별로 자르려면 원문에 **경계**가 남아야 한다 — 「[슬라이드 N]」이 그 재료다.
//   그리고 도해(SmartArt)·차트 글자를 놓치면 도해 많은 벤더 덱은 본문이 거의 빈다
//   (2026-08-23 SafeBreach 실측으로 확인한 공백).
//
// ⚠ 파이썬 파일을 **소스로** 검사한다 — 실행 검증은 운영 환경(WSL venv)에서 별도로 했다.
//   시험이 python을 부르면 개발 머신(0바이트 껍데기 python3)에서 헛돈다(2026-08-09 실사고).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "..", "scripts", "extract_doc.py"), "utf-8");
const 추출 = SRC.slice(SRC.indexOf("def extract_pptx"), SRC.indexOf("def extract_xlsx"));

describe("pptx 추출 — 주제별로 자를 재료를 남긴다", () => {
  it("★ 슬라이드 경계를 남긴다 — 없으면 주제 분해의 근거가 사라진다", () => {
    expect(추출, "「[슬라이드 N]」 표시가 없다 — 목차·「N.」 소속으로 자를 기준이 없어진다")
      .toContain("[슬라이드 %d]");
  });

  it("★ 도해(SmartArt)·차트 글자를 회수한다 — 도해 많은 덱이 빈 채로 들어오지 않게", () => {
    expect(추출, "SmartArt(ppt/diagrams/data*.xml)를 안 읽는다").toContain("diagrams/data");
    expect(추출, "차트(ppt/charts/chart*.xml)를 안 읽는다").toContain("charts/chart");
    expect(추출, "차트 값 태그(<c:v>)를 안 읽는다").toContain("c:v");
  });

  it("★ 도해를 **그 슬라이드 자리**에 끼운다 — 순서가 흐트러지면 주제 분해가 무의미하다", () => {
    // 관계 파일(slideN.xml.rels)로 소속을 알아낸다. 그냥 전부 뒤에 붙이면 어느 주제의
    // 도해인지 알 수 없어져, 「주제별로」라는 목적 자체가 깨진다.
    expect(추출, "관계 파일로 소속을 안 찾는다 — 도해가 어느 슬라이드 것인지 모르게 된다")
      .toContain("_rels/slide%d.xml.rels");
  });

  it("노트는 표시를 달아 본문과 섞이지 않는다", () => {
    expect(추출, "노트 표시가 없다 — 발표 노트가 본문인 척 섞인다").toContain("(노트)");
  });

  it("없는 파일에 관대하다 — 도해·노트가 없는 덱도 그대로 추출된다", () => {
    expect(추출, "관계 파일 부재를 안 다룬다 — 도해 없는 덱에서 죽는다").toMatch(/rel not in 있는파일|KeyError/);
  });
});
