// 학습기의 **두 변수**(격자·LoRA 자리) — 깃발을 주고도 안 켜지는 일을 막는다.
//
// ■ 왜 이 파일이 생겼나 (2026-09-10 · 계획서 §12.12)
//   증류 사다리 4회전은 **재료만 네 번 바꾸고 학습 설정은 한 번도 안 바꿨다.** 그런데 실측이 가리킨
//   뿌리 둘이 학습 설정에 있었다:
//     ① 학습은 4bit(NF4)인데 서빙은 Q4_K_M — **격자가 다른 두 곳** 사이에서 어댑터의 보정이 어긋난다
//        (§4.2 문서는 bf16이라 적어 놨는데 코드는 4bit였다 — 문서와 코드가 갈린 채 네 번을 구웠다).
//     ② LoRA가 MLP(gate/up/down)까지 먹어 사실(KEV)이 밀렸다.
//   그래서 --precision · --lora-targets 를 연다. **기본값은 옛 동작 그대로**여야 한다 —
//   기본이 바뀌면 지금까지의 명령·사슬·시험이 말없이 다른 학습을 하게 된다.
//
// ■ 이 파일이 못 박는 것
//   ① 세 깃발(--precision · --lora-targets · --max-steps)이 **실제로 받아들여진다**(argparse까지 간다)
//   ② 기본값이 옛 동작이다(4bit · all · max_steps 없음)
//   ③ 켠 값이 **로그에 찍힌다**(안 찍히면 「켰다고 믿은 채」 몇 시간을 돌린다 — warmup_ratio 계보)
//   ④ LoRA 모듈 목록의 출처가 함수 하나다(인라인 목록이 남아 있으면 찍는 값과 거는 값이 갈린다)
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const 루트 = path.join(__dirname, "..", "..");
const 학습기 = path.join(루트, "server", "scripts", "finetune_qlora14b.py");
const 소스 = fs.readFileSync(학습기, "utf8");

// ⚠ **있는 파이썬을 찾아서 돌린다.** `python` 하나만 보고 없으면 건너뛰게 두면 운영 환경(WSL —
//   python3만 있다)에서 늘 조용히 skip된다. 초록은 뜨는데 아무것도 증명하지 않는 그 상태다.
function 파이썬찾기(): string | null {
  for (const c of [process.env.GIJO_TEST_PYTHON, "python3", "python"]) {
    if (c && spawnSync(c, ["--version"]).status === 0) return c;
  }
  return null;
}
const PY = 파이썬찾기();

describe("소스 감시 — 깃발과 기본값", () => {
  it("★ 세 깃발을 받는다 — 셸이 넘겨도 이름이 없으면 argparse가 그 자리에서 죽는다", () => {
    for (const f of ["--precision", "--lora-targets", "--max-steps"]) {
      expect(소스, `학습기가 ${f}를 안 받는다`).toContain(f);
    }
  });

  it("★ 기본값이 옛 동작이다 — 기본이 바뀌면 지금까지의 명령이 말없이 다른 학습을 한다", () => {
    expect(소스).toMatch(/--precision[\s\S]{0,200}default="4bit"/);
    expect(소스).toMatch(/--lora-targets[\s\S]{0,200}default="all"/);
    expect(소스).toMatch(/--max-steps[\s\S]{0,200}default=0/);
  });

  it("★ LoRA 모듈 목록의 출처가 함수 하나다 — 인라인 목록이 남으면 찍는 값과 거는 값이 갈린다", () => {
    expect(소스).toContain("def lora_모듈(");
    expect(소스).toContain("target_modules=모듈들");
    // 옛 인라인 목록(7개를 그 자리에 적던 꼴)이 남아 있으면 두 곳이 된다.
    expect(소스).not.toContain('target_modules=["q_proj"');
  });

  it("★ 켠 값이 로그에 찍힌다 — 안 찍히면 「켰다고 믿은 채」 몇 시간을 돌린다", () => {
    expect(소스).toMatch(/\[finetune\] 설정 — precision=/);
    expect(소스).toContain("lora_targets=");
  });

  it("★ max_steps 0은 아예 안 넘긴다 — 넘기면 「스텝 0으로 끝」이 되어 조용히 아무것도 안 배운다", () => {
    expect(소스).toMatch(/if args\.max_steps and args\.max_steps > 0:/);
  });

  // ── r5b 메모리 대책(2026-09-13) ────────────────────────────────────────
  // ⚠ 왜 이 블록이 생겼나: 2026-09-12 gb10 r5a 본 굽기가 가용 0~1G에서 밤새 돌았는데,
  //   이 스크립트는 GPU 메모리를 **한 글자도 안 남겼다.** 계측 없이 상한값을 고르는 것은
  //   추측이지 대책이 아니다 — 그래서 계측(gpu_메모리_로그)과 토치 수준 상한(--gpu-mem-fraction)을
  //   먼저 연다. 기본은 **반드시 꺼져 있어야** r5a 재현(night-r5-bake.sh 기본값)이 안 깨진다.
  it("★ --gpu-mem-fraction이 있고 기본은 0(안 걺)이다 — r5a 재현이 이 기본값에 걸려 있다", () => {
    expect(소스, "학습기가 --gpu-mem-fraction을 안 받는다").toContain("--gpu-mem-fraction");
    expect(소스).toMatch(/--gpu-mem-fraction[\s\S]{0,200}default=0\.0/);
  });

  it("★ 0이면 set_per_process_memory_fraction을 안 부른다 — 기본이 켜지면 조용히 다른 학습이 된다", () => {
    expect(소스, "0보다 클 때만 거는 가드가 없다").toMatch(/if args\.gpu_mem_fraction and args\.gpu_mem_fraction > 0:/);
    expect(소스).toContain("set_per_process_memory_fraction(args.gpu_mem_fraction, 0)");
  });

  it("★ GPU 메모리 계측 로그가 적재 직후·학습 종료 두 자리에 있다", () => {
    expect(소스, "계측 함수가 없다").toContain("def gpu_메모리_로그(");
    expect(소스, "적재 직후 계측 호출이 없다").toContain('gpu_메모리_로그("적재 직후")');
    expect(소스, "학습 종료 계측 호출이 없다").toContain('gpu_메모리_로그("학습 종료")');
    expect(소스).toContain("max_memory_allocated()");
    expect(소스).toContain("max_memory_reserved()");
  });

  it("★ GPU 계측 로그는 `step N/M loss=` 꼴이 아니다 — 제품 진행률 파서(finetune.ts)를 오염시키지 않는다", () => {
    // 계측 로그를 찍는 그 f-string 한 줄만 자른다(전체 소스에서 다른 곳의 "step ... loss="와 안 섞이게).
    const 시작 = 소스.indexOf('log(f"[finetune] GPU 메모리(');
    expect(시작, "계측 로그 문자열을 못 찾았다").toBeGreaterThan(-1);
    const 끝 = 소스.indexOf("\n", 시작);
    const 계측줄 = 소스.slice(시작, 끝);
    expect(계측줄, "제품 파서 정규식(/step\\s+(\\d+)\\/(\\d+)\\s+loss=/)에 걸리면 진행률 막대가 이 값으로 튄다")
      .not.toMatch(/step\s+\d+\/\d+\s+loss=/);
  });

  it("nvidia-smi로 재지 않는다 — GB10은 통합메모리라 [N/A]를 준다(CLAUDE.md·unifiedmem.ts 계약)", () => {
    // ⚠ 문서화 주석(계측 함수 docstring)에는 「왜 안 쓰는지」를 설명하려고 이 낱말이 등장한다 —
    //   그걸 그대로 세면 설명 자체가 시험을 빨갛게 만든다(judge.sh의 pkill 주석 함정과 같은 종류).
    //   그래서 삼중따옴표 docstring을 뺀 **코드만** 본다.
    const 코드만 = 소스.replace(/"""[\s\S]*?"""/g, "");
    expect(코드만, "실제 코드에 nvidia-smi 호출이 있다").not.toContain("nvidia-smi");
  });

  it("bf16 경로는 k-bit 준비 함수를 안 부르고, 대신 입력 grad를 켠다(그게 없으면 체크포인팅과 함께 죽는다)", () => {
    // ⚠ **bf16 갈래만** 자른다 — else(4bit)까지 함께 자르면 그쪽의 k-bit 준비 호출이 걸려
    //   「bf16이 부른다」는 거짓 빨강이 난다(2026-09-10에 이 시험 자신이 그렇게 틀렸다).
    const 시작 = 소스.indexOf('if args.precision == "bf16":');
    const bf16블록 = 소스.slice(시작, 소스.indexOf("\n    else:", 시작));
    expect(bf16블록).toContain("enable_input_require_grads");
    // ⚠ **부르는 자리**를 본다 — 이름이 주석에 나오는 것과 부르는 것은 다르다(그 갈래의 주석이
    //   「여기서는 안 부른다」고 설명하느라 이름을 적는다). 낱말만 세면 그 설명이 거짓 빨강이 된다.
    expect(bf16블록).not.toMatch(/=\s*prepare_model_for_kbit_training\(/);
  });
});

describe.runIf(PY)("진짜 파이썬 — 깃발이 argparse를 지나 값으로 찍힌다", () => {
  const 데이터셋 = `vitest-flags-${Date.now().toString(36)}`;
  const 데이터셋경로 = path.join(루트, "server", "data", "datasets", `${데이터셋}.json`);
  const 산출 = path.join(루트, "server", "data", "lora", 데이터셋);
  const 행 = Array.from({ length: 25 }, (_, i) => ({
    question: `질문 ${i}`, answer: `답변 ${i} 입니다`, system: "근거가 실린 자리",
  }));

  const 돌리기 = (더: string[]) => {
    fs.mkdirSync(path.dirname(데이터셋경로), { recursive: true });
    fs.writeFileSync(데이터셋경로, JSON.stringify(행), "utf8");
    const r = spawnSync(PY as string, ["scripts/finetune_qlora14b.py", "--dataset", 데이터셋, "--output", 산출, "--smoke", ...더],
      { cwd: path.join(루트, "server"), encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  };

  it("깃발을 안 주면 옛 설정이 찍힌다(4bit · all 7모듈 · max_steps 0)", () => {
    const out = 돌리기([]);
    expect(out).toContain("precision=4bit");
    expect(out).toContain("lora_targets=all(q_proj·k_proj·v_proj·o_proj·gate_proj·up_proj·down_proj)");
    expect(out).toContain("max_steps=0");
  });

  it("★ 깃발을 주면 그 값이 찍힌다 — 「받았다」가 아니라 「이 값으로 돌겠다」를 말한다", () => {
    const out = 돌리기(["--precision", "bf16", "--lora-targets", "attn", "--max-steps", "100"]);
    expect(out).toContain("precision=bf16");
    expect(out).toContain("lora_targets=attn(q_proj·k_proj·v_proj·o_proj)");
    expect(out).toContain("max_steps=100");
  });

  it("모르는 값은 받지 않는다 — 오타를 조용히 기본값으로 떨어뜨리지 않는다", () => {
    const out = 돌리기(["--precision", "int8"]);
    expect(out).toMatch(/invalid choice|error/i);
  });

  it("★ --gpu-mem-fraction 값이 argparse를 지나 값으로 찍힌다(기본 0.0 · 지정 시 그 값)", () => {
    expect(돌리기([])).toContain("gpu_mem_fraction=0.0");
    expect(돌리기(["--gpu-mem-fraction", "0.9"])).toContain("gpu_mem_fraction=0.9");
  });

  afterAllCleanup();
  function afterAllCleanup() {
    // vitest의 afterAll을 쓰지 않고 마지막 it 뒤에 정리한다 — 이 파일은 파일 두 개만 남긴다.
    it("뒷정리 — 시험이 만든 데이터셋을 지운다", () => {
      fs.rmSync(데이터셋경로, { force: true });
      fs.rmSync(산출, { recursive: true, force: true });
      expect(fs.existsSync(데이터셋경로)).toBe(false);
    });
  }
});
