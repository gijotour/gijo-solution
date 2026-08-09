// 원문 누출 관문 — 기계 데이터를 사람에게 그대로 내보내지 않는다 (2026-08-09, 계획서 중-3).
//
// 왜 이 시험이 있나: 자산 조회 답에 검색 원문 조각이 그대로 섞여 나온 사례가 있었는데
// **QA가 통과시켰다**(도구도 맞고 숫자도 맞아서 형식 판정으로는 정상). 형식만 보는 판정의
// 사각지대라, 여기서 내용을 직접 못 박는다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 원문누출차단, 기계데이터줄인가 } from "../src/engine/rawleak";

describe("기계 데이터 판별", () => {
  it("★ 실제로 나왔던 그 조각 — 저장소 내부 열쇠말", () => {
    expect(기계데이터줄인가('"payload_id":"was_asset-0f21",')).toBe(true);
    expect(기계데이터줄인가('  "chunk_id": 41, ')).toBe(true);
    expect(기계데이터줄인가('"_distance":0.213')).toBe(true);
  });

  it("낱쌍이 둘 이상이면 문장이 아니라 자료다", () => {
    expect(기계데이터줄인가('{"host":"10.0.0.100","severity":"high"}')).toBe(true);
  });

  it("끊기지 않는 긴 덩어리 — 해시·벡터가 통째로 실려 온 것", () => {
    expect(기계데이터줄인가("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk=")).toBe(true);
  });

  it("★★ 사람 문장은 건드리지 않는다 — 막느라 기능을 죽이면 안 된다", () => {
    expect(기계데이터줄인가("자산 샘플-웹서버의 미조치 취약점은 4건입니다.")).toBe(false);
    expect(기계데이터줄인가("담당: 보안관제팀 · 서비스: 임직원 포털")).toBe(false);
    // 낱쌍 하나짜리는 표 설명일 수 있다 — 둘 이상일 때만 자료로 본다.
    expect(기계데이터줄인가('심각도는 "high"입니다.')).toBe(false);
    expect(기계데이터줄인가("")).toBe(false);
  });
});

describe("답에서 걷어내기", () => {
  it("★ 섞여 나온 조각만 빼고 사람 말은 남긴다", () => {
    const 답 = [
      "자산 샘플-웹서버의 정보는 다음과 같습니다.",
      '"payload_id":"was_asset-0f21","score":0.88',
      "미조치 취약점은 4건입니다.",
    ].join("\n");
    const r = 원문누출차단("이 자산 알려줘", 답);
    expect(r.막았나).toBe(true);
    expect(r.걸린수).toBe(1);
    expect(r.답).toContain("샘플-웹서버");
    expect(r.답).toContain("4건");
    expect(r.답).not.toContain("payload_id");
    // 무엇이 빠졌는지 말한다 — 말없이 지우면 답이 끊긴 것처럼 보인다.
    expect(r.답).toContain("뺐습니다");
  });

  it("★★ 사람이 JSON을 **달라고 했으면** 비켜간다 — SBOM·VEX는 원래 기계 형식이다", () => {
    const 답 = '{"bomFormat":"CycloneDX","specVersion":"1.5"}';
    expect(원문누출차단("SBOM을 JSON으로 보여줘", 답).막았나).toBe(false);
    expect(원문누출차단("VEX 원문 줘", 답).막았나).toBe(false);
  });

  it("★★★ 코드블록 안은 손대지 않는다 — 거긴 기계가 사는 자리다", () => {
    const 답 = [
      "설정은 이렇게 넣으세요.",
      "```",
      '{"ctx":8192,"batch":8192,"ubatch":8192}',
      "```",
    ].join("\n");
    const r = 원문누출차단("임베딩 설정 알려줘", 답);
    expect(r.막았나).toBe(false);
    expect(r.답).toContain("8192");
  });

  it("걷어내고 사람 말이 안 남으면 답을 통째로 바꾼다 — 빈 답이 제일 나쁘다", () => {
    const r = 원문누출차단("이 자산 알려줘", '"payload_id":"was_asset-0f21","score":0.88\n"chunk_id":41,"_distance":0.2');
    expect(r.막았나).toBe(true);
    expect(r.답).toContain("사람이 읽을 형태");
    expect(r.답).not.toContain("payload_id");
    expect(r.답.trim().length).toBeGreaterThan(20);
  });

  it("정상 답은 글자 하나 안 바뀐다", () => {
    const 답 = "자산 샘플-웹서버의 미조치 취약점은 4건입니다.\n\n다음 걸음: 조치 계획을 세우시겠어요?";
    const r = 원문누출차단("이 자산 알려줘", 답);
    expect(r.막았나).toBe(false);
    expect(r.답).toBe(답);
  });

  it("빈 답은 그대로 — 여기서 만들어 내지 않는다", () => {
    expect(원문누출차단("아무거나", "").막았나).toBe(false);
  });
});

describe("출구 한 곳에 달렸는가 (소스 계약)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");

  it("★ 갈래마다가 아니라 dispatchInstruction 출구 한 줄에 있다", () => {
    expect(src).toContain("기계데이터를걸러낸다(instructionText, 거짓완료를걸러낸다(instructionText, result))");
  });

  it("결재판·확인 대기는 건드리지 않는다 — 그건 보여줄 내용이 아니라 물음이다", () => {
    const 블록 = src.slice(src.indexOf("function 기계데이터를걸러낸다"));
    expect(블록.slice(0, 300)).toContain("if (r.approval || r.confirm) return r;");
  });
});
