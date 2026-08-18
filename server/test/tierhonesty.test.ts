// 등급이 **파는 것과 하는 일이 같은지** 본다. (사장님 결정 2026-08-18 ⓑ — 「남기되 사실대로 적는다」)
//
// ⚠ 실결함:
//   화면(`settings.html:704`)과 서버 설명(`localengine.ts:129`)이 프로를
//   *"LLM 2개 병행 — A/B·검증"* 이라 팔았는데 **둘 다 사실이 아니었다**:
//     · A/B·검증 — 제품 코드에 `abTest`·`compareModels`·`crossVerify` **0건**
//     · LLM 2개 — `maxLoadedModels`가 쓰이는 곳은 `makeRoomFor`의 **nvidia-smi 실패 갈래 하나뿐**.
//       Mac·통합메모리·정상 nvidia-smi 셋 다 숫자를 돌려주므로 지원 플랫폼 전부에서 **안 걸린다.**
//       모델 축출은 실제 남은 VRAM이 정한다 — 48GB면 스탠다드로도 여러 개가 상주한다.
//   ⇒ 프로와 스탠다드는 **엔진에 들어가는 값이 같다**(ctxSize·overheadMb 동일).
//
// ⚠ 그리고 그 상태로 등급을 누르면 **얻는 것 없이 30초 대화가 끊겼다** —
//   화면이 스스로 「약 30초, 진행 중 대화가 끊길 수 있습니다」라고 경고하는 그 값을 치른다.
//   티어에서 실제 스폰 인자로 가는 값은 `ctxSize` 하나뿐이므로(`:564` → `--ctx-size`),
//   문맥 길이가 그대로면 재기동할 이유가 없다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { GIJO_TIERS } from "../src/engine/localengine";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 엔진 = 읽기("../src/engine/localengine.ts");
const 설정화면 = 읽기("../../client/src/renderer/pages/settings.html");
const 안내 = 읽기("../src/engine/screenguide.ts");

const 등급 = (id: string) => GIJO_TIERS.find((t) => t.id === id)!;

describe("등급이 파는 것 = 등급이 하는 일", () => {
  it("표를 실제로 읽어 온다 — 못 읽으면 이 시험이 헛돈다", () => {
    expect(GIJO_TIERS.length, "등급 표가 비었다").toBeGreaterThanOrEqual(3);
    for (const id of ["lite", "standard", "pro"]) expect(등급(id), `${id} 등급이 사라졌다`).toBeTruthy();
  });

  it("★ 없는 기능(A/B·검증 병행)을 어디서도 팔지 않는다", () => {
    // ⚠ 셋 다 고객이 읽는 글이다 — 화면 · 서버 등급 설명 · 챗봇 안내.
    const 자리: [string, string][] = [
      ["설정 화면", 설정화면],
      ["등급 표(서버)", 엔진],
      ["챗봇 안내", 안내],
    ];
    for (const [이름, 글] of 자리) {
      // 「A/B·검증 병행」을 파는 문장만 잡는다 — 「없다」고 밝히는 주석은 통과시킨다.
      const 파는말 = /(A\/B\s*[·・]?\s*검증\s*병행|검증\s*병행|A\/B\s*병행)/g;
      const 걸린것 = [...글.matchAll(파는말)]
        .map((m) => 글.slice(Math.max(0, m.index! - 90), m.index! + 30).replace(/\s+/g, " "))
        // 「사실이 아니다」를 설명하는 주석 줄은 뺀다(그건 정직한 기록이다).
        .filter((s) => !/사실이 아니|없는 기능|0건|예전|안 그림|안 그렸|정직/.test(s));
      expect(걸린것.join("\n---\n"), `${이름}에 「A/B·검증 병행」을 파는 문장이 남아 있다`).toBe("");
    }
  });

  it("★ 프로와 스탠다드가 엔진에 같은 값을 넣는 한, 그렇게 적혀 있다", () => {
    const p = 등급("pro"), s = 등급("standard");
    const 같나 = p.ctxSize === s.ctxSize && p.overheadMb === s.overheadMb;
    if (같나) {
      // 같으면 **같다고 말해야** 한다. 안 그러면 다시 없는 것을 파는 셈이다.
      expect(p.desc, "프로가 스탠다드와 같은 값인데 설명이 그 사실을 안 밝힌다").toMatch(/스탠다드와.*(같|동일)/);
      expect(설정화면, "설정 화면이 그 사실을 안 밝힌다").toMatch(/스탠다드와 <b>엔진 동작이 같습니다<\/b>|스탠다드와 엔진 동작이 같/);
    } else {
      // 달라지면 이 시험이 알려 준다 — 그때는 desc를 그 차이로 다시 써야 한다.
      expect(p.desc, "프로가 스탠다드와 달라졌다 — 설명을 그 차이로 다시 쓸 것").not.toMatch(/스탠다드와.*(같|동일)/);
    }
  });

  it("★ 라이트 사양이 코드와 어긋나지 않는다 — 챗봇이 틀린 숫자를 말하면 안 된다", () => {
    // ⚠ 실제로 어긋나 있었다: 안내는 「12GB급·16K」인데 코드는 10GB·8192였다.
    const l = 등급("lite");
    expect(l.minVramGb).toBe(10);
    expect(l.ctxSize).toBe(8192);
    expect(안내, `챗봇 안내의 라이트 사양이 코드(${l.minVramGb}GB·${l.ctxSize})와 다르다`).toMatch(
      /Lite\(10GB급·LLM 1개·8K/
    );
  });

  it("★ 바뀔 게 없으면 재기동하지 않는다 — 얻는 것 없이 대화가 끊기면 안 된다", () => {
    expect(엔진, "티어 적용이 이전 문맥 길이를 안 본다").toMatch(/이전문맥\s*=\s*currentTierSettings\(\)\.ctxSize/);
    expect(엔진, "문맥이 같을 때 건너뛰는 갈래가 없다").toMatch(/restarting:\s*false/);
    // 화면도 그 값을 봐야 한다 — 안 보면 「재기동 중」이라 거짓말한다.
    expect(설정화면, "화면이 restarting을 무시하고 늘 「재기동 중」이라 적는다").toMatch(/r\.restarting !== false/);
  });

  it("등급마다 문맥 길이가 실제로 다른 짝이 있어야 재기동 갈래가 뜻을 갖는다", () => {
    // 라이트(8192) ↔ 스탠다드(32768)는 진짜로 다르다 — 그 경우는 재기동이 맞다.
    expect(등급("lite").ctxSize).not.toBe(등급("standard").ctxSize);
  });
});
