// "가서 하기" 안내 — **실제 화면과 한 글자라도 다르면 실패한다**.
// (2026-07-31 사용자 지시 "설정등은 해당메뉴가서 어떻게 하라고 가이드 주고")
//
// 이 시험이 있는 이유:
//   안내표를 처음 쓸 때 8건 중 5건이 화면과 달랐다 — 2차 인증을 관리자 구역이라 했지만 내 설정이고,
//   SMTP를 연동이라 했지만 서버·AI고, 계정 추가 버튼은 "계정 만들기"가 아니라 "추가"고,
//   백업은 화면이 아예 없는데 "[복원]을 누르세요"라고 썼다.
//   **틀린 안내는 안내가 없는 것보다 나쁘다** — 담당자가 없는 버튼을 찾아 헤매고 제품을 안 믿게 된다.
//   화면에서 버튼 이름이 바뀌면 담당자보다 이 시험이 먼저 알아야 한다.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { HOWTOS, findHowTo, howToMarkdown } from "../src/engine/howto";

const PAGES = new URL("../../client/src/renderer/pages/", import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, PAGES), "utf8");
const navSrc = read("nav.js");

/** "settings.html?s=my" → 파일명과 구역을 나눈다. */
function split(page: string): { file: string; sec: string | null } {
  const [file, q] = page.split("?");
  const sec = q ? (new URLSearchParams(q).get("s") ?? null) : null;
  return { file, sec };
}

/** 안내문에서 **[버튼]** 으로 적은 것들 — 화면에 그 글자가 실제로 있어야 한다. */
function buttonsIn(steps: string[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    // 정규식 이스케이프가 어긋나면 시험이 조용히 0건이 된다(전에 겪음) → 손으로 훑는다.
    let i = 0;
    while (true) {
      const a = s.indexOf("[", i);
      if (a < 0) break;
      const b = s.indexOf("]", a);
      if (b < 0) break;
      out.push(s.slice(a + 1, b));
      i = b + 1;
    }
  }
  return out;
}

/** 1단계의 첫 굵은 글씨 = 그 화면의 칸(패널) 이름. 없으면 null. */
function panelOf(steps: string[]): string | null {
  const s = steps[0] ?? "";
  const a = s.indexOf("**");
  if (a < 0) return null;
  const b = s.indexOf("**", a + 2);
  if (b < 0) return null;
  const t = s.slice(a + 2, b);
  return t.startsWith("[") ? t.slice(1, -1) : t;
}

describe("★ 안내가 실제 화면을 가리킨다", () => {
  for (const h of HOWTOS) {
    if (!h.page) continue; // 갈 화면이 없는 안내(백업)는 아래에서 따로 본다
    const { file, sec } = split(h.page);

    it(`${h.key}: ${file} 이 실제로 있다`, () => {
      expect(fs.existsSync(new URL(file, PAGES)), `${h.page} — 없는 화면으로 보낸다`).toBe(true);
    });

    it(`${h.key}: 구역·버튼·칸 이름이 화면과 같다`, () => {
      const html = read(file);
      if (sec) {
        expect(html.includes(`data-sec="${sec}"`), `설정에 '${sec}' 구역이 없다`).toBe(true);
      }
      for (const b of buttonsIn(h.steps)) {
        expect(html.includes(b), `화면에 [${b}] 라는 버튼 글자가 없다 — 담당자가 못 찾는다`).toBe(true);
      }
      const panel = panelOf(h.steps);
      if (panel) {
        expect(html.includes(panel), `화면에 '${panel}' 칸이 없다`).toBe(true);
      }
    });

    it(`${h.key}: 사이드바에 적힌 이름과 같은 자리를 말한다`, () => {
      // where("설정 > 내 설정")의 끝 이름이 nav.js에서 그 page에 붙은 label과 같아야 한다.
      // 다르면 "설정 > 관리자로 가세요"라고 해 놓고 정작 다른 구역을 여는 꼴이 된다.
      const leaf = h.where.split(">").pop()!.trim();
      // 2026-08-09 그룹 통합: 항목이 하나인 그룹은 **그룹 줄 자체가 메뉴**여서 사이드바에 보이는
      //   글자가 그룹 이름("③ 조치")이다. 그래서 항목 이름 **또는 그 화면을 품은 그룹 이름**과
      //   같으면 통과다 — 둘 다 아니면 안내가 없는 자리를 가리키는 것이다.
      // 2026-08-09 설정 정리: 같은 화면의 탭(settings.html?s=admin 등)은 사이드바에서 접혔다 —
      //   메뉴엔 「설정」 한 줄뿐이므로, **질의문자열을 뗀 같은 화면**의 항목 이름과 맞으면 통과다
      //   (안내의 page는 탭까지 여는 깊은 주소를 유지한다 — 그게 담당자에게 더 친절하다).
      const 같은화면 = (a: string, b: string) => a.split("?")[0] === b.split("?")[0];
      const 항목들 = [...navSrc.matchAll(/\{\s*page:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map((m) => ({ page: m[1], label: m[2] }));
      const 항목이름 = 항목들.some((i) => 같은화면(i.page, h.page) && i.label === leaf);
      const 그룹블록 = navSrc.split(/\{\s*id:\s*"/).find((b) => b.includes(`page: "${h.page}"`)) ?? "";
      const 그룹이름 = new RegExp(`label:\\s*"${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(그룹블록.split("items:")[0] ?? "");
      expect(항목이름 || 그룹이름, `nav.js에서 ${h.page}의 이름은 '${leaf}'가 아니다`).toBe(true);
    });
  }

  it("이 대조가 헛돌고 있지 않다", () => {
    // ⚠ buttonsIn/panelOf가 아무것도 못 뽑으면 위 시험들은 **전부 통과하면서 아무것도 안 본다**.
    //   "세는 것은 확인이 아니다"로 이미 당한 적이 있어(낡은 가이드가 단계 수만 맞아 통과) 못 박는다.
    const 버튼 = HOWTOS.filter((h) => h.page).flatMap((h) => buttonsIn(h.steps));
    const 칸 = HOWTOS.filter((h) => h.page).map((h) => panelOf(h.steps)).filter(Boolean);
    expect(버튼.length, "버튼을 하나도 안 뽑았다 — 위 대조는 빈 검사다").toBeGreaterThanOrEqual(5);
    expect(칸.length, "칸 이름을 하나도 안 뽑았다").toBeGreaterThanOrEqual(5);
    expect(버튼).toContain("2차 인증 켜기");
    expect(칸).toContain("저장 암호화");
    // 없는 글자는 정말로 못 찾아야 한다(찾기 자체가 고장 나면 뭘 적어도 통과한다).
    expect(read("settings.html").includes("[없는버튼XYZ]")).toBe(false);
  });

  it("갈 화면이 없는 안내는 화면을 지어내지 않는다", () => {
    const 백업 = HOWTOS.find((h) => h.key === "backup")!;
    expect(백업.page, "복원 화면은 없다 — 아무 설정 화면이나 열어 주면 없는 버튼을 찾게 된다").toBeNull();
    expect(백업.steps.join(" ")).toContain("복원은 화면에 없습니다");
  });
});

describe("걸려야 할 말에 걸린다", () => {
  // 대화창 서랍의 '설정·관리' 칸은 이 질문들에 **가서 하기** 배지를 달아 놓았다.
  // 하나라도 안 걸리면 배지가 거짓말이 된다.
  const 서랍질문 = [
    "2차 인증 켜려면 어떻게 해?",
    "복구 열쇠 재발급하려면 어떻게 해?",
    "담당자 계정 추가하려면 어떻게 해?",
  ];
  for (const q of 서랍질문) {
    it(`서랍 질문: ${q}`, () => {
      expect(findHowTo(q), "서랍이 '가서 하기'라고 적어 둔 질문이다").not.toBeNull();
    });
  }

  const 지시형 = [
    ["2차 인증 켜줘", "mfa-on"],
    ["OTP 등록하고 싶어", "mfa-on"],
    ["비밀번호 바꾸고 싶어", "password"],
    ["SMTP 설정 방법 알려줘", "smtp"],
    ["에이전트 모델 배정 어떻게 해?", "model-assign"],
    ["백업 어떻게 하나요?", "backup"],
  ] as const;
  for (const [q, key] of 지시형) {
    it(`${q} → ${key}`, () => {
      // ⚠ "켜줘"처럼 시키는 말도 걸려야 한다. 이걸 AI가 실행하면 AI를 속인 사람도 끌 수 있다.
      expect(findHowTo(q)?.key).toBe(key);
    });
  }
});

describe("★★ '해도 돼?'는 절대 가로채지 않는다 — 행동 대조(전-2)의 몫", () => {
  // 평가 게이트가 실제로 잡은 회귀다(2026-07-31): "점검 결과를 개인 메일로 보내도 돼?"를
  // SMTP 설정 안내가 물어 버렸다. 그 질문은 사내규정·법령 근거로 ○/△/× 를 판정해야 하고,
  // 그게 우리 차별점이다. 순서 안내가 가로채면 차별 기능이 죽는다.
  const 허용질문 = [
    "점검 결과를 개인 메일로 보내도 돼?", // ← 게이트 문항 그대로
    "점검 결과를 개인 메일로 보내도 됩니까?",
    "USB로 로그 반출해도 되나요?",
    "백업 파일을 개인 PC에 저장해도 괜찮아?",
    "운영 장비에 SSH로 접속해도 돼?",
    "이 자료를 협력사와 공유해도 무방한가?",
  ];
  for (const q of 허용질문) {
    it(`행동 대조로 넘긴다: ${q}`, () => {
      expect(findHowTo(q), "허용 여부 질문에 설정 순서를 답하면 판정 기능이 죽는다").toBeNull();
    });
  }

  it("방법을 묻는 말은 그대로 안내한다 — 너무 많이 막지 않았는지", () => {
    // 막는 규칙은 넓히기 쉽고, 넓히면 원래 되던 안내까지 죽는다.
    expect(findHowTo("SMTP 설정 방법 알려줘")?.key).toBe("smtp");
    expect(findHowTo("2차 인증 켜려면 어떻게 해?")?.key).toBe("mfa-on");
    expect(findHowTo("백업 어떻게 하나요?")?.key).toBe("backup");
  });
});

describe("★ 엉뚱한 질문을 가로채지 않는다", () => {
  // 가로채면 잘 되던 기능이 죽는다 — 안내만 나오고 아무 일도 안 일어난다.
  const 건드리면안됨 = [
    "오늘 뭐부터 해야 해?",
    "기한 지난 일 보여줘",
    "미조치 취약점 뭐 있어?",
    "우리 자산 현황 알려줘",
    "새 자산 등록할게",
    "가장 급한 취약점에 담당자 배정해줘",
    "경계 방화벽(FW-01) 정기점검 잡아줘",
    "이번 주 보안 현황을 요약해줘",
    "보안제품 등록해줘",
    "최근 작업 기록에서 이상한 게 있어?",
  ];
  for (const q of 건드리면안됨) {
    it(`그냥 지나간다: ${q}`, () => {
      expect(findHowTo(q), `이 지시는 도구가 처리하는 일이다 — 안내로 가로채면 기능이 죽는다`).toBeNull();
    });
  }
});

describe("안내문 자체", () => {
  it("왜 대신 못 하는지를 반드시 적는다", () => {
    // 이유 없이 "가서 하세요"만 하면 "왜 안 해주지"가 된다.
    for (const h of HOWTOS) expect(h.why.length, `${h.key}에 이유가 없다`).toBeGreaterThan(15);
  });

  it("순서와 이유가 한 덩이로 나온다", () => {
    const md = howToMarkdown(HOWTOS.find((h) => h.key === "mfa-on")!);
    // 2026-08-09 설정 정리 — 사이드바가 「설정」 한 줄이 되어 안내 자리말도 「설정」이다.
    expect(md).toContain("설정");
    expect(md).toContain("1. ");
    expect(md).toContain("[2차 인증 켜기]");
  });

  it("키가 겹치지 않는다", () => {
    const keys = HOWTOS.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("★ 화면 안내보다 먼저 본다", () => {
  it("dispatcher에서 howTo가 isHelpIntent 앞에 있다", () => {
    // 뒤에 두면 "2차 인증 어떻게 해?"가 지금 보고 있는 화면의 일반 안내로 떨어져,
    // 정작 켜는 법을 못 듣는다. 순서가 곧 동작이라 소스로 못 박는다.
    const src = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    const a = src.indexOf("findHowTo(instructionText)");
    const b = src.indexOf("isHelpIntent(instructionText");
    expect(a, "dispatcher가 howto를 아예 안 쓴다").toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a, "화면 안내가 먼저 가로채면 설정 질문이 엉뚱한 답을 받는다").toBeLessThan(b);
  });
});

describe("★ 하루 실전에서 나온 보강 (2026-08-01)", () => {
  it("파일 올리는 법을 안내한다 — 34초 헤매던 자리", () => {
    // 실측: "분석할 로그 올리려면 어떻게 해?"에 34초를 쓰고 문서 조각(표 부스러기)을 쏟았다.
    for (const q of ["분석할 로그 올리려면 어떻게 해?", "점검서 올리려면 어떻게 하나요", "매뉴얼 업로드 어떻게 해?"]) {
      const h = findHowTo(q);
      expect(h?.key, `"${q}"가 안내를 못 찾는다`).toBe("upload-file");
    }
  });

  it("★ 파일을 '올려도 되냐'고 물으면 행동 대조가 답한다 — 순서 안내가 가로채지 않는다", () => {
    // 계획서 전-2의 차별점. 순서 안내가 이 질문을 먹으면 그 기능이 죽는다.
    expect(findHowTo("점검 결과 파일을 협력사에 올려도 돼?")).toBeNull();
    expect(findHowTo("클라우드에 로그 올려도 되나?")).toBeNull();
  });
});

describe("★ 남의 제품 설명서를 우리 절차인 양 내놓지 않는다", () => {
  it("알림 설정을 물으면 우리 절차가 나온다", () => {
    // 실측(2026-08-01): "기한 임박 알림 받으려면 어떻게 해?"에 31초를 쓰고
    // **Tenable Security Center 설정법**을 안내했다. 지식베이스의 벤더 매뉴얼에서 끌어온 것.
    // 담당자는 우리 제품에 없는 화면을 찾아 헤맨다 — 틀린 답보다 나쁘다.
    for (const q of ["기한 임박 알림 받으려면 어떻게 해?", "알림 설정 어떻게 하나요", "메일로 통보 받게 하려면?"]) {
      expect(findHowTo(q)?.key, `"${q}"가 우리 절차를 못 찾는다`).toBe("alert-setup");
    }
  });

  it("★ '메일 보내도 돼?'는 여전히 행동 대조 몫이다", () => {
    // 규칙을 넓힐 때마다 이 경계를 다시 밟는다(2026-07-31에 한 번, 오늘 또).
    expect(findHowTo("점검 결과를 개인 메일로 보내도 돼?")).toBeNull();
    expect(findHowTo("협력사에 메일로 자산 목록 보내도 되나?")).toBeNull();
  });
});
