// mac 통합메모리 「여유」 계산 — 2026-08-09 실측으로 드러난 결함의 회귀 시험.
//
// 무슨 일이 있었나: mac 분기가 os.freemem()을 「여유 VRAM」으로 썼다. macOS는 남는 RAM을
// 전부 파일 캐시로 채우므로 그 값은 **정상 상태에서도 거의 0**이다. 실측(32GB 기계):
//     os.freemem() 0.20GB  ·  실제로 더 쓸 수 있던 양 7.78GB  ·  스왑 사용 0
// 그 0.20GB가 makeRoomFor에 들어가면 「자리가 없다」로 읽혀, 여유가 있는데도 올라가 있는
// 모델을 내린다 — 티어가 약속한 「채팅 LLM 2~3개 동시」가 mac에서만 성립하지 않는다.
//
// ⚠ 이 결함은 **실행 시험으로는 안 드러난다.** 숫자가 나오긴 나오기 때문이다.
//   그래서 파싱을 순수 함수로 빼고 고정 입력으로 검산한다.
import { describe, it, expect } from "vitest";
import { parseMacAvailableMb } from "../src/engine/localengine";

/** 실제 vm_stat 출력(32GB M1 Max, 2026-08-09 채취). 숫자를 그대로 둔다 — 검산이 되도록. */
const 실측 = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                9847.
Pages active:                            442738.
Pages inactive:                          441297.
Pages speculative:                         2118.
Pages throttled:                              0.
Pages wired down:                       1072398.
Pages purgeable:                           3934.
"Translation faults":                 2847362819.
Pages copy-on-write:                   84726351.
Pages zero filled:                   1847263518.
Pages reactivated:                     28473625.
Pages purged:                           4827361.
File-backed pages:                       443284.
Anonymous pages:                         442869.
Pages stored in compressor:               284736.
Pages occupied by compressor:              72836.
`;

const 총 = 32 * 1024 * 1024 * 1024; // 32GB

describe("mac 여유 메모리 계산", () => {
  it("배타적 분류(wired+active+압축)만 빼서 센다", () => {
    // (1072398 + 442738 + 72836) = 1,587,972쪽 × 16384B = 24.23GB 못 내줌
    // → 32GB − 24.23GB = 약 7.77GB 여유
    const mb = parseMacAvailableMb(실측, 총);
    expect(mb).not.toBeNull();
    expect(mb! / 1024).toBeCloseTo(7.77, 1);
  });

  it("★ File-backed를 더해 세지 않는다 — inactive와 같은 페이지를 두 번 세는 것이다", () => {
    // 이중계산 공식(free+inactive+purgeable+File-backed)은 약 13.6GB를 내놓는다.
    // macOS의 「free percentage」와 우연히 맞아떨어져 그럴듯해 보이지만 과대평가고,
    // 그대로 쓰면 스왑을 부른다. 실측 근거: inactive 441297쪽 · File-backed 443284쪽 —
    // 사실상 같은 페이지다.
    const mb = parseMacAvailableMb(실측, 총)!;
    expect(mb / 1024).toBeLessThan(10);
  });

  it("os.freemem()이 내놓을 값(free 쪽만)보다 **훨씬** 크다 — 이 시험의 존재 이유", () => {
    const freeOnly = (9847 * 16384) / 1024 / 1024; // 약 154MB
    const mb = parseMacAvailableMb(실측, 총)!;
    expect(mb).toBeGreaterThan(freeOnly * 10);
  });

  it("읽지 못하면 null — 0을 「여유가 전부」로 오해하지 않는다", () => {
    expect(parseMacAvailableMb("전혀 다른 출력", 총)).toBeNull();
    // 쪽 크기는 있지만 항목이 없는 경우(형식 변경)도 null이어야 한다.
    expect(parseMacAvailableMb("(page size of 16384 bytes)\nPages free: 100.", 총)).toBeNull();
  });

  it("음수로 내려가지 않는다", () => {
    expect(parseMacAvailableMb(실측, 1024)).toBe(0);
  });
});
