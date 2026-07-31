// 지식 번들 서명 검증 (계획서 후-3 2단계)
//
// ■ 이 시험이 지키는 것
//   번들 반입은 그대로 두면 **공급망 공격 경로**다. 가짜 번들 하나로 온톨로지를 오염시키면
//   그 뒤 AI가 하는 모든 답이 조작된다. 간접 프롬프트 주입과 같은 계열인데 파급이 훨씬 크다 —
//   그건 답 하나가 흔들리고 이건 지식 자체가 바뀐다.
//
// ■ 그래서 여기서는 **공격자가 할 법한 것을 하나씩 해 본다.** 정상 통과 시험보다 이쪽이 본체다.
//   서명을 빼기 / 남의 키로 서명 / 내용만 바꾸기 / 매니페스트만 바꾸기 / 개수 속이기 /
//   문서 바꿔치기 / 경로 섞은 파일명 / 압축 폭탄 / 깨진 파일.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { verifyBundle, canonicalJson, sha256Hex, isSafeDocName, BUNDLE_FORMAT, BUNDLE_PUBLIC_KEYS } from "../src/engine/bundleverify";

// ── 시험용 발행 키 — 제품에 실린 공개키와 **짝이 아니다**(남의 키 시나리오에 쓴다) ──
const 남의키 = crypto.generateKeyPairSync("ed25519");

/** 제품이 신뢰하는 키로 서명할 수 없으므로(개인키는 저장소 밖), 공개키를 바꿔 끼워 시험한다. */
function withTestKey<T>(pub: crypto.KeyObject, fn: () => T): T {
  const 원본 = [...BUNDLE_PUBLIC_KEYS];
  BUNDLE_PUBLIC_KEYS.length = 0;
  BUNDLE_PUBLIC_KEYS.push({ keyId: "test-key", spkiBase64: pub.export({ type: "spki", format: "der" }).toString("base64") });
  try { return fn(); } finally { BUNDLE_PUBLIC_KEYS.length = 0; BUNDLE_PUBLIC_KEYS.push(...원본); }
}

const 발행키 = crypto.generateKeyPairSync("ed25519");

function makeBundle(over: Record<string, unknown> = {}, keyPair = 발행키, keyId = "test-key") {
  const payload = {
    ontology: [{ subject: "T1059", predicate: "완화", object: "실행 정책 제한", scope: "global", source: "attack" }],
    docs: [{ file: "위협모델.md", sha256: sha256Hex(Buffer.from("본문")), contentBase64: Buffer.from("본문").toString("base64") }],
  };
  const manifest = {
    version: "2026.10-1",
    issuedAt: "2026-10-01T00:00:00.000Z",
    producer: "test",
    counts: { triples: payload.ontology.length, docs: payload.docs.length },
    attributions: ["MITRE ATT&CK® — © The MITRE Corporation."],
    payloadSha256: sha256Hex(canonicalJson(payload)),
  };
  const file = {
    format: BUNDLE_FORMAT,
    manifest,
    signature: {
      alg: "Ed25519",
      keyId,
      sig: crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), keyPair.privateKey).toString("base64"),
    },
    payload,
    ...over,
  };
  return { file, gz: () => zlib.gzipSync(Buffer.from(JSON.stringify(file), "utf8")) };
}

const gzipOf = (obj: unknown) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8"));

describe("정상 번들은 통과한다", () => {
  it("서명·해시가 맞으면 내용을 돌려준다", () => {
    const r = withTestKey(발행키.publicKey, () => verifyBundle(makeBundle().gz()));
    expect(r.ok, r.reason).toBe(true);
    expect(r.manifest?.version).toBe("2026.10-1");
    expect(r.payload?.ontology).toHaveLength(1);
  });
});

describe("공격 시나리오 — 전부 거부해야 한다", () => {
  it("서명을 빼면 거부 (예외를 두면 공격자는 서명을 빼고 보낸다)", () => {
    const { file } = makeBundle();
    const r = withTestKey(발행키.publicKey, () => verifyBundle(gzipOf({ ...file, signature: undefined })));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("서명이 없는");
    expect(r.payload, "거부했으면 내용을 넘기면 안 된다").toBeUndefined();
  });

  it("남의 키로 서명하면 거부", () => {
    const r = withTestKey(발행키.publicKey, () => verifyBundle(makeBundle({}, 남의키).gz()));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("서명이 맞지 않");
  });

  it("모르는 keyId면 거부", () => {
    const r = withTestKey(발행키.publicKey, () => verifyBundle(makeBundle({}, 발행키, "누군가의-키").gz()));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("모르는 서명 키");
  });

  it("★ 진짜 매니페스트에 가짜 내용을 붙이면 거부 — 서명은 매니페스트만 덮으므로 이게 핵심이다", () => {
    const { file } = makeBundle();
    const 가짜 = {
      ...file,
      payload: { ...file.payload, ontology: [{ subject: "T1059", predicate: "완화", object: "조치 불필요", scope: "global", source: "attack" }] },
    };
    const r = withTestKey(발행키.publicKey, () => verifyBundle(gzipOf(가짜)));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("서명된 목록과 다릅니다");
  });

  it("매니페스트를 고치면 서명이 깨져 거부(버전만 올려도)", () => {
    const { file } = makeBundle();
    const r = withTestKey(발행키.publicKey, () =>
      verifyBundle(gzipOf({ ...file, manifest: { ...file.manifest, version: "2027.01-1" } }))
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("서명이 맞지 않");
  });

  it("문서 내용을 바꿔치기하면 지문이 안 맞아 거부", () => {
    const payload = {
      ontology: [],
      docs: [{ file: "안내.md", sha256: sha256Hex(Buffer.from("원본")), contentBase64: Buffer.from("바뀐 내용").toString("base64") }],
    };
    const manifest = {
      version: "2026.10-1", issuedAt: "2026-10-01T00:00:00.000Z", producer: "test",
      counts: { triples: 0, docs: 1 }, attributions: [], payloadSha256: sha256Hex(canonicalJson(payload)),
    };
    const file = {
      format: BUNDLE_FORMAT, manifest,
      signature: { alg: "Ed25519", keyId: "test-key", sig: crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), 발행키.privateKey).toString("base64") },
      payload,
    };
    const r = withTestKey(발행키.publicKey, () => verifyBundle(gzipOf(file)));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("문서 지문이 맞지 않");
  });

  it("개수를 속이면 거부 — 목록과 실제가 달라도 안 받는다", () => {
    const payload = { ontology: [], docs: [] };
    const manifest = {
      version: "2026.10-1", issuedAt: "2026-10-01T00:00:00.000Z", producer: "test",
      counts: { triples: 999, docs: 0 }, attributions: [], payloadSha256: sha256Hex(canonicalJson(payload)),
    };
    const file = {
      format: BUNDLE_FORMAT, manifest,
      signature: { alg: "Ed25519", keyId: "test-key", sig: crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), 발행키.privateKey).toString("base64") },
      payload,
    };
    const r = withTestKey(발행키.publicKey, () => verifyBundle(gzipOf(file)));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("목록과 실제 내용이 다릅니다");
  });

  it("다른 서명 방식이라 우기면 거부", () => {
    const { file } = makeBundle();
    const r = withTestKey(발행키.publicKey, () =>
      verifyBundle(gzipOf({ ...file, signature: { ...file.signature, alg: "none" } }))
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("지원하지 않는 서명 방식");
  });

  it("모르는 형식이면 거부 — 옛 코드가 새 형식을 제멋대로 해석하지 않는다", () => {
    const { file } = makeBundle();
    const r = withTestKey(발행키.publicKey, () => verifyBundle(gzipOf({ ...file, format: "gijobundle/9" })));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("지원하지 않는 번들 형식");
  });
});

describe("깨진 입력에 무너지지 않는다", () => {
  // 반입 화면이 스택트레이스를 보여주면 그것 자체가 정보 노출이다 — 전부 사유 한 줄로 돌려준다.
  it.each([
    ["빈 파일", Buffer.alloc(0)],
    ["gzip이 아님", Buffer.from("이건 그냥 글자입니다")],
    ["잘린 gzip", zlib.gzipSync(Buffer.from("{}")).subarray(0, 5)],
    ["gzip 안이 JSON이 아님", zlib.gzipSync(Buffer.from("헬로"))],
  ])("%s → 예외 없이 거부", (_이름, buf) => {
    const r = verifyBundle(buf as Buffer);
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe("string");
  });

  it("압축 폭탄은 풀다가 막는다", () => {
    // 1GB의 0을 gzip하면 1MB 남짓이다 — 상한이 없으면 메모리를 통째로 먹는다.
    const bomb = zlib.gzipSync(Buffer.alloc(400 * 1024 * 1024, 0x41));
    const r = verifyBundle(bomb);
    expect(r.ok).toBe(false);
  }, 60000);
});

describe("문서 이름은 파일명만 받는다", () => {
  // zip을 안 써서 풀어 쓰는 경로가 없지만, 이름은 그대로 파일로 기록된다.
  it.each(["../../etc/passwd", "..\\..\\windows\\system32\\x.md", "/절대경로.md", "a/b.md", ".숨김.md", "", "x".repeat(250) + ".md"])(
    "거부: %s",
    (n) => expect(isSafeDocName(n)).toBe(false)
  );
  it("널바이트가 섞이면 거부", () => expect(isSafeDocName("정상\0.md")).toBe(false));
  it.each(["위협모델.md", "KISA 대응지침 (2026).md", "notes.txt", "seed-data.json"])(
    "허용: %s",
    (n) => expect(isSafeDocName(n)).toBe(true)
  );
  it("경로가 섞인 문서명은 번들 검증에서도 걸린다", () => {
    const payload = {
      ontology: [],
      docs: [{ file: "../탈출.md", sha256: sha256Hex(Buffer.from("x")), contentBase64: Buffer.from("x").toString("base64") }],
    };
    const manifest = {
      version: "2026.10-1", issuedAt: "2026-10-01T00:00:00.000Z", producer: "test",
      counts: { triples: 0, docs: 1 }, attributions: [], payloadSha256: sha256Hex(canonicalJson(payload)),
    };
    const file = {
      format: BUNDLE_FORMAT, manifest,
      signature: { alg: "Ed25519", keyId: "test-key", sig: crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), 발행키.privateKey).toString("base64") },
      payload,
    };
    const r = withTestKey(발행키.publicKey, () => verifyBundle(gzipOf(file)));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("문서 이름이 올바르지 않");
  });
});

describe("결정적 직렬화 — 여기가 흔들리면 서명이 통째로 무의미해진다", () => {
  it("키 순서가 달라도 같은 문자열이 나온다", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it("중첩된 객체도 정렬한다", () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });
  it("배열 순서는 유지한다 — 순서가 뜻을 갖는 자리다", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("한글·특수문자를 넣어도 왕복한다", () => {
    const v = { 제목: "취약점 \"인용\"·\n줄바꿈", n: null, t: true };
    expect(JSON.parse(canonicalJson(v))).toEqual(v);
  });
});

describe("제품에 실린 공개키", () => {
  it("실제 Ed25519 공개키로 읽힌다 — 오타 하나면 모든 번들이 거부된다", () => {
    for (const k of BUNDLE_PUBLIC_KEYS) {
      const pub = crypto.createPublicKey({ key: Buffer.from(k.spkiBase64, "base64"), format: "der", type: "spki" });
      expect(pub.asymmetricKeyType).toBe("ed25519");
    }
  });
  it("최소 한 개는 있어야 한다 — 비면 아무 번들도 못 받는다", () => {
    expect(BUNDLE_PUBLIC_KEYS.length).toBeGreaterThan(0);
  });
});
