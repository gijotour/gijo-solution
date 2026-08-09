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
  it("라우트가 selection을 한 줄로 눌러쓰고 200자에서 자른다 — 화면 라벨이 프롬프트 구조를 못 흔들게", () => {
    expect(src).toContain('req.body?.selection');
    // 문자열 그대로 대조 — 이 검사가 실제로 이스케이프 실수(\s가 s로)를 한 번 잡았다(2026-08-09).
    expect(src).toContain('replace(/\\s+/g, " ").trim().slice(0, 200)');
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
    const vs = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "vulnscan.html"), "utf8");
    expect(vs, "취약점 화면에 선택 배선").toContain("gijo:select");
    expect(vs, "허브 한 겹 함정 — parent 금지").toContain("window.top !== window");
    const db = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "dashboard.html"), "utf8");
    expect(db, "할 일 줄에 선택 배선").toContain("gijo:select");
    expect(db, "셸은 최상위 창").toContain("window.top.postMessage");
  });
});
