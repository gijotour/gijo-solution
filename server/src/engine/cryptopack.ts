// engine/cryptopack.ts — 민감 보안데이터 암호화 유틸 (서버 내부용, 라우트 미노출)
// 키 관리 정책: 프로덕션/온프레미스에서는 GIJO_ENCRYPTION_KEY(64자리 hex = 32바이트)를 반드시
// 환경변수로 주입할 것. 미지정 시 개발 편의를 위해 최초 1회 랜덤 키를 생성해
// data/encryption.key에 저장하고 이후 재사용한다 — OS 키체인/HSM 연동은 여전히 TODO
// (엔터프라이즈 온프레미스 배포 시 재검토, server-java-reference의 Java 스택 재검토 사유와 동일 맥락).
// 첫 실사용처는 cti.ts의 벤더 API 키 암호화 저장.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface EncryptedPayload {
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export function encryptBuffer(data: Buffer, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return { iv, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptBuffer(payload: EncryptedPayload, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}

const KEY_PATH = path.join("data", "encryption.key");
let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.GIJO_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "hex");
    if (key.length !== 32) throw new Error("GIJO_ENCRYPTION_KEY must be 64 hex chars (32 bytes) for AES-256-GCM");
    cachedKey = key;
    return key;
  }

  if (fs.existsSync(KEY_PATH)) {
    cachedKey = Buffer.from(fs.readFileSync(KEY_PATH, "utf-8").trim(), "hex");
    return cachedKey;
  }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, key.toString("hex"), "utf-8");
  cachedKey = key;
  return key;
}
