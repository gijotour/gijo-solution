// engine/cryptopack.ts — 민감 보안데이터 암호화 유틸 (서버 내부용, 라우트 미노출)

import * as crypto from "crypto";

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
// TODO: 키 관리 정책(예: OS 키체인 또는 HSM 연동) 결정 후 사용처(sbom.ts, memory.ts)에 연결
