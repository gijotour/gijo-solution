// auth/totp.ts — 시간 기반 1회용 비밀번호(TOTP, RFC 6238) 핵심.
//
// 왜 이 방식인가: 이 제품은 폐쇄망(인터넷 없음)에 놓인다. 문자·이메일 인증은 망 밖으로
// 나가야 하므로 아예 쓸 수 없다. TOTP는 서버와 휴대폰이 **같은 시계**만 보면 되고 통신이
// 전혀 필요 없다 — 폐쇄망에서 되는 유일한 2차 인증이고, 표준 인증앱(Google/Microsoft
// Authenticator 등)을 그대로 쓸 수 있다.
//
// 외부 라이브러리를 쓰지 않는다: 알고리즘이 HMAC 한 줄이라 node crypto로 충분하고,
// 인증 경로에 남의 코드를 넣지 않는 편이 검증하기 쉽다. RFC 6238 부록 B의 공식 시험
// 벡터로 test/totp.test.ts가 정확성을 못박는다.

import * as crypto from "crypto";

export const TOTP_STEP_SEC = 30; // RFC 6238 권고 기본값
export const TOTP_DIGITS = 6; // 인증앱 표준
// 시계 오차 허용 칸수. ±1칸(=±30초)만 본다.
// 넓히면 어깨너머로 훔쳐본 숫자를 그만큼 오래 쓸 수 있게 된다 — 편의와 바꿀 수 없는 값이다.
export const TOTP_WINDOW = 1;

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 base32

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out; // 패딩(=)은 붙이지 않는다 — otpauth URI 관례
}

export function base32Decode(s: string): Buffer {
  // 사람이 옮겨 적은 키를 받는다: 공백·하이픈·패딩·소문자를 모두 관용한다.
  const clean = s.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error("base32 형식이 아닙니다");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 비밀키 160비트(20바이트) — RFC 4226 §4가 SHA-1 HMAC 키로 권고하는 길이이고
// NIST SP 800-63B의 최소(112비트)를 넉넉히 넘는다.
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// HOTP(RFC 4226): HMAC-SHA1 후 동적 절단(dynamic truncation).
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  // counter는 64비트지만 실사용 범위(초/30)는 2^53 안이라 상·하위 32비트로 나눠 쓴다.
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function counterFor(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SEC);
}

export function totpCode(secretB32: string, atMs: number = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretB32), counterFor(atMs), digits);
}

export interface TotpVerifyResult {
  ok: boolean;
  counter?: number; // 맞은 칸 — 재사용 방지를 위해 저장해야 한다
  reason?: "형식" | "불일치" | "재사용";
}

/**
 * 코드를 검증한다.
 * @param lastCounter 이 계정이 마지막으로 성공한 칸. 같거나 이전 칸은 **재사용**으로 거부한다
 *        (RFC 6238 §5.2 — 한 칸에 한 번만 통과해야 어깨너머로 본 숫자를 못 쓴다).
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { atMs?: number; lastCounter?: number | null; window?: number } = {}
): TotpVerifyResult {
  const digits = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return { ok: false, reason: "형식" };
  let secret: Buffer;
  try {
    secret = base32Decode(secretB32);
  } catch {
    return { ok: false, reason: "형식" };
  }
  const now = counterFor(opts.atMs ?? Date.now());
  const window = opts.window ?? TOTP_WINDOW;
  for (let d = -window; d <= window; d++) {
    const c = now + d;
    if (c < 0) continue;
    // 타이밍 공격 방어: 길이가 같은 두 문자열을 상수 시간으로 비교한다.
    const expected = hotp(secret, c, digits.length);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) {
      if (opts.lastCounter != null && c <= opts.lastCounter) return { ok: false, reason: "재사용" };
      return { ok: true, counter: c };
    }
  }
  return { ok: false, reason: "불일치" };
}

// 인증앱이 읽는 표준 URI(otpauth://). QR로 만들어 보여주거나 키를 직접 넣게 한다.
// issuer·account가 앱 목록에 표시되는 이름이 된다 — 여러 서버를 쓰는 담당자가 구분할 수 있게.
export function otpauthUri(secretB32: string, account: string, issuer = "GIJO AS"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// 사람이 옮겨 적기 쉽게 4글자씩 끊어 보여준다(저장값은 끊지 않은 원본).
export function formatSecretForDisplay(secretB32: string): string {
  return secretB32.replace(/(.{4})/g, "$1 ").trim();
}

// ── 복구 코드 ────────────────────────────────────────────────────────────────
// 폐쇄망에는 "이메일로 재설정" 같은 길이 없다. 휴대폰을 잃으면 복구 코드가 유일한 자력 복구
// 수단이고, 그것마저 없으면 관리자 해제만 남는다.
// 혼동 문자(0/O, 1/I/L)를 뺀 32자 알파벳 × 8자 = 40비트. 1회용이고 10개뿐이라 추측 공격은
// 로그인 횟수 제한(15분 10회)에 먼저 막힌다.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCode(): string {
  const bytes = crypto.randomBytes(8);
  let s = "";
  for (const b of bytes) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(generateRecoveryCode());
  return [...set];
}

// 비교용 정규화 — 사용자가 하이픈·공백·소문자로 넣어도 같은 값으로 본다.
export function normalizeRecoveryCode(code: string): string {
  return String(code ?? "").replace(/[\s-]/g, "").toUpperCase();
}
