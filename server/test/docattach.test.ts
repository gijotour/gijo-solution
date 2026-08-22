// 문서 첨부(캡처)와 버전 이력 — **우리가 고객에게 약속한 것**이 실제로 되는가 (2026-08-22 신설).
//
// ■ 왜 이 시험이 있나
//   Smart MD Studio(별도 창)를 없애기로 했다. 없애려면 내 문서가 그 일을 해야 하는데,
//   우리가 **세 곳에 똑같이 약속해 둔 목록**이 있다
//   (라이트 설치안내서 · 용어사전 · 챗봇 안내):
//     화면 캡처 Ctrl+V 삽입 · **md/HTML/PDF/워드 4형식** · 템플릿 · **문서 이력** · 인터넷 불필요
//   ★ 그 목록이 「충분히」의 선이다 — 취향이 아니라 **문서로 검증되는 기준**이다.
//     (주석·화살표 그리기는 어디에도 약속된 적이 없어 만들지 않았다.)
//
// ⚠ 이 시험이 지키는 것은 「기능이 있다」가 아니라 **「약속한 것이 된다」**이다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  첨부저장, 첨부목록, 첨부읽기, 첨부삭제, 문서첨부정리, 첨부장수상한,
  판남기기, 판목록, 판본문, 문서판정리, 이력보존판수,
} from "../src/engine/docattach";

const 서버루트 = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// 1×1 PNG — 진짜 그림 바이트여야 한다(빈 문자열로 재면 시험이 헛돈다).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("첨부(캡처) — 본문에 박지 않고 파일로 둔다", () => {
  it("★ 저장하면 **본문에 넣을 표기**를 돌려준다 — 본문엔 그림이 안 들어간다", () => {
    const doc = "t-doc-" + Date.now();
    const r = 첨부저장({ docId: doc, userId: "u1", name: "캡처 1", mime: "image/png", base64: PNG });
    expect(r.ok, "저장 실패").toBe(true);
    if (!r.ok) return;
    // ⚠ base64가 아니라 **참조**여야 한다. 캡처 1장이 본문 상한의 71%라 본문에 박으면 2장이 불가하고,
    //   지식 인입기가 「글자가 아니다」로 거절해 **저장이 500인데 본문은 이미 저장된** 상태가 된다.
    expect(r.표기, "표기에 base64가 들어가면 안 된다").not.toMatch(/base64|data:/);
    expect(r.표기).toMatch(/^!\[.*\]\(gijo-att:[0-9a-f-]{36}\)$/);
    문서첨부정리(doc, "u1");
  });

  it("★★ **격리** — 남의 첨부는 원리상 안 열린다", () => {
    const doc = "t-iso-" + Date.now();
    const r = 첨부저장({ docId: doc, userId: "주인", name: "비밀 캡처", mime: "image/png", base64: PNG });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(첨부읽기(r.첨부.id, "주인"), "주인은 열 수 있어야 한다").toBeTruthy();
    expect(첨부읽기(r.첨부.id, "남"), "남이 열리면 개인 문서 격리가 깨진 것이다").toBeNull();
    expect(첨부삭제(r.첨부.id, "남"), "남이 지울 수 있으면 안 된다").toBe(false);
    문서첨부정리(doc, "주인");
  });

  it("★ 그림이 아닌 것은 안 받는다", () => {
    const r = 첨부저장({ docId: "t-x", userId: "u1", name: "몰래.exe", mime: "application/x-msdownload", base64: PNG });
    expect(r.ok).toBe(false);
  });

  it("★ 장수 상한이 있다 — 없으면 한 문서가 디스크를 먹는다", () => {
    const doc = "t-cap-" + Date.now();
    for (let i = 0; i < 첨부장수상한; i++) {
      expect(첨부저장({ docId: doc, userId: "u1", name: "c" + i, mime: "image/png", base64: PNG }).ok).toBe(true);
    }
    const 넘김 = 첨부저장({ docId: doc, userId: "u1", name: "하나 더", mime: "image/png", base64: PNG });
    expect(넘김.ok, `${첨부장수상한}장을 넘겨 받으면 안 된다`).toBe(false);
    expect(첨부목록(doc, "u1").length).toBe(첨부장수상한);
    문서첨부정리(doc, "u1");
  });

  it("★★ 문서를 지우면 파일도 지운다 — 안 지우면 고아 그림이 디스크에 영원히 남는다", () => {
    const doc = "t-del-" + Date.now();
    const r = 첨부저장({ docId: doc, userId: "u1", name: "캡처", mime: "image/png", base64: PNG });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const 지운수 = 문서첨부정리(doc, "u1");
    expect(지운수).toBe(1);
    expect(첨부읽기(r.첨부.id, "u1"), "표에서 지웠는데 아직 읽힌다").toBeNull();
  });

  it("★ 저장 자리가 `data/docs/` 안이다 — 밖이면 **백업에서 조용히 빠진다**", () => {
    // backup.ts가 `data/docs`를 통째로 복사한다. 새 폴더를 그 밖에 두면 백업 계보의 4번째 누락이 된다.
    const src = fs.readFileSync(path.join(서버루트, "src", "engine", "docattach.ts"), "utf8");
    expect(src, "첨부 폴더가 data/docs 아래여야 한다").toMatch(/"docs",\s*"attach"/);
  });

  it("★ 파일 이름이 **uuid**다 — basename 키잉은 2026-08-22에 기밀을 새게 한 그 방식이다", () => {
    const src = fs.readFileSync(path.join(서버루트, "src", "engine", "docattach.ts"), "utf8");
    expect(src, "randomUUID로 이름을 지어야 한다").toMatch(/randomUUID\(\)/);
    // 사람이 준 이름을 파일 경로에 쓰면 경로 조작이 섞인다.
    expect(src, "원본 이름을 파일 경로에 쓰면 안 된다").not.toMatch(/path\.join\(ATTACH_DIR,\s*[^)]*name/);
  });
});

describe("버전 이력 — 고치다 날린 글을 되찾는다", () => {
  it("★ 판이 쌓이고, 본문을 되읽을 수 있다", () => {
    const doc = "t-ver-" + Date.now();
    판남기기({ docId: doc, userId: "u1", title: "첫판", body: "처음 글", savedBy: "나" });
    판남기기({ docId: doc, userId: "u1", title: "둘판", body: "고친 글", savedBy: "나" });
    const 목록 = 판목록(doc, "u1");
    expect(목록.length).toBe(2);
    expect(목록[0].글자수).toBeGreaterThan(0);
    const 본문 = 판본문(목록[목록.length - 1].id, "u1");
    expect(본문?.body, "가장 오래된 판이 첫 글이어야 한다").toBe("처음 글");
    문서판정리(doc, "u1");
  });

  it("★★ **격리** — 남의 판은 못 읽는다", () => {
    const doc = "t-viso-" + Date.now();
    판남기기({ docId: doc, userId: "주인", title: "비밀", body: "남이 보면 안 되는 글" });
    const 목록 = 판목록(doc, "주인");
    expect(목록.length).toBe(1);
    expect(판본문(목록[0].id, "남"), "남이 읽으면 격리가 깨진 것이다").toBeNull();
    expect(판목록(doc, "남").length, "남에게는 목록도 안 보여야 한다").toBe(0);
    문서판정리(doc, "주인");
  });

  it("★ 보존 판수를 넘기면 오래된 것부터 지운다 — 안 지우면 DB가 계속 부푼다", () => {
    const doc = "t-keep-" + Date.now();
    for (let i = 0; i < 이력보존판수 + 5; i++) {
      판남기기({ docId: doc, userId: "u1", title: "p" + i, body: "본문 " + i });
    }
    expect(판목록(doc, "u1", 100).length, `${이력보존판수}판만 남아야 한다`).toBe(이력보존판수);
    문서판정리(doc, "u1");
  });
});

describe("★★ 약속한 목록이 실제로 되는가 — 소스 계약", () => {
  const pd = fs.readFileSync(path.join(서버루트, "src", "engine", "personaldocs.ts"), "utf8");

  it("내보내기 **4형식** — md·HTML·PDF·워드를 세 곳에 약속했다", () => {
    // ⚠ 2026-08-22까지 **HTML만 빠져 있었다.** md는 본문 그대로라 클라가 만든다(서버는 3종).
    expect(pd, "HTML 내보내기가 없다 — 안내서가 약속한 4형식이 3형식이 된다").toMatch(/fmt === "html"/);
    expect(pd).toMatch(/fmt === "pdf"/);
    expect(pd).toMatch(/fmt === "docx"/);
  });

  it("★ 고치기 **전**에 판을 남긴다 — 뒤에 남기면 새 내용을 두 번 적는 셈이다", () => {
    const 판자리 = pd.indexOf("판남기기({");
    const 저장자리 = pd.indexOf("updateStmt.run({");
    expect(판자리, "판남기기 호출을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(판자리, "판을 저장 뒤에 남기면 옛 내용이 아니라 새 내용이 쌓인다").toBeLessThan(저장자리);
  });

  it("★ 문서를 지울 때 첨부·이력을 함께 지운다", () => {
    expect(pd, "첨부 정리를 안 부른다 — 고아 파일이 남는다").toMatch(/문서첨부정리\(/);
    expect(pd, "이력 정리를 안 부른다 — 지운 문서의 옛 본문이 남는다").toMatch(/문서판정리\(/);
  });

  it("★ 붙여넣기를 `#editBody`에 건다 — document에 걸면 요청 만들기와 다툰다", () => {
    // 같은 화면의 「요청 만들기」가 이미 document 단위 붙여넣기를 쓴다(설계관 2026-08-22 경고).
    const html = fs.readFileSync(path.resolve(서버루트, "..", "client", "src", "renderer", "pages", "mydocs.html"), "utf8");
    expect(html, "편집기 붙여넣기가 editBody 요소에 걸려 있어야 한다")
      .toMatch(/getElementById\("editBody"\)\.addEventListener\("paste"/);
  });
});
