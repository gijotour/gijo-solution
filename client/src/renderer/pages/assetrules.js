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

  /** SBOM이 아직 없는 **대상** 자산 수 — 화면 KPI는 이것만 쓴다. */
  function gijoSbomMissingCount(assets) {
    return (assets || []).filter(function (a) {
      return gijoSbomApplies(a) && !a.sbomGeneratedAt;
    }).length;
  }

  window.gijoSbomApplies = gijoSbomApplies;
  window.gijoSbomMissingCount = gijoSbomMissingCount;
})();
