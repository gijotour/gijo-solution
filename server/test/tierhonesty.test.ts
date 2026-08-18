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
// ⚠ **대시보드도 본다**(2026-08-18 회귀). 담당자가 매일 처음 보는 화면인데 검사 대상에 없어
//   「채팅 LLM N개」가 그대로 나갔다. 「어디를 볼지」를 손으로 적으면 빠진 자리가 생긴다.
const 대시보드 = 읽기("../../client/src/renderer/pages/dashboard.html");
const 안내 = 읽기("../src/engine/screenguide.ts");
// ⚠ 용어사전은 **RAG에 실린다**(docs-manifest.json) — 여기 적은 것은 챗봇이 고객에게 말한다.
const 용어사전 = 읽기("../../GIJO_AS_용어사전.md");
const 매니페스트 = 읽기("../docs-manifest.json");

const 등급 = (id: string) => GIJO_TIERS.find((t) => t.id === id)!;

describe("등급이 파는 것 = 등급이 하는 일", () => {
  it("표를 실제로 읽어 온다 — 못 읽으면 이 시험이 헛돈다", () => {
    expect(GIJO_TIERS.length, "등급 표가 비었다").toBeGreaterThanOrEqual(3);
    for (const id of ["lite", "standard", "pro"]) expect(등급(id), `${id} 등급이 사라졌다`).toBeTruthy();
  });

  it("★ 없는 기능을 어디서도 팔지 않는다 — 「A/B·검증 병행」과 **「LLM N개」** 둘 다", () => {
    // ⚠ 넷 다 고객이 읽는 글이다 — 화면 · 서버 등급 설명 · 챗봇 안내 · **용어사전**.
    //   ⚠ 용어사전은 `server/docs-manifest.json`에 있어 **RAG에 실린다** — 여기 적은 것은
    //     챗봇이 고객에게 그대로 말한다. 이 저장소에서 가장 멀리 가는 글이다.
    //
    // ⚠ 2026-08-18에 이 검사가 **반쪽이라 놓쳤다**: 「검증 병행」만 보고 **「LLM 2개」**를 안 봤다.
    //   그래서 등급을 **고르는 목록**(`settings.html` tierManualSelect)과 **고른 직후 메시지**,
    //   그리고 용어사전 두 곳에 거짓이 그대로 남았다. 앞의 정정이 다 소용없어질 뻔했다.
    //   ⇒ 「몇 개」를 파는 말도 함께 막는다. 모델 개수는 등급이 아니라 남은 VRAM이 정한다.
    const 자리: [string, string][] = [
      ["설정 화면", 설정화면],
      ["등급 표(서버)", 엔진],
      ["챗봇 안내", 안내],
      ["용어사전(RAG)", 용어사전],
      ["대시보드", 대시보드],
    ];
    // ⚠⚠ **숫자만 보면 못 잡는다**(2026-08-18 회귀 — 5.24.0에 두 자리가 실려 나갔다).
    //   `LLM ${current.maxLoadedModels}개`·`"채팅 LLM " + cur.maxLoadedModels + "개"`처럼
    //   **변수로 조립하는** 자리는 `\d+`에 안 걸린다. 하필 그 둘이 「등급을 한 번도 안 고른
    //   새 설치 고객」과 「매일 처음 보는 대시보드」였다.
    //   ⇒ 숫자든 변수든 **「LLM … 개」 꼴**이면 잡는다.
    //   ⚠ `maxLoadedModels …개`를 통째로 잡으면 **주석의 기술 설명**까지 걸린다
    //     (「maxLoadedModels가 안 걸린다」를 설명하는 글도 그 낱말을 쓴다).
    //     파는 문장은 「LLM …개」·「채팅 LLM …개」 꼴이므로 **그 모양만** 잡는다.
    const 파는말 =
      /((?:채팅\s*)?LLM\s*(?:\d+|\$\{[^}]{1,60}\}|"\s*\+\s*[\w.]{1,40}\s*\+\s*")\s*개|A\/B\s*[·・]?\s*검증\s*병행|검증\s*병행|A\/B\s*병행)/g;
    for (const [이름, 글] of 자리) {
      const 걸린것 = [...글.matchAll(파는말)]
        .map((m) => 글.slice(Math.max(0, m.index! - 110), m.index! + 40).replace(/\s+/g, " "))
        // 「사실이 아니다」를 설명하는 주석·정정 기록은 통과시킨다(그건 정직한 기록이다).
        // ⚠ **정정 기록은 통과시킨다.** 「예전엔 『LLM 2개』라고 적었다」는 주석까지 막으면
        //   고친 이유를 코드에 남길 수 없게 된다 — 이 저장소는 왜 고쳤는지를 주석에 남긴다.
        //   다만 면제 낱말이 너무 헐거우면 진짜 거짓도 통과하므로, **정정을 뜻하는 말만** 넣는다.
        .filter((s) =>
          !/사실이 아니|없는 기능|0건|예전|안 그림|안 그렸|정직|적지 않는다|안 걸리는|죽은 값|정정|뺐다|같은 이유로 틀린/.test(s)
        );
      expect(걸린것.join("\n---\n"), `${이름}에 없는 기능을 파는 문장이 남아 있다`).toBe("");
    }
  });

  it("용어사전을 실제로 읽어 온다 — 못 읽으면 위 검사가 헛돈다", () => {
    expect(용어사전.length, "용어사전이 비었다").toBeGreaterThan(1000);
    expect(용어사전, "등급 이야기가 사라졌다 — 위 검사의 근거가 바뀐 것이다").toMatch(/Lite·Standard·Pro|등급.*프로/);
    // RAG에 실리는 문서가 맞는지도 확인한다 — 여기 적은 것이 챗봇 입으로 나간다.
    expect(매니페스트, "용어사전이 RAG 목록에서 빠졌다 — 그러면 위 검사의 무게가 달라진다").toContain("GIJO_AS_용어사전.md");
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
    // ⚠ **문구가 아니라 숫자를 본다.** 예전엔 「Lite(10GB급·LLM 1개·8K」라는 **표기 자체**를
    //   요구했는데, 「LLM 1개」를 빼자(개수는 등급이 안 정한다) 이 검사가 빨간불이 났다.
    //   묻는 것은 「그 문장이 그대로 있나」가 아니라 **「숫자가 코드와 맞나」**다.
    expect(안내, `챗봇 안내의 라이트 VRAM이 코드(${l.minVramGb}GB)와 다르다`).toMatch(
      new RegExp(`Lite\\(${l.minVramGb}GB급`)
    );
    expect(안내, `챗봇 안내의 라이트 문맥이 코드(${l.ctxSize})와 다르다`).toMatch(
      new RegExp(`Lite\\([^)]*${l.ctxSize / 1024}K`)
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
