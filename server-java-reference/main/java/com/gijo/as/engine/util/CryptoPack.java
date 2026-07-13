package com.gijo.as.engine.util;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;

/**
 * 민감 보안데이터 암호화 유틸 (서버 내부용, REST로 노출되지 않음).
 * TODO: 키 관리 정책(OS 키체인 또는 HSM 연동) 결정 후 사용처(SbomService, MemoryService)에 연결.
 */
public final class CryptoPack {

    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;

    private CryptoPack() {
    }

    public record Encrypted(byte[] iv, byte[] ciphertext) {
    }

    public static Encrypted encrypt(byte[] data, byte[] key) {
        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] ciphertext = cipher.doFinal(data);
            return new Encrypted(iv, ciphertext);
        } catch (Exception e) {
            throw new IllegalStateException("encryption failed", e);
        }
    }
}
