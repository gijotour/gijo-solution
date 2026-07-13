import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import { encryptBuffer, decryptBuffer } from "../src/engine/cryptopack";

describe("cryptopack", () => {
  const key = crypto.randomBytes(32);

  it("round-trips data through encrypt/decrypt", () => {
    const plaintext = Buffer.from("고객사 보안 정책 원문", "utf-8");
    const encrypted = encryptBuffer(plaintext, key);
    const decrypted = decryptBuffer(encrypted, key);
    expect(decrypted.toString("utf-8")).toBe(plaintext.toString("utf-8"));
  });

  it("produces ciphertext that differs from the plaintext", () => {
    const plaintext = Buffer.from("sensitive", "utf-8");
    const { ciphertext } = encryptBuffer(plaintext, key);
    expect(ciphertext.equals(plaintext)).toBe(false);
  });

  it("fails to decrypt with the wrong key (regression: original code dropped the GCM auth tag entirely)", () => {
    const plaintext = Buffer.from("sensitive", "utf-8");
    const encrypted = encryptBuffer(plaintext, key);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decryptBuffer(encrypted, wrongKey)).toThrow();
  });

  it("fails to decrypt if the ciphertext was tampered with", () => {
    const plaintext = Buffer.from("sensitive", "utf-8");
    const encrypted = encryptBuffer(plaintext, key);
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => decryptBuffer(encrypted, key)).toThrow();
  });
});
