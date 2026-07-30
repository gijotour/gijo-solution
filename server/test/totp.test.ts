// TOTP 정확성 — **RFC 6238 부록 B 공식 시험 벡터**로 못박는다.
// 자체 구현이라 "내 코드끼리 일치"로는 아무것도 증명하지 못한다. 표준이 정한 정답과 맞아야
// 시중 인증앱(Google/Microsoft Authenticator)이 만든 숫자를 우리가 받아들일 수 있다.
import { describe, it, expect } from "vitest";
import {
  base32Encode, base32Decode, generateSecret, hotp, totpCode, verifyTotp, counterFor,
  otpauthUri, formatSecretForDisplay, generateRecoveryCodes, normalizeRecoveryCode,
  TOTP_STEP_SEC, TOTP_DIGITS,
} from "../src/auth/totp";

// RFC 6238 부록 B 시험 비밀키: ASCII "12345678901234567890" (20바이트, SHA-1)
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_B32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, "ascii"));

describe("base32 (RFC 4648)", () => {
  it("RFC 시험 비밀키를 표준 base32로 인코딩한다", () => {
    // 인증앱에 넣는 키 문자열 — 이 값이 틀리면 앱이 다른 숫자를 만든다.
    expect(RFC_SECRET_B32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("인코딩→디코딩이 원본으로 돌아온다(왕복)", () => {
    for (let n = 1; n <= 24; n++) {
      const buf = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255));
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  it("사람이 옮겨 적은 형태(공백·하이픈·소문자·패딩)를 관용한다", () => {
    const want = base32Decode(RFC_SECRET_B32);
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(want)).toBe(true);
    expect(base32Decode("GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ").equals(want)).toBe(true);
    expect(base32Decode(RFC_SECRET_B32 + "==").equals(want)).toBe(true);
  });

  it("base32에 없는 문자는 거부한다 — 조용히 엉뚱한 키를 만들면 안 된다", () => {
    expect(() => base32Decode("ABC1DEF")).toThrow(); // 1은 base32 알파벳에 없다
    expect(() => base32Decode("")).toThrow();
  });
});

describe("TOTP — RFC 6238 부록 B 시험 벡터", () => {
  // [시각(초), 8자리 정답] — 표의 SHA-1 행. 6자리는 뒤 6글자.
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [sec, expected8] of vectors) {
    it(`t=${sec}s → ${expected8}`, () => {
      const counter = Math.floor(sec / TOTP_STEP_SEC);
      expect(hotp(Buffer.from(RFC_SECRET_ASCII, "ascii"), counter, 8)).toBe(expected8);
      // 제품이 쓰는 6자리는 같은 값의 뒤 6글자여야 한다.
      expect(totpCode(RFC_SECRET_B32, sec * 1000, 6)).toBe(expected8.slice(-6));
    });
  }

  it("30초 안에서는 같은 숫자, 넘어가면 바뀐다", () => {
    const base = 1111111111 * 1000;
    expect(totpCode(RFC_SECRET_B32, base)).toBe(totpCode(RFC_SECRET_B32, base + 999));
    expect(counterFor(base)).not.toBe(counterFor(base + 30_000));
  });

  it("비밀키를 새로 만들면 160비트(20바이트)다 — RFC 4226 권고 길이", () => {
    const s = generateSecret();
    expect(base32Decode(s).length).toBe(20);
    expect(generateSecret()).not.toBe(s); // 무작위
  });
});

describe("검증 — 통과·거부·재사용", () => {
  const at = 1111111111 * 1000;
  const code = totpCode(RFC_SECRET_B32, at);

  it("맞은 코드는 통과하고 어느 칸이었는지 알려준다", () => {
    const r = verifyTotp(RFC_SECRET_B32, code, { atMs: at });
    expect(r.ok).toBe(true);
    expect(r.counter).toBe(counterFor(at));
  });

  it("시계 오차 ±30초(1칸)까지는 받아준다 — 폐쇄망 서버·휴대폰 시각이 정확히 같을 수 없다", () => {
    expect(verifyTotp(RFC_SECRET_B32, code, { atMs: at + 30_000 }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, { atMs: at - 30_000 }).ok).toBe(true);
  });

  it("2칸(60초) 넘게 어긋나면 거부한다 — 훔쳐본 숫자를 오래 쓰지 못하게", () => {
    expect(verifyTotp(RFC_SECRET_B32, code, { atMs: at + 65_000 }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, code, { atMs: at - 65_000 }).ok).toBe(false);
  });

  it("한 번 쓴 칸은 다시 못 쓴다(재사용 방지) — RFC 6238 §5.2", () => {
    const first = verifyTotp(RFC_SECRET_B32, code, { atMs: at });
    expect(first.ok).toBe(true);
    const again = verifyTotp(RFC_SECRET_B32, code, { atMs: at, lastCounter: first.counter });
    expect(again.ok).toBe(false);
    expect(again.reason).toBe("재사용");
  });

  it("이전 칸의 코드도 거부한다 — 허용 범위 안이라도 이미 지난 칸이면 안 된다", () => {
    const older = totpCode(RFC_SECRET_B32, at - 30_000);
    const r = verifyTotp(RFC_SECRET_B32, older, { atMs: at, lastCounter: counterFor(at) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("재사용");
  });

  it("형식이 아닌 입력은 형식 오류로 구분한다(6자리 숫자만)", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5", "  "]) {
      const r = verifyTotp(RFC_SECRET_B32, bad, { atMs: at });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("형식");
    }
  });

  it("공백이 섞인 6자리는 받아준다 — 화면이 '418 902'처럼 띄워 보여주기 때문", () => {
    const spaced = code.slice(0, 3) + " " + code.slice(3);
    expect(verifyTotp(RFC_SECRET_B32, spaced, { atMs: at }).ok).toBe(true);
  });

  it("다른 비밀키의 코드는 통과하지 못한다", () => {
    expect(verifyTotp(generateSecret(), code, { atMs: at }).ok).toBe(false);
  });

  it("비밀키가 깨져 있으면 통과가 아니라 형식 오류로 실패한다(조용한 통과 금지)", () => {
    const r = verifyTotp("이건-base32가-아니다", code, { atMs: at });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("형식");
  });
});

describe("인증앱 연동 표현", () => {
  it("otpauth URI에 앱이 필요한 값이 전부 들어간다", () => {
    const uri = otpauthUri(RFC_SECRET_B32, "jyh");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(encodeURIComponent("GIJO AS:jyh"));
    expect(uri).toContain(`secret=${RFC_SECRET_B32}`);
    expect(uri).toContain(`digits=${TOTP_DIGITS}`);
    expect(uri).toContain(`period=${TOTP_STEP_SEC}`);
    expect(uri).toContain("algorithm=SHA1");
  });

  it("표시용 키는 4글자씩 끊되 원본과 같은 값이다", () => {
    const shown = formatSecretForDisplay(RFC_SECRET_B32);
    expect(shown).toBe("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
    expect(base32Decode(shown).equals(base32Decode(RFC_SECRET_B32))).toBe(true);
  });
});

describe("복구 코드", () => {
  it("10개를 만들고 서로 다르다", () => {
    const codes = generateRecoveryCodes();
    expect(codes.length).toBe(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("혼동 문자(0·O·1·I·L)를 쓰지 않는다 — 종이에 적어 옮기는 값이라", () => {
    for (const c of generateRecoveryCodes(50)) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });

  it("하이픈·공백·소문자를 넣어도 같은 값으로 본다", () => {
    expect(normalizeRecoveryCode("7k3f-qp92")).toBe("7K3FQP92");
    expect(normalizeRecoveryCode(" 7K3F QP92 ")).toBe("7K3FQP92");
  });
});
