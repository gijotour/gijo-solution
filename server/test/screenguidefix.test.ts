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
import { getScreenGuide, isHelpIntent, formatScreenGuide } from "../src/engine/screenguide";
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
const memoryHtml = 화면파일("memory.html");
const handover = 화면파일("handover.html");

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

  it("★ 되살리기를 **늘 되는 것처럼** 적지 않는다(원본도 추출본도 없으면 실행 단계에서 실패한다)", () => {
    // ⚠ 2026-09-10 수리: 옛 정규식은 「**추출본(.md)이 없으면** 실패」를 고정하고 있었는데,
    //   그날부터 **원본만 있어도 되살아난다**(memory.reingestFromExtracted가 원본에서 다시 뽑는다).
    //   시험이 거짓 문구를 초록으로 지키고 있었다 — 고정할 것은 「둘 다 없으면」 쪽이다.
    expect(문서안내(), "「추출본만 없으면 실패」로 되돌아갔다 — 원본이 있으면 되살아난다").toMatch(/원본도 추출본\(\.md\)도.{0,20}없으면/);
    expect(문서안내(), "성공을 미리 그리지 않는다는 말이 빠졌다").toMatch(/미리 그리지 않습니다/);
    expect(문서안내(), "원본에서 다시 뽑는다는 새 동작을 안내가 말하지 않는다").toMatch(/원본이 남아 있으면 지금 추출기로 다시 뽑습니다/);
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
    // 📚 AI 지식·업무 넘기기 — C-B가 같은 라운드에 세운 유령 표시(2026-09-07). 안내가 그 글자를 인용한다.
    ["지식 화면 유령 꼬리", memoryHtml, "⚠ 조각 없음"],
    ["인계 ② 고를 때", handover, "조각 없음 — 인계 자료로 못 씁니다"],
    ["인계 ③ 검증에서 뺌", handover, "은 검증에서 뺐습니다"],
  ];
  for (const [이름, 소스, 글자] of 약속) {
    it(`${이름} — 「${글자}」`, () => expect(소스).toContain(글자));
  }

  it("★ 지식·인계 안내가 화면에 실제로 선 글자를 인용한다(안내만 먼저 늙지 않게)", () => {
    expect(구역("memory.html", "조각 없음 표시"), "머리줄 꼬리 표기를 안 적었다").toContain("(⚠ 조각 없음 N)");
    const 인계 = 구역("handover.html", "인수인계");
    expect(인계).toContain("조각 없음 — 인계 자료로 못 씁니다");
    expect(인계, "검증에서 뺀다는 말이 빠졌다").toMatch(/검증에서 뺐습니다/);
    expect(인계, "몰래 지우지 않는다는 계약이 빠졌다").toMatch(/몰래 지우지는 않습니다/);
  });

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

  /* ★★ 2026-09-07 검토관 [중] 수리 — 자물쇠를 걸면서 **그 도구를 약속한 화면 안내**를 안 고쳤다.
     learnloop.html의 can 셋째 줄이 「"이번 주 답변 지적 뭐 있었어?"」를 누구에게나 권하는데,
     담당자(security_officer)에게는 registry.listToolsFor가 그 도구를 **목록에서 숨기므로**
     시킨 대로 쳐도 권한 안내조차 없이 답이 안 나온다. 그 화면은 담당자도 연다(카드에 role 분기
     없음 · GET /api/learnloop/topics는 authMiddleware만).
     ⚠ guidance-check가 이 어긋남을 못 본 이유는 도구 결함이다 — 수확식이 screenguide.ts의
       이스케이프된 큰따옴표에 걸려 그 줄을 통째로 버린다(보고 open_issues).
       그래서 **여기서 짝으로** 묶는다: 자물쇠와 문장은 함께 움직인다. */
  it("★★ 자물쇠와 **화면 안내의 약속**이 짝이다 — admin 전용이면 안내도 그렇게 말한다", () => {
    const 약속 = (getScreenGuide("learnloop.html").can || []).filter((c) => /답변 지적/.test(c));
    expect(약속.length, "learnloop 안내에서 답변 지적 약속 줄이 사라졌다 — 이 시험이 헛돈다").toBe(1);
    if (도구()?.requiredRole === "admin") {
      expect(약속[0],
        "도구는 관리자 전용인데 안내는 누구에게나 「이렇게 물어보세요」라고 말한다(담당자는 답을 못 받는다)"
      ).toMatch(/관리자만/);
    } else {
      expect(약속[0],
        "자물쇠를 풀었으면 안내의 「관리자만」도 함께 지워야 한다(없는 제한을 말하게 된다)"
      ).not.toMatch(/관리자만/);
    }
  });
});

/* ── ⑦ 라이트 한계 — 안내가 「없는 것」을 없다고 말하나 (2026-09-07) ────────────────────
   ■ 왜: 라이트 셸은 대화창(lite-chat)을 **console.html로 자리 바꿈**해 들어가므로 chatparts.js가
     그대로 실려 「▶ 이 답 이상해요」 꼬리가 **라이트에도 뜬다**(코드 확인 2026-09-07:
     lite-chat.html이 location.replace("console.html?embed=1&edition=lite")). 그런데 라이트에는
     결재판 화면이 없어(lite-screens.json) 「결재판 열기」로 갈 자리가 없고, 「다시 넣기」를 받을
     쓰기 도구(reingest_document)도 lite-tools.json에서 **사유와 함께 빠져 있다.**
   ■ 그래서 안내가 그 사실을 말해야 한다. 이 시험은 **양쪽을 묶는다** — 라이트에 그 화면·도구가
     생기는 날 여기서 빨개져서 안내를 함께 고치게 한다(안 그러면 안내만 낡는다). */
describe("⑦ 라이트 한계를 안내가 말한다(그 근거도 함께 잰다)", () => {
  const liteScreens = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "lite-screens.json"), "utf8"));
  const liteTools = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "src", "lite", "lite-tools.json"), "utf8"));
  // ★★ 2026-09-07 검토관 [낮] 수리 — 근거 ①②가 **이름 한 줄에 걸린 헐거운 판정**이었다.
  //   ① `not.toContain("lite-approvals")`: 접두사 관례일 뿐 강제가 아니라 다른 이름
  //      ("approvals"·"lite-fixboard")으로 들어오면 시험은 초록인 채 안내만 늙는다.
  //   ② `JSON.stringify(liteTools).includes('"id": "reingest_document"')`: **원리상 늘 false**다
  //      — JSON.stringify는 공백 없는 `"id":"reingest_document"`를 낸다(실측). 게다가 그 문자열은
  //      **뺀 것 목록**(_뺀것_중_설명이_필요한_것)에도 실려 있어, 공백만 지워 고치면 이번엔
  //      「없는데 있다」는 **거짓 빨강**이 된다. 판정은 실제 목록(tools[].id)에서 읽는다.
  const 라이트화면 = (liteScreens.screens || []) as { id: string; 이름?: string; 파일?: string }[];
  const 라이트도구ids = (liteTools.tools || []).map((t: { id: string }) => t.id) as string[];

  it("근거 ① 라이트에 결재판 화면이 없다 — 생기면 이 줄이 먼저 빨개진다(이름을 안 가린다)", () => {
    expect(라이트화면.length, "화면 목록을 못 읽었다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    // 이름이 아니라 **뜻**으로 찾는다 — id·표시 이름·파일명 어디에 결재/승인/approval이 있어도 잡는다.
    const 결재비슷 = 라이트화면.filter((sc) =>
      /approval|결재|승인/i.test([sc.id, sc.이름, sc.파일].filter(Boolean).join(" ")));
    expect(결재비슷.map((sc) => sc.id),
      "라이트에 결재판(비슷한 화면)이 생겼다 — 꼬리 안내의 「갈 자리가 없습니다」를 고칠 것").toEqual([]);
  });

  it("근거 ② 라이트 도구 목록에 reingest_document가 없다 — 생기면 문서함 안내를 고칠 것", () => {
    expect(라이트도구ids.length, "도구 목록을 못 읽었다 — 이 시험이 헛돈다").toBeGreaterThan(5);
    expect(라이트도구ids, "짝인 읽기 도구가 사라졌다 — 라이트 안내의 전제가 무너졌다")
      .toContain("doc_chunk_gaps");
    expect(라이트도구ids,
      "라이트에 재인입 도구가 생겼다 — 「다시 넣기를 받을 도구가 아직 없습니다」를 고칠 것")
      .not.toContain("reingest_document");
  });

  it("★ 판정이 헛돌지 않는다(반증) — 없는 도구를 넣은 사본은 위 판정이 잡아낸다", () => {
    // 위 두 시험은 「없다」를 재므로 **늘 초록일 수 있다**. 같은 판정식에 있는 값을 먹여
    // 빨개지는지 여기서 확인한다(모집단 감시).
    const 사본 = [...라이트도구ids, "reingest_document"];
    expect(사본).toContain("reingest_document");
    expect(라이트화면.some((sc) => /approval|결재|승인/i.test(String(sc.id))), "").toBe(false);
    expect([{ id: "lite-approvals" }, { id: "fixboard" }]
      .filter((sc) => /approval|결재|승인/i.test(sc.id)).map((sc) => sc.id)).toEqual(["lite-approvals"]);
  });

  it("★ 꼬리 안내가 라이트에 결재판이 없다고 말한다", () => {
    expect(공통구역("이 답 이상해요")).toMatch(/라이트 에디션에는 결재판 화면이 없습니다/);
  });

  /* ★★ 2026-09-07 검토관 [중] 수리 — 이 라운드 보고가 「라이트에서 결재판 열기를 누르면
     담당자가 대화창에서 튕겨 나간다(안내 한 줄 없이)」고 적었는데, **코드로 성립하지 않는다.**
     실제 경로를 끝까지 따라가면 화면 전환이 아니라 **알림 한 줄**이다:
       console.js 결재판열기() → (IS_WINDOW 거짓·gijoTabs 없음) → gijo.navigateTo(page)
       → preload.ts navigateTo: 부모가 있고 embed=1이면 **ipcRenderer 대신 parent로 postMessage**
       → lite-app.html의 message 리스너 → gijoOpenScreen("approvals.html?fix=open")
       → 화면목록에 없음 → 없는화면알림() = 「이 기능은 라이트 에디션에 없습니다」 4.2초
     안내는 **본 대로** 적어야 하므로 문장을 그렇게 고쳤고, 그 경로의 네 마디를 여기 묶는다.
     한 마디라도 사라지면 안내가 거짓이 되므로 이 시험이 먼저 빨개진다. */
  it("근거 ④ 라이트에서 「결재판 열기」는 튕김이 아니라 **알림 한 줄**이다(경로 네 마디)", () => {
    const 읽기 = (...seg: string[]) => fs.readFileSync(path.join(__dirname, "..", "..", ...seg), "utf8");
    const preload = 읽기("client", "src", "preload.ts");
    const consoleJs = 읽기("client", "src", "renderer", "pages", "console.js");
    const liteApp = 읽기("client", "src", "renderer", "pages", "lite-app.html");
    // ① 대화창의 마지막 갈래가 navigateTo다(이것이 없으면 죽은 단추로 되돌아간다)
    expect(consoleJs, "결재판열기()의 navigateTo 갈래가 사라졌다 — 라이트에서 다시 죽은 단추가 된다")
      .toMatch(/function 결재판열기\(\)[\s\S]{0,400}navigateTo\(page\)/);
    // ② preload가 embed 안에서는 창을 갈아치우지 않고 부모에게 부탁한다(= 튕기지 않는 이유)
    expect(preload, "navigateTo가 embed에서 postMessage로 안 바뀐다 — 그러면 정말로 창이 갈아치워진다")
      .toMatch(/embed=1[\s\S]{0,400}postMessage\(\{ type: "gijo:openTab"/);
    // ③ 라이트 셸이 그 부탁을 받는다
    expect(liteApp, "라이트 셸이 gijo:openTab을 안 받는다 — 그러면 침묵 단추가 된다")
      .toMatch(/d\.type === "gijo:openTab"/);
    // ④ 없는 화면이면 **말한다**(안내가 약속한 바로 그 문장)
    expect(liteApp, "「이 기능은 라이트 에디션에 없습니다」 문구가 사라졌다 — 안내가 거짓이 된다")
      .toContain("이 기능은 라이트 에디션에 없습니다");
    // 안내 문장도 그 사실을 그대로 적었나(약속 ↔ 코드)
    expect(공통구역("이 답 이상해요"), "안내가 「알려 줍니다」를 안 적었다")
      .toMatch(/이 기능은 라이트 에디션에 없습니다/);
  });

  it("★ 문서함 안내가 라이트에서 「다시 넣기」가 안 된다고 말한다(＋로 다시 올리기로 넘긴다)", () => {
    const 문서안내 = 구역("mydocs.html", "조각이 없는 문서(⚠)");
    expect(문서안내).toMatch(/라이트 에디션/);
    expect(문서안내, "라이트에서 할 수 있는 길을 안 적었다").toMatch(/＋로 파일을 다시 올려/);
  });

  it("근거 ③ 라이트 대화창이 console.html로 자리를 바꿔 들어간다(그래서 꼬리가 뜬다)", () => {
    const liteChat = fs.readFileSync(
      path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "lite-chat.html"), "utf8");
    expect(liteChat, "라이트 대화창이 더는 console.html을 안 쓴다 — 꼬리 안내의 전제가 무너졌다")
      .toContain('location.replace("console.html?"');
  });
});

/* ── ★ B12 화면 안내 「X 뭐야?」 도달 — 라이트 격리·본문 검증 (2026-09-12 · 설계관 지시서) ── */
describe("★ B12 — 대화 홈 전역 훑기는 라이트에서 꺼진다(없는 기능을 안내하지 않는다)", () => {
  // ⚠⚠ 2026-09-12 검토관 [중] 정정 — 첫 판은 근거를 「라이트엔 mydocs.html이 없다(라이트 화면은
  //   전부 lite-* 이름이다)」라고 적었는데 **사실이 아니다.** client/src/renderer/pages/
  //   lite-mydocs.html은 화면이 아니라 **이름표**라서 `location.replace`로 프로 mydocs.html로
  //   넘긴다(lite-screens.json no.8 「프로의 「내 문서」를 **그대로** 쓴다 … 포크 금지」).
  //   진짜 근거는 **라이트 대화창(lite-chat.html)에 ☑ 근거 지정·📎 첨부가 없다**는 것이다
  //   (실측 grep 0건) — 전역표 넷은 전부 그 기능을 설명하는 구역이라 라이트 대화 홈에서 열면
  //   없는 기능을 가르친다. 근거가 거짓이면 다음 사람이 이 차단을 쉽게 뒤집는다.
  // ⚠ 「격리 원리」로 재던 두 줄은 뺐다 — 같은 날 검토관 [상] 수리로 그 이름이 전역표에서
  //   **빠졌다**(일반 보안 용어라 망·컨테이너·VM 격리 지식 물음 8문장을 가로챘다).
  it("라이트 대화창에 ☑ 근거 지정·📎 첨부가 없다(이 차단의 근거 — 원천 대조)", () => {
    const 라이트챗 = fs.readFileSync(
      path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "lite-chat.html"), "utf8");
    expect(라이트챗.includes("근거 지정"), "라이트 챗에 ☑ 근거 지정이 생겼다 — 이 차단의 근거가 사라졌다").toBe(false);
  });
  it("lite=true면 전역 훑기가 꺼진다", () => {
    expect(isHelpIntent("근거 지정 뭐야?", undefined, "admin", true)).toBe(false);
    expect(isHelpIntent("지난 작업 첨부 뭐야?", undefined, "admin", true)).toBe(false);
  });
  it("lite=false(기본값)면 그대로 안내로 닿는다", () => {
    expect(isHelpIntent("근거 지정 뭐야?", undefined, "admin", false)).toBe(true);
    expect(isHelpIntent("근거 지정 뭐야?", undefined, "admin")).toBe(true);
  });
});

describe("★ B12 — 걸렸다고만 하고 본문이 안 나오는 어긋남이 없다", () => {
  it("「근거 지정 뭐야?」의 본문이 대화 홈에서도 실제로 나온다(폴백 문구 금지)", () => {
    const 답 = formatScreenGuide(undefined, "근거 지정 뭐야?");
    expect(답).toMatch(/^내 문서 › 근거 지정과 첨부\(📎\)/);
    expect(답, "본문이 검색 범위를 좁히는 설명을 안 담았다").toContain("검색 범위를 좁히는 것");
    expect(답, "폴백 문구(사이드바에서 찾으라)가 새로 섞였다").not.toMatch(/사이드바/);
    expect(답, "폴백 문구(이 화면 사용 안내로 떨어졌다)가 섞였다").not.toContain("이 화면 사용 안내");
  });
  it("「지난 작업 첨부 뭐야?」도 같은 꼴로 나온다", () => {
    const 답 = formatScreenGuide(undefined, "지난 작업 첨부 뭐야?");
    expect(답).toMatch(/^내 문서 › /);
    expect(답, "폴백 문구가 섞였다").not.toContain("이 화면 사용 안내");
  });
  // ★ 뺀 것을 **뺐다고** 잰다 — 「격리 원리」는 전역(대화 홈)에서 더 이상 안 걸린다.
  //   화면 위(mydocs.html)에서는 그대로 닿아야 한다(구역 자체를 지운 게 아니다).
  it("「격리 원리 뭐야?」는 대화 홈에서 안 걸리고, 내 문서 화면에서는 그대로 닿는다", () => {
    expect(isHelpIntent("격리 원리 뭐야?", undefined, "admin"), "일반 보안 용어가 대화 홈에서 화면 안내를 채 간다").toBe(false);
    expect(isHelpIntent("격리 원리 뭐야?", "mydocs.html", "admin"), "화면 위에서도 안내를 잃었다 — 너무 많이 뺐다").toBe(true);
  });
});
