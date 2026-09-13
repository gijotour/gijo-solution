// 관문 ⑭ — **로컬 14B 단독**(원격 없음 · 근거 없음)에서 아는 것을 잃지 않았는가.
//
// ■ 왜 생겼나 (2026-09-10 · 계획서 §12.12)
//   회전 5의 목적이 「원격(gb10) 없는 설치본의 14B 바닥 올리기」로 바뀌었다. 그런데 관문 ①~⑬은
//   전부 **근거를 주거나 과제를 주는** 자리에서 잰다 — 고객 설치본에서 실제로 벌어지는
//   「근거도 원격도 없이 물어본다」를 재는 자가 **0개**였다. 목적을 재는 자가 없으면 그 회전은
//   무엇을 고쳤는지 말할 수 없다(⑧~⑪이 뒤늦게 생긴 그 이유와 같다).
//
// ■ 이 파일이 못 박는 것
//   ① 채점은 **⑧과 같은 자**(overlap20)다 — 새 잣대를 짓지 않았다
//   ② 근거 ref를 회수 못 한 문항은 **건너뜀**이지 0점이 아니다(재료 사정이 점수로 둔갑하면 안 된다)
//   ③ 문항이 24개 미만이면 **미측정=불합격**(8건짜리 표본으로 낸 초록은 통과가 아니다)
//   ④ 하네스의 knowledge 조건은 근거를 **프롬프트에 안 싣고** 정답 조각은 **파일에 적는다**
//      (persona와 조건은 같고 목적이 반대라, 한 이름으로 묶으면 관문 ⑨의 모집단이 오염된다)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { 지식정답률, 문항최소_지식, 판정 } from "../../tools/team-bench/gates.mjs";
import { MODES, 조각들, 조각기록, 조각필요, system만들기 } from "../../tools/team-bench/ask-samples.mjs";

const 정답조각 = "기본 관리자 계정명을 변경하지 않고 사용할 경우 공격자에 의한 계정 및 비밀번호 추측 공격이 가능함";
const 아는답 = "확인해 보면 「기본 관리자 계정명을 변경하지 않고 사용할 경우」 추측 공격이 가능합니다. 계정명을 먼저 바꾸세요.";
const 모르는답 = "잘 모르겠습니다. 담당 부서에 문의하시기 바랍니다. 일반적인 보안 권고를 참고하세요.";
const 행 = (text: string, chunk = 정답조각) => ({ id: "k", question: "기본 계정명을 그대로 두면?", text, chunk });

describe("관문 ⑭의 잣대 — 채점은 ⑧과 같은 자다", () => {
  it("정답 조각의 20자가 답에 남아 있으면 맞은 것으로 센다", () => {
    expect(지식정답률([행(아는답)])!.성립).toBe(1);
    expect(지식정답률([행(모르는답)])!.성립).toBe(0);
  });

  it("★ 근거 조각을 회수 못 한 문항은 **건너뜀**이지 0점이 아니다", () => {
    const r = 지식정답률([행(아는답), 행(모르는답, ""), 행(아는답, "짧음")])!;
    expect(r.대상, "채점할 수 있는 문항만 모집단이다").toBe(1);
    expect(r.건너뜀).toBe(2);
    expect(r.비율, "건너뛴 둘을 0점으로 세면 재료 사정이 점수가 된다").toBe(1);
  });

  it("답이 비었으면 모집단에서 뺀다(빈 답을 오답으로 세면 서버 장애가 점수가 된다)", () => {
    expect(지식정답률([행("")])).toBeNull();
  });
});

describe("관문 ⑭의 판정 — 없으면 불합격, 모자라면 불합격", () => {
  const 아무것도없음 = { easy: null, hard: null };

  it("★ 지식 결과가 없으면 미측정이고, 미측정은 통과가 아니다(fail-closed)", () => {
    const r = 판정(아무것도없음, {});
    const 칸 = r.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any;
    expect(칸.값).toBe("미측정");
    expect(칸.통과).toBe(false);
  });

  it("★ 베이스 지식 결과가 없으면 무엇과 견줄지 모른다 — 역시 미측정이다", () => {
    const r = 판정({ ...아무것도없음, 지식: [행(아는답)] }, {});
    const 칸 = r.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any;
    expect(칸.값).toBe("미측정");
    expect(칸.설명 ?? 칸.이름).toBeTruthy();
  });

  it("★ 문항이 24개 미만이면 미측정이다 — 작은 표본으로 낸 초록은 통과가 아니다", () => {
    expect(문항최소_지식).toBe(24);
    const 적음 = Array.from({ length: 8 }, () => 행(아는답));
    const r = 판정({ ...아무것도없음, 지식: 적음 }, { 지식: 적음 });
    const 칸 = r.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any;
    expect(칸.값).toBe("미측정");
  });

  it("★ 문항이 충분하면 **베이스 대비**로 판정한다 — 무하락이면 초록, 떨어지면 빨강", () => {
    const 스물넷 = (text: string) => Array.from({ length: 문항최소_지식 }, () => 행(text));
    const 좋아짐 = 판정({ ...아무것도없음, 지식: 스물넷(아는답) }, { 지식: 스물넷(모르는답) });
    expect((좋아짐.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any).통과).toBe(true);
    const 나빠짐 = 판정({ ...아무것도없음, 지식: 스물넷(모르는답) }, { 지식: 스물넷(아는답) });
    expect((나빠짐.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any).통과, "잊었으면 막는다").toBe(false);
  });
});

describe("하네스 — knowledge 조건은 근거를 **안 싣고** 정답 조각은 **적는다**", () => {
  it("조건 목록에 knowledge가 있다", () => {
    expect(MODES).toContain("knowledge");
  });

  it("★ 프롬프트에는 근거를 안 싣는다(그게 「단독」의 뜻이다)", () => {
    expect(조각필요("knowledge")).toBe(false);
    expect(조각들({ chunk: 정답조각, distractor: "방해" }, "knowledge"), "프롬프트에 실을 조각은 없다").toEqual([]);
    expect(system만들기("팀원 프롬프트", "머리말", [], "knowledge")).toBe("팀원 프롬프트");
  });

  it("★ 정답 조각이 없는 문항은 건너뛴다 — 채점할 수 없는 문항을 0점으로 세지 않는다", () => {
    expect(조각들({ chunk: "" }, "knowledge")).toBeNull();
  });

  it("★ 파일에는 정답 조각을 적는다 — 채점(overlap20)이 그것과 답을 견준다", () => {
    expect(조각기록("knowledge")).toBe(true);
    expect(조각기록("grounded")).toBe(true);
    expect(조각기록("persona"), "⑨의 모집단에는 정답 조각이 없다").toBe(false);
  });
});

// ── 사슬(day2-train.sh) 소스 감시 — 2026-09-11 회전5 r5a 판정 배선 ─────────
// ★ 왜 여기 있나: 채점자(지식정답률)와 측정자(ask-samples MODES)는 이미 다 있었다(위 describe 둘).
//   그런데 사슬이 그 조건을 **던지지도, 게이트에 넘기지도 않아** ⑭는 배선 공백으로 죽어 있었다
//   (설계관 실측, 2026-09-11). 이 describe가 그 배선을 지킨다 — day2-train.sh는 한 줄도 안 보던
//   이 시험 파일이 이제 그 사슬의 소스를 직접 읽는다.
describe("사슬이 ⑭를 실제로 재고 넘긴다(day2-train.sh 소스 감시)", () => {
  const 셸 = readFileSync(join(__dirname, "..", "..", "tools", "ladder", "day2-train.sh"), "utf8");
  const 게이트 = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "gates.mjs"), "utf8");

  it("① knowledge 표본을 실제로 던진다 — --mode knowledge 호출이 없으면 ⑭는 영영 미측정이다", () => {
    // ⚠ **부르는 줄 통째로** 본다. 낱말만 세면 주석 한 줄로도 초록이 된다(2026-09-11 검토관 적발 —
    //   바로 아래 ②③이 그 꼴이었다: 배선을 지워도 주석이 남아 시험이 통과했다).
    expect(셸, "ask-samples.mjs 를 --mode knowledge 로 부르는 줄이 없다")
      .toMatch(/node "\$BENCH_SRC\/ask-samples\.mjs" "\$dir\/samples-knowledge\.json" --mode knowledge/);
  });

  it("② 이번 판의 knowledge 결과를 --local-knowledge 로 게이트에 넘긴다", () => {
    // ⚠ --samples-knowledge 로 넘기면 gates.mjs가 조용히 무시한다(그 인자를 모른다) — 관문이
    //   초록인데 아무것도 안 잰 상태가 된다. 반드시 --local-knowledge 라는 이름이어야 한다.
    expect(셸, "GATE_ARGS 배선 줄이 통째로 있어야 한다 — 낱말만 보면 주석으로 통과한다")
      .toContain('GATE_ARGS+=(--local-knowledge "$probedir/samples-knowledge.json")');
  });

  it("③ 베이스의 knowledge 결과를 --baseline-local-knowledge 로 넘긴다 — 없으면 무엇과 견줄지 모른다", () => {
    expect(셸).toContain('GATE_ARGS+=(--baseline-local-knowledge "$BASELINE_DIR/samples-knowledge.json")');
  });

  it("★★③-2 게이트가 그 인자 이름을 **실제로 받는다** — 셸만 넘기고 게이트가 모르면 조용히 무시된다", () => {
    // ⚠ 이 시험이 없으면 gates.mjs 쪽 이름만 바꿔도(예: --samples-knowledge 로 통일) 시험은 전부
    //   초록인데 밤마다 ⑭은 「미측정」이 된다. 선례는 ladder.test.ts 의 persona 인자 감시다 —
    //   거기도 셸·게이트 **양쪽**을 본다.
    expect(게이트, "gates.mjs가 --local-knowledge 를 안 읽는다").toContain('opt("--local-knowledge"');
    expect(게이트, "gates.mjs가 --baseline-local-knowledge 를 안 읽는다").toContain('opt("--baseline-local-knowledge"');
  });

  it("④ 「무슨 인자로 쟀는지」 기록(harness-args.json)의 표본 목록에도 knowledge가 있다", () => {
    expect(셸, "이 칸이 knowledge를 빼먹으면 결과 파일만 보고 무슨 조건으로 쟀는지 가릴 수 없다")
      .toMatch(/\["grounded", "distractor-only", "bare", "persona", "knowledge"\]/);
  });

  it("★★⑤ 표본 만들기·게이트 넘기기 루프 문자열은 **그대로 남아 있다**", () => {
    // 이 문자열은 server/test/ladder.test.ts:1598-1599가 이미 못 박아 둔 것이다 — knowledge를
    // 저 루프 안에 끼워 넣으면 이 문자열이 깨지고 그 시험도 함께 죽는다. 이 시험이 곧
    // 「knowledge는 루프에 끼우지 말고 별도 블록으로 두라」의 못이다.
    const 루프문자열 = "for mode in grounded distractor-only bare persona; do";
    const 개수 = 셸.split(루프문자열).length - 1;
    expect(개수, "표본 만들기 루프 + 게이트 넘기기 루프 — 정확히 둘이어야 한다(늘어도 줄어도 이 계약이 깨진 것)").toBe(2);
  });
});

// ── night-r5-judge.sh 소스 감시(2026-09-11 신설) ──────────────────────────
// ⚠ 왜 필요한가: night-r5-bake.sh는 2026-09-11까지 이것을 보는 시험이 0건이었다(전수 grep).
//   새 밤 스크립트를 감시 표에 안 올리면 「밤 스크립트는 시험이 없다」가 관례가 된다 — 같은 구멍을
//   두 번 파지 않으려고 judge와 bake 둘 다 여기서 덮는다.
describe("night-r5-judge.sh 소스 감시 — 판정은 굽지 않는다(fail-closed)", () => {
  const 밤 = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "night-r5-judge.sh"), "utf8");
  // ★ **주석을 뺀 실행 줄**에서 본다(선례: datasetgrade.test.ts의 같은 감시).
  //   왜: 이 파일의 머리주석에는 「pkill -f llama-server 는 교사까지 죽인다」가 **경고**로 적혀 있다.
  //   주석까지 세면 그 경고문 때문에 시험이 빨강이 되어, 사람이 경고를 지우거나 문구를 약하게
  //   고치게 된다 — 감시가 문서를 갉아먹는 꼴이다. 실제로 2026-09-11 구현자가 그 함정에 걸려
  //   judge 주석에서 `pkill` 두 글자를 빼 통과시켰다(검토관 적발). 잣대를 바꿔 경고를 되살린다.
  const 줄바꿈 = String.fromCharCode(10);
  const 실행줄 = 밤.split(줄바꿈).filter((l) => !l.trim().startsWith("#")).join(줄바꿈);

  it("★ 교사(8080) 감시견이 있다 — 교사가 말을 멈추면 판정을 내린다", () => {
    // ⚠ 「8080/health 라는 낱말이 있나」로는 못 본다 — 상태보고 함수 teacher()와 시작 상태 ①에도
    //   같은 URL이 있어, 감시견을 통째로 지워도 초록이 된다(2026-09-11 검토관 적발 · 실측 확인).
    //   그래서 **감시견 안에만 있는 것**을 본다: 켜짐 판단 · 연속 실패 셈 · 내리는 자.
    expect(실행줄, "주석이 아니라 실제로 재는 줄이 있어야 한다").toContain("8080/health");
    expect(실행줄, "교사 감시견의 켜짐 판단이 없다 — 시작 때 잰 값을 안 쓰는 것이다")
      .toMatch(/\[ "\$TEACHER_WATCH" -eq 1 \] \|\| continue/);
    expect(실행줄, "한 번 놓쳤다고 내리면 8080 재기동 몇 초에 판정 밤을 통째로 잃는다")
      .toMatch(/\[ "\$fails" -lt 3 \] && continue/);
    expect(실행줄, "감시견은 내리는 자를 불러야 한다 — 재고 아무것도 안 하면 감시견이 아니다")
      .toMatch(/stop_child "\$pid"/);
  });

  it("★ 08:30 데드라인 감시견이 있다 — 낮 서빙을 지키는 마지막 방어선", () => {
    expect(실행줄).toMatch(/DEADLINE=\$\{DEADLINE:-/);
    expect(실행줄, "데드라인을 견주는 줄이 없다").toMatch(/\[\[ "\$NOW" > "\$DEADLINE" \]\]/);
  });

  it("★★ 교사를 이름으로 죽이지 않는다 — pkill -f llama-server 는 교사(8080)까지 죽인다", () => {
    expect(실행줄, "이 패턴이 있으면 교사·임베딩까지 함께 죽는다").not.toMatch(/pkill\s+(-\w+\s+)*['"]?llama-server/);
  });

  it("★★ 신호는 셸과 **그 직계 자식**에 함께 준다 — 셸에만 쏘면 전경 명령이 끝날 때까지 안 듣는다", () => {
    // bash는 전경 자식을 기다리는 동안 trap을 미룬다. 표본 한 벌(40문항)은 수 분~수십 분이라
    // 그만큼 8093 두뇌가 더 산다 — 감시견이 막으려던 상황(낮 서빙 침범)이 연장된다.
    // ⚠ -P(부모)로만 고른다: 교사(8080)·임베딩(8081)은 이 PID의 자식이 아니라 원리상 안 걸린다.
    expect(실행줄).toMatch(/kill -TERM "\$pid"/);
    expect(실행줄, "직계 자식에 TERM을 주는 줄이 없다").toMatch(/pkill -TERM -P "\$pid"/);
  });

  it("★ judge 자신이 TERM을 받으면 자식까지 내린다 — trap이 없으면 8093과 감시견이 따로 산다", () => {
    expect(실행줄, "되돌리기 ①이 말하는 그 trap이 없다").toMatch(/trap 'judge_abort' INT TERM/);
  });

  it("★ 재학습 금지를 명시한다 — --skip-train 이 있다", () => {
    // 어댑터 없이 --round r5a 를 부르면 day2-train.sh의 `-s "$DONE_MARK"` 검사가 거짓이 되어
    // 4bit 기본값으로 밤을 통째로 다시 굽는다(학습 호출에 --precision이 없다).
    // ⚠ 줄 번호로 가리키지 않는다 — 그 파일은 자주 늘어나 번호가 밀린다(2026-09-11 실측).
    expect(실행줄, "머리주석이 아니라 **부르는 줄**에 있어야 한다").toMatch(/--skip-build --skip-train/);
  });

  it("★ 어댑터 존재를 **먼저** 본다(fail-closed) — 없으면 판정 없이 끝낸다", () => {
    expect(실행줄).toContain('DONE_MARK="$LORA_DIR/adapter_model.safetensors"');
    expect(실행줄).toMatch(/\[ ! -s "\$DONE_MARK" \]/);
  });

  it("★★ 체크포인트는 **개수**로 본다 — 번호를 박으면 한 스텝만 달라져도 밤이 통째로 날아간다", () => {
    // checkpoint-<N>의 N은 총 스텝이고, 총 스텝 = ceil(살아남은 행 수 / 16) × 에폭이다.
    // 길이 초과 행은 finetune_qlora14b.py에서 **조용히** 빠지므로(10% 미만이면 경고도 없다),
    // 412행이 400행이 되기만 해도 26/52가 25/50이 된다 — 그때 굽기는 완주했는데 판정만 멈추고
    // 로그에는 「반쯤 구워졌다」는 **틀린 원인**이 남는다.
    expect(실행줄, "체크포인트 번호를 손으로 박았다").not.toMatch(/checkpoint-(26|52)\b/);
    expect(실행줄, "개수로 세는 줄이 없다").toMatch(/ls -1d "\$LORA_DIR"\/checkpoint-\*/);
    expect(실행줄).toMatch(/\[ "\$CKPT_FOUND" -lt "\$EPOCHS_EXPECTED" \]/);
  });

  it("★ free 호출은 전부 LC_ALL=C다 — night-r5-bake.sh와 같은 부류(2026-09-14 검토관 적발·하)", () => {
    // ⚠ bake.sh의 mem()이 로케일 의존이라 gb10 한국어 로케일에서 스왑 칸이 시종 0으로 찍힌
    //   결함이 있었다(2026-09-14 실측) — 같은 파일 꼴이 이 스크립트에도 있어 함께 통일한다.
    const 로케일의존 = 실행줄.match(/(?<!LC_ALL=C )free -g/g);
    expect(로케일의존, `LC_ALL=C 없이 free -g를 부르는 곳이 있다: ${JSON.stringify(로케일의존)}`).toBeNull();
  });
});

describe("night-r5-bake.sh 소스 감시 — 2026-09-11까지 시험 0건이던 구멍을 메운다", () => {
  const 밤 = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "night-r5-bake.sh"), "utf8");
  // ★ judge 쪽과 **같은 잣대**다 — 주석을 뺀 실행 줄에서 본다(경고문 때문에 빨강이 나면 사람이
  //   경고를 지우게 된다). 이 파일 머리글에도 「pkill llama-server 는 교사까지 죽인다」가 적힐 자리다.
  const 줄바꿈 = String.fromCharCode(10);
  const 실행줄 = 밤.split(줄바꿈).filter((l) => !l.trim().startsWith("#")).join(줄바꿈);

  it("★ 교사(8080) 감시견이 있다", () => {
    expect(실행줄).toContain("8080/health");
  });

  it("★ 08:30 데드라인 감시견이 있다", () => {
    expect(실행줄).toContain("DEADLINE");
  });

  it("★★ 교사를 이름으로 죽이지 않는다", () => {
    expect(실행줄).not.toMatch(/pkill\s+(-\w+\s+)*['"]?llama-server/);
  });

  it("굽기 직전에 등급 관문을 다시 잰다 — 빨강이면 굽지 않는다", () => {
    expect(밤).toContain("GRADEGATE");
    expect(밤).toMatch(/GATE=red/);
    expect(밤).toMatch(/\[ "\$GATE" != "ok" \]/);
  });

  // ── r5b 굽기 전 메모리 대책(2026-09-13) ──────────────────────────────────
  // ⚠ 왜 필요한가: 2026-09-12 r5a 본 굽기 실측 — cgroup MemoryMax(38G) 상한이 통합메모리 GPU
  //   할당을 원리상 못 봐 아무 것도 못 막았다(전체 RSS 18.8GiB vs used 77.2GiB). 대책은 ①계측
  //   ②토치 상한 깃발 ③매개변수화 ④정직한 GUARD 문구 ⑤스왑 증가 감시견 ⑥잣대 병기 — 여기서
  //   그 짝을 못 박는다. 코드 자리를 본다(주석만 지우면 지나가는 것은 감시가 아니다).
  it("★ LORA_TARGETS·PRECISION·MAXSEQ가 매개변수화됐고 기본값이 r5a와 같다", () => {
    expect(밤).toContain("LORA_TARGETS=${LORA_TARGETS:-all}");
    expect(밤).toContain("PRECISION=${PRECISION:-bf16}");
    expect(밤).toContain("MAXSEQ=${MAXSEQ:-4096}");
    expect(실행줄, "하드코딩된 값이 아니라 변수를 넘겨야 매개변수화한 보람이 있다").toMatch(/--precision "\$PRECISION"/);
    expect(실행줄).toMatch(/--lora-targets "\$LORA_TARGETS"/);
    expect(실행줄).toMatch(/--max-seq "\$MAXSEQ"/);
  });

  it("가용 관문 숫자(32G/43G)는 그대로다 — 숫자를 바꾸는 것은 메인/사장님 결정이다", () => {
    expect(밤).toContain("BAKE_MIN_AVAIL=${BAKE_MIN_AVAIL:-32}");
    expect(밤).toContain("BAKE_MEASURED_NEED=${BAKE_MEASURED_NEED:-43}");
  });

  it("★ --gpu-mem-fraction은 기본 꺼짐이다 — 값이 없으면 명령줄에 아예 안 붙는다(r5a 재현 보존)", () => {
    expect(밤).toContain("GPUMEMFRAC=${GPUMEMFRAC:-}");
    expect(실행줄, "조건부로 붙는 자리가 없다").toMatch(/\$\{GPUMEMFRAC:\+--gpu-mem-fraction "\$GPUMEMFRAC"\}/);
  });

  it("★ PYTORCH_CUDA_ALLOC_CONF는 깃발/env로만 켜지고 기본은 안 켠다(효과 미실측)", () => {
    expect(밤).toContain("ALLOC_CONF=${ALLOC_CONF:-}");
    // ⚠ `${ALLOC_CONF:+VAR="$ALLOC_CONF"}`(env 없이)는 쉘이 대입으로 안 읽어 "command not found"로
    //   죽는다(2026-09-13 dry 대조 중 실측) — 그래서 반드시 `env`를 거쳐야 한다.
    expect(실행줄, "env 없이 대입만 쓰면 실행 시 command not found로 죽는다")
      .toMatch(/\$\{ALLOC_CONF:\+env PYTORCH_CUDA_ALLOC_CONF="\$ALLOC_CONF"\}/);
  });

  it("★★ GUARD 문구가 실측 결론이다 — 「실효는 미검증」은 더는 맞는 말이 아니다(2026-09-12 실측 확정)", () => {
    // ⚠ 주석이 아니라 **실제로 찍히는 GUARD 값**에서 본다 — 이 파일의 머리주석·설명 주석에는
    //   "왜 문구를 바꿨는지"를 말하려고 옛 표현이 인용구로 남아 있을 수 있다(주석은 실행줄에서 뺀다).
    expect(실행줄, "실효 미검증 문구가 실제 GUARD 값에 남아 있다").not.toContain("실효는 미검증");
    expect(실행줄, "cgroup이 왜 못 보는지 실측 근거가 GUARD 값에 있어야 한다").toMatch(/memcg 밖|통합메모리 GPU 할당/);
  });

  it("★★ 스왑 감시견이 있다 — 문턱은 SwapFree 절대 수준이다(2026-09-14 실측: 시작-대비-증가 문턱이 정상 굽기를 75초 만에 죽였다)", () => {
    // ⚠ 2026-09-14 회전 r5b 첫 굽기 실측: 「시작 대비 증가 ≥2GiB 연속 3회」 문턱이 베이스 가중치
    //   로드 중이던 정상 굽기를 죽였다(night4.log 스왑 4G→5G→8G·종료코드 143). r5a는 같은 조건에서
    //   완주했으므로 증가량 자체는 위험 신호가 아니다 — 문턱을 SwapFree 절대 수준으로 바꿨다.
    expect(실행줄, "SwapFree 기준선을 시작 때 재는 줄이 없다").toMatch(/SWAP_BASE_KB=.*SwapFree/);
    expect(실행줄, "증가량을 곡선 기록용으로 남기는 줄이 없다").toMatch(/DROP_GB/);
    expect(실행줄, "문턱이 SwapFree 절대 수준과 견주는 조건이 없다")
      .toMatch(/"\$FREE_NOW_GB"\s+-lt\s+"\$SWAP_FREE_MIN_GB"/);
    expect(실행줄, "폐기된 옛 문턱(시작 대비 증가)이 아직도 죽이는 조건으로 남아 있다")
      .not.toMatch(/"\$DROP_GB"\s+-ge\s+"\$SWAP_DROP_MAX_GB"/);
    expect(실행줄, "학습만 내려야 한다 — 여기도 이름으로 죽이면 교사까지 죽는다")
      .toMatch(/pkill -f "finetune_qlora14b\.py"/);
    expect(실행줄, "감시견 PID를 안 챙기면 굽기가 끝나도 안 죽고 남는다").toContain("SWAPDOGPID");
  });

  it("★★ 스왑 감시견 — SwapTotal 0(스왑 없음)이거나 못 읽으면 문턱 판정을 건너뛴다(2026-09-14 검토관 적발·중)", () => {
    // ⚠ 격리 시뮬레이션 실측: 절대 문턱 아래서 `${SWAP_NOW_KB:-$SWAP_BASE_KB}` 폴백을 그대로
    //   두면(옛 「시작 대비 증가」 규칙에선 안전했던 그 폴백) /proc/meminfo를 못 읽는 경우와
    //   스왑이 꺼진 기계(SwapFree 늘 0) 둘 다 표본 0 0 0 → 연속 3회(45초) 만에 정상 굽기를
    //   죽였다. 시작 때 SwapTotal도 재서 0/읽기실패면 문턱 판정만 건너뛰고 기록은 계속한다.
    expect(실행줄, "SwapTotal을 시작 때 재는 줄이 없다").toMatch(/SWAP_TOTAL_KB=.*SwapTotal/);
    expect(실행줄, "감시 가능 여부 플래그(SWAP_MONITOR)가 없다").toContain("SWAP_MONITOR=1");
    expect(실행줄, "SwapTotal 0/읽기실패에서 SWAP_MONITOR를 0으로 내리는 조건이 없다")
      .toMatch(/SWAP_TOTAL_KB"\s+-eq\s+0[\s\S]{0,120}SWAP_MONITOR=0/);
    expect(실행줄, "루프 안 SWAP_NOW_KB를 SWAP_BASE_KB로 메우는 옛 폴백이 아직 있다 — 절대 문턱에선 위험하다")
      .not.toMatch(/SWAP_NOW_KB=\$\{SWAP_NOW_KB:-\$SWAP_BASE_KB\}/);
    // 문턱 판정(FREE_NOW_GB 비교)이 SWAP_MONITOR 안에 갇혀 있어야 한다 — 안 그러면 스왑 없는
    // 기계에서 매 표본이 곧바로 "0G < 2G"가 되어 문턱 판정 자체가 다시 걸린다.
    expect(실행줄, "문턱 판정이 SWAP_MONITOR 안에 갇혀 있지 않다")
      .toMatch(/SWAP_MONITOR"\s+-eq\s+1[\s\S]{0,200}"\$FREE_NOW_GB"\s+-lt\s+"\$SWAP_FREE_MIN_GB"/);
  });

  it("스왑 감시견이 학습 프로세스명으로만 죽인다 — llama-server 이름은 어디에도 안 쓴다", () => {
    const 시작 = 실행줄.indexOf("SWAP_BASE_KB=");
    expect(시작, "스왑 감시견 블록을 못 찾았다").toBeGreaterThan(-1);
    const 끝 = 실행줄.indexOf("SWAPDOGPID=", 시작) + "SWAPDOGPID=$!".length;
    const 블록 = 실행줄.slice(시작, 끝);
    expect(블록).not.toMatch(/llama-server/);
  });

  it("★★ 한 표본으로 학습을 죽이지 않는다 — 연속 확인이 있어야 한다", () => {
    // ⚠ 2026-09-13 검토관 적발(당시 문턱은 시작-대비-증가 2GiB, 실측 근거 없음이었다): 순간
    //   표본 하나로 내리면 정상 굽기가 밤째 날아가고 원인이 「대책으로 넣은 감시견」이 된다.
    //   2026-09-14 실측이 그 우려를 그대로 확인했다(문턱 자체가 정상 굽기를 죽였다 — 위 시험이
    //   그 문턱을 SwapFree 절대 수준으로 교체했음을 본다). 연속 확인은 그 교체 뒤에도 유효한
    //   완충이라 그대로 둔다.
    expect(실행줄, "연속 확인 횟수가 변수로 없다").toContain("SWAP_DOG_CONFIRM=${SWAP_DOG_CONFIRM:-3}");
    expect(실행줄, "걸린 횟수를 세는 자리가 없다").toMatch(/SWAP_HITS=\$\(\(SWAP_HITS \+ 1\)\)/);
    expect(실행줄, "연속이 끊기면 0으로 되돌려야 「연속」이 된다").toMatch(/else[\s\S]{0,80}SWAP_HITS=0/);
    expect(실행줄, "연속 횟수에 못 미치면 로그만 남기고 지나가야 한다")
      .toMatch(/\[ "\$SWAP_HITS" -lt "\$SWAP_DOG_CONFIRM" \]/);
    // pkill은 **연속 확인을 넘은 갈래 안에서만** 불린다 — 문턱을 넘자마자 부르는 꼴이면 빨강.
    const 시작 = 실행줄.indexOf("SWAP_BASE_KB=");
    const 블록 = 실행줄.slice(시작, 실행줄.indexOf("SWAPDOGPID=", 시작));
    expect(블록.indexOf('pkill -f "finetune_qlora14b.py"'), "감시견 블록에 pkill이 없다").toBeGreaterThan(-1);
    expect(블록.indexOf("SWAP_DOG_CONFIRM"), "연속 확인 없이 곧바로 죽인다")
      .toBeLessThan(블록.indexOf('pkill -f "finetune_qlora14b.py"'));
  });

  it("★ 잣대 단일화 — mem() **함수 안에** 스왑 칸이 있다(32G/43G는 스왑을 안 깎은 수라서)", () => {
    // ⚠ 2026-09-13 검토관 적발(상): 예전엔 파일 **전체**에서 낱말 「스왑」만 봤다. 그런데 스왑
    //   감시견 로그 줄에도 그 낱말이 있어서, mem()에서 스왑 칸을 통째로 지워도 시험이 초록이었다
    //   (실측: 돌연변이로 mem()을 옛 한 줄짜리로 되돌려도 통과). 그래서 **함수 본문만** 잘라서 본다.
    const 시작 = 밤.indexOf("mem() {");
    expect(시작, "mem() 함수를 못 찾았다").toBeGreaterThan(-1);
    const 끝 = 밤.indexOf("\n}", 시작);
    expect(끝, "mem() 함수의 닫는 줄을 못 찾았다 — 한 줄짜리 옛 mem()으로 되돌아갔을 수 있다").toBeGreaterThan(시작);
    const 본문 = 밤.slice(시작, 끝);
    expect(본문, "mem() 함수가 스왑을 안 찍는다").toMatch(/스왑 %sG|스왑 "/);
    expect(본문, "free의 스왑 줄을 읽는 자리가 없다").toMatch(/\^스왑\|\^Swap/);
    // 굽기 중 최대치 집계가 "사용" 뒤 필드를 전부 최댓값 후보로 줍는다 — 스왑 칸에 같은 낱말을
    // 다시 쓰면 그 집계가 스왑 값과 메모리 값을 뒤섞는다(회귀 방지).
    expect(실행줄).not.toMatch(/스왑 사용/);
  });

  it("★ free 호출은 전부 LC_ALL=C다 — 로케일 의존 행이름 결함 재발 방지(2026-09-14 검토관 적발·하)", () => {
    // ⚠ 2026-09-14 실측: mem()만 LC_ALL=C로 고치고 AVAIL 관문(가용 메모리 판단)은 로케일
    //   의존인 채 남아 있었다. 지금은 ko.po "메모리:"가 패딩 없어 오작동은 아니지만(일관성
    //   지적), 번역 문자열이 바뀌면 AVAIL이 비어 가용 관문을 틀린 사유로 건너뛰게 된다.
    const 로케일의존 = 실행줄.match(/(?<!LC_ALL=C )free -g/g);
    expect(로케일의존, `LC_ALL=C 없이 free -g를 부르는 곳이 있다: ${JSON.stringify(로케일의존)}`).toBeNull();
  });

  it("★ 굽기 산출 로그가 **회전에 묶인다** — ROUND=r5b로 돌려도 r5a 증거를 안 덮는다", () => {
    // ⚠ 2026-09-13 검토관 적발: bake.log·bake-mem.log가 회전과 무관한 한 이름이라, r5b 밤이
    //   `>`로 r5a의 시계열 증거(773표본)를 잘라 덮고 배너는 「r5a」라고 말했다.
    expect(실행줄).toContain("BAKELOG=${BAKELOG:-$R5/$ROUND-bake.log}");
    expect(실행줄).toContain("MEMLOG=${MEMLOG:-$R5/$ROUND-bake-mem.log}");
    expect(실행줄, "회전과 무관한 옛 이름으로 쓰는 자리가 남아 있다").not.toMatch(/> "\$R5\/bake(-mem)?\.log"/);
    expect(실행줄, "배너가 회전 이름을 안 찍는다 — 아침에 어느 회전인지 못 읽는다")
      .toMatch(/회전 5 \$ROUND 본 굽기 시작/);
    expect(실행줄).toMatch(/회전 5 \$ROUND 본 굽기 끝/);
    expect(실행줄, "요약 줄에도 회전이 있어야 한다").toMatch(/요약 — 회전=\$ROUND/);
  });

  it("★★ 깃발 검사 목록은 **이번에 넘기는 깃발만** 본다 — 안 쓰는 깃발로 사본 폴백을 넓히지 않는다", () => {
    // ⚠ 2026-09-13 검토관 적발: --gpu-mem-fraction을 목록에 박아 두면, 그 깃발을 안 쓰는 밤에도
    //   저장소 학습기가 「깃발 없음」으로 걸려 사본으로 내려간다 — 그 사본에는 이번 대책의 GPU
    //   계측이 없어 「대책을 넣고 구웠다」로 읽히는데 계측은 0줄인 밤이 된다.
    expect(실행줄, "안 쓰는 깃발이 기본 목록에 박혀 있다")
      .toContain('FTFLAGS="--precision --lora-alpha-mult --save-epochs --eval-file --lora-targets --max-seq"');
    expect(실행줄, "값을 줄 때만 목록에 더하는 자리가 없다")
      .toMatch(/\[ -z "\$GPUMEMFRAC" \] \|\| FTFLAGS="\$FTFLAGS --gpu-mem-fraction"/);
    expect(실행줄, "고른 학습기에 계측이 있는지를 로그가 말해야 한다(폴백을 정상 출력처럼 다루지 않는다)")
      .toContain('grep -q "def gpu_메모리_로그(" "$FT"');
    expect(실행줄).toMatch(/학습기: \$FT · GPU 계측: \$FTMEAS/);
    // 사본에도 깃발이 없으면 굽지 않는다 — 그대로 부르면 새벽에 argparse로 즉사한다.
    expect(실행줄).toMatch(/elif \[ -n "\$FTMISS2" \]; then/);
  });

  it("★ 「걸린 보호」 줄이 새 보호 둘도 말한다 — GPUMEMFRAC·ALLOC_CONF를 켜면 그 줄에 남는다", () => {
    // ⚠ 2026-09-13 검토관 적발: 이 한 줄을 정직하게 만들려고 2026-09-11에 고친 자리인데,
    //   이번에 생긴 보호 둘(토치 상한·ALLOC_CONF)이 그 줄에 한 글자도 안 남았다.
    expect(실행줄).toMatch(/\[ -z "\$GPUMEMFRAC" \] \|\| GUARD="\$GUARD · 토치 상한 \$GPUMEMFRAC/);
    expect(실행줄).toMatch(/\[ -z "\$ALLOC_CONF" \] \|\| GUARD="\$GUARD · PYTORCH_CUDA_ALLOC_CONF=\$ALLOC_CONF"/);
    // ⚠ 순서가 중요하다 — RUNNER가 비었을 때 GUARD를 **통째로 갈아 쓰는** 줄보다 뒤에 붙어야 남는다.
    expect(실행줄.indexOf('[ -n "$RUNNER" ] || GUARD='))
      .toBeLessThan(실행줄.indexOf('[ -z "$GPUMEMFRAC" ] || GUARD='));
  });

  // ★ 돌연변이로 실제로 잡히는지 확인(2026-09-13 구현 중 실측) — 스왑 감시견 줄을 지우면
  //   위 두 시험(SWAP_BASE_KB·pkill)이 실제로 빨개졌다(수동 확인, 되돌린 뒤 커밋).
  //   ★ 2026-09-13 수리: mem()에서 스왑 칸을 지우는 돌연변이로 옛 시험(/스왑/)이 **초록**임을
  //     실측해 확인한 뒤, 위 「mem() 함수 안에」 시험으로 바꿔 같은 돌연변이가 빨개지는 것을 확인했다.
});
