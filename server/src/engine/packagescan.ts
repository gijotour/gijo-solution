// engine/packagescan.ts — 장비에서 **설치된 패키지 목록을 직접 읽어** SBOM을 채운다.
//
// ★ 왜 만들었나 (2026-08-04 파트너 검토 의견 · 계획서 중-7)
//   지적: "SBOM을 Tenable 기반으로 만든다면 개선이 필요하다. Tenable은 CPE만 기준이라
//   정보가 제한된다. SBOM에는 Package나 Library가 들어가야 한다."
//
//   확인해 보니 **맞는 지적이었다.** 스캐너로 들어온 호스트의 구성요소를 만드는 코드
//   (vulnscan.ts:424~431)는 `meta.os` 한 줄을 쪼개 **배포판 1개 + 커널 1개**를 넣을 뿐이고
//   버전·라이선스는 `-`다. 호스트 한 대의 SBOM에 부품이 두 개인 셈이다.
//
//   고객이 제안한 방식(Audit 파일을 장비에서 돌려 패키지를 긁어 오기)에 필요한 것은
//   **원격에서 읽기 전용 명령을 돌리는 길**인데, 우리는 이미 갖고 있다(hardeningscan.ts).
//   그래서 이 파일은 **새 커넥터가 아니라 있는 길에 명령을 더 태우는 것**이다.
//
// ■ 지키는 것
//   ① **읽기 전용 고정 명령만.** 사용자 입력을 셸에 넣지 않는다(하드닝 점검과 같은 계약).
//   ② **파싱은 코드가 한다 — LLM에 맡기지 않는다.** 목록 파싱은 정확해야 하고 정확할 수 있다.
//      7B에 1,500줄짜리 패키지 목록을 주면 반드시 몇 줄을 흘린다(반복 실측된 원칙).
//      AI는 "이 부품에 어떤 위험이 있나"를 설명하는 자리에 쓴다.
//   ③ **출처를 적는다**(from: "package"). 스캐너 추정치와 실제 수집을 섞지 않는다.
//   ④ **못 읽으면 못 읽었다고 말한다.** 빈 목록을 "부품 없음"으로 기록하지 않는다.
import type { RunFn } from "./hardeningscan";
import type { AssetComponent } from "./assets";
// ⚠ 「라이선스를 아는가」 잣대는 **licenserisk 한 곳**을 쓴다(2026-08-22 검토관).
//   여기서는 `c.license !== "-"`로, 화면(sbom.html)에서는 NOASSERTION·unknown까지 미상으로 세어
//   **두 잣대가 서로 달랐다.** 지금은 rpm/deb 수집이 NOASSERTION을 안 만들어 안 터지지만,
//   타사 SBOM 반입이 붙으면 그 값이 거의 반드시 들어온다 — 그날 대화창은 「512개 안다」,
//   화면은 「미상 400」이라고 서로 다른 말을 하고 담당자는 둘 다 못 믿게 된다.
import { 라이선스모름 } from "./licenserisk";

/** 장비 종류 — 어떤 명령으로 읽을지 가른다. */
export type 장비종류 = "rpm" | "deb" | "windows";

/**
 * 패키지 목록을 읽는 **고정 명령**.
 *
 * ⚠ 전부 읽기(query)만 한다. 설치·삭제·변경 명령은 여기 들어올 수 없다 —
 *   `안전한명령인가()`가 시험으로 막는다.
 * ⚠ 구분자는 탭이다. 패키지 이름·라이선스에 공백이 흔해서 공백으로 나누면 깨진다.
 */
export const 수집명령: Record<장비종류, string> = {
  // %{LICENSE}까지 한 번에 — 라이선스는 SBOM의 핵심 칸인데 스캐너는 안 준다.
  rpm: "rpm -qa --qf '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{LICENSE}\\n'",
  // dpkg-query는 라이선스를 안 준다 — 데비안은 /usr/share/doc/<pkg>/copyright에 적는다.
  // 그래서 아래 데비안라이선스명령으로 **두 번째 읽기**를 해 채운다(2026-08-05).
  deb: "dpkg-query -W -f='${Package}\\t${Version}\\t\\n'",
  // 설치 목록은 레지스트리에 있다. wmic product는 **MSI 재구성을 유발**해 쓰지 않는다(느리고 위험).
  // ⚠ UTF-8 출력을 **명령 자신이** 지정한다(2026-08-06 A/B 실증). 로컬 실행기는 chcp 65001을
  //   켜 주지만 원격 SSH 윈도우는 우리가 코드페이지를 못 만진다 — 한국어 Windows의 기본
  //   CP949로 나오면 한글 이름이 깨진다(이 PC 실측: chcp 없이 돌리니 189줄 중 7줄 깨짐,
  //   -Begin 블록으로 UTF-8 지정 후 0줄·「팟플레이어-64비트」 온전).
  //   세미콜론은 안전규칙 ③이 막으므로 ForEach-Object -Begin 블록을 쓴다(파이프라인 안이라 규칙과 공존).
  windows:
    'powershell -NoProfile -Command "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object DisplayName | ForEach-Object -Begin { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } -Process { $_.DisplayName + [char]9 + $_.DisplayVersion + [char]9 + $_.Publisher }"',
};

/**
 * 데비안 계열 라이선스 채우기 (2026-08-05, 계획서 중-7).
 *
 * ★ 왜 필요했나 — **실측이 시켰다.** 운영 데이터의 부품 844개 중 **789개가 장비에서 직접 읽은
 *   것**인데 라이선스가 전부 "-"였다. 파서가 틀린 게 아니라 `dpkg-query`가 라이선스 칸을
 *   아예 안 주기 때문이다(데비안 정책상 라이선스는 copyright 파일에 있다).
 *   라이선스는 **법무가 보는 칸**이라 비워 두면 SBOM을 내보내는 뜻이 절반 사라진다.
 *
 * ■ 이 명령이 안전한 이유
 *   · `grep -m1`이라 파일당 **첫 줄 하나만** 읽는다 — 출력이 패키지 수를 넘지 않는다.
 *   · 와일드카드는 셸이 펴지만 **사용자 입력이 들어갈 자리가 없다**(고정 상수).
 *   · 읽기 전용이고 `안전한명령인가()`가 시험으로 다시 검사한다.
 *
 * ⚠ `2>/dev/null`을 **붙이지 않는다.** 처음엔 붙였는데 `안전한명령인가()`가 막았다 —
 *   규칙 ③(파일 덮어쓰기 `>` 금지)에 걸린 것이다. 그물이 제 일을 했고, 규칙을 느슨하게
 *   푸는 대신 명령에서 뺐다. 없는 파일에 대한 하소연은 stderr로 가고 우리는 stdout만 쓴다.
 *
 * ■ 못 읽는 경우가 있다(정직하게 비워 둔다)
 *   · copyright가 DEP-5 형식이 아니면 `License:` 줄이 없다(오래된 패키지에 흔하다).
 *   · 그런 패키지는 "-"로 남는다 — **추측해서 채우지 않는다.**
 */
export const 데비안라이선스명령 =
  "grep -m1 -H '^License:' /usr/share/doc/*/copyright";

/** 라이선스 칸 길이 상한. 화면 막대 이름·표 한 칸에 들어가야 한다. */
export const 라이선스최대길이 = 60;

/**
 * 라이선스 문자열을 칸에 맞게 다듬는다 — **자를 땐 잘랐다고 표시한다**.
 *
 * ⚠ **rpm·deb 두 길이 같은 규칙을 보게** 여기 하나로 모았다(2026-08-06 실측).
 *   deb 쪽에만 상한을 두고 rpm 쪽엔 두지 않았더니, 진짜 AlmaLinux 9 패키지를 읽었을 때
 *   glibc의 라이선스가 **571자 그대로** 들어왔다("LGPL-2.1-or-later AND SunPro AND …"가
 *   스물몇 개 이어진 SPDX 식이다). 그대로 두면 SBOM 화면 막대 이름이 571자가 되고 표가 깨진다.
 *   한쪽에만 규칙을 두면 반드시 다른 쪽이 샌다 — 그래서 함수로 묶고 양쪽이 이것만 부른다.
 * ⚠ **뜻을 바꾸며 줄이지 않는다.** 예전에 `A and B`에서 앞만 취한 적이 있는데, 「and」는
 *   둘 다 지켜야 한다는 뜻이라 한쪽만 적으면 뜻이 뒤집힌다(`OpenSSL and SSLeay` → `OpenSSL`).
 *   그래서 뜻으로 자르지 않고 **길이로만** 자르며, 잘렸다는 표시(…)를 반드시 남긴다.
 *   라이선스 칸은 법무가 보는 자리다.
 */
export function 라이선스다듬기(값: string): string {
  const s = String(값 ?? "").trim();
  if (s.length <= 라이선스최대길이) return s;
  return s.slice(0, 라이선스최대길이).trim() + "…";
}

/**
 * `/usr/share/doc/<pkg>/copyright:License: GPL-2+` 꼴을 {패키지 → 라이선스}로.
 * ⚠ 경로에서 패키지 이름을 뽑는다 — 파일 이름(copyright)이 아니라 **그 위 폴더**다.
 */
export function 데비안라이선스파싱(out: string): Record<string, string> {
  const 표: Record<string, string> = {};
  for (const line of String(out ?? "").split(/\r?\n/)) {
    const m = line.match(/^\/usr\/share\/doc\/([^/]+)\/copyright:\s*License:\s*(.+)$/);
    if (!m) continue;
    const 이름 = m[1].trim();
    // 다듬기 규칙은 라이선스다듬기() 하나뿐 — rpm 쪽과 갈리지 않게(위 주석 참고).
    const 값 = 라이선스다듬기(m[2]);
    if (!이름 || !값) continue;
    if (!표[이름]) 표[이름] = 값;   // 먼저 나온 것을 남긴다(grep -m1이라 파일당 하나뿐)
  }
  return 표;
}

/**
 * 읽은 라이선스를 부품에 채운다. **이미 아는 것은 덮지 않는다** — rpm이 준 값이 더 정확하다.
 * 못 찾은 것은 "-" 그대로 둔다(지어내지 않는다).
 */
export function 라이선스채우기(부품: AssetComponent[], 표: Record<string, string>): AssetComponent[] {
  return (부품 ?? []).map((c) => {
    if (!라이선스모름(c.license)) return c;
    const v = 표[c.name];
    return v ? { ...c, license: v } : c;
  });
}

/** 어떤 장비인지 알아내는 **판별 명령**(이것도 읽기 전용). */
/**
 * ⚠ **검사기를 통과하지 못하는 유일한 예외**다(2026-08-05 검토가 짚어 명시).
 *   `>`·`&&`·`||`가 들어 있어 `안전한명령인가()`는 이것을 거부한다 — 그 규칙은
 *   「셸이 해석하는 것 금지」이고 이 명령은 그 문법 자체가 본질이기 때문이다.
 *
 *   그래도 안전한 근거: ① 고정 상수라 사용자 입력이 낄 자리가 없다 ② `command -v`(조회)와
 *   `echo`(출력)뿐이고 `>`는 /dev/null 버리기다 ③ 무엇도 바꾸지 않는다.
 *   ⚠ export 하지 않는다 — 밖에서 조립해 쓰지 못하게. 대신 여기 적어 다음 사람이 알게 한다.
 *   시험(packagescan.test.ts)은 이 예외를 **알고 있는 상태로** 나머지를 검사한다.
 */
const 판별명령 = "(command -v rpm >/dev/null && echo rpm) || (command -v dpkg-query >/dev/null && echo deb) || echo unknown";

/**
 * ★ 이 명령이 정말 **읽기만** 하는가. 시험이 이 함수로 수집명령 전부를 검사한다.
 *
 * ⚠ "우리가 짰으니 안전하다"는 근거가 아니다. 이 파일은 담당자 장비에 원격으로 명령을
 *   보내는 자리다 — 실수로 쓰기 명령이 하나 섞이면 고객 장비가 바뀐다.
 */
export function 안전한명령인가(cmd: string): boolean {
  const c = String(cmd ?? "");
  // ① 무엇을 바꾸는 동사가 있으면 안 된다.
  const 위험동사 = /\b(rm|mv|dd|mkfs|chmod|chown|kill|shutdown|reboot|systemctl|service|yum|dnf|apt|apt-get|pip|npm|nc|curl|wget|Remove-|Set-|New-|Stop-|Start-|Restart-|Install-|Uninstall-)\b/i;
  if (위험동사.test(c)) return false;
  // ② 명령 치환 — 다른 명령을 몰래 실행시키는 길.
  if (/\$\(|`/.test(c)) return false;
  // ③ 명령 이어붙이기·파일 덮어쓰기.
  if (/;|&&|\|\||>/.test(c)) return false;
  // ④ 파이프는 **PowerShell -Command 안에서만** 허용한다. 윈도우 설치 목록은 파이프가 본질이고
  //    그 안은 PowerShell이 해석하지 셸이 해석하지 않는다. 리눅스 명령에 파이프가 생기면 막는다.
  if (/\|/.test(c) && !/^powershell\s+-NoProfile\s+-Command\s+"/.test(c)) return false;
  return true;
}

/**
 * ⚠ **이 검사기가 진짜 방패는 아니다.** 진짜 방패는 `수집명령`이 **고정 상수**라는 것이다 —
 *   사용자 입력이 명령에 들어갈 길이 아예 없다. 이 검사기는 나중에 누군가(나를 포함해)
 *   명령을 손볼 때 실수를 잡는 **두 번째 그물**이다.
 *   실제로 처음 짤 때 이 그물이 내 명령을 막았고(`%{NAME}`의 중괄호), 그때 규칙을
 *   "punctuation 전부 금지"에서 "셸이 해석하는 것만 금지"로 정확하게 고쳤다.
 */

/** 판별 결과를 장비종류로. 못 가리면 null(윈도우는 이 명령이 아예 안 도므로 따로 본다). */
export function 장비종류판별(out: string): 장비종류 | null {
  const t = String(out ?? "").trim().toLowerCase();
  if (t === "rpm") return "rpm";
  if (t === "deb") return "deb";
  return null;
}

/**
 * 명령 출력을 구성요소 목록으로. **탭으로 나눈다.**
 *
 * ⚠ 이름에 공백이 흔하다("Microsoft Visual C++ 2015 Redistributable"). 공백으로 나누면
 *   한 부품이 여러 개로 쪼개져 **부품 수가 부풀려진다** — SBOM에서 그건 거짓말이다.
 */
export function 패키지파싱(종류: 장비종류, out: string): AssetComponent[] {
  const 결과: AssetComponent[] = [];
  const 본이름 = new Set<string>();
  for (const line of String(out ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    // ⚠ **줄 전체를 trim한 뒤 나누면 안 된다.** 앞칸이 비어 있을 때(`\t1.0\tMIT`) 앞 탭이
    //   사라져 **버전이 이름 자리로 밀려든다**. 시험이 이걸 잡았다 — 이름 없는 줄이
    //   "1.0"이라는 부품이 됐다. 나눈 **뒤에** 칸마다 다듬는다.
    const [name = "", version = "", 셋째칸 = ""] = line.split("\t").map((s) => s.trim());
    if (!name) continue;
    // 같은 패키지가 아키텍처별로 두 번 나오는 일이 있다(i686/x86_64) — 이름+버전으로 한 번만.
    const 열쇠 = `${name}@${version}`;
    if (본이름.has(열쇠)) continue;
    본이름.add(열쇠);
    // ★ 셋째 칸의 **뜻이 장비마다 다르다**(2026-08-06 실장비 실증에서 잡음).
    //   rpm은 %{LICENSE}, 윈도우 설치 목록은 **Publisher(제조사)**다. 같은 칸에 넣었더니
    //   이 PC 실측 189개 전부 회사 이름이 라이선스로 저장됐고, 요약문이 "라이선스를 아는
    //   것은 189개"라고 거짓을 말했다. 회사 이름은 라이선스가 아니다 — 칸을 가른다.
    const 윈도우 = 종류 === "windows";
    결과.push({
      name,
      version: version || "-",
      // ⚠ 라이선스를 못 읽는 장비가 있다(데비안·윈도우). 모르는 것을 "-"로 두고
      //   **아는 척하지 않는다**. SBOM 라이선스 칸은 법무가 보는 칸이다.
      // ⚠ 길이는 deb 쪽과 **같은 규칙**으로 다듬는다 — rpm은 SPDX 식이 통째로 오는 일이
      //   흔하다(진짜 AlmaLinux 9 glibc = 571자, 2026-08-06 실측).
      license: 윈도우 ? "-" : 라이선스다듬기(셋째칸) || "-",
      // ⚠ 제조사는 **자르지 않는다**(2026-08-06 검토 #11). 처음엔 라이선스와 같은 60자 규칙을
      //   물렸는데, 그 상한의 근거는 "라이선스 **막대 이름**이 표를 깨뜨린다"였다 — 제조사 칸의
      //   폭 예산과 무관하다. 게다가 잘림 표시(…)가 SPDX supplier·CycloneDX publisher 같은
      //   표준 산출물에 그대로 실려 하류 도구의 조직명 대조를 어긋나게 한다. 화면은 CSS
      //   말줄임이 알아서 줄인다(원문은 title로 보임) — 저장은 원문 그대로가 정직하다.
      ...(윈도우 && 셋째칸 ? { publisher: 셋째칸 } : {}),
      from: "package",
    });
    if (종류 === "windows" && 결과.length >= 3000) break; // 터무니없이 길면 자른다(아래에서 밝힌다)
  }
  return 결과;
}

export interface 수집결과 {
  ok: boolean;
  종류: 장비종류 | null;
  부품: AssetComponent[];
  /** 담당자에게 그대로 보여 줄 한 줄. 실패 이유도 여기에 적는다. */
  말: string;
}

/**
 * 한 장비에서 패키지를 읽는다. **실패를 성공처럼 만들지 않는다.**
 *
 * @param run  hardeningscan의 targetRunner(t) — 원격이면 SSH, local이면 호스트
 * @param 윈도우  대상이 윈도우인지(판별 명령이 리눅스 전용이라 미리 알려 준다)
 */
export async function 패키지수집(run: RunFn, 윈도우 = false): Promise<수집결과> {
  let 종류: 장비종류 | null = 윈도우 ? "windows" : null;
  if (!종류) {
    const 판별 = await run(판별명령);
    종류 = 장비종류판별(판별.out);
    if (!종류) {
      return {
        ok: false, 종류: null, 부품: [],
        말: "패키지 관리자를 찾지 못했습니다(rpm·dpkg 둘 다 없음). 이 장비는 목록을 읽을 수 없습니다 — **부품이 없다는 뜻이 아닙니다.**",
      };
    }
  }
  const cmd = 수집명령[종류];
  const r = await run(cmd);
  if (r.code !== 0 && !r.out.trim()) {
    return {
      ok: false, 종류, 부품: [],
      말: `패키지 목록을 읽지 못했습니다(${종류}). ${r.err ? `사유: ${r.err.slice(0, 120)}` : "접속·권한을 확인해 주세요."} — **부품이 없다는 뜻이 아닙니다.**`,
    };
  }
  let 부품 = 패키지파싱(종류, r.out);
  if (부품.length === 0) {
    return { ok: false, 종류, 부품: [], 말: `명령은 돌았는데 읽은 부품이 0개입니다(${종류}). 출력 형식이 예상과 다를 수 있습니다 — 확인이 필요합니다.` };
  }
  // 데비안 계열은 라이선스를 한 번 더 읽어 채운다(2026-08-05, 중-7).
  // ⚠ 실패해도 수집 자체는 성공이다 — 라이선스는 부가 정보고, 못 읽으면 "-"로 남긴다.
  let 라이선스보탬 = 0;
  if (종류 === "deb") {
    try {
      const lr = await run(데비안라이선스명령);
      const 표 = 데비안라이선스파싱(lr.out);
      const 전 = 부품.filter((c) => !라이선스모름(c.license)).length;
      부품 = 라이선스채우기(부품, 표);
      라이선스보탬 = 부품.filter((c) => !라이선스모름(c.license)).length - 전;
    } catch (e) { /* 못 읽어도 목록은 살린다 */ }
  }
  const 라이선스없음 = 부품.filter((c) => 라이선스모름(c.license)).length;
  return {
    ok: true, 종류, 부품,
    말:
      `${종류} 패키지 **${부품.length}개**를 읽었습니다.` +
      (라이선스보탬 > 0 ? ` copyright 파일에서 라이선스 ${라이선스보탬}개를 더 읽었습니다.` : "") +
      // 윈도우는 설치 목록에 라이선스가 아예 없다 — "못 읽었다"보다 정확하게 말한다.
      // ⚠ 제조사도 **실제 센 수로** 말한다(2026-08-06 검토 #11) — 레지스트리에 Publisher가
      //   빈 항목이 흔한데 "제조사만 따로 적어 둔다"고 단정하면 0건일 때 거짓이 된다.
      (종류 === "windows"
        ? ` 윈도우 설치 목록에는 라이선스 정보가 없어 미상으로 둡니다 — 제조사는 적혀 있던 ${부품.filter((c) => c.publisher).length}개만 따로 담았습니다.`
        : 라이선스없음 ? ` 그중 ${라이선스없음}개는 라이선스를 못 읽었습니다(그 장비가 안 알려 줍니다 — 비워 둡니다).` : ""),
  };
}

/**
 * 기존 구성요소와 합친다. **스캐너가 준 것을 지우지 않는다.**
 *
 * ⚠ 같은 이름이 양쪽에 있으면 **실제로 읽은 쪽(package)을 남긴다** — 스캐너 추정치보다
 *   장비에서 직접 읽은 것이 정확하다. 다만 스캐너에만 있는 것(OS·배포판)은 그대로 둔다.
 */
export function 구성요소합치기(기존: AssetComponent[], 새것: AssetComponent[]): AssetComponent[] {
  const 이름 = (c: AssetComponent) => c.name.trim().toLowerCase();
  const 새것이름 = new Set(새것.map(이름));
  const 남길기존 = (기존 ?? []).filter((c) => !새것이름.has(이름(c)));
  return [...남길기존, ...새것];
}

/** SBOM·화면에 붙일 **덮는 범위** 한 줄. 이걸 안 적으면 부품 수가 실제보다 정확해 보인다. */
export function 덮는범위글(components: AssetComponent[]): string {
  const 총 = components.length;
  if (총 === 0) return "구성요소가 아직 없습니다 — 패키지 수집을 돌리면 채워집니다.";
  const 실제 = components.filter((c) => c.from === "package").length;
  const 추정 = components.filter((c) => c.from !== "package").length;
  const 라이선스 = components.filter((c) => !라이선스모름(c.license)).length;
  return (
    `구성요소 ${총}개 — 장비에서 **직접 읽은 것 ${실제}개** · 스캐너가 준 것 ${추정}개. ` +
    `라이선스를 아는 것은 ${라이선스}개입니다.` +
    (실제 === 0 ? " ⚠ 아직 직접 읽은 부품이 없습니다 — SBOM이 제품(CPE) 수준입니다." : "")
  );
}
