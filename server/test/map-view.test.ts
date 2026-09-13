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

const 화면 = (이름: string) =>
  readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", 이름), "utf8");

/**
 * 함수 **본문만** 잘라 내고 주석을 걷는다 — 소스 감시가 「주석에 남은 글자」로 초록이 나는 것을
 * 막는다(2026-09-14 검토관 [하] 적발: `registered:false`를 본문에서 지우고 주석에만 남겨도
 * 통과하던 자리. 이 한 줄이 지키는 것이 「승인 없는 전사 리포트 구멍」의 뚜껑이라 감시 강도가
 * 곧 그 구멍의 뚜껑 두께다).
 */
function 함수본문(src: string, 머리: string, 길이 = 2000): string {
  const i = src.indexOf(머리);
  if (i < 0) return "";
  return src.slice(i, i + 길이)
    .replace(/\/\*[\s\S]*?\*\//g, "")          // 블록 주석
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");      // 줄 주석(「http://」를 안 건드리게 앞 글자를 본다)
}

// [전-7 2단계 · 시안 §11] vulnscan.html의 vheatCtx()는 registered:false를 **명시**해야 한다 —
// 지우면 ⑥⑦ 칩이 미등록 화면에서도 떠 승인 없는 전사 리포트 구멍이 재현된다.
describe("★ 소스 감시 — vulnscan.html vheatCtx()의 주입 계약(주석은 걷고 본문만 잰다)", () => {
  const src = 화면("vulnscan.html");
  const 본문 = 함수본문(src, "function vheatCtx()");

  it("vheatCtx() **본문**에 registered: false가 있다 — 주석에만 남기면 실패한다", () => {
    expect(본문, "function vheatCtx()를 못 찾았다 — 이름이 바뀌었으면 이 감시도 고쳐라").not.toBe("");
    expect(본문, "vheatCtx()에 registered:false가 없으면 ⑥⑦ 쓰기 칩이 미등록 화면에서도 뜬다(시안 §11)")
      .toMatch(/registered\s*:\s*false/);
  });

  // [2026-09-14 검토관 [중] 적발] flat 모드는 구획이 1개뿐이라 취약점 있는 자산이 200을 넘으면
  // 군집이 **반드시** 걸린다(군집규칙: 총노드>200 && 구획타일수>40). onClusterDetail이 없으면
  // 「+N개 더」 타일이 무반응이 되어 상위 40개 밖 자산이 지도에서 도달 불가가 된다.
  it("vheatCtx() 본문에 onClusterDetail이 있다 — 없으면 「+N개 더」가 무반응이다", () => {
    expect(본문, "flat 모드도 총노드 200을 넘으면 군집이 걸린다 — 고리가 없으면 눌러도 아무 일이 없다")
      // ⚠ 열쇠 이름까지 잰다 — /onClusterDetail/만 쓰면 onClusterDetailXX 같은 오타도 통과한다
      //   (2026-09-14 돌연변이 검증에서 실제로 안 잡혀 좁혔다).
      .toMatch(/onClusterDetail\s*:/);
  });
});

// [2026-09-14 검토관 [중] 적발] 같은 DOM 계약 클래스가 두 화면에서 **다른 색**으로 갈렸다.
// vulnscan은 :root에 --amber:#f0a020을 실제로 정의하므로 var(--amber, #ffe9c4)는 폴백이 안 쓰이고
// #f0a020이 나온다 → 칩 배경 위 대비 4.04로 AA(4.5) 미달. inventory는 --amber-ink 미정의라
// #ffe9c4(7.39)가 나온다. themecolors(토큰+폴백 꼴만 본다)·uireadability(font-size만 본다)
// 어느 쪽도 이 부류를 원리상 못 잡아 사람이 안 보면 그대로 게시된다.
describe("★ DOM 계약 사본 — vulnscan.html의 .mv-* CSS가 inventory.html과 같은 토큰을 쓴다", () => {
  const v = 화면("vulnscan.html");
  const inv = 화면("inventory.html");

  it("칩 배지(.chiptag.appr/.maybe) 글자색이 두 화면 모두 --amber-ink다", () => {
    for (const 파일 of [["vulnscan.html", v], ["inventory.html", inv]] as const) {
      const 줄 = 파일[1].split(/\r?\n/).filter((l) => /^\s*\.chiptag\.(appr|maybe)\s*\{/.test(l));
      expect(줄.length, `${파일[0]}에서 .chiptag.appr/.maybe 두 줄을 못 찾았다`).toBe(2);
      for (const l of 줄) {
        expect(l, `${파일[0]}: 칩 배지 글자색은 --amber-ink여야 한다(--amber는 이 파일이 #f0a020으로 정의해 대비 4.04로 떨어진다)`)
          .toMatch(/color:\s*var\(--amber-ink,/);
      }
    }
  });

  // map-view.js:215-218이 **화면 구분 없이** 모든 h4에 접기 토글을 붙인다 — flat 모드는 자동
  // 접기만 원리상 안 걸릴 뿐, 사람이 제목을 누르면 그 한 구획(=히트맵 전체)이 접힌다.
  it("구획 머리글(.mv-zone h4)이 두 화면 모두 누를 수 있는 자리로 보인다(cursor:pointer + flex)", () => {
    for (const 파일 of [["vulnscan.html", v], ["inventory.html", inv]] as const) {
      const 머리 = 파일[1].split(/\r?\n/).filter((l) => /^\s*\.mv-zone h4\s*\{/.test(l)).join("\n");
      expect(머리, `${파일[0]}: 접기 토글이 붙는 자리인데 cursor:pointer가 없다 — 왜 사라졌는지 알 수 없다`)
        .toMatch(/cursor:\s*pointer/);
      expect(머리, `${파일[0]}: display:flex가 없으면 .fold-cnt{margin-left:auto}가 안 먹어 「펼치려면 클릭」이 제목에 붙어 읽힌다`)
        .toMatch(/display:\s*flex/);
    }
  });
});

// [2026-09-14 검토관 [상]·[중] 적발] 화면 안내(screenguide 「지도」)가 **화면에 없는 표기**를
// 설명하고 실제 점선의 뜻을 반대로 알려주고 있었다. 지도에서 유일한 점선은 관측된 진입 경로다.
// guidance-check·publish-gate 어느 관문도 안내 문장과 SVG 표기를 대조하지 않아 원리상 못 잡는다.
describe("★★ 안내 ↔ 화면 표기 대조 — screenguide 「지도」가 없는 것을 있다고 말하지 않는다", () => {
  const guide = readFileSync(join(__dirname, "..", "src", "engine", "screenguide.ts"), "utf8");
  const 지도안내 = 함수본문(guide, '"지도":', 4000);
  const mvSrc = 화면("map-view.js");
  const inv = 화면("inventory.html");

  it("지도 안내를 찾는다(이 감시의 모집단)", () => {
    expect(지도안내, 'screenguide.ts panels["지도"]를 못 찾았다 — 열쇠가 바뀌었으면 이 감시도 고쳐라').not.toBe("");
    expect(지도안내).toMatch(/보안 지형도/);
  });

  it("간선 배지를 약속하지 않는다 — drawRegisteredEdges는 path 하나만 그리고 배지 글자를 안 만든다", () => {
    // 실제로 그리는 것: path 하나 + class="mv-edge mv-edge-reg". SVG text 요소 0개.
    expect(mvSrc, "등록 간선이 배지를 만들기 시작했으면 이 감시를 고치고 안내를 되살려라")
      .not.toMatch(/createElementNS\([^)]*,\s*"text"\)/);
    expect(지도안내, "화면에 없는 「등록 배지」·「추정 배지」를 안내가 약속하면, 담당자는 배지가 안 뜬 것을 결함으로 읽는다")
      .not.toMatch(/등록 배지|추정 배지/);
  });

  it("붉은 점선을 「관측된 진입」으로 적는다 — 「추정」으로 적으면 실제 공격 신호를 무시하게 된다", () => {
    // 화면 사실: .mv-edge-entry만 stroke-dasharray를 쓴다(= 지도에서 유일한 점선 = 진입).
    expect(inv).toMatch(/\.mv-edge-entry\{[^}]*stroke-dasharray/);
    expect(inv, "등록 간선이 점선이 되면 안내를 다시 쓰고 이 감시도 고쳐라").toMatch(/\.mv-edge-reg\{(?![^}]*dasharray)[^}]*\}/);
    expect(지도안내, "점선의 뜻이 안내에 「진입·관측」으로 적혀 있어야 한다").toMatch(/붉은 점선[^·]*진입|점선 화살표=진입/);
    expect(지도안내, "지도는 점수로 추정해 선을 긋지 않는다 — 그렇게 적으면 거짓 안내다")
      .toMatch(/추정해 그리는 선은 없습니다/);
  });

  // 바로 위 :1066-1068 주석이 「접은 구역은 **어디서 여는지** 반드시 안내한다」를 못 박아 뒀다.
  it("구획 자동 접기가 코드에 있으면 안내도 그것을 적는다(기본 동작 변화는 반드시 안내)", () => {
    const 자동접기있음 = /폴드상태 === null && 정렬\.length > 3/.test(mvSrc);
    expect(자동접기있음, "자동 접기 규칙이 사라졌으면 이 감시와 안내를 함께 고쳐라").toBe(true);
    expect(지도안내, "첫 화면에 동네가 하나만 보이는 이유를 ⓘ가 답하지 못하면 담당자는 기능이 사라진 줄 안다")
      .toMatch(/구획 제목을 누르면/);
  });
});

// [2026-09-14 검토관 [하]·[중] 적발] 방패 타일과 방패 상세판이 「연결」을 서로 다른 조건으로
// 말하던 자리 + 시안 §4 참조코드 1045·1075의 「보호 범위」 빈 자리 줄이 빠져 있던 자리.
describe("★ 방패 상세판 — 「연결」 잣대는 assetId 하나 · 못 그리는 것은 빈 자리로 밝힌다", () => {
  it("assetId는 있는데 assetName이 비면(연결된 자산이 지워짐) 「등록하면 나타납니다」가 아니다", () => {
    const html = mv.shieldDetailHtml("product", { id: "p1", name: "방화벽-A", category: "방화벽", assetId: "a9", docs: [] });
    // 「연결 자산」 칸만 잘라 본다 — 아래 「보호 범위」 칸에도 같은 문구가 있어 파일 전체로 재면 헛돈다.
    const 연결칸 = (html.match(/연결 자산<\/div>([\s\S]*?)<\/div>/) || [])[1] || "";
    expect(연결칸, "타일은 assetId로 「연결됨」이라 말하는데 상세판이 「연결 안 됨」이라 말하면 정반대다")
      .not.toMatch(/등록하면 나타납니다/);
    expect(연결칸).toMatch(/연결된 자산을 찾을 수 없습니다/);
  });

  it("assetId가 아예 없으면 「등록하면 나타납니다」", () => {
    const html = mv.shieldDetailHtml("product", { id: "p2", name: "IPS-B", category: "IPS", docs: [] });
    const 연결칸 = (html.match(/연결 자산<\/div>([\s\S]*?)<\/div>/) || [])[1] || "";
    expect(연결칸).toMatch(/등록하면 나타납니다/);
    expect(연결칸).not.toMatch(/연결된 자산을 찾을 수 없습니다/);
  });

  it("보안제품 상세판에 「보호 범위」 빈 자리(.mv-noedge)가 **연결이 있을 때도** 있다(시안 §4:1075)", () => {
    const 연결됨 = mv.shieldDetailHtml("product", { id: "p3", name: "방화벽-C", category: "방화벽", assetId: "a1", assetName: "web-01", docs: [] });
    expect(연결됨, "이 줄이 없으면 담당자는 그 한 자산이 이 제품이 지키는 전부라고 읽는다 — 안내도 이 자리를 가리킨다")
      .toMatch(/보호 범위[^<]*<\/div><span class="mv-noedge">/);
  });

  it("자산 상세판에도 「보호 범위」 빈 자리가 있다(시안 §4:1045) — ctx.products가 주입됐을 때", () => {
    const ctx = {
      activeFindings: () => [],
      riskOf: () => ({ level: "low", label: "양호", kev: false }),
      products: [{ id: "p1", name: "방화벽-A", assetId: "a1" }],
      registered: true,
    };
    const html = mv.detailHtml({ id: "a1", name: "web-01", owner: "보안팀", findings: [] }, ctx);
    expect(html).toMatch(/보호 범위[^<]*<\/div><span class="mv-noedge">/);
  });
});

// [2026-09-14 검토관 [중] 적발] 구획 접기 토글이 공격경로 오버레이를 조용히 지웠다 —
// renderZones의 container.innerHTML=""가 .mv-overlay까지 지우는데 render()는 등록 간선만
// 되살린다(호출자의 drawPaths는 안 불린다). 시안 §3이 막으려던 사고의 거울상.
describe("★ 접기 재렌더가 호출자 층(공격경로·선택 테두리)을 되살릴 길을 준다", () => {
  const mvSrc = 화면("map-view.js");
  const inv = 화면("inventory.html");
  const 토글 = 함수본문(mvSrc, 'h4.addEventListener("click"', 1400);

  it("map-view는 접기 재렌더 뒤 ctx.onRerender()를 부른다", () => {
    expect(토글, "고리가 없으면 🎯를 켠 채 구획을 접었다 펴면 화살표가 사라지고 토글을 두 번 눌러야 돌아온다")
      .toMatch(/ctx\.onRerender/);
  });

  it("같은 재렌더에서 선택 테두리(.mv-sel)를 되찾는다 — 상세판과 어긋나지 않게", () => {
    expect(토글).toMatch(/mv-sel/);
  });

  it("inventory가 그 고리로 공격경로를 다시 그린다", () => {
    expect(inv, "onRerender를 안 주면 map-view가 부를 곳이 없다")
      .toMatch(/onRerender\(\)\s*\{[^}]*mapPathsOn[^}]*drawPaths/);
  });
});
