// 스캔 실패를 취약점으로 세는 자리가 새로 생기지 않는가 — **소스를 직접 본다.**
//
// 왜 이 시험이 필요한가:
//   `isRealVulnerability`는 2026-08-01에 만들어졌는데, 그 뒤로도 **안 부르는 호출부**가
//   계속 발견됐다 — 보안 KPI(08-01) · 절차 띠 · 자산 요약 · 리포트 4곳 · 컴플라이언스 ·
//   통합 관제 · 커버리지. 함수는 있는데 부르는 걸 잊는 것이 문제라, 함수를 고쳐도 안 낫는다.
//   기능 QA로도 안 잡힌다 — 숫자가 나오긴 나오기 때문이다.
//
//   담당자는 이 숫자로 **임원 보고를 쓴다.** 609건 중 608건이 스캔 실패였던 적이 있다.
//
// ★ 재는 방법: `a.findings`를 훑거나 세는 자리를 소스에서 찾아, 그 근처에 판정이 있는지 본다.
//   판정이 필요 없는 자리는 **이유와 함께 아래 예외 목록에 적는다** — 예외를 적는 행위가
//   "이 자리는 왜 안 걸러도 되는가"를 한 번 생각하게 만든다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 엔진 = path.join(__dirname, "../src/engine");

/**
 * 걸러도 되는 자리 — **이유를 반드시 적는다.**
 * 이유 없이 이름만 추가하는 것은 시험을 끄는 것과 같다.
 */
const 예외: Record<string, string> = {
  "agenttools/handlers.ts": "판정 함수(isRealVulnerability·findingSummary)가 사는 곳 — 여기가 원본이다",
  "assets.ts": "저장·삭제 계층. 세는 것이 아니라 **보관**한다 — 스캔 실패도 기록으로 남겨야 한다",
  "kbhygiene.ts": "여기의 findings는 취약점이 아니라 **지식베이스 점검 결과**다(같은 이름 다른 뜻)",
  "remrequest.ts": "세지 않는다 — 사람이 목록에서 고른 건을 findingKey로 **되찾는 조회**다(요청서 동봉). 고른 목록 자체가 이미 판정을 거쳐 나온 것",
  "ctimatch.ts": "취약점 문구를 CTI와 대조하는 자리 — 세지 않고 **글자만** 본다",
  "ingestreport.ts": "반입 직후 그 파일이 넣은 것을 세는 자리 — 반입 결과 보고이지 현황 집계가 아니다",
  "verifyengine.ts": "조치 검증 대상 뽑기 — 스캔 실패 자산도 재점검 대상이라 넣어야 한다",
  "bridge.ts": "스캐너 출력을 표준형으로 옮기는 곳 — 판정 이전 단계다",
};

function ts파일들(): string[] {
  // 하위 폴더까지 — agenttools/가 2026-08-06에 폴더로 나뉘었다. 평면만 훑으면
  // 판정 코드가 사는 handlers.ts가 감시 밖으로 빠진다(지키는 게 아니라 안 보는 것).
  const out: string[] = [];
  const 걷기 = (rel: string) => {
    for (const e of fs.readdirSync(path.join(엔진, rel), { withFileTypes: true })) {
      // __로 시작하는 파일은 다른 시험(airgap)이 잠깐 만드는 표본 — 제품 소스가 아니고,
      // 병렬 실행 중 읽는 순간 사라진다(실측 ENOENT: __airgap_probe_tmp.ts가 이 시험을 깨뜨림).
      if (e.name.startsWith("__")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) 걷기(r);
      else if (e.name.endsWith(".ts")) out.push(r);
    }
  };
  걷기("");
  return out;
}

/** 이 줄이 findings를 **세거나 훑는** 자리인가(단순 참조는 뺀다). */
function 세는줄인가(l: string): boolean {
  if (!/\.findings/.test(l)) return false;
  if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false;                 // 주석
  return /for\s*\(|\.filter\(|\.reduce\(|\.length|\.map\(|\.some\(/.test(l);
}

describe("스캔 실패를 취약점으로 세지 않는다 — 소스 감시", () => {
  it("findings를 세는 파일은 판정(isRealVulnerability)을 부른다", () => {
    const 걸린것: string[] = [];
    for (const f of ts파일들()) {
      if (예외[f]) continue;
      const src = fs.readFileSync(path.join(엔진, f), "utf8");
      const 세는줄 = src.split("\n").filter(세는줄인가);
      if (!세는줄.length) continue;
      if (src.includes("isRealVulnerability")) continue;
      걸린것.push(`${f} — ${세는줄.length}곳:\n      ${세는줄.map((l) => l.trim().slice(0, 90)).join("\n      ")}`);
    }
    expect(
      걸린것,
      "스캔 실패가 취약점 건수에 섞이면 담당자가 그 숫자로 임원 보고를 쓴다.\n" +
      "  걸러야 하면 isRealVulnerability를 부르고, 걸러선 안 되는 자리면 **이유와 함께** 예외에 적을 것:\n\n  " +
      걸린것.join("\n  ")
    ).toEqual([]);
  });

  it("예외에는 전부 이유가 적혀 있다", () => {
    // ⚠ 이유 없는 예외는 시험을 끄는 것과 같다. 짧은 한 줄도 안 된다.
    const 부실 = Object.entries(예외).filter(([, 이유]) => 이유.trim().length < 20).map(([f]) => f);
    expect(부실, "예외에 이유가 없거나 너무 짧다").toEqual([]);
  });

  it("예외에 적힌 파일이 실제로 있다 — 낡은 예외가 시험을 헐겁게 만든다", () => {
    const 없는것 = Object.keys(예외).filter((f) => !fs.existsSync(path.join(엔진, f)));
    expect(없는것, "없는 파일이 예외에 남아 있다").toEqual([]);
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    // ⚠ 정규식이 아무것도 못 잡으면 위 시험은 **전부 통과하면서 아무것도 안 본다.**
    let 세는파일 = 0;
    for (const f of ts파일들()) {
      const src = fs.readFileSync(path.join(엔진, f), "utf8");
      if (src.split("\n").some(세는줄인가)) 세는파일++;
    }
    expect(세는파일, "findings를 세는 파일을 하나도 못 찾았다 — 빈 검사다").toBeGreaterThanOrEqual(8);
  });
});
