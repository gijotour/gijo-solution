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

// [전-7 2단계 · 2026-09-14 · 시안 mockups/asset-graph-v2/시안.html §3] 하드닝 대상(host만
// 있고 assetId가 없다)을 자산과 같은 대역 셈법으로 놓는다. 두 함수가 갈리면 같은 /24인데
// 구획이 두 개로 쪼개진다.
describe("★ 호스트구획열쇠 — 자산 구획열쇠와 정확히 같은 셈법(시안 §3)", () => {
  it("호스트구획열쇠(IP) === 구획열쇠({ip:IP}) — 갈리면 안 된다", () => {
    expect(mv.호스트구획열쇠("192.0.2.10")).toBe(mv.구획열쇠({ ip: "192.0.2.10" }));
    expect(mv.호스트구획열쇠("203.0.113.5")).toBe(mv.구획열쇠({ ip: "203.0.113.5" }));
    expect(mv.호스트구획열쇠("192.0.2.10")).toBe("192.0.2.x 대역");
  });

  it("IP 꼴이 아니면(한글 라벨·빈 값) 기타 — 대역 미상", () => {
    expect(mv.호스트구획열쇠("코어 스위치")).toMatch(/대역 미상/);
    expect(mv.호스트구획열쇠("")).toMatch(/대역 미상/);
    expect(mv.호스트구획열쇠(undefined)).toMatch(/대역 미상/);
  });
});

// [전-7 2단계 · 시안 §5] 총노드(자산+방패)>200 && 구획 안 타일수>40이면 그 구획을 군집한다.
// 렌더 배치 규칙 하나 — 무엇이 위험한지는 안 바꾸고 몇 개를 개별 타일로 그릴지만 정한다.
describe("★ 군집규칙 — 총노드>200 && 구획타일수>40 (경계 3점, 시안 §5)", () => {
  it("경계값 — 199/201 · 40/41", () => {
    expect(mv.군집규칙(199, 41), "총노드가 200을 못 넘으면 타일이 많아도 군집 안 함").toBe(false);
    expect(mv.군집규칙(201, 41), "둘 다 넘으면 군집").toBe(true);
    expect(mv.군집규칙(201, 40), "총노드는 넘어도 구획 타일이 40을 안 넘으면 군집 안 함").toBe(false);
  });
});

// [전-7 2단계 · 시안 §2·§11] 자산 상세판 칩 6종 — ①③④⑤⑥⑦(②는 예외표 재사용, 새 줄 아님).
// ⑥⑦(쓰기 칩)은 ctx.registered일 때만 뜬다 — 미등록 화면(vulnscan)에서 승인 없는 전사
// 리포트가 생기는 구멍을 막는 스위치(시안 §11 검토관 [상] 3차 적발).
describe("★★ chipsForAsset — ⑥⑦은 ctx.registered 게이팅 + 문장은 등록 이름(a.name)", () => {
  const ctxOf = (registered: boolean) => ({ registered, activeFindings: (x: any) => x.findings || [] });
  const asset = { id: "a1", name: "192.0.2.11", displayName: "web-edge-01", owner: "보안팀", findings: [] };

  it("registered:false — ⑥(조치 요청서)·⑦(취약점 리포트)이 없다", () => {
    const rows = mv.chipsForAsset(asset, ctxOf(false));
    expect(rows.some((r: any) => r.text.includes("조치 요청서 만들어줘"))).toBe(false);
    expect(rows.some((r: any) => r.text.includes("취약점 리포트 만들어줘"))).toBe(false);
    // ①④⑤는 registered 여부와 무관하게 항상 있다(읽기전용이라 위험이 안 바뀐다).
    expect(rows.some((r: any) => r.text.includes("취약점만 보여줘"))).toBe(true);
    expect(rows.some((r: any) => r.text.includes("재스캔 상태 알려줘"))).toBe(true);
    expect(rows.some((r: any) => r.text.includes("공격 경로 보여줘"))).toBe(true);
  });

  it("registered:true — ⑥⑦이 있다", () => {
    const rows = mv.chipsForAsset(asset, ctxOf(true));
    expect(rows.some((r: any) => r.text.includes("조치 요청서 만들어줘"))).toBe(true);
    expect(rows.some((r: any) => r.text.includes("취약점 리포트 만들어줘"))).toBe(true);
  });

  it("★★★ 표시 이름(displayName)이 등록 이름(name)과 달라도 ⑥⑦ 문장은 a.name이다 — " +
    "dispatcher.ts:2024 listAssets().find가 a.name/a.id만 보기 때문(시안 §11)", () => {
    const rows = mv.chipsForAsset(asset, ctxOf(true));
    const 요청서 = rows.find((r: any) => r.text.includes("조치 요청서 만들어줘"));
    const 리포트 = rows.find((r: any) => r.text.includes("취약점 리포트 만들어줘"));
    expect(요청서, "⑥ 칩이 있어야 한다").toBeTruthy();
    expect(리포트, "⑦ 칩이 있어야 한다").toBeTruthy();
    // asset.name="192.0.2.11" · asset.displayName="web-edge-01" — 표시 이름을 썼다면
    // "web-edge-01 조치 요청서 만들어줘"가 됐을 것이다. 등록 이름이어야 한다.
    expect(요청서!.text).toBe("192.0.2.11 조치 요청서 만들어줘");
    expect(리포트!.text).toBe("192.0.2.11 취약점 리포트 만들어줘");
    // ⚠ 구현 중 수기 돌연변이 검증: chipsForAsset의 등록이름을 표시이름(a.displayName||a.name)
    // 으로 되돌려 이 시험을 실행하면 위 두 expect가 "web-edge-01 …"을 받아 빨강이 됨을 확인했다
    // (검증 후 원복). CI가 소스를 자동으로 변형하지는 않는다 — stash 없이 손으로 확인한 절차다.
  });

  it("② 칩(담당자 배정)은 미조치>0 && 담당없음일 때만, 문구는 예전 그대로(예외표 재사용)", () => {
    const 미배정 = { id: "a2", name: "192.0.2.12", displayName: "db-01", owner: null, findings: [{ severity: "high", state: "active" }] };
    const rows = mv.chipsForAsset(미배정, ctxOf(false));
    const 담당자 = rows.find((r: any) => r.text.includes("취약점 담당자 배정해줘"));
    expect(담당자, "미조치가 있고 담당이 없으면 ② 칩이 있어야 한다").toBeTruthy();
    expect(담당자!.text).toBe("db-01 취약점 담당자 배정해줘"); // 표시 이름 그대로(예전과 같다)
    expect(담당자!.badge).toBe("maybe");
    // 담당이 있으면 ②는 안 뜬다(기존 조건 불변).
    const rows2 = mv.chipsForAsset(asset, ctxOf(false)); // asset.owner = "보안팀"
    expect(rows2.some((r: any) => r.text.includes("담당자 배정해줘"))).toBe(false);
  });
});

// [전-7 2단계 · 시안 §11] vulnscan.html(B 소유)은 registered:false를 **명시**해야 한다 —
// 지우면 ⑥⑦ 칩이 미등록 화면에서도 떠 승인 없는 전사 리포트 구멍이 재현된다. A는 이 파일을
// 소유하지 않으므로 여기서는 소스 감시(문자열 존재)만 잰다 — 파일 소유는 넘어가지 않는다.
describe("★ 소스 감시 — vulnscan.html의 vheatCtx()가 registered:false를 명시한다(B의 파일)", () => {
  it("vulnscan.html에 registered: false가 있다", () => {
    const src = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "vulnscan.html"), "utf8");
    expect(src, "vheatCtx()에 registered:false가 없으면 ⑥⑦ 쓰기 칩이 미등록 화면에서도 뜬다(시안 §11)")
      .toMatch(/registered\s*:\s*false/);
  });
});
