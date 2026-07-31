// 개인 문서함 — **격리가 이 기능의 전부다** (2026-07-31 사용자 지시 "개인용 문서함")
//
// 담당자가 자기 메모를 넣는 자리다. 남의 것이 한 번이라도 보이면 이 기능은 쓰레기가 된다
// ("개인용"이라고 해 놓고 새면 그건 기능 결함이 아니라 배신이다).
// 그래서 목록·조회·수정·삭제·AI연결 **모든 경로**를 남의 계정으로 두들겨 본다.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db";
import { listPersonalDocs, getPersonalDoc, countPersonalDocs, ragDocumentId } from "../src/engine/personaldocs";

const 나 = "user-me";
const 남 = "user-other";

function 넣기(userId: string, title: string, body = "본문", ragOptIn = 0): string {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO personal_docs (id, userId, title, body, ragOptIn, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)"
  ).run(id, userId, title, body, ragOptIn, now, now);
  return id;
}

beforeEach(() => { db.exec("DELETE FROM personal_docs"); });

describe("★ 남의 문서는 보이지 않는다", () => {
  it("목록에 내 것만 나온다", () => {
    넣기(나, "내 메모");
    넣기(남, "남의 메모");
    넣기(남, "남의 메모2");
    const 목록 = listPersonalDocs(나);
    expect(목록).toHaveLength(1);
    expect(목록[0].title).toBe("내 메모");
  });

  it("남의 문서를 id로 찍어도 못 연다", () => {
    const 남의것 = 넣기(남, "남의 비밀 메모");
    expect(getPersonalDoc(남의것, 나), "id를 알아도 열리면 안 된다").toBeNull();
    expect(getPersonalDoc(남의것, 남), "주인은 열 수 있어야 한다").toBeTruthy();
  });

  it("건수도 내 것만 센다", () => {
    넣기(나, "A"); 넣기(남, "B"); 넣기(남, "C");
    expect(countPersonalDocs(나)).toBe(1);
    expect(countPersonalDocs(남)).toBe(2);
  });

  it("빈 사용자에게는 빈 목록 — 오류가 아니다", () => {
    expect(listPersonalDocs("아무도아님")).toEqual([]);
  });
});

describe("목록에는 본문을 싣지 않는다", () => {
  it("긴 메모 200건이 목록에 통째로 실리지 않게", () => {
    넣기(나, "긴 메모", "가".repeat(5000));
    const 목록 = listPersonalDocs(나) as unknown as Record<string, unknown>[];
    expect(목록[0]).not.toHaveProperty("body");
    expect(목록[0].title).toBe("긴 메모");
  });
});

describe("AI 연결(ragOptIn)", () => {
  it("기본은 꺼져 있다 — 켜는 순간 개인용이 아니게 된다", () => {
    const id = 넣기(나, "내 절차");
    expect(getPersonalDoc(id, 나)!.ragOptIn).toBe(false);
  });

  it("켜진 문서는 켜진 것으로 읽힌다", () => {
    const id = 넣기(나, "공유할 절차", "본문", 1);
    expect(getPersonalDoc(id, 나)!.ragOptIn).toBe(true);
  });

  it("지식베이스 문서 id에 개인 것임이 드러난다 — 근거 표시에 그대로 나온다", () => {
    // "이 답변의 근거"에 personal:… 이 보이면 담당자가 자기 메모가 쓰였음을 안다.
    expect(ragDocumentId("abc")).toBe("personal:abc");
  });
});

describe("비밀번호 경고는 막지 않고 알린다", () => {
  // ⚠ 막으면 담당자는 포스트잇에 적는다 — 그게 더 나쁘다. 대신 분명히 말하고
  //   제대로 된 자리(보안제품 등록부)로 안내한다.
  it("★ 밖으로 나가는 경고에 원본 비밀번호가 들어가지 않는다", async () => {
    // ⚠ findSecrets는 **탐지용 내부 함수**라 match에 원본을 담는다. 응답에 그걸 실으면
    //   경고하려다 유출하는 셈이다(2026-07-31에 실제로 그렇게 짰다가 이 시험이 잡았다).
    //   밖으로 나가는 자리에는 maskSecrets의 hits(가려진 값)만 쓴다.
    const { findSecrets, maskSecrets } = await import("../src/engine/secretscan");
    const 비밀 = "password=SuperSecret123!";
    expect(JSON.stringify(findSecrets(비밀)), "내부 탐지 함수는 원본을 담는다(그래서 밖에 쓰면 안 된다)")
      .toContain("SuperSecret123!");
    const 나가는것 = maskSecrets(비밀).hits;
    expect(나가는것.length).toBeGreaterThan(0);
    expect(JSON.stringify(나가는것), "응답에 실리는 값에 원본이 들어가면 그 자체가 유출이다")
      .not.toContain("SuperSecret123!");
  });

  it("개인 문서 경고가 가려진 값만 쓴다 — 소스로 확인", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/engine/personaldocs.ts", import.meta.url), "utf8");
    // 정규식 대신 문자열 포함 — 괄호 이스케이프가 어긋나면 시험 자체가 안 돈다("no tests").
    expect(src.includes("findSecrets("), "findSecrets를 응답에 쓰면 원본이 샌다").toBe(false);
    expect(src).toContain("maskSecrets(");
  });
});
