// 통합메모리 CUDA(GB10) 판정 — 2026-08-11 실측으로 드러난 결함의 회귀 시험. (계획서: 전-7 하드웨어 갈래)
//
// 무슨 일이 있었나: NVIDIA DGX Spark(GB10, 통합메모리 121GB)는 nvidia-smi가 GPU 전용 메모리를
// **아예 보고하지 않는다**(`[N/A]`). 우리 코드는 그것을 parseInt로 읽어 NaN을 얻고
// **「GPU 없음」으로 판정**했다. 그 결과 설정 화면 구동 티어가 1 PetaFLOP 기계에 대고
//     "NVIDIA GPU를 찾지 못했습니다(nvidia-smi 없음) — 로컬 LLM 구동 미지원 환경입니다."
// 를 띄웠고, makeRoomFor는 여유를 모른다며 모델 2개로 묶었다(121GB인데).
// 동시에 자가진단(preflight)은 같은 명령이 성공하니 pass로 넘겨 **두 화면이 서로 모순**됐다.
//
// ⚠ 이 결함은 **실행 시험으로는 안 드러난다.** `[N/A]`도 parseInt를 통과해 NaN이라는
//   「그럴듯한 실패」가 되기 때문이다. 그래서 파싱을 순수 함수로 빼고 고정 입력으로 검산한다
//   (mac 쪽 macmemory.test.ts와 같은 이유·같은 방식).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseGpuMemoryReport, parseMemAvailableMb } from "../src/util/unifiedmem";

describe("GPU 메모리 보고 방식 판정", () => {
  it("★ GB10 실측 출력 — 메모리가 [N/A]면 「GPU 없음」이 아니라 「통합메모리」다", () => {
    // 2026-08-11 promaxgb10-1d0a에서 채취한 실제 출력.
    const r = parseGpuMemoryReport("NVIDIA GB10, [N/A]");
    expect(r.kind).toBe("unified");
    expect(r.kind === "unified" && r.name).toBe("NVIDIA GB10");
  });

  it("보통 NVIDIA GPU는 총량을 그대로 준다 — 기존 동작이 바뀌지 않는다", () => {
    // 운영(RTX 3090 24GB) 형태의 출력.
    const r = parseGpuMemoryReport("NVIDIA GeForce RTX 3090, 24576");
    expect(r.kind).toBe("reported");
    expect(r.kind === "reported" && r.totalMb).toBe(24576);
    expect(r.kind === "reported" && r.name).toBe("NVIDIA GeForce RTX 3090");
  });

  it("여러 GPU면 첫 줄만 본다", () => {
    const r = parseGpuMemoryReport("NVIDIA RTX A6000, 49140\nNVIDIA RTX A6000, 49140\n");
    expect(r.kind === "reported" && r.totalMb).toBe(49140);
  });

  it("빈 출력은 「GPU 없음」 — 통합메모리로 오해하지 않는다", () => {
    // ⚠ 이 구분이 무너지면 GPU 없는 기계에 「통합메모리」라고 말하게 된다.
    expect(parseGpuMemoryReport("").kind).toBe("none");
    expect(parseGpuMemoryReport("   \n ").kind).toBe("none");
    expect(parseGpuMemoryReport("쉼표가 없는 한 줄").kind).toBe("none");
  });

  it("이름에 쉼표가 있어도 마지막 쉼표로 가른다", () => {
    const r = parseGpuMemoryReport("NVIDIA Graphics Device, Rev A, 32768");
    expect(r.kind === "reported" && r.totalMb).toBe(32768);
    expect(r.kind === "reported" && r.name).toBe("NVIDIA Graphics Device, Rev A");
  });

  it("총량이 0이나 「Not Supported」여도 통합메모리로 본다", () => {
    // nvidia-smi 판본에 따라 표현이 다르다 — 숫자가 아니면 전부 「메모리를 못 준다」다.
    expect(parseGpuMemoryReport("NVIDIA GB10, Not Supported").kind).toBe("unified");
    expect(parseGpuMemoryReport("NVIDIA GB10, 0").kind).toBe("unified");
  });
});

describe("리눅스 여유 메모리 계산", () => {
  /** 실제 /proc/meminfo 일부(GB10 121GiB, 2026-08-11 채취 형태). */
  const 실측 = `MemTotal:       127323456 kB
MemFree:        119537664 kB
MemAvailable:   122683392 kB
Buffers:           98304 kB
Cached:          4823040 kB
SwapTotal:      16777216 kB
SwapFree:       16777216 kB
`;

  it("MemAvailable을 MB로 읽는다", () => {
    // 122,683,392 kB ÷ 1024 = 119,808 MB ≈ 117.0GB
    const mb = parseMemAvailableMb(실측);
    expect(mb).toBe(119808);
    expect(mb! / 1024).toBeCloseTo(117.0, 1);
  });

  it("★ MemFree가 아니라 MemAvailable을 쓴다 — 캐시가 찬 상태에서 갈린다", () => {
    // 리눅스는 남는 RAM을 페이지 캐시로 채운다. MemFree만 보면 「자리가 없다」로 읽혀
    // 여유가 있는데도 올라간 모델을 내린다.
    // (⚠ mac과 사정이 다르다: 리눅스 Node 24의 os.freemem()은 이미 MemAvailable 쪽을 따라간다 —
    //  GB10 실측 MemFree 117,783,548kB · MemAvailable 122,391,476kB · os.freemem() 122,385,704kB.
    //  그래도 이 시험을 두는 이유는 **파서가 MemFree를 집지 않는다**를 못박기 위해서다.)
    const 캐시가찬상태 = `MemTotal:       127323456 kB
MemFree:          524288 kB
MemAvailable:   100663296 kB
Cached:         98566144 kB
`;
    const mb = parseMemAvailableMb(캐시가찬상태)!;
    expect(mb).toBe(98304); // 96GB — 실제로 더 쓸 수 있는 양
    expect(mb).toBeGreaterThan((524288 / 1024) * 100); // MemFree(512MB)보다 훨씬 크다
  });

  it("항목이 없으면 null — 0을 「여유 없음」으로 오해하지 않는다", () => {
    // 아주 오래된 커널엔 MemAvailable이 없다. 추측하지 않고 호출부가 물러나게 한다.
    expect(parseMemAvailableMb("MemTotal: 127323456 kB\nMemFree: 100 kB\n")).toBeNull();
    expect(parseMemAvailableMb("")).toBeNull();
  });

  it("줄 중간에 있는 비슷한 이름에 걸리지 않는다", () => {
    // ⚠ ^ 앵커가 없으면 "CmaMemAvailable" 같은 항목을 잘못 읽을 수 있다.
    expect(parseMemAvailableMb("CmaMemAvailable:  12345 kB\n")).toBeNull();
  });
});

// ── 소스 감시 ────────────────────────────────────────────────────────────────
// 이 결함은 **같은 읽기가 네 곳에 흩어져 있었기** 때문에 커졌다: localengine 2곳 ·
// preflight · tools/model-benchmark. 한 곳을 고쳐도 나머지가 옛 판정을 계속했다.
// 그래서 「새로 nvidia-smi로 메모리를 읽는 자리」가 생기면 시험이 잡게 한다.
describe("GPU 메모리 판정은 한 곳에서 한다", () => {
  const src = path.join(__dirname, "..", "src");
  const 주석지우기 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
  /** src 아래 .ts 전부 훑기 */
  function ts(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? ts(path.join(dir, d.name)) : d.name.endsWith(".ts") ? [path.join(dir, d.name)] : []
    );
  }

  it("util/unifiedmem.ts와 localengine.ts 밖에서는 nvidia-smi로 메모리를 읽지 않는다", () => {
    // 예외 둘, 이유를 적어 둔다:
    //   · util/unifiedmem.ts — 판정 당사자.
    //   · engine/localengine.ts — 모델 풀 주인. utilization+used+total을 **한 번의 호출로** 받아야
    //     스냅샷이 같은 순간의 값이 된다(따로 부르면 어긋난다). 단 통합메모리 판정은
    //     반드시 unifiedmem을 거친다 — 아래 시험이 그것을 확인한다.
    const 예외 = [path.join("util", "unifiedmem.ts"), path.join("engine", "localengine.ts")];
    const 위반: string[] = [];
    for (const f of ts(src)) {
      if (예외.some((e) => f.endsWith(e))) continue;
      const code = 주석지우기(fs.readFileSync(f, "utf8"));
      if (/nvidia-smi/.test(code) && /memory\.(total|used|free)/.test(code)) 위반.push(path.relative(src, f));
    }
    expect(위반, `nvidia-smi 메모리 직접 읽기 잔존: ${위반.join(", ")}`).toEqual([]);
  });

  it("localengine은 통합메모리 판정을 unifiedmem에서 받는다 — 자기 나름대로 판단하지 않는다", () => {
    const code = fs.readFileSync(path.join(src, "engine", "localengine.ts"), "utf8");
    expect(code).toContain('from "../util/unifiedmem"');
    expect(code).toContain("gpuMemoryReport()");
  });

  it("preflight은 nvidia-smi를 직접 부르지 않는다 — 티어와 서로 다른 말을 하던 자리다", () => {
    // 예전엔 execFileSync로 직접 읽어 "NVIDIA GB10, [N/A]"를 pass로 넘겼고,
    // 같은 순간 구동 티어는 「GPU 없음」이라 말했다.
    const code = fs.readFileSync(path.join(src, "engine", "preflight.ts"), "utf8");
    expect(code).not.toContain("nvidia-smi\"");
    expect(code).toContain('from "../util/unifiedmem"');
  });

  it("tools/model-benchmark.mjs도 [N/A]를 다룬다 — .mjs라 모듈을 못 써 같은 판정을 적어 둔 곳", () => {
    // ⚠ 이 도구가 GB10 tok/s 실측에 쓰인다. 여기가 빠지면 「❌ 미지원 환경」을 찍고 멈춘다.
    const p = path.join(__dirname, "..", "..", "tools", "model-benchmark.mjs");
    const code = fs.readFileSync(p, "utf8");
    expect(code).toContain("MemAvailable"); // 통합메모리일 때 시스템 메모리로 센다
    expect(code).toContain("unified");
    // 총량이 숫자가 아닐 때를 반드시 가른다 — 이게 없으면 NaN이 조용히 흐른다.
    expect(code).toMatch(/Number\.isFinite\(total\)/);
  });
});
