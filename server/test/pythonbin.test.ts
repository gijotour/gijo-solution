// 파이썬을 부르는 자리 — **맨 "python"이라고 적은 곳이 없는가**를 소스로 지킨다.
//
// 실사고(2026-08-08): 운영(WSL)에는 `python`이라는 명령이 아예 없다(python3만 있다).
// 그런데 문서 추출·모델 스캔·장비 접속·학습이 전부 그 이름을 부르고 있었다. 결과:
//   · PDF 텍스트 추출이 **한 번도 성공한 적 없었다** → 경로 인입이 PDF를 글자로 그냥 읽어
//     압축 바이트가 지식이 됐다(저장소 조각의 73%가 사람이 못 읽는 상태).
//   · 원클릭 학습 루프는 "No module named 'unsloth'"로 죽었다(다른 방의 파이썬을 봤다).
// 둘 다 조용히 실패해서 오래 몰랐다 — 그래서 코드가 아니라 **감시**로 못 박는다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { serverPython } from "../src/util/pythonbin";

const 엔진방 = path.join(__dirname, "..", "src", "engine");
// 주석 안의 설명("예전엔 python이었다")은 봐주고, 실행되는 코드만 본다.
const 주석지우기 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");

describe("파이썬 실행 경로는 한 곳에서 고른다", () => {
  it("엔진 어디에도 맨 \"python\"을 실행하는 자리가 없다", () => {
    const 위반: string[] = [];
    for (const f of fs.readdirSync(엔진방).filter((x) => x.endsWith(".ts"))) {
      // trainenv는 **경로를 고르는 당사자**다(마지막 폴백으로 "python"을 돌려준다) — 예외.
      if (f === "trainenv.ts") continue;
      const code = 주석지우기(fs.readFileSync(path.join(엔진방, f), "utf8"));
      if (/(execFile|spawn|spawnSync)\(\s*"python"/.test(code)) 위반.push(f);
      if (/=\s*process\.env\.GIJO_PYTHON\s*\?\?\s*"python"/.test(code)) 위반.push(`${f}(기본값)`);
    }
    expect(위반, `맨 python 호출 잔존: ${위반.join(", ")}`).toEqual([]);
  });

  // ⚠ **Windows 호스트에서는 이 시험이 실패한다**(2026-08-09 실측). 제품 결함이 아니다.
  //   `which python3` → C:\...\Microsoft\WindowsApps\python3.exe 가 잡히는데, 이건 **0바이트
  //   껍데기**다(스토어 설치 안내용). 실행하면 아무 일도 안 하고 멈춘다.
  //   운영은 WSL이고 거기엔 /usr/bin/python3(3.12.3)이 정상 동작한다 — 실측 확인했다.
  //   즉 Windows에서 `npm test`를 돌릴 때만 나는 **시험 환경 문제**다.
  //   ⚠ 이 주석을 「그러니 무시해도 된다」로 읽지 말 것. 언젠가 Windows에서도 서버를 돌린다면
  //     그때는 진짜 결함이 된다 — 그 판단은 그때 다시 한다.
  it("고른 파이썬은 실제로 실행되는 것이다", () => {
    // 존재하지 않는 이름을 돌려주면 호출부가 조용히 죽는다 — 이 사고의 정확한 꼴이다.
    const p = serverPython();
    expect(p.length).toBeGreaterThan(0);
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const r = spawnSync(p, ["--version"], { encoding: "utf-8" });
    expect(r.status, `${p} 실행 실패`).toBe(0);
  });
});

describe("추출이 필요한 형식은 글자로 그냥 읽지 않는다", () => {
  it("PDF·한글·오피스 문서는 추출기를 거친다", () => {
    // 경로 인입(ingestDocument)이 확장자를 보고 추출기로 보내는지 — 이게 빠져서
    // Tenable 매뉴얼 4종(4,100여 조각)이 압축 바이트로 저장됐다.
    const memory = fs.readFileSync(path.join(엔진방, "memory.ts"), "utf8");
    expect(memory).toContain("추출필요");
    expect(memory).toContain("extractDocumentText");
    for (const ext of [".pdf", ".hwpx", ".docx", ".xlsx"]) expect(memory).toContain(`"${ext}"`);
  });
});
