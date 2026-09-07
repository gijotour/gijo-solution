// 안내(screenguide) ↔ 서버 잣대 ↔ 화면 글자 **짝 시험** — 2026-09-07 두 번째 원장 라운드(F).
// (계획서 중-1 「파일럿 실사용 피드백 루프」 · 전-4 「정직한 구현」)
//
// ■ 왜 이 파일이 필요한가
//   이번 라운드는 **같은 이름을 세 곳**에 적었다: 서버 판정(fixboard·docledger) · 화면 글자
//   (approvals.html·supervision.html·mydocs.html·chatparts.js) · 안내(screenguide). 이 저장소가
//   반복해 겪은 결함이 정확히 그 모양이다 — 「같은 것을 여러 곳에 적으면 어긋난다」.
//   사람은 셋을 못 센다. 그래서 기계가 센다.
//
// ■ 안 재는 것(정직 표시)
//   · **라우팅**은 안 잰다(그건 aliaspair.test·guidance-check 몫).
//   · **화면이 실제로 그리는가**도 안 잰다(가짜 DOM은 원리상 못 본다 — 게시 관문 ⑨′이 잰다).
//     여기서 재는 것은 「안내가 약속한 글자가 화면 소스에 **있는가**」까지다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getScreenGuide } from "../src/engine/screenguide";
import { 고칠것갈래라벨, 질문가림 } from "../src/engine/fixboard";
import { 상태꼬리 } from "../src/engine/docledger";
import { 무르기시간_MS } from "../src/engine/answerfeedback";
import { listAgentTools } from "../src/engine/agenttools/registry";

const 화면파일 = (f: string) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", f), "utf8");
const chatparts = 화면파일("chatparts.js");
const approvals = 화면파일("approvals.html");
const supervision = 화면파일("supervision.html");
const mydocs = 화면파일("mydocs.html");

const 구역 = (screen: string, name: string): string => {
  const p = getScreenGuide(screen).panels?.[name];
  expect(p, `${screen}에 구역 「${name}」이 없다 — 이름을 바꿨으면 별칭·시험도 함께 고칠 것`).toBeTruthy();
  return String(p);
};
/** 공통(OVERVIEW) 구역 — 대화창 조작은 어느 화면에서 물어도 같은 답이라 화면별 안내에 사본을
 *  두지 않는다. `getScreenGuide()`를 **인자 없이** 부르는 것이 그 공통 안내다. */
const 공통구역 = (name: string): string => {
  const p = getScreenGuide().panels?.[name];
  expect(p, `공통 안내(OVERVIEW)에 구역 「${name}」이 없다`).toBeTruthy();
  return String(p);
};

describe("① 갈래 이름의 주인은 서버 하나 — 안내가 그 글자를 그대로 쓴다", () => {
  const 지적안내 = () => 구역("approvals.html", "답 지적(💬)");
  const 감독안내 = () => 구역("supervision.html", "고칠 것(🔧)");

  it("결재판 안내에 갈래 4종이 **라벨 글자 그대로** 있다", () => {
    for (const 라벨 of Object.values(고칠것갈래라벨)) {
      expect(지적안내(), `갈래 이름 「${라벨}」이 안내에 없다(또는 다른 말로 적혔다)`).toContain(라벨);
    }
  });

  it("감독 안내에도 같은 4종이 같은 글자로 있다 — 두 화면이 다른 말을 쓰면 같은 것이 두 이름이 된다", () => {
    for (const 라벨 of Object.values(고칠것갈래라벨)) {
      expect(감독안내(), `갈래 이름 「${라벨}」이 감독 안내에 없다`).toContain(라벨);
    }
  });

  it("★ 화면 셋(결재판·감독·꼬리)도 같은 글자를 쓴다 — 서버 라벨을 바꾸면 여기서 빨개진다", () => {
    for (const 라벨 of Object.values(고칠것갈래라벨)) {
      expect(approvals, `결재판 화면에 「${라벨}」이 없다`).toContain(라벨);
      expect(supervision, `감독 화면에 「${라벨}」이 없다`).toContain(라벨);
      expect(chatparts, `대화창 꼬리에 「${라벨}」이 없다`).toContain(라벨);
    }
  });

  it("★ 감독 안내가 **자리표를 글자 그대로** 적는다(제 말로 바꿔치기하면 화면과 다른 말이 된다)", () => {
    expect(감독안내()).toContain(질문가림);
  });
});

describe("② 조각 상태 꼬리표 — 안내·화면·서버가 한 글자까지 같다", () => {
  const 문서안내 = () => 구역("mydocs.html", "조각이 없는 문서(⚠)");

  it("칩 세 문구가 서버 docledger.상태꼬리 그대로다", () => {
    // ⚠ 여기 문자열을 손으로 적지 않는다 — 서버 함수를 **불러서** 낸 값과 견준다.
    expect(문서안내()).toContain(상태꼬리("missing"));        // 「조각 없음」
    expect(문서안내()).toContain(상태꼬리("short"));           // 「조각 일부 사라짐」
    expect(문서안내()).toContain(상태꼬리("extra"));           // 「옛 판 조각 남음」
    expect(문서안내(), "대장 수가 붙는 꼴을 안 적었다").toContain("조각 없음(대장 ");
  });

  it("화면(mydocs.html)도 같은 세 문구를 쓴다", () => {
    for (const s of ["missing", "short", "extra"] as const) {
      expect(mydocs, `화면에 「${상태꼬리(s)}」이 없다`).toContain(상태꼬리(s));
    }
  });

  it("★ ok·unknown에는 꼬리표가 없다 — 안내가 「정상인 줄에도 칩이 붙는다」고 말하지 않게", () => {
    expect(상태꼬리("ok")).toBe("");
    expect(상태꼬리("unknown")).toBe("");
    expect(문서안내(), "견줄 수 없는 문서에 칩을 안 붙인다는 말이 빠졌다").toMatch(/견줄 수 없는/);
  });

  it("배지 잣대를 **missing만**이라고 적는다 — 대화 답(「⚠ 조각 없음 N건」)과 같은 잣대", () => {
    expect(문서안내()).toContain("「조각 없음」만 셉니다");
  });

  it("★ 되살리기를 **늘 되는 것처럼** 적지 않는다(추출본이 없으면 실행 단계에서 실패한다)", () => {
    expect(문서안내()).toMatch(/추출본\(\.md\)이 없으면/);
    expect(문서안내(), "성공을 미리 그리지 않는다는 말이 빠졌다").toMatch(/미리 그리지 않습니다/);
  });
});

describe("③ 무르기 1분 — 안내·화면·서버가 같은 값이다", () => {
  it("서버 60초 · 화면 60000ms · 안내 「1분」", () => {
    expect(무르기시간_MS).toBe(60000);
    expect(chatparts, "화면 무르기 창이 서버와 다르면 눌러도 403이 온다").toContain("무르기_MS = 60000");
    const 꼬리안내 = 공통구역("이 답 이상해요");   // 공통(OVERVIEW)으로 떨어진다
    expect(꼬리안내).toContain("1분 안");
  });

  it("★ 1분이 지난 뒤 화면이 적는 말을 안내가 그대로 인용한다", () => {
    const 지난말 = "무르기(1분)는 지났습니다";
    expect(chatparts).toContain(지난말);
    expect(공통구역("이 답 이상해요")).toContain(지난말);
  });
});

describe("④ 안내가 약속한 화면 글자가 실제로 화면에 있다(같은 라운드 배포 계약)", () => {
  // ⚠ 안내는 **서버 배포**로, 화면은 **클라 게시**로 나간다(screenguide.ts 「인용 제거(✂)」
  //   머리말의 계약). 한쪽만 내보내면 「안내만 맞는 말을 하는 구간」이 생긴다 — 이 시험이
  //   두 쪽이 **같은 라운드에 있음**을 못 박는다.
  const 약속: [string, string, string][] = [
    ["결재판 세그먼트", approvals, "💬 답 지적"],
    ["초안 단추", approvals, "🤖 초안 만들기"],
    ["초안 대기 표시", approvals, "초안 만드는 중… (몇 초 걸립니다)"],
    ["초안 옮기기", approvals, "↧ 최종문 칸으로 옮기기"],
    ["관리자 전용 안내", approvals, "관리자</b>만 볼 수 있습니다"],
    ["가림 표시", approvals, "🔒 일부 가림"],
    ["감독 처리 단추", supervision, "🗔 결재판에서 처리"],
    ["감독 0건 설명", supervision, "열림 기준(0건도 그립니다)"],
    ["꼬리 단추", chatparts, "▶ 이 답 이상해요"],
    ["올린 뒤 영수증", chatparts, "✓ 결재판에 올림"],
    ["결재판 열기", chatparts, "결재판 열기"],
    ["다시 넣기", mydocs, "↩ 다시 넣기"],
    ["얹지 못한 말", approvals, "대화창에 얹지 못했습니다"],
  ];
  for (const [이름, 소스, 글자] of 약속) {
    it(`${이름} — 「${글자}」`, () => expect(소스).toContain(글자));
  }

  it("★ 지적 종류 셋의 이름이 안내와 화면에서 같다", () => {
    const 꼬리안내 = 공통구역("이 답 이상해요");
    for (const 이름 of ["❌ 틀린 답", "🔍 못 찾음", "💬 말투"]) {
      expect(chatparts, `화면에 「${이름}」이 없다`).toContain(이름);
      expect(꼬리안내, `안내에 「${이름}」이 없다`).toContain(이름);
    }
  });
});

describe("⑤ 과장 금지 — 「똑똑해집니다」라고 적지 않는다", () => {
  // 승인 문답은 **아직 지식(RAG)으로 안 들어간다.** 실제로 일어나는 일은 「사람이 검토해
  // 회귀 검사 문항 후보로 모은다」까지다(2026-09-03 실측: 승인 문답이 RAG에 안 들어감).
  const 볼구역 = [
    구역("approvals.html", "답 지적(💬)"),
    구역("approvals.html", "수정 초안(🤖)"),
    구역("supervision.html", "고칠 것(🔧)"),
    공통구역("이 답 이상해요"),
  ];
  it("네 구역 어디에도 「똑똑해집니다」·「스스로 배웁니다」류가 없다", () => {
    for (const 글 of 볼구역) {
      expect(글).not.toContain("똑똑해집니다");
      expect(글).not.toContain("스스로 배웁니다");
      expect(글).not.toContain("학습됩니다");
    }
  });
  it("★ 대신 **실제로 일어나는 일**을 적는다 — 사람이 검토하고 문항 후보로 모은다", () => {
    expect(구역("approvals.html", "답 지적(💬)")).toContain("회귀 검사 문항 후보");
    expect(공통구역("이 답 이상해요")).toMatch(/자동으로 반영되지 않습니다/);
  });
});

describe("⑥ 대화 도구 answer_feedback_status — 자물쇠와 상세는 **짝**이다", () => {
  const 도구 = () => listAgentTools().find((t) => t.name === "answer_feedback_status");

  it("★ requiredRole:\"admin\"이 걸려 있다 — 정문(GET /api/answer-feedback)과 같은 등급", () => {
    expect(도구(), "도구가 사라졌다").toBeTruthy();
    expect(도구()?.requiredRole,
      "옆문이 열려 있다 — 담당자가 남의 질문 원문·사유를 대화창으로 읽는다").toBe("admin");
  });

  it("★ 자물쇠를 걸었으니 run은 상세를 되찾는다(하나만 되돌리면 유출이거나 반쪽 기능)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf8");
    const i = src.indexOf('name: "answer_feedback_status"');
    expect(i, "도구 정의를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(-1);
    const 덩어리 = src.slice(i, src.indexOf("\n  },", i));
    expect(덩어리, "run이 상세를 안 켰다 — admin인데 건수만 본다").toMatch(/feedbackSummaryText\(.*,\s*true\s*\)/);
  });
});
