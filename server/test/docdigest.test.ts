// 문서 반입 소식 — [2026-08-06 · 계획서 1차 목표(3소스 분석) 소스 확장 + 후-6(축적 자산)]
//
// 왜: CrowdStrike 위협 보고서 같은 PDF를 올려도 올린 순간의 카드가 전부였다 — 그 뒤로는
// 무엇이 들어왔는지, 무슨 내용인지, 우리와 무슨 상관인지 아무도 모른다(사용자 지적).
// 지키는 계약:
//   ① 대장은 결정적이다 — 없으면 없다고 말한다(0건 재작성 금지 계열).
//   ② 요약은 LLM이지만 실패를 숨기지 않는다(failedReason 기록 — 조용한 공백 금지).
//   ③ 접점(온톨로지 대조)은 LLM이 꺼져 있어도 나온다.
//   ④ today가 안내하는 「새로 들어온 문서 알려줘」는 결정적으로 라우팅된다(안내한 말은 흔들리지 않는다).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, chat: vi.fn() };
});

import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db";
import { chat } from "../src/engine/llm";
import { addTriple, deleteTriplesBySource } from "../src/engine/ontology";
import {
  makeDigest, listRecentDocs, recentDocumentsText, ontologyMatchesFor, 요약정리,
  목록최대, 상세최대, 답글자상한,
} from "../src/engine/docdigest";
import { forcedToolFor } from "../src/engine/agentloop";

// memory.ts를 통째로 안 끌고 오려고(무거운 lancedb) 대장 테이블만 직접 보장한다 —
// 실서버에선 memory.ts의 migrate가 만든다(컬럼은 여기서 쓰는 4개보다 많아도 IF NOT EXISTS라 무해).
db.exec(`CREATE TABLE IF NOT EXISTS memory_documents (
  documentId TEXT PRIMARY KEY, scope TEXT, chunks INTEGER, embeddingModel TEXT,
  sourcePath TEXT, ingestedAt TEXT, docClass TEXT, uploadedBy TEXT, category TEXT, grade TEXT
)`);

const putDoc = (id: string, daysAgo: number, category = "위협대응", uploadedBy: string | null = "jyh") =>
  db.prepare(
    `INSERT INTO memory_documents (documentId, scope, chunks, ingestedAt, uploadedBy, category)
     VALUES (?, 'global', 2, ?, ?, ?)
     ON CONFLICT(documentId) DO UPDATE SET ingestedAt=excluded.ingestedAt`
  ).run(id, new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(), uploadedBy, category);

beforeEach(() => {
  db.prepare("DELETE FROM memory_documents WHERE documentId LIKE 'QA소식%'").run();
  db.prepare("DELETE FROM doc_digests WHERE documentId LIKE 'QA소식%'").run();
  deleteTriplesBySource("QA소식시드");
  vi.mocked(chat).mockReset();
});

describe("문서 반입 소식 — 대장(슬라이스 1)", () => {
  it("최근 N일만 보이고, 없으면 없다고 말한다", () => {
    putDoc("QA소식-옛날.pdf", 30);
    expect(listRecentDocs(7).filter((r) => r.documentId.startsWith("QA소식"))).toHaveLength(0);
    putDoc("QA소식-어제.pdf", 1);
    const rows = listRecentDocs(7).filter((r) => r.documentId.startsWith("QA소식"));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("위협대응");
  });

  it("★ 0건이면 지어내지 않고 '없습니다'라고 답한다", () => {
    const text = recentDocumentsText(1);
    // 다른 시험이 남긴 최근 문서가 있을 수 있어, QA소식 문서가 없는 것만 확인한다
    expect(text).not.toContain("QA소식");
  });

  it("답변에 분류 집계와 문서 이름이 실린다", () => {
    putDoc("QA소식-위협보고서.pdf", 1, "위협대응");
    putDoc("QA소식-규정.md", 2, "사내규정");
    const text = recentDocumentsText(7);
    expect(text).toContain("QA소식-위협보고서.pdf");
    expect(text).toContain("위협대응");
    expect(text).toContain("사내규정");
  });
});

describe("문서 반입 소식 — 요약(슬라이스 2)", () => {
  it("세 줄 요약과 핵심어를 저장하고 '자체 요약'으로 표기한다", async () => {
    putDoc("QA소식-요약대상.pdf", 0);
    vi.mocked(chat).mockResolvedValue("첫 줄 요약\n둘째 줄 요약\n셋째 줄 요약\n핵심어: 피싱, 랜섬웨어, 계정 탈취, 클라우드, AI");
    await makeDigest("QA소식-요약대상.pdf", "본문", "위협대응");
    const row = listRecentDocs(7).find((r) => r.documentId === "QA소식-요약대상.pdf")!;
    expect(row.summary).toContain("첫 줄 요약");
    expect(row.keywords).toContain("랜섬웨어");
    expect(recentDocumentsText(7)).toContain("자체 요약"); // 원문 대체가 아님을 표기(7B 오독 전례)
  });

  it("★ LLM 실패를 숨기지 않는다 — failedReason이 남고 답에도 '요약 없음'으로 보인다", async () => {
    putDoc("QA소식-실패.pdf", 0);
    vi.mocked(chat).mockRejectedValue(new Error("모델이 꺼져 있습니다"));
    await makeDigest("QA소식-실패.pdf", "본문", "일반");
    const row = listRecentDocs(7).find((r) => r.documentId === "QA소식-실패.pdf")!;
    expect(row.summary).toBeNull();
    expect(row.failedReason).toContain("모델이 꺼져");
    expect(recentDocumentsText(7)).toContain("요약 없음");
  });
});

describe("반입 소식 2차 — 스스로 알린다(2026-08-06)", () => {
  // 협업 독으로 흐르는 알림을 붙잡는다(emitCollaboration은 WebSocket으로 나가므로 여기서 가로챈다).
  const 흐른것: string[] = [];
  beforeEach(async () => {
    await (await import("../src/engine/docdigest")).알림창닫기(); // 앞선 시험의 잔여 창 비우기
    흐른것.length = 0;
    const col = await import("../src/engine/collaboration");
    vi.spyOn(col, "emitCollaboration").mockImplementation((e) => { 흐른것.push(e.message); });
  });

  it("★ 요약이 끝나면 한 줄 흐른다 — 물어봐야만 아는 것은 알림이 아니다", async () => {
    putDoc("QA소식-알림.pdf", 0);
    vi.mocked(chat).mockResolvedValue("첫 줄입니다. 둘째 줄입니다. 셋째 줄입니다.");
    await makeDigest("QA소식-알림.pdf", "본문", "위협대응");
    await (await import("../src/engine/docdigest")).알림창닫기(); // 도배 방지 창(60초)을 지금 닫는다
    const 알림 = 흐른것.find((m) => m.includes("QA소식-알림.pdf"));
    expect(알림, "요약을 끝내고도 아무도 모른다").toBeTruthy();
    expect(알림!).toContain("요약 완료");
  });

  it("요약이 실패해도 알린다 — 들어온 사실은 알려야 한다", async () => {
    putDoc("QA소식-알림실패.pdf", 0);
    vi.mocked(chat).mockRejectedValue(new Error("모델 꺼짐"));
    await makeDigest("QA소식-알림실패.pdf", "본문", "일반");
    await (await import("../src/engine/docdigest")).알림창닫기();
    const 알림 = 흐른것.find((m) => m.includes("QA소식-알림실패.pdf"));
    expect(알림!).toContain("요약은 만들지 못했습니다");
  });
});

describe("문서 반입 소식 — 온톨로지 접점(슬라이스 3, 결정적)", () => {
  it("본문에 등장한 표제어의 연결 지식이 접점으로 나온다 — LLM 없이", () => {
    addTriple({ subject: "피싱공격", predicate: "완화통제", object: "이메일게이트웨이", source: "QA소식시드" });
    const 접점 = ontologyMatchesFor("이번 분기 피싱공격이 89% 증가했다는 보고입니다.");
    expect(접점.length).toBeGreaterThan(0);
    expect(접점.join("\n")).toContain("피싱공격");
  });

  it("아무 표제어도 안 나오면 접점 0건 — 억지로 잇지 않는다", () => {
    expect(ontologyMatchesFor("전혀 무관한 요리 이야기")).toHaveLength(0);
  });

  it("★ 일반 영단어는 표제어가 아니다 — 운영 실측 오탐(Logs·Environment) 재발 방지", () => {
    // CrowdStrike 실측(2026-08-06): "Logs"가 남의 장비 매뉴얼 트리플을 접점으로 끌어왔다
    addTriple({ subject: "Logs", predicate: "저장 파일", object: "sc-logs.txt", source: "QA소식시드" });
    addTriple({ subject: "Environment", predicate: "저장 파일", object: "sc-environment.txt", source: "QA소식시드" });
    const 접점 = ontologyMatchesFor("This report covers logs and environment across the cloud.");
    expect(접점.join("\n")).not.toContain("sc-logs");
    expect(접점.join("\n")).not.toContain("sc-environment");
    // 숫자·코드꼴은 자격 있음
    addTriple({ subject: "CVE-2021-44228", predicate: "완화통제", object: "Log4j 업그레이드", source: "QA소식시드" });
    expect(ontologyMatchesFor("The actor exploited CVE-2021-44228 in the wild.").join("\n")).toContain("CVE-2021-44228");
  });

  it("★ 목록 번호에서 잘리지 않는다 — 대량 반입 실측 재현(2026-08-07)", () => {
    // 실측: "…요약하면 다음과 같습니다: 1." 에서 끊긴 줄이 담당자에게 나갔다.
    const 실측꼴 = "운영 메모 4에서는 방화벽 정책 변경 절차가 다뤄져 있습니다. 정기 점검은 분기 1회입니다. 이 정보를 요약해보면 다음과 같습니다: 1. 방화벽 정책 변경 2. 피싱 대응";
    const r = 요약정리(실측꼴);
    expect(r.summary, "끝맺지 못한 꼬리가 요약에 남았다").not.toMatch(/[:：]$/m);
    expect(r.summary, "목록 번호에서 잘려 한 글자짜리 줄이 생겼다").not.toMatch(/^\s*\d\.?\s*$/m);
    for (const 줄 of r.summary!.split("\n")) expect(줄.length).toBeGreaterThanOrEqual(8);
  });

  it("★ 7B 복창 서두를 코드로 걷어내고 문장 셋으로 만든다 — 운영 실측 재현", () => {
    const 실측꼴 = "CROWDSTRIKE 2026 글로벌 위협 보고서에 대해 간략한 요약을 작성해주세요. 주요 포인트는 침해 가능성이 증가하였습니다. 공격자는 신뢰를 악용하여 빠르게 데이터 유출을 수행하였습니다. 속도가 가장 중요해지고 있습니다. 클라우드 위협도 증가하였습니다.";
    const r = 요약정리(실측꼴);
    expect(r.summary).not.toContain("작성해주세요"); // 지시 복창은 내용이 아니다
    expect(r.summary!.split("\n")).toHaveLength(3); // 한 덩어리가 아니라 세 줄
  });

  it("접점은 요약 실패와 무관하게 저장된다", async () => {
    addTriple({ subject: "피싱공격", predicate: "완화통제", object: "이메일게이트웨이", source: "QA소식시드" });
    putDoc("QA소식-접점.pdf", 0);
    vi.mocked(chat).mockRejectedValue(new Error("죽음"));
    await makeDigest("QA소식-접점.pdf", "피싱공격 동향 보고", "위협대응");
    const row = listRecentDocs(7).find((r) => r.documentId === "QA소식-접점.pdf")!;
    expect(row.matches).toContain("피싱공격");
  });
});

describe("★ 라우팅 — 안내한 말은 흔들리지 않는다", () => {
  const 도착 = (말: string) => forcedToolFor(말)?.tool;
  it("조회 물음은 recent_documents로 못 박힌다", () => {
    expect(도착("새 문서 뭐 들어왔어?")).toBe("recent_documents");
    expect(도착("새로 들어온 문서 알려줘")).toBe("recent_documents"); // today가 안내하는 그 문장
    expect(도착("최근 들어온 문서 보여줘")).toBe("recent_documents");
    expect(도착("들어온 문서 있어?")).toBe("recent_documents");
  });
  it("이웃 문장은 안 삼킨다 — 쓰기·다른 뜻·이웃 영토", () => {
    expect(도착("어제 들어온 문서 지워줘")).not.toBe("recent_documents");
    expect(도착("새 문서 만들어줘")).not.toBe("recent_documents");
    expect(도착("문서 보강해줘")).not.toBe("recent_documents");
    // 이웃 영토 존중(겹침 0): 반영 확인·재고 목록은 knowledge_status가 계속 맡는다
    expect(도착("최근 올린 문서 알려줘")).toBe("knowledge_status");
    expect(도착("들어온 문서 목록 줘")).toBe("knowledge_status");
  });
});

// ── B8 결함 — 「새 문서」 답이 읽히는 길이여야 한다(2026-09-12 설계관 지시서 · Sonnet 구현) ──
// 실측: 67편 반입 시 답이 2,260자로 「너무 긺」(tools/ops-sim.mjs 산문 상한 2,000자)에 걸렸다.
// 뿌리는 편수가 아니라 편당 상세였다 — 상세를 상위 `상세최대`편으로 좁히고 답 전체에 `답글자상한`
// 안전망을 둔다. 새 스텁 접두는 `QA소식길이-`로 잡아 위 beforeEach가 그대로 지운다.
const putDigest = (
  id: string,
  summary: string | null,
  matches: string | null = null,
  failedReason: string | null = null
) =>
  db.prepare(
    `INSERT INTO doc_digests (documentId, summary, keywords, matches, model, failedReason, madeAt)
     VALUES (?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT(documentId) DO UPDATE SET summary=excluded.summary, matches=excluded.matches,
       model=excluded.model, failedReason=excluded.failedReason, madeAt=excluded.madeAt`
  ).run(id, summary, matches, summary ? "로컬 모델 자체 요약" : null, failedReason, new Date().toISOString());

/** 분 단위로 벌려 넣는다 — ingestedAt DESC 정렬을 결정적으로 만든다(minutesAgo=0이 가장 최근).
 *  ⚠ putDoc(daysAgo=0)을 67번 부르면 밀리초 동률이 생겨 순서가 실행마다 갈린다(검토관 2026-09-12 [중]). */
const putDocAt = (id: string, minutesAgo: number, category = "일반", uploadedBy: string | null = "jyh") =>
  db.prepare(
    `INSERT INTO memory_documents (documentId, scope, chunks, ingestedAt, uploadedBy, category)
     VALUES (?, 'global', 2, ?, ?, ?)
     ON CONFLICT(documentId) DO UPDATE SET ingestedAt=excluded.ingestedAt`
  ).run(id, new Date(Date.now() - minutesAgo * 60_000).toISOString(), uploadedBy, category);

describe("★ B8 — 67편이 들어와도 읽히는 길이다", () => {
  it("상한·「외 N건」·건수 합·요약 실림(제품 함수로 대조)", () => {
    const 총건수 = 67;
    // 4100 실측 재현 — 맨 앞 두 편은 요약도 접점도 없는 builtin(용어사전·제품소개)이고,
    // 요약은 그 **다음** 편부터 붙어 있었다. 자리로만 상세를 고르면 요약 8편 중 1편만 남는다.
    for (let i = 0; i < 총건수; i++) {
      putDocAt(`QA소식길이-${i}.pdf`, i, i % 2 === 0 ? "위협대응" : "사내규정", i < 2 ? null : "jyh");
      if (i >= 2 && i < 10) {
        putDigest(`QA소식길이-${i}.pdf`, `${i}편 요약 첫 줄\n${i}편 요약 둘째 줄\n${i}편 요약 셋째 줄`, "피싱공격 —[완화통제]→ 이메일게이트웨이");
      }
    }
    const text = recentDocumentsText(7);
    expect(text.length, "산문 상한(1,800자, ops-sim.mjs 2,000의 90%)을 넘었다").toBeLessThanOrEqual(답글자상한);

    const total = listRecentDocs(7).length; // 제품 함수로 대조 — 시험이 새 잣대를 만들지 않는다
    const 머리매치 = text.match(/새 문서 (\d+)건/);
    expect(Number(머리매치?.[1])).toBe(total);

    const 갈래부분 = text.split(" — ")[1]?.split("\n")[0] ?? "";
    const 갈래합 = 갈래부분.split(" · ").reduce((acc, seg) => {
      const n = Number(seg.trim().split(/\s+/).pop());
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    expect(갈래합).toBe(total); // 머리의 갈래별 합 == listRecentDocs(days).length

    const 이름줄수 = (text.match(/^- /gm) || []).length;
    expect(이름줄수).toBe(목록최대);
    expect(text).toContain(`(외 ${total - 목록최대}건)`);

    // ★ 계약(tools/ops-sim.mjs ⑨ 「새 문서 뭐 들어왔어?」 주석 — 요약·접점까지 즉답이어야 한다).
    //   맨 앞 두 편에 소식이 없어도 요약이 `상세최대`편 실린다 — 길이 수리가 계약을 먹지 않는다.
    expect(text, "요약이 한 줄도 안 실렸다 — 자리로만 상세를 골랐다").toContain("2편 요약 첫 줄");
    expect((text.match(/편 요약 첫 줄/g) || []).length).toBe(상세최대);
    expect((text.match(/편 요약 셋째 줄/g) || []).length, "편당 요약은 2줄까지다").toBe(0);
    expect((text.match(/자체 요약/g) || []).length).toBe(1);
  });

  it("★ 최악치에서도 상한을 안 넘는다 — 옛 데이터는 120자 상한을 안 지났다", () => {
    // doc_digests에 직접 INSERT — 요약정리의 120자 상한은 **새로 만드는 요약에만** 걸리고
    // 이미 저장된 옛 값에는 안 걸린다(옛 데이터 재현).
    const 긴줄 = "가".repeat(300);
    const 긴요약 = [긴줄, 긴줄, 긴줄].join("\n");
    const 긴접점 = [긴줄, 긴줄].join("\n");
    const 총건수 = 67;
    for (let i = 0; i < 총건수; i++) {
      putDocAt(`QA소식길이-옛${"자".repeat(60)}-${i}`, i, "일반");
      putDigest(`QA소식길이-옛${"자".repeat(60)}-${i}`, 긴요약, 긴접점);
    }
    const text = recentDocumentsText(7);
    expect(text.length).toBeLessThanOrEqual(답글자상한);

    // ★ 예산은 **본문에서만** 깎는다(검토관 2026-09-12 [중]) — 답 끝을 통째로 자르면
    //   「67건」이라 말해 놓고 「(외 N건)」·표기·갈 곳이 사라져, 길이 불편이 「숫자만 주고
    //   갈 곳 없음」(ops-sim.mjs) 불편으로 바뀔 뿐이다. 셋 다 살아 있어야 한다.
    const 이름줄수 = (text.match(/^- /gm) || []).length;
    const total = listRecentDocs(7).length;
    expect(이름줄수, "예산에 걸렸는데도 본문이 안 깎였다").toBeLessThan(목록최대);
    expect(text, "「(외 N건)」이 잘려 나갔다 — 목록이 왜 짧은지 아무도 모른다").toContain(`(외 ${total - 이름줄수}건)`);
    expect(text, "「자체 요약」 표기가 잘려 나갔다(7B 오독 계약)").toContain("자체 요약");
    expect(text, "갈 곳 한 줄이 잘려 나갔다").toContain("AI 지식");
    expect(text).toMatch(/화면|메뉴|여기서|누르|열어|가서|＋|▸|물으면|물어보/);
  });

  it("상세는 소식 있는 앞 N편에만 붙는다 — 나머지는 이름만", () => {
    const 문서들 = Array.from({ length: 6 }, (_, i) => `QA소식길이-상세${i}.pdf`);
    // 정렬은 ingestedAt DESC — 분 단위로 벌려 순서를 결정적으로 만든다(i=0이 가장 최근).
    문서들.forEach((id, i) => {
      putDocAt(id, i);
      putDigest(id, "이 편의 요약 문장입니다.");
    });
    const text = recentDocumentsText(7);
    // 여섯 편 모두 소식이 있으므로 상세는 앞 `상세최대`편 — 그 다음 편이 상세 밖의 첫 문서다.
    // ⚠ 이름을 「넷째」로 적지 않는다(검토관 2026-09-12 [하]) — 상세최대를 바꾸면 이름이 거짓말이 된다.
    const 상세밖첫편 = 문서들[상세최대];
    const idx = text.indexOf(상세밖첫편);
    expect(idx, "이름 줄 자체가 없다").toBeGreaterThan(-1);
    const 다음문서 = text.indexOf("\n- ", idx + 1);
    const 이줄 = text.slice(idx, 다음문서 === -1 ? text.length : 다음문서);
    expect(이줄, "상세최대를 넘은 편에 요약이 붙었다").not.toContain("이 편의 요약 문장입니다");
  });

  it("「자체 요약」 표기는 답에 한 번만", () => {
    for (let i = 0; i < 5; i++) {
      putDoc(`QA소식길이-표기${i}.pdf`, 0, "일반");
      putDigest(`QA소식길이-표기${i}.pdf`, "요약입니다.");
    }
    const text = recentDocumentsText(7);
    const 등장 = (text.match(/자체 요약/g) || []).length;
    expect(등장).toBe(1);
  });

  it("요약이 하나도 없으면 「자체 요약」 표기가 아예 없다", () => {
    for (let i = 0; i < 3; i++) {
      putDoc(`QA소식길이-실패${i}.pdf`, 0, "일반");
      putDigest(`QA소식길이-실패${i}.pdf`, null, null, "모델 꺼짐");
    }
    const text = recentDocumentsText(7);
    expect(text).not.toContain("자체 요약");
    expect(text).toContain("요약 없음");
  });

  it("폴백 문구(FAIL_MARKS)가 안 섞인다 · 갈 곳이 한 곳이다", () => {
    putDoc("QA소식길이-fail1.pdf", 0, "일반");
    putDoc("QA소식길이-fail2.pdf", 1, "위협대응");
    const text = recentDocumentsText(7);
    // ⚠ FAIL_MARKS는 글자로 베끼지 않는다 — drawer-audit.mjs를 읽어 뽑는다(approvalstatustool.test.ts 계보).
    const 경로 = path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs");
    const src = fs.readFileSync(경로, "utf8");
    const 시작 = src.indexOf("const FAIL_MARKS = [");
    if (시작 < 0) throw new Error("FAIL_MARKS를 못 찾았다 — drawer-audit.mjs가 낡았다(이 시험을 손볼 것)");
    const 끝 = src.indexOf("];", 시작);
    const marks = [...src.slice(시작, 끝).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (marks.length === 0) throw new Error("FAIL_MARKS를 하나도 못 뽑았다 — 추출 정규식이 낡았다");
    for (const m of marks) expect(text, `폴백 문구 "${m}"가 섞였다`).not.toContain(m);

    // 갈 곳은 한 곳만 — 「AI 지식」과 「내 문서」가 동시에 나오면 두 화면을 가리키는 것이다.
    const AI지식있음 = text.includes("AI 지식");
    const 내문서있음 = text.includes("내 문서");
    expect(AI지식있음 && 내문서있음, "한 답에서 두 화면을 가리킨다").toBe(false);
    expect(AI지식있음, "갈 곳 자체가 없다").toBe(true);
    // ★ 한 번만 말한다(검토관 2026-09-12 [하]) — 같은 갈 곳을 두 줄로 적으면 글자 예산에서
    //   상세 반 편 값을 잡아먹는다. 글자 아끼자는 수리 안에서 같은 말을 두 번 하지 않는다.
    expect((text.match(/AI 지식/g) || []).length, "같은 갈 곳을 두 번 말한다").toBe(1);
    // ★ 없는 것을 가리키지 않는다(검토관 2026-09-12 [상]) — 요약이 사는 doc_digests를 읽는
    //   코드는 docdigest.ts 하나뿐이라 「AI 지식」 화면에 요약 전문은 없고(전수 grep),
    //   원본 열기 단추도 hasSource인 문서에만 뜬다(memory.html). 전체 목록만 약속한다.
    expect(text, "화면에 없는 것(요약 전문)을 약속한다").not.toContain("요약 전문");
    // ops-sim.mjs의 갈곳 정규식(화면|메뉴|여기서|누르|열어|가서|＋|▸|물으면|물어보)이 걸려야 한다.
    expect(text).toMatch(/화면|메뉴|여기서|누르|열어|가서|＋|▸|물으면|물어보/);
  });
});
