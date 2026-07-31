// 화면과 화면 사이에 **맥락이 실려 가는가** (2026-07-31 사용자 지적:
//   "스캔 데이터 이후 해당 IP나 호스트를 눌렀을 때 해당 취약점만 나와야 하는데 전체가 보인다")
//
// 실측으로 확인한 두 가지 결함:
//   ① 특정 건을 눌렀는데 **전체 목록**이 열렸다 — 무엇을 눌렀는지 안 실어 보냈다.
//   ② 그때 **열어 둔 탭이 전부 사라졌다** — navigateTo가 앱을 통째로 갈아치운다.
//      담당자가 옆 탭에 걸어 둔 조건과 스크롤이 통째로 날아간다.
//
// 이건 화면 코드라 서버 시험으로는 "동작"을 못 본다. 대신 **약속과 코드가 어긋나지 않는지**를
// 소스로 못 박는다 — 툴팁이 "이 호스트의 취약점"이라고 적혀 있으면 host를 실어야 한다.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";

const PAGES = new URL("../../client/src/renderer/pages/", import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, PAGES), "utf8");
const preload = fs.readFileSync(new URL("../../client/src/preload.ts", import.meta.url), "utf8");

describe("★ 탭 안에서의 이동은 탭을 죽이지 않는다", () => {
  it("preload의 navigateTo가 embed일 때 셸에 탭 열기를 부탁한다", () => {
    // ⚠ nav.js에서 window.gijo.navigateTo를 갈아끼우려 했다가 실패했다 —
    //   contextBridge로 노출한 객체는 렌더러에서 못 고친다(조용히 무시된다).
    //   그래서 판단은 반드시 **preload 안**에 있어야 한다.
    const i = preload.indexOf("navigateTo:");
    expect(i, "navigateTo를 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(0);
    const 본문 = preload.slice(i, i + 900);
    expect(본문, "embed(탭 안) 판단이 없다").toContain("embed=1");
    expect(본문, "셸에 탭 열기를 부탁하지 않는다").toContain("gijo:openTab");
    expect(본문, "로그아웃까지 탭으로 열면 로그인 화면이 탭 안에 갇힌다").toContain("login.html");
  });

  it("nav.js에는 같은 것을 다시 만들지 않는다", () => {
    // 두 곳에서 하면 한쪽만 고쳐 놓고 고쳤다고 믿게 된다.
    const nav = read("nav.js");
    expect(nav.includes("window.gijo.navigateTo ="), "렌더러에서 덮어써도 무시된다 — preload에서 한다").toBe(false);
  });
});

describe("★ 특정 항목을 누르면 그 항목으로 좁혀 간다", () => {
  it("취약점 화면의 '오늘의 조치' 행이 자산·건 키를 실어 보낸다", () => {
    const src = read("vulnscan.html");
    expect(src, "행에 자산 id가 없으면 무엇을 눌렀는지 전할 수 없다").toContain('data-a="${esc(r.assetId)}"');
    expect(src).toContain("asset=${encodeURIComponent(row.dataset.a)}");
  });

  it("조치·승인 화면이 ?asset= 을 읽어 그 자산만 보여준다", () => {
    const src = read("approvals.html");
    expect(src).toContain('q.get("asset")');
    expect(src, "목록만 걸러도 위 숫자가 전체면 무엇을 믿을지 알 수 없다").toContain("scopeAsset ? reviews.filter");
    expect(src, "좁혀진 줄 모르면 '왜 몇 건밖에 없지?'가 된다").toContain("의 취약점만 보는 중");
    expect(src, "전체로 돌아갈 길이 없으면 갇힌다").toContain("rvScopeAll");
  });

  it("취약점 화면이 ?host= 를 읽어 그 호스트를 펼친다", () => {
    const src = read("vulnscan.html");
    expect(src).toContain('.get("host")');
    expect(src, "목록에만 있고 안 펼치면 46개 중에서 또 찾아야 한다").toContain("currentHostId = want");
  });

  it("★ 툴팁이 '이 호스트의 취약점'이라 적었으면 host를 실어야 한다", () => {
    // 약속(툴팁)과 코드가 어긋난 자리였다 — 전체 목록이 열려 툴팁이 거짓이 됐다.
    const src = read("inventory.html");
    const i = src.indexOf("이 호스트의 취약점 보기");
    expect(i, "그 툴팁을 못 찾았다 — 문구가 바뀌었으면 이 시험도 같이 고칠 것").toBeGreaterThan(0);
    const 줄 = src.slice(src.lastIndexOf("\n", i), src.indexOf("\n", i));
    expect(줄, "툴팁은 '이 호스트'라는데 자산 id를 안 싣고 있다").toContain("data-vulns=\"${esc(a.id)}\"");
    expect(src).toContain("vulnscan.html\" + (id && id !== \"1\" ? `?host=");
  });

  it("자산 통합 뷰의 '취약점 화면' 링크도 그 자산을 지목한다", () => {
    const src = read("assethub.html");
    expect(src).toContain('vulnscan.html?host=${encodeURIComponent(r.id)}');
  });

  it("보안제품의 '이 제품 점검'이 제품명을 실어 보낸다", () => {
    const src = read("products.html");
    expect(src, "제품명을 안 실으면 전체 점검 목록이 열린다").toContain('data-open-ops="${esc(p.name)}"');
    expect(src).toContain("opsguide.html\" + (name ? `?product=");
  });

  it("운영 가이드가 ?product= 를 읽어 그 제품 점검만 보여준다", () => {
    const src = read("opsguide.html");
    expect(src).toContain('.get("product")');
    expect(src, "목록만 걸러도 위 KPI가 전체면 무엇을 믿을지 알 수 없다").toContain("renderMaintKpis(items)");
    expect(src, "좁혀진 줄 모르면 '왜 몇 건밖에 없지?'가 된다").toContain("의 점검만 보는 중");
    expect(src, "빠져나올 길이 없으면 그 제품 안에 갇힌다").toContain("opsScopeAll");
  });

  it("★ 자산 목록의 '이 자산의 유지보수 점검'도 실어 보낸다", () => {
    // 여기도 툴팁이 "이 자산의"라고 약속하던 자리다.
    const src = read("inventory.html");
    const i = src.indexOf("이 자산의 유지보수 점검");
    expect(i, "그 툴팁을 못 찾았다").toBeGreaterThan(0);
    const 줄 = src.slice(src.lastIndexOf("\n", i), src.indexOf("\n", i));
    expect(줄).toContain('data-open-ops="${esc(a.name)}"');
  });

  it("AI-BOM의 '견고성 자세히'가 그 자산을 골라 둔 채로 연다", () => {
    expect(read("sbom.html")).toContain('redteam.html?asset=" + encodeURIComponent(asset.id)');
    expect(read("redteam.html"), "레드팀이 ?asset= 을 안 읽으면 실어 보내도 소용없다").toContain('.get("asset")');
  });
});
