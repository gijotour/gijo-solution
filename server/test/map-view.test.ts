// 보안 지형도(map-view.js) 코어 로직 — [2026-08-04 · 계획서 전-7]
//
// 왜 이 시험이 있나:
//   지도는 **표와 같은 잣대**로 세야 한다. 지도가 제 나름대로 세면 「고위험 27」인데
//   지도는 다른 수를 그려, 어긋난 두 숫자가 둘 다 못 믿게 만든다. 특히 「진짜 취약점만
//   센다」는 서버 isRealVulnerability와 **목록이 정확히 같아야** 한다 — 실제로 이 시험을
//   쓰다가 scan_not_supported 하나가 빠져 있는 것을 잡았다.
//
// map-view.js는 브라우저 파일이라 window에 붙는다. Node에서 스텁 window를 씌워 로드한다.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { isRealVulnerability } from "../src/engine/agenttools";

// map-view.js를 스텁 window 위에서 실행해 gijoMapView를 꺼낸다.
function loadMapView(): any {
  const src = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "map-view.js"), "utf8");
  const win: any = {};
  const sandbox = {
    window: win,
    document: { createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {} }),
      createElementNS: () => ({ setAttribute() {}, appendChild() {}, innerHTML: "" }) },
    CSS: { escape: (s: string) => s },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return win.gijoMapView;
}

const mv = loadMapView();

describe("★★ 지도의 「진짜 취약점」이 서버 isRealVulnerability와 **정확히 같다**", () => {
  // 서버가 거르는 것 = 지도도 거른다. 한쪽만 세면 타일 크기가 표와 어긋난다.
  const 표본 = [
    { finding_type: "CVE-2021-44228", severity: "critical", state: "active" },  // 진짜
    { finding_type: "scan_error", severity: "low", state: "active" },            // 스캔 실패
    { finding_type: "scan_not_supported", severity: "low", state: "active" },    // 미지원 — 잘 빠지는 것
    { finding_type: "OpenSSH 감지", severity: "info", state: "active" },         // 조사 정보
    { finding_type: "CVE-2020-1", severity: "high", state: "fixed" },            // 고쳐짐
    { finding_type: "CVE-2020-2", severity: "medium", state: "active" },          // 진짜
  ];

  it("한 건씩 서버 규칙과 판정이 일치한다", () => {
    for (const f of 표본) {
      expect(mv.진짜취약(f), `${f.finding_type}/${f.severity}/${f.state}`).toBe(isRealVulnerability(f) && f.state !== "fixed");
    }
  });

  it("★ scan_not_supported도 뺀다 — 서버 SCAN_NOISE에 있는데 지도에서 빠져 있었다", () => {
    expect(mv.진짜취약({ finding_type: "scan_not_supported", severity: "low", state: "active" })).toBe(false);
  });

  it("진짜 취약점 수가 서버 집계와 같다", () => {
    const 지도 = 표본.filter((f) => mv.진짜취약(f)).length;
    const 서버 = 표본.filter((f) => isRealVulnerability(f) && f.state !== "fixed").length;
    expect(지도).toBe(서버);
    expect(지도).toBe(2);
  });
});

describe("구획 열쇠 — 네트워크 대역으로 묶는다", () => {
  it("같은 /24는 한 구획, AI 자산은 따로", () => {
    expect(mv.구획열쇠({ ip: "172.168.50.142" })).toBe(mv.구획열쇠({ ip: "172.168.50.99" }));
    expect(mv.구획열쇠({ ip: "172.168.50.1" })).not.toBe(mv.구획열쇠({ ip: "192.168.219.98" }));
    expect(mv.구획열쇠({ assetType: "LLM 서비스", name: "FDS" })).toMatch(/AI 자산/);
  });

  it("IP가 없으면 성격으로 묶고, 도메인은 외부 노출로", () => {
    expect(mv.구획열쇠({ hostname: "cert.aj-safe.co.kr" })).toMatch(/외부 노출/);
    expect(mv.구획열쇠({ name: "이름만 있는 자산" })).toMatch(/대역 미상/);
  });
});
