// 고객 설치본에 실리는 문서의 **재배포 권리**를 지킨다 (2026-08-22 신설).
//
// ■ 왜 생겼나 — 우리는 상용 제품인데 「배포하면 안 되는」 문서 7종을 싣고 있었다
//   공공기관 가이드를 PDF→마크다운으로 바꿔 지식 번들에 담아 **고객 설치본과 함께 배포**했다.
//   판권면을 실제로 열어 보니:
//     · SW 공급망 보안 가이드라인 → **CC BY-NC-ND**(비영리·변경금지)
//     · ISMS-P 인증기준 안내서   → **공공누리 제4유형**(상업적 이용금지·변경금지)
//     · 랜섬웨어 대응 가이드라인 → 「진흥원의 **허가 없이** 무단전재 및 복사를 금하며…」
//     · 침해사고·가명정보·영향평가 → 전부 「무단전재를 금하며…」
//     · 제로트러스트 2.0        → **표기 자체가 없음**(허락이 없다는 뜻이다)
//
//   ⚠ **가장 아픈 것**: 그 문장들이 **우리가 변환한 .md 안에 이미 들어 있었다.**
//     랜섬웨어 문서 1002행에 「허가 없이 무단전재 및 복사를 금하며」가 그대로 있었고,
//     우리는 그 문장을 실은 채로 배포했다.
//
//   ⚠ 뿌리: 머리말에 「라이선스: **공개 배포**」라고만 적어 두고 그것을 판정으로 여겼다.
//     그 말은 「무료로 받을 수 있다」는 뜻이지 **「재배포·변환해도 된다」가 아니다.**
//     사람의 주의로는 또 놓친다 — 그래서 기계로 막는다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const 서버루트 = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const 저장소 = path.resolve(서버루트, "..");

function 매니페스트() {
  return JSON.parse(fs.readFileSync(path.join(서버루트, "docs-manifest.json"), "utf8")) as {
    files: { file: string; why?: string }[];
    _제외?: { file?: string; why?: string; removed?: string }[];
  };
}

describe("배포 문서 라이선스 — 실을 권리가 있는 것만 싣는다", () => {
  it("★★ 「배포하면 안 된다」고 확인된 문서가 목록에 없다", () => {
    // 판권면을 직접 열어 확인한 것들. 되살리려면 발행처 허락 근거를 먼저 받아야 한다.
    const 금지 = [
      "KISA_SW_공급망_보안_가이드라인.md",
      "KISA_ISMS-P_인증기준_안내서.md",
      "KISA_침해사고_분석절차_안내서.md",
      "KISA_랜섬웨어_대응_가이드라인.md",
      "개인정보위_가명정보_처리_가이드라인.md",
      "개인정보위_영향평가_수행안내서.md",
      "KISA_제로트러스트_가이드라인_2.0.md",
    ];
    const 실리는것 = 매니페스트().files.map((f) => path.basename(f.file));
    const 걸린것 = 금지.filter((n) => 실리는것.includes(n));
    expect(걸린것, `상용 배포가 금지된 문서가 목록에 있다:\n${걸린것.join("\n")}\n` +
      `근거는 docs-manifest.json의 _제외에 있다. 되살리려면 발행처 허락 근거를 먼저 적을 것.`).toEqual([]);
  });

  it("★ 「공개 배포」를 라이선스 판정으로 쓰지 않는다 — 그건 판정이 아니다", () => {
    // 이 표기가 바로 7종을 통과시킨 뿌리다. 「무료로 받을 수 있다」와 「재배포해도 된다」는 다르다.
    const 걸린것: string[] = [];
    for (const f of 매니페스트().files) {
      const p = path.join(저장소, f.file);
      if (!fs.existsSync(p)) continue;
      const 머리 = fs.readFileSync(p, "utf8").slice(0, 2500);
      // 「**라이선스**: 공개 배포」 꼴만 잡는다 — 본문에 그 말이 나오는 것은 무관하다.
      if (/\*\*라이선스\*\*\s*:?\s*공개\s*배포|라이선스\s*[:：]\s*공개\s*배포/.test(머리)) {
        걸린것.push(f.file);
      }
    }
    expect(걸린것, `「라이선스: 공개 배포」는 판정이 아니다 — 공공누리 유형(제0~4) 또는 CC 식별자를\n` +
      `판권면에서 읽어 그대로 적을 것:\n${걸린것.join("\n")}`).toEqual([]);
  });

  it("★ 남의 문서를 실을 때는 **판권면 근거**가 머리말에 있다", () => {
    // 우리가 쓴 문서(GIJO_*)는 대상이 아니다 — 저작권자가 우리다.
    const 남의것 = 매니페스트().files.filter((f) => !/GIJO/.test(path.basename(f.file)));
    const 근거없음: string[] = [];
    for (const f of 남의것) {
      const p = path.join(저장소, f.file);
      if (!fs.existsSync(p)) continue;
      const 머리 = fs.readFileSync(p, "utf8").slice(0, 2500);
      // 쓸 수 있는 근거: 공공누리 유형 · CC 식별자 · 자유이용 명시 · 법령(저작권 대상 아님)
      const 근거있나 =
        /공공누리|KOGL|제\s*[0-4]\s*유형|자유이용/.test(머리) ||
        /CC[\s-]?(BY|0)|Creative\s*Commons|CC0/i.test(머리) ||
        /법령|조문|법률\s*원문/.test(머리);
      if (!근거있나) 근거없음.push(f.file);
    }
    expect(근거없음, `남의 문서인데 판권면 근거가 머리말에 없다 — 실을 권리가 있는지 확인할 것:\n${근거없음.join("\n")}`)
      .toEqual([]);
  });

  it("_제외에는 **왜 뺐는지**가 있다 — 이유 없는 제외는 다음 사람이 되돌린다", () => {
    for (const x of 매니페스트()._제외 ?? []) {
      if (!x.file) continue;   // 묶음 설명 항목(_왜_한꺼번에)은 건너뛴다
      expect(String(x.why ?? "").length, `${x.file}: 뺀 이유가 없다`).toBeGreaterThan(20);
    }
  });

  it("보류 폴더에 규칙이 적혀 있다 — 파일만 옮겨 두면 다음 사람이 도로 넣는다", () => {
    const p = path.join(저장소, "knowledge", "_라이선스보류", "README.md");
    expect(fs.existsSync(p), "knowledge/_라이선스보류/README.md 가 있어야 한다").toBe(true);
    const s = fs.readFileSync(p, "utf8");
    expect(s, "다시 넣지 말라는 말이 있어야 한다").toContain("다시 넣지 마세요");
    expect(s, "되살리는 길도 적어야 한다 — 영영 못 쓴다는 뜻이 아니다").toContain("되살리려면");
  });
});
