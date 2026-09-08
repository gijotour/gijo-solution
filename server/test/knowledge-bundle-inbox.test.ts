// 후-3 지식 번들 구독화 — 대화창 조회·반입 슬라이스.
// [전중후 계획서 정렬] 후-3: 담당자가 "지금 실린 지식이 언제 기준인가"를 스스로 보고,
//   파일로 받은 번들을 대화창에서 **서명 검증 후** 반입한다. 화면 없이 챗봇 도구 2종으로.
//
// ⚠ 이 시험은 세 가지를 지킨다:
//   ① 라우팅을 **실제 함수(forcedToolFor)**로 대조한다 — 정규식을 베끼면 코드와 어긋난다.
//   ② 반입은 **admin만**이고 **서명이 맞을 때만** — 안 맞으면 거부하고 감사기록에 남긴다.
//   ③ 이 시험이 헛돌지 않는지: 통제 문구가 제 도구로 가는지 함께 잰다.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

// 문서 인입(임베딩)은 무겁다 — 반입의 온톨로지·상태 기록만 본다(멱등 자체는 각 모듈 시험 몫).
// ⚠ 목의 모양은 **진짜 반환값을 따라간다**(2026-09-08 적발⑧) — updated·removed가 빠져 있어서
// 갱신 편수를 세는 코드를 넣자 이 시험이 TypeError로 죽었다. 진짜 반환값이 바뀌면 여기도 따라온다.
const docsMock = vi.fn(async () => ({ ingested: [] as string[], skipped: [] as string[], updated: [] as string[], missing: [], removed: [], failed: [] }));
vi.mock("../src/engine/docsbundle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/docsbundle")>()),
  bootstrapDocsBundle: () => docsMock(),
}));

import { canonicalJson, sha256Hex, BUNDLE_FORMAT, BUNDLE_PUBLIC_KEYS } from "../src/engine/bundleverify";
import { listInboxBundles, importBundleFromInbox, BUNDLE_INBOX_DIR } from "../src/engine/knowledgebundle";
import { forcedToolFor } from "../src/engine/agentloop";
import { findAgentTool } from "../src/engine/agenttools";
import { listAudit } from "../src/engine/audit";
import { dispatchInstruction } from "../src/engine/dispatcher";

// ── 서명 번들 만들기 (bundleverify.test.ts와 같은 방식) ──────────────────────
const 발행키 = crypto.generateKeyPairSync("ed25519");

function withTestKey<T>(pub: crypto.KeyObject, fn: () => T): T {
  const 원본 = [...BUNDLE_PUBLIC_KEYS];
  BUNDLE_PUBLIC_KEYS.length = 0;
  BUNDLE_PUBLIC_KEYS.push({ keyId: "test-key", spkiBase64: pub.export({ type: "spki", format: "der" }).toString("base64") });
  try { return fn(); } finally { BUNDLE_PUBLIC_KEYS.length = 0; BUNDLE_PUBLIC_KEYS.push(...원본); }
}

/** 빈 payload(온톨로지·문서 0건)로 서명한 최소 번들의 gzip 바이트. 반입 자체만 본다. */
function 서명번들gz(version = "2026.10-1"): Buffer {
  const payload = { ontology: [] as unknown[], docs: [] as unknown[] };
  const manifest = {
    version, issuedAt: "2026-10-01T00:00:00.000Z", producer: "시험",
    counts: { triples: 0, docs: 0 }, attributions: [], payloadSha256: sha256Hex(canonicalJson(payload)),
  };
  const file = {
    format: BUNDLE_FORMAT, manifest, payload,
    signature: { alg: "Ed25519", keyId: "test-key", sig: crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), 발행키.privateKey).toString("base64") },
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(file), "utf8"));
}

// 대기 폴더 정리 — 실제 BUNDLE_INBOX_DIR을 쓰되 내가 만든 파일만 지운다.
let 폴더선존: boolean;
const 쓴파일: string[] = [];
function 대기에쓰기(name: string, buf: Buffer): void {
  fs.writeFileSync(path.join(BUNDLE_INBOX_DIR, name), buf);
  쓴파일.push(name);
}
beforeEach(() => {
  폴더선존 = fs.existsSync(BUNDLE_INBOX_DIR);
  fs.mkdirSync(BUNDLE_INBOX_DIR, { recursive: true });
  쓴파일.length = 0;
  docsMock.mockClear();
});
afterEach(() => {
  for (const n of 쓴파일) { try { fs.rmSync(path.join(BUNDLE_INBOX_DIR, n)); } catch { /* 이미 없음 */ } }
  // 폴더가 원래 없었고 지금 비었으면 되돌린다 — 시험이 자취를 남기지 않는다.
  if (!폴더선존) { try { if (fs.readdirSync(BUNDLE_INBOX_DIR).length === 0) fs.rmdirSync(BUNDLE_INBOX_DIR); } catch { /* 남은 파일 있음 */ } }
});

describe("대화창 라우팅 — 지식 번들 상태·반입", () => {
  it("「지식 번들 상태」류는 knowledge_bundle_status로 간다", () => {
    for (const q of ["지식 번들 상태 알려줘", "지금 실린 지식 언제 기준이야?", "번들 버전 뭐야", "지식 번들 현황"]) {
      expect(forcedToolFor(q, { role: "admin" })?.tool, `"${q}"`).toBe("knowledge_bundle_status");
    }
  });

  it("「번들 넣어줘」류는 admin에게 knowledge_bundle_import로 간다(결재판)", () => {
    for (const q of ["지식 번들 넣어줘", "새 번들 반입해줘", "번들 적용해줘"]) {
      expect(forcedToolFor(q, { role: "admin" })?.tool, `"${q}"`).toBe("knowledge_bundle_import");
    }
  });

  it("반입은 admin만 — 일반 담당자에겐 import로 새지 않는다", () => {
    // requiredRole:"admin"이라 도구가 목록에서 숨는다 → 강제 라우팅이 그 도구로 못 간다.
    expect(forcedToolFor("지식 번들 넣어줘", {})?.tool ?? null).not.toBe("knowledge_bundle_import");
  });

  it("이 라우팅 대조가 헛돌지 않는다 — 통제 문구가 제 도구로 간다", () => {
    expect(forcedToolFor("오늘 뭐부터 조치해야 해?", {})?.tool).toBe("today");
  });
});

// ⚠ forcedToolFor에 {role:"admin"}을 **직접** 넘기면 위 시험은 통과하지만, 실제 대화창은
//   dispatch 파이프라인이 사용자 권한을 scope로 실어 날라야 admin 도구가 보인다. 2026-08-04
//   E2E에서 "지식 번들 넣어줘"가 **권한 누락으로** 상태 조회로 새는 것을 잡았다(파이프라인이
//   viewer에 role을 안 실었음). 그 통합 지점을 여기서 결정적으로 지킨다 — 단위 라우팅과 다른 축.
describe("파이프라인이 권한을 실어 admin 도구를 라우팅한다 (E2E가 잡은 결함)", () => {
  it("admin이 「지식 번들 넣어줘」라 하면 반입 결재판이 뜬다", async () => {
    const r = await dispatchInstruction("지식 번들 넣어줘", undefined, undefined, "관리자시험", true, undefined, { role: "admin" });
    expect(r.approval?.tool).toBe("knowledge_bundle_import");
  });
  it("권한이 없으면 반입으로 새지 않는다 — 도구가 목록에서 숨는다", async () => {
    const r = await dispatchInstruction("지식 번들 넣어줘", undefined, undefined, "일반시험", true, undefined, {});
    expect(r.approval?.tool ?? null).not.toBe("knowledge_bundle_import");
  });
});

describe("번들 현황 도구 출력", () => {
  it("버전(언제 기준)·표준·출처 표시를 답한다", async () => {
    const t = findAgentTool("knowledge_bundle_status");
    expect(t, "knowledge_bundle_status 도구가 없다").toBeTruthy();
    const out = String(await t!.run({}));
    expect(out).toContain("지금 실린 지식");
    expect(out).toMatch(/번들\s*20\d\d\.\d/);   // CalVer 버전 표기
    expect(out).toContain("표준 지식");
    expect(out).toMatch(/출처 표시/);
  });

  it("읽기 도구이고 반입은 admin 쓰기 도구다(결재판·되돌리기 고지 있음)", () => {
    const s = findAgentTool("knowledge_bundle_status")!;
    const i = findAgentTool("knowledge_bundle_import")!;
    expect(s.write).toBe(false);
    expect(i.write).toBe(true);
    expect(i.requiredRole).toBe("admin");
    expect((i.effect?.({ file: "x.gijobundle" }) ?? "").length).toBeGreaterThan(10);
    expect((i.undo ?? "").length).toBeGreaterThan(5);
  });
});

describe("반입 대기 폴더", () => {
  it("폴더가 비면 대기 목록이 빈다", () => {
    expect(listInboxBundles()).toEqual([]);
  });

  it("서명이 안 맞는 파일은 목록에 반입 불가로 뜬다", () => {
    대기에쓰기("가짜.gijobundle", zlib.gzipSync(Buffer.from("이건 번들이 아니다")));
    const list = listInboxBundles();
    const b = list.find((x) => x.file === "가짜.gijobundle");
    expect(b, "가짜 파일이 목록에 없다").toBeTruthy();
    expect(b!.ok).toBe(false);
    expect(b!.reason && b!.reason.length).toBeGreaterThan(0);
  });

  it("서명 검증 실패 반입은 거부하고 감사기록에 남긴다", async () => {
    대기에쓰기("가짜2.gijobundle", zlib.gzipSync(Buffer.from("깨진 번들")));
    const r = await importBundleFromInbox("가짜2.gijobundle", "시험자");
    expect(r.ok).toBe(false);
    const blocked = listAudit({ kind: "block", limit: 50 })
      .find((e) => e.action.includes("번들 반입 거부") && e.target === "가짜2.gijobundle");
    expect(blocked, "거부가 감사기록에 안 남았다").toBeTruthy();
    expect(blocked!.result).toBe("blocked");
  });

  it("경로가 섞인 이름·잘못된 확장자는 폴더 밖을 못 읽는다", async () => {
    expect((await importBundleFromInbox("../../etc/passwd", "시험자")).ok).toBe(false);
    expect((await importBundleFromInbox("notabundle.txt", "시험자")).ok).toBe(false);
    expect((await importBundleFromInbox("없는파일.gijobundle", "시험자")).ok).toBe(false);
  });

  it("서명이 통과한 번들은 반입되고 목록에 버전이 뜬다", async () => {
    대기에쓰기("좋은.gijobundle", 서명번들gz("2026.10-1"));
    // 목록: 서명까지 확인해 버전을 읽는다
    const list = withTestKey(발행키.publicKey, () => listInboxBundles());
    const b = list.find((x) => x.file === "좋은.gijobundle");
    expect(b?.ok, `반입 불가로 떴다: ${b?.reason}`).toBe(true);
    expect(b!.version).toBe("2026.10-1");
    // 반입: verifyBundle은 동기(첫 await 이전)라 키 교체 창 안에서 끝난다.
    const p = withTestKey(발행키.publicKey, () => importBundleFromInbox("좋은.gijobundle", "시험자"));
    const r = await p;
    expect(r.ok, r.ok ? "" : (r as { reason: string }).reason).toBe(true);
    if (r.ok) expect(r.version).toBe("2026.10-1");
    expect(docsMock).toHaveBeenCalled(); // 기존 멱등 인입 경로를 재사용했다
  });
});
