// engine/sbomimport.ts — **남이 준 SBOM 파일을 읽는다.**
//
// ■ 왜 (2026-08-22 사장님 지시 · 계획서 중-7 확장)
//   「우리가 AGPL에 걸릴 뻔한 문제를 고객사도 겪는다 → **타사 제품의 SBOM을 우리 제품이 직접
//   점검**하게 만들고 메인 메뉴로 빼자」. 결과에 **「소스 공개 요구」·「상용 라이선스 구매 요구」**
//   같은 **실제로 받게 되는 요구**가 나오게 하라는 것이 지시의 핵심이다.
//
// ■ 방향이 반대다 — 기존 sbom.ts는 **쓰기(내보내기)** 전용이다
//   ⚠ `@cyclonedx/cyclonedx-library`가 이미 의존성인데 **역직렬화가 `// @TODO`로 주석 처리**돼
//     export조차 없다(설계관이 실물 확인). 「의존성에 있으니 파서도 있겠지」로 계획하면 첫날에 막힌다.
//     그래서 JSON.parse + 직접 필드 접근으로 손수 쓴다.
//
// ★ **라이선스가 실리는 자리가 형식마다 다르고, 우리 내보내기 코드는 각각 하나씩만 쓴다.**
//   우리 코드를 보고 파서를 짜면 실제 문서의 대부분을 놓친다(설계관 적발):
//     · SPDX      — `licenseDeclared`(공급사 선언) **와** `licenseConcluded`(조사 확정). 우리는 앞만 쓴다.
//     · CycloneDX — `licenses[].license.id`(SPDX 식별자) · `.name`(이름) · `.expression`(식 전체).
//                   우리 생산 코드는 `.name`만 만든다 — 타사 문서는 `.id`·`.expression`이 훨씬 흔하다.
//   → 다섯 자리를 **전부** 읽고, **어느 자리에서 읽었는지**를 결과에 남긴다.
//
// ⚠ 판정은 하지 않는다 — 등급은 `licenserisk.ts` 한 곳이 매긴다(잣대를 두 벌 두지 않는다).

import { 라이선스모름 } from "./licenserisk";

/** 읽어 낸 부품 한 개. 판정 전 **날것**이다. */
export interface 반입부품 {
  이름: string;
  판: string;
  /** 라이선스 표기 **원문**. 여러 자리에서 나왔으면 AND로 이어 붙인다(뜻을 안 줄인다). */
  라이선스: string;
  /** 어느 자리에서 읽었나 — 근거를 화면이 보여 줄 수 있어야 한다. */
  읽은자리: string[];
  /** 공급사·제조사(있으면). */
  공급사?: string;
  /** purl(package URL) — 있으면 부품을 정확히 가리킨다. */
  purl?: string;
}

export interface 반입결과 {
  형식: "CycloneDX" | "SPDX" | "알수없음";
  형식판?: string;
  /** 문서가 말하는 대상(무엇의 부품표인가). */
  대상?: string;
  부품: 반입부품[];
  /** 사람이 알아야 할 것 — 형식은 맞는데 이상한 자리들. **조용히 넘기지 않는다.** */
  알림: string[];
}

/** 여러 자리에서 읽은 라이선스를 하나로 — **뜻을 줄이지 않는다.**
 *  ⚠ SPDX의 declared와 concluded가 다르면 **둘 다 남긴다.** 하나를 골라 버리면
 *    「조사해 보니 사실은 GPL이더라」(concluded)를 놓치거나, 공급사 선언을 지워 버린다. */
function 라이선스합치기(값들: (string | undefined | null)[]): string {
  const 쓸것: string[] = [];
  for (const v of 값들) {
    const s = String(v ?? "").trim();
    if (!s || 라이선스모름(s)) continue;
    if (!쓸것.includes(s)) 쓸것.push(s);
  }
  return 쓸것.join(" AND ");
}

/** CycloneDX의 licenses[] — **세 형태를 전부** 받는다. */
function cycloneDx라이선스(licenses: unknown): { 값: string; 자리: string[] } {
  const 값들: string[] = [];
  const 자리: string[] = [];
  if (!Array.isArray(licenses)) return { 값: "", 자리 };
  for (const it of licenses) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    // ① 식 전체 — `licenses: [{ expression: "MIT OR Apache-2.0" }]`
    if (typeof o.expression === "string" && o.expression.trim()) {
      값들.push(o.expression.trim());
      if (!자리.includes("expression")) 자리.push("expression");
      continue;
    }
    const lic = o.license as Record<string, unknown> | undefined;
    if (!lic || typeof lic !== "object") continue;
    // ② 정본 식별자 — 가장 좋은 자료
    if (typeof lic.id === "string" && lic.id.trim()) {
      값들.push(lic.id.trim());
      if (!자리.includes("license.id")) 자리.push("license.id");
      continue;
    }
    // ③ 이름 그대로 — 자유 표기다. 판정기가 읽어 준다.
    if (typeof lic.name === "string" && lic.name.trim()) {
      값들.push(lic.name.trim());
      if (!자리.includes("license.name")) 자리.push("license.name");
    }
  }
  return { 값: 라이선스합치기(값들), 자리 };
}

/** 파일 하나를 읽어 부품 목록으로. **형식을 스스로 알아본다.** */
export function sbom읽기(원문: string): 반입결과 {
  const 알림: string[] = [];
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(원문) as Record<string, unknown>;
  } catch (e) {
    return { 형식: "알수없음", 부품: [], 알림: ["JSON으로 읽지 못했습니다 — SPDX(.spdx.json)나 CycloneDX(.json) 형식인지 확인해 주세요."] };
  }
  if (!doc || typeof doc !== "object") {
    return { 형식: "알수없음", 부품: [], 알림: ["내용이 비어 있거나 형식이 아닙니다."] };
  }

  // ── CycloneDX ─────────────────────────────────────────────────────────
  if (doc.bomFormat === "CycloneDX" || Array.isArray(doc.components)) {
    // 상한에 걸려 **안 읽은 것이 몇 개인지** 센다 — 직계 자식이 아니라 **그 아래 전부**다.
    // ⚠ 여기도 깊이를 막는다. 부품이 자기 자신을 품는 망가진 문서가 오면 세다가 스택이 터진다.
    let 너무깊음 = false; // 세다가도 상한에 닿았나 — 그러면 「못 읽은 수」마저 하한이다
    const 안읽은수 = (목록: unknown[], 남은겹 = 64): number => {
      if (남은겹 <= 0) {
        // ⚠ 여기도 **말없는 잘라내기**였다(2026-09-01 재검토 [하]). 64겹에 닿으면 그 아래를
        //   통째로 1로 쳐서 「N개 못 읽었습니다」가 다시 실제보다 적어지는데, 그 사실을
        //   알리는 문장이 없었다 — 이 커밋이 세운 원칙을 이 함수 자신이 어겼다.
        너무깊음 = true;
        return 목록.length;
      }
      let n = 0;
      for (const c of 목록) {
        if (!c || typeof c !== "object") continue;
        n++;
        const 안 = (c as Record<string, unknown>).components;
        if (Array.isArray(안) && 안.length) n += 안읽은수(안, 남은겹 - 1);
      }
      return n;
    };
    const 부품: 반입부품[] = [];
    // ⚠ **중첩을 편다**(2026-09-01). 전에는 맨 위 단계만 셌다 — 「겉만 셌습니다」라고 정직하게
    //   알리기는 했지만, 부품 안에 든 부품도 **똑같이 라이선스 의무를 지운다.** GPL 라이브러리가
    //   한 겹 안에 들어 있다고 의무가 사라지지 않는다. 겉만 세면 검수 결과가 **실제보다 안전해
    //   보인다** — 이것이 이 화면에서 가장 위험한 종류의 틀림이다.
    // ⚠ 깊이 상한을 둔다. 상한에 닿으면 **몇 개를 못 봤는지 말한다** — 조용히 자르면
    //   「전부 봤다」로 읽힌다(말없는 잘라내기 금지).
    const 최대깊이 = 8;
    let 깊이초과 = 0;
    const 펴기 = (목록: unknown[], 깊이: number): Record<string, unknown>[] => {
      const 결과: Record<string, unknown>[] = [];
      for (const c of 목록) {
        if (!c || typeof c !== "object") continue;
        const o = c as Record<string, unknown>;
        결과.push(o);
        const 안 = o.components;
        if (Array.isArray(안) && 안.length) {
          if (깊이 >= 최대깊이) {
            // ⚠ **못 읽은 것은 서브트리 전체다.** 직계 자식만 세면 그 아래 손자·증손자가
            //   빠져 「N개 못 읽었습니다」가 실제보다 **적게** 나온다 — 덜 센 정도를 과소
            //   보고하면 검수 결과가 실제보다 안전해 보인다(2026-09-01 검토관 [중]).
            깊이초과 += 안읽은수(안);
            continue;
          }
          결과.push(...펴기(안, 깊이 + 1));
        }
      }
      return 결과;
    };
    const 맨위 = Array.isArray(doc.components) ? doc.components : [];
    const comps = 펴기(맨위, 1);
    // ★ 안쪽에서 온 것의 수는 **평탄화 결과에서 맨 위 개수를 빼서** 구한다.
    //   재귀 안에서 `중첩에서온것 += 안쪽.length`로 누적하면 **깊이마다 자손이 다시 더해져**
    //   3겹부터 실제 부품 수를 넘는다(실측: a>b>c 3개인데 「맨 위 1 + 안쪽 3」=4,
    //   10겹은 읽은 것 8개인데 「1 + 28」=29). 이 커밋의 목적이 「숫자가 왜 겉보다 많은지
    //   밝힌다」였는데 밝히려던 그 숫자가 틀렸던 것이다(2026-09-01 검토관 [상]).
    //   빼기 한 번이면 정의상 절대 안 어긋난다 — 셈을 두 곳에서 하지 않는다.
    const 중첩에서온것 = comps.length - 맨위.filter((c) => c && typeof c === "object").length;
    for (const c of comps) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const 이름 = String(o.name ?? "").trim();
      if (!이름) continue;   // 이름 없는 항목은 셀 수 없다 — 아래에서 몇 개인지 알린다
      const { 값, 자리 } = cycloneDx라이선스(o.licenses);
      부품.push({
        이름,
        판: String(o.version ?? "").trim(),
        라이선스: 값,
        읽은자리: 자리,
        공급사: typeof o.publisher === "string" ? o.publisher : (o.supplier as Record<string, unknown>)?.name as string | undefined,
        purl: typeof o.purl === "string" ? o.purl : undefined,
      });
    }
    const 이름없음 = comps.length - 부품.length;
    if (이름없음 > 0) 알림.push(`이름이 없는 항목 ${이름없음}개는 세지 못했습니다.`);
    if (!comps.length) 알림.push("부품 목록(components)이 비어 있습니다.");
    // ⚠ 숫자가 왜 겉보다 많은지 밝힌다 — 안 밝히면 「목록엔 12개인데 왜 47개라 하나」가 된다.
    if (중첩에서온것 > 0) {
      const 맨위수 = 맨위.filter((c) => c && typeof c === "object").length;
      알림.push(`부품 안에 든 부품 ${중첩에서온것}개까지 펴서 셌습니다(맨 위 ${맨위수}개 + 안쪽 ${중첩에서온것}개 = ${comps.length}개). 안쪽 부품도 똑같이 라이선스 의무를 지웁니다.`);
    }
    // ⚠ **말없는 잘라내기 금지.** 상한에 걸린 것이 있으면 몇 개인지 말한다.
    if (깊이초과 > 0) {
      알림.push(
        `부품이 ${최대깊이}겹보다 깊게 들어 있어 ${깊이초과}개는 못 읽었습니다 — 이 결과는 그만큼 덜 센 값입니다.` +
          // ⚠ 세는 것조차 상한(64겹)에 걸렸으면 **그 수마저 하한**이다. 안 밝히면
          //   「못 읽은 것이 딱 N개」로 읽힌다 — 이 함수가 세운 원칙을 자기가 어기게 된다.
          (너무깊음 ? " ⚠ 문서가 64겹보다 깊어 **못 읽은 수조차 다 세지 못했습니다** — 실제로는 더 많습니다." : ""),
      );
    }
    return {
      형식: "CycloneDX",
      형식판: typeof doc.specVersion === "string" ? doc.specVersion : undefined,
      대상: ((doc.metadata as Record<string, unknown>)?.component as Record<string, unknown>)?.name as string | undefined,
      부품,
      알림,
    };
  }

  // ── SPDX ──────────────────────────────────────────────────────────────
  if (typeof doc.spdxVersion === "string" || Array.isArray(doc.packages)) {
    const 부품: 반입부품[] = [];
    const pkgs = Array.isArray(doc.packages) ? doc.packages : [];
    for (const p of pkgs) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const 이름 = String(o.name ?? "").trim();
      if (!이름) continue;
      // ★ **두 자리를 다 본다.** concluded(조사해 확정한 것)와 declared(공급사가 선언한 것)는
      //   다를 수 있고, 다르면 그 사실 자체가 중요하다 — 하나를 골라 버리지 않는다.
      const 자리: string[] = [];
      const conc = String(o.licenseConcluded ?? "").trim();
      const decl = String(o.licenseDeclared ?? "").trim();
      if (conc && !라이선스모름(conc)) 자리.push("licenseConcluded");
      if (decl && !라이선스모름(decl)) 자리.push("licenseDeclared");
      const 합 = 라이선스합치기([conc, decl]);
      if (자리.length === 2 && conc !== decl) {
        알림.push(`「${이름}」은 선언(${decl})과 확정(${conc})이 다릅니다 — 둘 다 지켜야 하는 것으로 봤습니다.`);
      }
      부품.push({
        이름,
        판: String(o.versionInfo ?? "").trim(),
        라이선스: 합,
        읽은자리: 자리,
        공급사: typeof o.supplier === "string" ? o.supplier.replace(/^(Organization|Person):\s*/i, "") : undefined,
        purl: (Array.isArray(o.externalRefs) ? o.externalRefs : [])
          .map((r) => (r as Record<string, unknown>))
          .find((r) => r?.referenceType === "purl")?.referenceLocator as string | undefined,
      });
    }
    const 이름없음 = pkgs.length - 부품.length;
    if (이름없음 > 0) 알림.push(`이름이 없는 항목 ${이름없음}개는 세지 못했습니다.`);
    if (!pkgs.length) 알림.push("부품 목록(packages)이 비어 있습니다.");
    // SPDX는 파일 단위 라이선스(files[])도 있지만 부품 판정에는 쓰지 않는다 — 있으면 알린다.
    if (Array.isArray(doc.files) && doc.files.length) {
      알림.push(`파일 단위 항목 ${doc.files.length}개는 이 점검에서 세지 않았습니다(부품 단위로만 봅니다).`);
    }
    return {
      형식: "SPDX",
      형식판: typeof doc.spdxVersion === "string" ? doc.spdxVersion : undefined,
      대상: typeof doc.name === "string" ? doc.name : undefined,
      부품,
      알림,
    };
  }

  return {
    형식: "알수없음",
    부품: [],
    알림: [
      "SPDX도 CycloneDX도 아닌 것 같습니다 — 이 점검은 두 형식의 **JSON**만 읽습니다.",
      "SPDX는 `spdxVersion`·`packages`, CycloneDX는 `bomFormat`·`components`가 있어야 합니다.",
      "태그-값(.spdx)·XML 형식은 아직 못 읽습니다.",
    ],
  };
}
