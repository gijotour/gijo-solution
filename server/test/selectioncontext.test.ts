// 2단계 — 화면에서 고른 것이 「이거」가 된다 (선택 항목 맥락, 2026-08-09).
//
// 외부사례 근거: VS Code Copilot의 implicit context(활성 파일+**선택 영역**),
// Security Copilot 임베디드(보는 인시던트가 곧 맥락). 우리는 화면 단위(1단계)에서
// 선택 단위(2단계)로 내려간다.
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../src/engine/assets", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    listAssets: () => [
      { id: "vuln:172.168.50.142", name: "172.168.50.142" },
      { id: "vuln:sample-web01", name: "sample-web01", displayName: "안전대부 웹서버" },
    ],
  };
});

import { 선택을박는다, 지목된자산아이디, forcedToolFor } from "../src/engine/agentloop";

const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");

describe("선택 항목 맥락 (소스 계약)", () => {
  it("라우트가 selection을 선택정리()로 눌러쓴다 — 한 줄·200자·⌗키 꼬리 보존(검토관 11)", () => {
    // 두 REST 창구(일반·스트림)가 같은 함수를 타야 한다 — 옛날처럼 인라인 복붙이면 한쪽만 고친다.
    expect(src).toContain("function 선택정리");
    expect((src.match(/선택정리\(req\.body\?\.selection\)/g) || []).length).toBe(2);
    // 눌러쓰기·상한·키 보존이 함수 안에 있는지(이스케이프 실수를 잡았던 문자열 대조 유지)
    expect(src).toContain('replace(/\\s+/g, " ").trim()');
    expect(src).toContain(".slice(0, 200)");
    expect(src).toContain("⌗.+?::[0-9a-f]{16}");
  });

  it("선택이 맥락 앞머리에 실린다 — 「이거」는 대화 이력보다 방금 고른 것", () => {
    expect(src).toContain("[지금 화면에서 선택한 항목]");
    expect(src).toContain("[선택맥락, 대화맥락].filter(Boolean)");
  });

  it("선택이 있으면 대명사 되묻기를 건너뛴다 — 대상이 이미 있다", () => {
    expect(src).toContain("if (!선택 && (대명사뿐인가(instructionText)");
  });

  it("qa 경로에도 선택이 실린다 — 질문의 일부이지 기록이 아니다", () => {
    const qa블록 = src.slice(src.indexOf("if (qa) {"), src.indexOf("if (qa) {") + 400);
    expect(qa블록).toContain("선택맥락");
  });
});

describe("선택 치환 — 대명사 자리에 고른 항목을 박는다", () => {
  // 실앱 e2e 실측(2026-08-09): 선택맥락은 모델에게 가지만 강제 분기는 지시문만 봐서,
  // 한 자산을 골라 「이 자산 취약점 몇 건이야?」를 물었는데 전역 4,828건이 나갔다.
  it("★ e2e가 잡은 그 문장 — 「이 자산」이 고른 자산으로 바뀐다", () => {
    expect(선택을박는다("이 자산 미조치 취약점 몇 건이야?", "자산 172.168.50.142"))
      .toBe("자산 172.168.50.142 미조치 취약점 몇 건이야?");
    expect(선택을박는다("이거 조치 절차 알려줘", "자산 안전대부 웹서버"))
      .toBe("자산 안전대부 웹서버 조치 절차 알려줘");
    // 3단계(2026-08-09): 대시보드 할 일 줄 선택 — 「이 할 일」도 치환된다.
    expect(선택을박는다("이 할 일 완료 처리해줘", "할 일 방화벽 정기점검"))
      .toBe("할 일 방화벽 정기점검 완료 처리해줘");
  });

  it("★★ 대명사가 없으면 원문 그대로 — 칩이 붙었다고 마음대로 좁히지 않는다", () => {
    expect(선택을박는다("미조치 취약점 몇 건이야?", "자산 X")).toBe("미조치 취약점 몇 건이야?");
    // 「필요 자산」의 「요 자산」, 낱말 속 「이」는 지시어가 아니다(단어 경계).
    expect(선택을박는다("필요 자산 목록 보여줘", "자산 X")).toBe("필요 자산 목록 보여줘");
  });

  it("★★★ 낱말 뒤에 한글이 붙으면 다른 낱말이다 — 평가 게이트가 잡은 실사고", () => {
    // 2026-08-09: 「그냥 아무 **얘기**나 해봐」의 「얘」가 대명사로 잡혀 직전 대상이 박혔고,
    // 잡담 질문이 **자산 목록 조회**로 갔다(korean 축 100%→95.8%로 게이트 보류).
    // 게이트가 아니었으면 조용히 나갈 뻔한 결함이다.
    expect(선택을박는다("그냥 아무 얘기나 해봐", "자산 sample-web01")).toBe("그냥 아무 얘기나 해봐");
    expect(선택을박는다("이것저것 알려줘", "자산 X")).toBe("이것저것 알려줘");
    expect(선택을박는다("그 거리 어디야?", "자산 X"), "「그 거」+리").toBe("그 거리 어디야?");
    // 진짜 대명사는 여전히 바뀐다(막느라 기능을 죽이면 안 된다).
    expect(선택을박는다("얘 취약점 알려줘", "자산 A")).toBe("자산 A 취약점 알려줘");
    expect(선택을박는다("이것 조치해줘", "자산 A")).toBe("자산 A 조치해줘");
  });

  it("등록된 자산 하나를 지목하면 id를 준다 — 둘 이상이면 좁히지 않는다", () => {
    expect(지목된자산아이디("자산 172.168.50.142 취약점 몇 건이야?")).toBe("vuln:172.168.50.142");
    expect(지목된자산아이디("안전대부 웹서버 취약점 몇 건이야?"), "표시 이름으로도 잡는다").toBe("vuln:sample-web01");
    expect(지목된자산아이디("전체 취약점 몇 건이야?"), "지목이 없다").toBe("");
    expect(지목된자산아이디("172.168.50.142랑 안전대부 웹서버 몇 건이야?"), "둘이면 모호").toBe("");
  });

  it("★ 세는 질문 강제 분기가 지목 자산으로 좁힌다 — 치환된 문장이 전역 집계로 새지 않게", () => {
    const r = forcedToolFor("자산 172.168.50.142 취약점 몇 건이야?");
    expect(r?.tool).toBe("finding_status");
    expect(r?.args.filter).toContain("vuln:172.168.50.142");
  });
});

describe("직전 대상 이어 붙이기 (2026-08-09 ③ — 같은 병의 마지막 조각)", () => {
  // 되묻기 관문은 직전 대상이 있으면 「맥락으로 풀린다」며 비켜 주는데, 정작 그 대상을 쓰는
  // 곳이 없었다 — 「그 서버 취약점 몇 건?」이 관문을 지나 전역 4,828건을 답했다.
  it("선택이 없으면 직전 대상을 쓴다 — 관문이 맥락이 있다고 판단했으면 실제로 써야 한다", () => {
    expect(src).toContain("const 직전 = 선택 ? null : 직전대상자산(대화열쇠);");
    expect(src).toContain("선택 ?? (직전 ? `자산 ${자산표시이름(직전.assetId)}` : undefined)");
  });

  it("★ 추측한 티를 낸다 — 화면 클릭과 달리 이어 붙이기는 우리 추측이다", () => {
    // 라벨(도구)이 없어도 이 줄만은 달아야 한다 — 알릴 것이 있는데 형식 때문에 삼키면 안 된다.
    expect(src).toContain("직전에 다룬 「${r.이어붙인대상}」 기준으로 봤습니다");
    expect(src).toContain("const 줄 = [알아들음, 이어붙임].filter(Boolean).join(\" · \");");
    // 말이 실제로 바뀌었을 때만 — 안 바뀌었으면 알릴 것이 없다.
    expect(src).toContain("!선택 && 실행문 !== instructionText");
  });
});

describe("클라 배선 (소스 계약)", () => {
  it("선택 알림은 클릭 한 곳에서만 — 자동 열림은 선택이 아니다", () => {
    const mv = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "map-view.js"), "utf8");
    expect((mv.match(/gijo:select/g) ?? []).length, "선택 알림이 여러 곳이면 자동 열림까지 잡는다").toBe(1);
    // 2026-08-09 실측 결함: parent로 보내면 허브 화면(discover 등) 안의 한 겹 때문에
    // 셸에 못 닿는다 — 셸은 항상 최상위 창이므로 top으로 보낸다.
    expect(mv, "선택 알림은 top으로 — parent는 허브 한 겹에 막힌다").toContain("window.top.postMessage");
  });

  it("화면이 바뀌면 선택을 푼다 — 옆 화면 항목을 계속 가리키면 「이거」가 거짓말이 된다", () => {
    const cs = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js"), "utf8");
    expect(cs).toContain("setSelection(null); // 선택도 푼다");
    expect(cs).toContain("select: setSelection");
  });

  it("3단계 확장 화면도 top으로 보낸다 — 취약점 목록(호스트·항목)·할 일 줄", () => {
    // 2026-08-20 계약 갱신: vulnscan은 공용 부품(selectnotify.js)으로 이관됐다 —
    // 「top 전송·팝업 예외 금지」 계약은 부품 한 곳이 지고, 화면은 부품 호출만 감시한다.
    const vs = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "vulnscan.html"), "utf8");
    expect(vs, "취약점 화면에 선택 배선(부품)").toContain("gijoSelectNotify");
    expect(vs, "부품 로드가 없으면 호출이 조용히 죽는다").toContain('src="selectnotify.js"');
    const sn = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "selectnotify.js"), "utf8");
    expect(sn, "부품이 top으로 안 보낸다 — parent는 허브 한 겹에 막힌다").toContain("window.top.postMessage");
    expect((sn.match(/window\.top\.postMessage/g) ?? []).length, "부품의 전송은 한 곳이어야 규격이 산다").toBe(1);
    expect(sn, "단독 팝업 예외(top!==window)가 되살아나면 프로 팝업 선택이 다시 죽는다").not.toContain("window.top !== window");
    const db = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "dashboard.html"), "utf8");
    expect(db, "할 일 줄에 선택 배선").toContain("gijo:select");
    expect(db, "셸은 최상위 창").toContain("window.top.postMessage");
  });
});

// ── 조치·승인 화면 → 대화창 (2026-08-18, 「조치 항목 → 대화창 카드」 시안 승인분) ──────
// 왜: 사장님 첫인상 QA 발견 — 조치 대상을 누르면 옆 패널만 열리고 대화창과 **완전히 끊겨**
//   있었다(전수조사 실측: approvals.html의 gijo:select 호출 0건). 법령·판례는 이미
//   고르면 대화창이 답하는데 조치 화면만 안 됐다.
// ⚠ 이 감시가 없으면 조용히 되돌아간다 — "만들어만 두고 안 부른다"가 이 저장소의 반복 함정.
describe("조치·승인 화면이 고른 항목을 대화창에 넘긴다", () => {
  const ap = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "approvals.html"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "app.html"), "utf8");
  const cs = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js"), "utf8");

  it("항목을 누르면 선택 알림을 보낸다 — 그리고 실제로 불린다", () => {
    // 2026-08-20 부품 이관: 전송(top·허용 키·200자 컷)은 selectnotify.js가 진다.
    expect(ap, "approvals.html이 선택 알림(부품)을 안 부른다").toContain("gijoSelectNotify");
    expect(ap, "부품 로드가 없으면 호출이 조용히 죽는다").toContain('src="selectnotify.js"');
    expect(ap, "알림 함수를 만들어만 두고 호출부가 없다").toContain("대화창에알림(r)");
  });

  it("셸이 fields를 걸러 버리지 않는다 — 아는 키만 문자열로 통과시킨다", () => {
    // ⚠ 2026-08-18에 실제로 밟은 함정: app.html이 { label, text }만 다시 만들어 넘겨
    //   fields가 조용히 사라졌다. 보내는 쪽·받는 쪽만 고치면 상태 패널이 영영 안 뜬다.
    const i = shell.indexOf('d.type === "gijo:select"');
    expect(i, "gijo:select 수신부를 못 찾았다 — 코드가 바뀌었으면 이 시험도 같이 볼 것").toBeGreaterThan(-1);
    const 구간 = shell.slice(i, i + 1200);
    expect(구간, "fields를 콘솔로 안 넘긴다").toContain("fields");
    expect(구간, "iframe 값을 그대로 믿으면 안 된다 — String 강제가 있어야 한다").toContain("String(");
    expect(구간, "아는 키만 통과시켜야 한다(허용 목록)").toMatch(/허용키|allow/);
  });

  // (2026-08-20 승인 시안 pro-context-strip: 🎯 상세 박스(renderSelState)는 폐지 —
  //  같은 데이터(sel.fields)를 대화 안 「고른 항목」 카드(선택카드)가 그린다. 계약의 뜻
  //  — 「fields가 온 화면에서만 상세가 보이고, 없으면 무변경 호환」 — 은 카드가 잇는다.)
  it("대화창이 fields를 받으면 「고른 항목」 카드를 그린다 — 없으면 지금 그대로", () => {
    expect(cs, "카드를 그리는 함수가 없다").toContain("function 선택카드");
    // fields가 없으면 카드를 안 그린다 — 기존 화면(vulnscan·dashboard·map-view) 무변경 호환.
    expect(cs, "fields 있을 때만 카드로 가는 갈래가 없다").toMatch(/if\s*\(sel\.fields\)\s*선택카드\(sel\.fields\)/);
  });

  it("없는 함수를 부르지 않는다 — boldify는 console.js에 없다", () => {
    // 2026-08-18에 실제로 이 실수를 했다가 잡았다. approvals.html엔 있고 console.js엔 없어서,
    // 옮겨 심으면 TypeError로 조용히 죽는다(버튼이 무반응이 되는 그 부류).
    const i = cs.indexOf("function 선택카드");
    const 구간 = cs.slice(i, i + 4200);
    if (!/function boldify/.test(cs)) {
      expect(구간, "console.js에 boldify가 없는데 부르고 있다").not.toContain("boldify(");
    }
  });

  it("한글 한 줄을 다시 만들지 않고 화면이 준 것을 쓴다 — 같은 문장이 두 곳에서 갈라지지 않게", () => {
    // 전-7③의 f.plain(서버 findingplain.ts가 만든 것)을 그대로 실어 보낸다.
    expect(ap, "한글 한 줄(plain)을 안 싣는다").toMatch(/plain:\s*f\.plain/);
  });
});

// ── 고른 항목 카드(승인 시안 mockups/조치항목_대화창 — 2026-08-19 구현) ──────────
// 클릭 → 카드가 대화에 쌓이고 → 이어서 할 일은 제안 칩 → 기존 submit → 기존 결재판.
// 「만들어만 두고 안 부르면 안 된다」가 이 저장소의 반복 함정이라, 배선을 소스로 잠근다.
describe("고른 항목 카드 — 클릭이 대화창에서 이어진다", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const 콘솔 = fs.readFileSync(new URL("../../client/src/renderer/pages/console.js", import.meta.url), "utf8");
  const 승인 = fs.readFileSync(new URL("../../client/src/renderer/pages/approvals.html", import.meta.url), "utf8");

  it("★★ 화면(조치·승인)이 fields를 실어 보낸다 — 카드의 원료", () => {
    // 2026-08-20 부품 이관: 전송(postMessage)은 selectnotify.js가 진다 —
    // 화면 몫은 fields 조립과 부품 호출에 fields를 싣는 것까지다.
    expect(승인).toMatch(/const fields = \{/);
    expect(승인, "부품 호출에 fields가 실려야 카드가 그린다").toMatch(/gijoSelectNotify\(\{[^}]*fields/);
  });
  it("★★ setSelection이 fields가 오면 카드를 붙인다", () => {
    expect(콘솔).toMatch(/if \(sel\.fields\) 선택카드\(sel\.fields\)/);
  });
  it("★ 제안 칩은 기존 submit으로만 나간다 — 새 입력칸을 만들지 않는다(시안 핵심 결정 3)", () => {
    const i = 콘솔.indexOf("function 선택카드(");
    expect(i).toBeGreaterThan(0);
    const 본문 = 콘솔.slice(i, i + 2600);
    expect(본문).toContain("submit(q)");
    expect(본문, "카드 안에 입력칸이 생기면 「지시는 대화창 입력줄 하나」 원칙이 깨진다").not.toMatch(/<input|<textarea/i);
  });
  it("같은 항목 연타에 카드를 도배하지 않는다", () => {
    expect(콘솔).toContain("선택카드.직전");
  });
});
