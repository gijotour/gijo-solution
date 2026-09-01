/**
 * assetrules.js — 자산을 **세는 잣대** 공용 부품 (2026-09-01 신설).
 *
 * ■ 왜 만들었나
 *   「SBOM이 없는 자산이 몇 건인가」를 **세 곳이 각자 세고 있었다** —
 *     · 서버 assetcoverage.ts(sbomApplies)  … 스캐너 IP 호스트·인프라 장비를 뺀다
 *     · 화면 sbom.html:712 / inventory.html … 전부 센다
 *   그래서 담당자가 대화창에 「SBOM 없는 자산 알려줘」로 물으면 12건, 같은 순간
 *   📦 화면 배지는 4,812건이었다. **같은 물음에 두 숫자**가 나오면 어느 것도 못 믿는다.
 *
 * ■ ⚠ 왜 서버 잣대를 여기 옮겨 적나 (그리고 그것을 어떻게 지키나)
 *   화면은 서버 함수를 부를 수 없어 **어쩔 수 없이 한 벌 더** 적는다. 그런데 이 저장소는
 *   「같은 것을 여러 곳에 적으면 어긋난다」를 반복해 겪었다 — 그래서 **어긋나면 시험이
 *   깨지게** 못 박았다(server/test/sbomapplies-pair.test.ts). 서버 규칙을 고치면 여기도
 *   같이 고쳐야 시험이 통과한다.
 *
 * ⚠ 규칙을 고칠 때는 **서버 assetcoverage.ts가 원천**이다. 여기를 먼저 고치지 말 것.
 */
(function () {
  /**
   * 이 자산이 SBOM(구성요소 목록) 대상인가.
   *
   * 서버 assetcoverage.ts sbomApplies와 **같은 뜻**이어야 한다:
   *   · `vuln:`으로 시작하는 id — 취약점 스캐너가 들여온 IP 호스트다(소프트웨어 자산이 아니다)
   *   · assetType이 `infra-host` — 방화벽·DB·네트워크 장비
   * 이 둘을 「SBOM 없음」으로 세면 커버리지가 **거짓 결손**으로 가득 찬다
   * (실측 2026-07-19: 방화벽까지 SBOM 결손으로 집계됐다).
   */
  function gijoSbomApplies(a) {
    if (!a) return false;
    if (String(a.id || "").indexOf("vuln:") === 0) return false;
    return a.assetType !== "infra-host";
  }

  /**
   * SBOM 잣대가 **적용되는 자산들** — 세는 것도, 목록도, 일괄 작업도 전부 여기서 시작한다.
   *
   * ⚠⚠ 왜 목록까지 여기서 주나(2026-09-01 3차 검토 [상]): KPI 한 칸만 공용 잣대로 바꾸고
   *   같은 화면의 **필터 칩·드롭다운 건수·일괄 생성**을 옛 잣대로 두었더니, 배지는 12를
   *   말하는데 목록을 펴면 4,888행이 나왔다 — 「같은 물음에 두 숫자」를 화면 밖에서 안으로
   *   옮겼을 뿐이다. **모수를 만드는 함수 하나**를 쓰게 해야 갈릴 수가 없다.
   */
  function gijoSbomTargets(assets) {
    return (assets || []).filter(gijoSbomApplies);
  }

  /** SBOM이 아직 없는 **대상** 자산들 — 목록·일괄 작업이 쓴다. */
  function gijoSbomMissing(assets) {
    return gijoSbomTargets(assets).filter(function (a) {
      return !a.sbomGeneratedAt;
    });
  }

  /** SBOM이 이미 있는 **대상** 자산들. */
  function gijoSbomGenerated(assets) {
    return gijoSbomTargets(assets).filter(function (a) {
      return a.sbomGeneratedAt;
    });
  }

  /**
   * 화면 KPI용 건수.
   * ⚠ 「생성」과 「미생성」은 **같은 모수**에서 나와야 한다 — 한쪽만 고치면 나란히 놓인 두
   *   숫자의 합이 전체와 안 맞아 담당자가 「나머지는 어디 갔나」를 묻게 된다
   *   (sbom.html이 옛날에 겪고 주석으로 못 박아 둔 그 사고를, 2026-09-01에 내가 재발시켰다).
   */
  function gijoSbomMissingCount(assets) {
    return gijoSbomMissing(assets).length;
  }
  function gijoSbomGeneratedCount(assets) {
    return gijoSbomGenerated(assets).length;
  }

  window.gijoSbomApplies = gijoSbomApplies;
  window.gijoSbomTargets = gijoSbomTargets;
  window.gijoSbomMissing = gijoSbomMissing;
  window.gijoSbomGenerated = gijoSbomGenerated;
  window.gijoSbomMissingCount = gijoSbomMissingCount;
  window.gijoSbomGeneratedCount = gijoSbomGeneratedCount;
})();
