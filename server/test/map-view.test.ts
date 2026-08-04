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

describe("★★ 관제 4소스 히트맵 — 서버 상관과 어긋나지 않는다 (지형도 3단계)", () => {
  const events = [
    { source: "vuln", entity: "172.168.50.142", severity: "critical" },
    { source: "vuln", entity: "172.168.50.142", severity: "high" },
    { source: "hardening", entity: "172.168.50.142", severity: "medium" },
    // ⚠ 로그의 entity는 공격자 IP · peers에 대상 — 우리 자산으로 귀속돼야 한다
    { source: "log", entity: "203.0.113.9", peers: ["172.168.50.142"], severity: "high" },
    { source: "vuln", entity: "192.168.219.98", severity: "critical" },
    { source: "product", entity: "샘플-웹서버", severity: "low" },
  ];
  const correlations = [{ entity: "172.168.50.142" }];  // 서버가 준 상관(2소스 이상)

  it("로그의 공격자 IP가 아니라 **우리 대상 자산**으로 집계된다", () => {
    const hd = mv.heatmapData(events, correlations, (s: string) => s);
    const 대상 = hd.rows.find((r: any) => r.name === "172.168.50.142");
    expect(대상, "peers 대상으로 집계돼야 한다").toBeTruthy();
    // 취약점 2 · 보안로그 1 · 운영 0 · 하드닝 1
    expect(대상.cells.map((c: any) => c.count)).toEqual([2, 1, 0, 1]);
    expect(hd.rows.find((r: any) => r.name === "203.0.113.9"), "공격자 IP는 행이 되면 안 된다").toBeUndefined();
  });

  it("★ 상관은 **서버 correlations를 그대로 믿는다** — 화면이 새로 판정하지 않는다", () => {
    const hd = mv.heatmapData(events, correlations, (s: string) => s);
    expect(hd.rows.find((r: any) => r.name === "172.168.50.142").corr).toBe(true);
    expect(hd.rows.find((r: any) => r.name === "192.168.219.98").corr).toBe(false);
    // correlations가 비면 아무 행도 상관이 아니다(화면이 지어내지 않는다)
    const hd2 = mv.heatmapData(events, [], (s: string) => s);
    expect(hd2.rows.every((r: any) => !r.corr)).toBe(true);
  });

  it("위험 큰 순으로 세우되 상관을 맨 위로", () => {
    const hd = mv.heatmapData(events, correlations, (s: string) => s);
    expect(hd.rows[0].name).toBe("172.168.50.142"); // 상관 + 최다
  });
});

describe("★ flat 모드(취약점 히트맵 ㉯) — 구획 없이 심각도 순 한 판", () => {
  // render는 DOM을 만들어 붙이므로, 여기서는 flat 정렬 규칙이 map-view에 실재하는지 소스로 확인한다.
  const src = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "map-view.js"), "utf8");
  it("ctx.flat이면 한 구획에 심각도 순으로 담는다", () => {
    expect(src).toMatch(/ctx && ctx\.flat/);
    expect(src, "flat은 취약점 있는 자산 심각도 순 한 판").toMatch(/취약점 있는 자산 — 심각도 순/);
    // high 먼저, 그다음 진짜 취약점 수 — 취약점 화면의 「오늘 뭐부터」에 맞다.
    expect(src).toMatch(/riskOf\(y\)\.level === "high"\) - \(ctx\.riskOf\(x\)\.level === "high"\)/);
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
