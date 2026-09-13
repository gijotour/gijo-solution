// 짝 감시(전중후 계획서 무관 — 클라 사본 정합) — 점검 「지연」 잣대·「기한 초과」 라벨의
// 클라 사본이 sla.ts 단일 출처와 같은가 (2026-09-13, feb8d420 검토관 이관 후속).
//
// ■ 배경: 서버는 점검 「지연」 판정을 sla.ts 점검지연인가() 한 곳으로 통일했다 —
//   승인(approved) 아님 + 예정일이 **오늘보다 앞**(`< today`, 오늘 마감은 예정이지 지연이
//   아니다). 그런데 렌더러(client/)는 서버 코드를 import할 수 없어 이 잣대를 손으로 옮겨
//   적은 사본이 있다(inventory.html의 자산별 점검 배지 집계) — tone.test.ts가 이미 잡고
//   있는 EPSS 클라 사본(승인 화면·취약점 화면)과 **같은 이유·같은 방식**이다. 그래서 여기서도
//   숫자·글자를 이 시험에 또 적지 않고 **sla.ts 소스에서 읽어** 클라 사본과 대조한다.
//
// ■ 「기한 초과」 라벨(조치 SLA의 기한초과라벨, sla.ts)도 같은 사정이다 — kpi.html 추세
//   카드와 grouppanels.js의 KPI 판이 서버가 이미 계산해 준 remediation.overdue 값을
//   보여줄 뿐이지만, **칸 이름**은 Word·HTML 보고서·챗봇과 같은 글자여야 한다(안 그러면
//   같은 값을 두고 화면마다 다른 이름으로 부른다 — 2026-09-13 검토관 [중] 수리가 잡은
//   바로 그 혼동). 화면 폭이 좁아 「기한 초과*」로 줄여 적더라도, 서버 글자 원문은
//   title 툴팁(4번째 배열 자리)에 그대로 담는다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ENGINE = path.join(__dirname, "..", "src", "engine");
const CLIENT_PAGES = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");

describe("★ 점검 지연 잣대(클라 사본) — inventory.html이 sla.ts 점검지연인가()와 같다", () => {
  it("승인 전 + `<`(오늘 마감은 지연 아님) — sla.ts에서 읽은 조건 그대로", () => {
    const slaSrc = fs.readFileSync(path.join(ENGINE, "sla.ts"), "utf8");
    const 본문 = /export function 점검지연인가\([\s\S]*?\n\}/.exec(slaSrc)?.[0];
    expect(본문, "sla.ts에서 점검지연인가 본문을 못 찾았다 — 함수 이름·모양이 바뀌었으면 이 감시도 함께 고친다").toBeTruthy();

    // 승인 제외 조건 — sla.ts는 `m.status === "approved") return false`로 뺀다.
    expect(본문, "sla.ts의 승인 제외 조건이 바뀌었다 — 이 감시가 읽는 모양과 다르다").toMatch(/status === "approved"\)\s*return false/);

    // 날짜 견줌 연산자 — `<=`가 아니라 `<`여야 한다(SLA② 2026-09-13).
    const 연산자 = /scheduleDate\s*(<=?|>=?)\s*today/.exec(본문 ?? "")?.[1];
    expect(연산자, "sla.ts에서 scheduleDate와 today를 견주는 연산자를 못 찾았다 — 판정식 모양이 바뀌었으면 이 감시도 함께 고친다").toBe("<");

    const 사본경로 = path.join(CLIENT_PAGES, "inventory.html");
    expect(fs.existsSync(사본경로), `클라 사본이 여기 없다 — 화면을 옮겼으면 이 감시의 경로도 옮긴다: ${사본경로}`).toBe(true);
    const html = fs.readFileSync(사본경로, "utf8");

    // ⚠ 파일 전체에서 아무 scheduleDate 비교 줄이나 집지 않는다(첫 매치에 기대면 다른 함수의
    //   줄을 볼 수 있다 — tone.test.ts가 이미 겪은 함정과 같은 모양). 판정 결과를 쌓는
    //   `s.overdue++` 줄 하나로 좁힌다.
    const 판정줄 = html.split(/\r?\n/).find((l) => /s\.overdue\+\+/.test(l));
    expect(판정줄, `inventory.html에서 점검 지연 판정 줄(s.overdue++)을 못 찾았다 — 화면이 바뀌었으면 이 감시도 함께 고친다: ${사본경로}`).toBeTruthy();

    expect(판정줄, `클라 사본이 승인 완료를 지연에서 빼지 않는다 — sla.ts(status !== "approved")와 어긋난다: ${사본경로}`).toMatch(/status\s*!==\s*"approved"/);
    expect(판정줄, `클라 사본에 scheduleDate < today 판정이 없다 — sla.ts와 어긋난다: ${사본경로}`).toMatch(/scheduleDate\s*&&\s*m\.scheduleDate\s*<\s*today/);
    // 위 toMatch만으로도 `<=`로 되돌리면 걸리지만(`<\s*today`가 `<=`엔 안 걸린다), 실패 메시지를
    // 더 명확히 하기 위해 금지 모양도 따로 잰다.
    expect(판정줄, `클라 사본이 \`<=\`를 쓴다 — 오늘 마감을 지연으로 세면 sla.ts(\`<\`, SLA②)와 어긋난다: ${사본경로}`).not.toMatch(/scheduleDate\s*<=\s*today/);
  });
});

// ⚠ 주석 줄은 안 센다 — 실제 코드(title 속성·배열 4번째 자리)가 아니라 **설명 주석에만** 원문이
//   남아 있어도 include()는 속는다(첫 판 실측: trendCard 호출에서 title 인자를 지웠는데 바로
//   위 주석이 같은 문자열을 들고 있어 초록이 나왔다). 화면에 실제로 뜨는 값만 잰다.
function 주석뺀본문(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

describe("★ 「기한 초과」 라벨(클라 사본) — kpi.html·grouppanels.js가 sla.ts 기한초과라벨과 같은 글자를 담는다", () => {
  it("sla.ts 기한초과라벨 문자열을 두 화면 어딘가(툴팁 포함)에 원문 그대로 담고 있다", () => {
    const slaSrc = fs.readFileSync(path.join(ENGINE, "sla.ts"), "utf8");
    const 라벨 = /export const 기한초과라벨 = "([^"]+)"/.exec(slaSrc)?.[1];
    expect(라벨, "sla.ts에서 기한초과라벨 상수를 못 찾았다 — 이름·모양이 바뀌었으면 이 감시도 함께 고친다").toBeTruthy();

    const kpiPath = path.join(CLIENT_PAGES, "kpi.html");
    expect(fs.existsSync(kpiPath), `클라 사본이 여기 없다 — 화면을 옮겼으면 이 감시의 경로도 옮긴다: ${kpiPath}`).toBe(true);
    const kpiCode = 주석뺀본문(fs.readFileSync(kpiPath, "utf8"));
    expect(
      kpiCode.includes(라벨 as string),
      `kpi.html 추세 카드가 sla.ts 기한초과라벨("${라벨}")과 다른 글자를 쓴다 — 표시가 짧더라도(예: "기한 초과*") 화면 어딘가(title 툴팁 등)에 서버 원문을 그대로 담을 것(주석은 안 친다): ${kpiPath}`,
    ).toBe(true);

    const gpPath = path.join(path.dirname(kpiPath), "grouppanels.js");
    expect(fs.existsSync(gpPath), `클라 사본이 여기 없다 — 화면을 옮겼으면 이 감시의 경로도 옮긴다: ${gpPath}`).toBe(true);
    const gpCode = 주석뺀본문(fs.readFileSync(gpPath, "utf8"));
    expect(
      gpCode.includes(라벨 as string),
      `grouppanels.js의 KPI 판이 sla.ts 기한초과라벨("${라벨}")과 다른 글자를 쓴다(주석은 안 친다): ${gpPath}`,
    ).toBe(true);
  });
});
