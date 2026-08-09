// 권장 모델 목록이 **죽은 안내**가 되지 않게 (2026-08-10).
//
// ■ 왜 이 시험이 있나
//   2026-08-08에 추천 카탈로그를 지운 이유가 「추천 모델이 서버에 없는 죽은 안내를 냈다」였다.
//   되살리면서 같은 실패를 반복하지 않으려면, 목록을 **사람 기억이 아니라 형식으로** 지켜야 한다.
//   실제로 이 파일을 처음 쓸 때 내가 `BAAI/bge-m3`라고 적었는데, 그 저장소에는 **GGUF가 0개**였다
//   (우리 엔진은 GGUF만 읽는다). 확인하지 않았으면 고객 화면에 눌러도 안 되는 버튼이 생겼다.
//
// ⚠ 여기서 **네트워크를 부르지 않는다.** 시험이 인터넷에 기대면 사내망·에어갭에서 빨간불이 나고,
//   그러면 「원래 빨간불이야」가 자리 잡아 감시가 죽는다(2026-08-09에 그렇게 죽은 감시를 둘 봤다).
//   저장소가 살아 있는지는 **제품이 받기 전에 확인**하고, 여기서는 형식만 지킨다.
import { describe, it, expect } from "vitest";
import { 권장모델목록, 권장모델인가, 개조본일수있나, 로컬폴더후보 } from "../src/engine/modelcatalog";

describe("권장 모델 목록 — 형식 계약", () => {
  it("검사할 대상이 있다 — 0건이면 이 시험이 헛돌고 있다", () => {
    expect(권장모델목록.length).toBeGreaterThan(0);
  });

  it("★ 모든 저장소가 **조직명을 포함**한다 — 이 파일의 존재 이유다", () => {
    // 「qwen3-14b」로 검색하면 안전정렬 제거 변종이 상위에 온다(2026-08-10 실측).
    // 조직명이 빠진 항목이 하나라도 있으면 그 방어가 무너진다.
    const 조직없음 = 권장모델목록.filter((m) => !/^[^/\s]+\/[^/\s]+$/.test(m.repo));
    expect(조직없음.map((m) => m.repo), "형식은 반드시 <조직>/<저장소>").toEqual([]);
  });

  it("★★ 권장 목록에 개조본(Uncensored·abliterated 등)이 없다", () => {
    const 걸린것 = 권장모델목록.filter((m) => 개조본일수있나(m.repo));
    expect(걸린것.map((m) => m.repo), "보안 제품이 개조본을 권장하면 감사 지적 사항이다").toEqual([]);
  });

  it("기준 두뇌가 정확히 하나다 — 화면 맨 위에 올 것이 둘이면 안 된다", () => {
    expect(권장모델목록.filter((m) => m.기준).length).toBe(1);
  });

  it("사람이 읽을 칸이 비어 있지 않다 — 화면에 빈 줄이 나가지 않게", () => {
    for (const m of 권장모델목록) {
      expect(m.용도.trim(), `${m.repo}의 용도`).not.toBe("");
      expect(m.대략크기.trim(), `${m.repo}의 크기`).not.toBe("");
      expect(m.권장장비.trim(), `${m.repo}의 권장장비`).not.toBe("");
    }
  });

  it("권장모델인가()는 대소문자·공백에 흔들리지 않는다", () => {
    const r = 권장모델목록[0].repo;
    expect(권장모델인가(r)).toBe(true);
    expect(권장모델인가(`  ${r.toUpperCase()}  `)).toBe(true);
    expect(권장모델인가("someone/random-model")).toBe(false);
  });
});

describe("로컬 폴더 이름 — 「이미 받음」을 놓치지 않게", () => {
  // ⚠ 2026-08-10 실측으로 잡은 것: 운영에는 models/qwen3-14b/ · models/bge-m3/ 로 있는데
  //   받기가 만드는 이름은 models/Qwen__Qwen3-14B-GGUF/ 다. 하나만 보면 **이미 가진 모델에
  //   「받기」가 떠서 8.4GB를 다시 받는다.** 죽은 버튼의 반대 방향 사고다.
  it("★ 운영에 실제로 있는 짧은 이름을 포함한다", () => {
    expect(로컬폴더후보("Qwen/Qwen3-14B-GGUF")).toContain("qwen3-14b");
    expect(로컬폴더후보("gpustack/bge-m3-GGUF")).toContain("bge-m3");
  });

  it("★ 받기가 만드는 이름(org__repo)도 포함한다", () => {
    expect(로컬폴더후보("Qwen/Qwen3-14B-GGUF")).toContain("Qwen__Qwen3-14B-GGUF");
  });

  it("권장 목록 전부가 후보를 2개 이상 낸다 — 하나뿐이면 규칙이 낡은 것", () => {
    for (const m of 권장모델목록) {
      expect(new Set(로컬폴더후보(m.repo)).size, m.repo).toBeGreaterThan(1);
    }
  });

  it("조직명 없는 이름도 견딘다(BYOM으로 받은 것 대비)", () => {
    expect(로컬폴더후보("some-model")).toContain("some-model");
  });
});

describe("개조본 거름망", () => {
  it("★ 알려진 표식을 잡는다", () => {
    for (const id of [
      "org/Qwen3-14B-Uncensored-GGUF",
      "org/qwen3-abliterated",
      "org/Heretic-14B",
      "org/model-jailbroken",
      "org/llama-unfiltered",
    ]) {
      expect(개조본일수있나(id), id).toBe(true);
    }
  });

  it("★★ 평범한 이름을 오인하지 않는다 — 오탐이 잦으면 아무도 안 믿는다", () => {
    for (const id of [
      "Qwen/Qwen3-14B-GGUF",
      "BAAI/bge-m3",
      "gpustack/bge-m3-GGUF",
      "LGAI-EXAONE/EXAONE-3.5-7.8B-Instruct-GGUF",
      "meta-llama/Llama-3.1-8B-Instruct",
    ]) {
      expect(개조본일수있나(id), id).toBe(false);
    }
  });

  it("⚠ 이름 규칙은 마지막 그물일 뿐이라는 것을 시험으로 기록한다", () => {
    // 표식 없이 안전정렬만 제거한 모델은 이 그물로 못 잡는다. 진짜 방어는
    // 「고르지 않게 하는 것」(권장 목록)이다 — 이 시험은 그 사실을 남겨 둔다.
    expect(개조본일수있나("org/totally-normal-name-but-modified")).toBe(false);
  });
});
