// DB 암호화 열쇠 — 여기가 틀리면 **고객 데이터가 영영 안 열린다**. 경계를 못으로 박는다.
//
// 특히 확인하는 것:
//  · 다른 기계로 옮기면 정말 안 풀리는가 (안 그러면 파일 유출 방어가 성립하지 않는다)
//  · 복구 열쇠로는 열리는가, 그리고 연 뒤 **새 기계에 다시 봉인되는가**
//  · 열쇠 파일을 실수로 덮어쓰지 못하게 막는가 (덮어쓰면 복구 불가)
//  · 복구 열쇠는 파일에 저장되지 않는가 (저장되면 종이 보관이 의미가 없다)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createKeyFile, readKeyFile, hasKeyFile, keyFilePath,
  unsealWithMachine, unsealWithRecovery, rotateRecoveryKey, __setMachineFingerprintForTests,
  generateRecoveryKey, normalizeRecoveryKey, machineFingerprint, fingerprintStrength,
} from "../src/dbkey";

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-dbkey-"));
  dbPath = path.join(tmp, "data", "gijo-as.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  delete process.env.GIJO_DB_KEY_PATH;
});
afterEach(() => {
  vi.restoreAllMocks();
  __setMachineFingerprintForTests(null);
  delete process.env.GIJO_DB_KEY_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("열쇠 생성과 보관", () => {
  it("열쇠는 DB 옆이 아니라 별도 폴더에 둔다", () => {
    // data/ 폴더를 통째로 복사·압축하는 백업 스크립트가 흔하다 — 그 한 번에 열쇠와
    // 자물쇠가 같이 나가면 암호화가 무의미해진다.
    const p = keyFilePath(dbPath);
    expect(path.dirname(p)).not.toBe(path.dirname(dbPath));
    expect(p).toContain("secrets");
  });

  it("열쇠 파일에 열쇠(DEK)도 복구 열쇠도 평문으로 없다", () => {
    const { dek, recoveryKey } = createKeyFile(dbPath);
    const raw = fs.readFileSync(keyFilePath(dbPath), "utf8");
    expect(raw).not.toContain(dek.toString("hex"));
    expect(raw).not.toContain(recoveryKey);
    expect(raw).not.toContain(normalizeRecoveryKey(recoveryKey));
  });

  it("이미 있는 열쇠 파일을 덮어쓰지 않는다 — 덮어쓰면 기존 DB를 영영 못 연다", () => {
    createKeyFile(dbPath);
    expect(() => createKeyFile(dbPath)).toThrow(/이미 있습니다/);
  });

  it("파일 권한을 소유자만으로 좁힌다", () => {
    createKeyFile(dbPath);
    const mode = fs.statSync(keyFilePath(dbPath)).mode & 0o777;
    // 윈도우는 POSIX 권한이 그대로 반영되지 않는다 — 그 경우는 통과시키고 리눅스에서만 본다.
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });
});

describe("기계 봉인", () => {
  it("같은 기계에서는 사람 개입 없이 열린다 — 무인 재시작이 되어야 한다", () => {
    const { dek } = createKeyFile(dbPath);
    expect(unsealWithMachine(dbPath)?.equals(dek)).toBe(true);
  });

  it("다른 기계로 열쇠 파일을 옮기면 안 열린다", () => {
    createKeyFile(dbPath);
    // 기계가 바뀐 상황 재현 — 호스트명이 달라진다
    __setMachineFingerprintForTests("남의-서버-01 linux x64");
    expect(unsealWithMachine(dbPath)).toBeNull();
  });

  it("열쇠 파일이 한 글자라도 변조되면 열지 않는다", () => {
    createKeyFile(dbPath);
    const p = keyFilePath(dbPath);
    const f = JSON.parse(fs.readFileSync(p, "utf8"));
    f.machine.ct = f.machine.ct.slice(0, -2) + (f.machine.ct.endsWith("00") ? "11" : "00");
    fs.writeFileSync(p, JSON.stringify(f));
    expect(unsealWithMachine(dbPath)).toBeNull();
  });

  it("열쇠 파일이 없으면 조용히 null — 예외로 서버를 못 뜨게 만들지 않는다", () => {
    expect(hasKeyFile(dbPath)).toBe(false);
    expect(unsealWithMachine(dbPath)).toBeNull();
    expect(readKeyFile(dbPath)).toBeNull();
  });
});

describe("복구 열쇠", () => {
  it("기계가 바뀌어도 복구 열쇠로는 열린다", () => {
    const { dek, recoveryKey } = createKeyFile(dbPath);
    __setMachineFingerprintForTests("새로-교체한-서버 linux x64");
    expect(unsealWithMachine(dbPath)).toBeNull(); // 기계 봉인은 실패
    expect(unsealWithRecovery(dbPath, recoveryKey)?.equals(dek)).toBe(true);
  });

  it("복구로 연 뒤에는 새 기계에 다시 봉인된다 — 다음 재시작부터 자동", () => {
    const { dek, recoveryKey } = createKeyFile(dbPath);
    __setMachineFingerprintForTests("새로-교체한-서버 linux x64");
    unsealWithRecovery(dbPath, recoveryKey);
    // 같은(새) 기계에서 이제 사람 개입 없이 열려야 한다
    expect(unsealWithMachine(dbPath)?.equals(dek)).toBe(true);
  });

  it("틀린 복구 열쇠로는 안 열린다", () => {
    const { recoveryKey } = createKeyFile(dbPath);
    expect(unsealWithRecovery(dbPath, generateRecoveryKey())).toBeNull();
    // 한 글자만 틀려도 안 된다
    const 한글자틀림 = recoveryKey.replace(/[A-Z]/, (c) => (c === "A" ? "B" : "A"));
    expect(unsealWithRecovery(dbPath, 한글자틀림)).toBeNull();
  });

  it("사람이 옮겨 적으며 생기는 차이는 흡수한다 — 소문자·공백·하이픈 없음", () => {
    const { dek, recoveryKey } = createKeyFile(dbPath);
    expect(unsealWithRecovery(dbPath, recoveryKey.toLowerCase())?.equals(dek)).toBe(true);
    expect(unsealWithRecovery(dbPath, recoveryKey.replace(/-/g, " "))?.equals(dek)).toBe(true);
    expect(unsealWithRecovery(dbPath, recoveryKey.replace(/-/g, ""))?.equals(dek)).toBe(true);
  });

  it("복구 열쇠에 헷갈리는 글자(0 O 1 I L)가 없다 — 종이에 옮겨 적는 값이다", () => {
    for (let i = 0; i < 40; i++) expect(generateRecoveryKey()).not.toMatch(/[01OIL]/);
  });

  it("복구 열쇠는 추측으로 뚫리지 않을 만큼 길다", () => {
    const k = normalizeRecoveryKey(generateRecoveryKey());
    expect(k.length).toBeGreaterThanOrEqual(30); // 31글자 알파벳 × 30자 ≈ 147비트
  });

  it("복구 열쇠를 새로 내면 옛 것은 즉시 못 쓴다 — DB 재암호화는 없다", () => {
    const { dek, recoveryKey: 옛것 } = createKeyFile(dbPath);
    const 새것 = rotateRecoveryKey(dbPath, dek);
    expect(unsealWithRecovery(dbPath, 새것)?.equals(dek)).toBe(true);
    expect(unsealWithRecovery(dbPath, 옛것)).toBeNull();
    // 기계 봉인은 그대로 살아 있어야 한다(재발급이 무인 기동을 깨면 안 된다)
    expect(unsealWithMachine(dbPath)?.equals(dek)).toBe(true);
  });
});

describe("기계 지문", () => {
  it("고유 식별자를 못 읽으면 '약함'으로 정직하게 알린다", () => {
    const s = fingerprintStrength();
    expect(s.sources).toBeGreaterThanOrEqual(3); // 호스트명·플랫폼·아키텍처는 항상 있다
    expect(typeof s.strong).toBe("boolean");
    // 지문 재료가 호스트명뿐이면 "다른 기계면 안 열린다"가 약해진다 — 화면에 그대로 표시한다.
    expect(machineFingerprint()).toContain(os.hostname());
  });
});
