// 지원 종료(EOL/EOS) 표 — [2026-08-04 파트너 지적 3번 · 계획서 중-7 + 전-4]
//
// ★ 지적: "자산 정보 … 그럼 **EOS 정보** 같은 것도 같이 제공 될거라고 생각이 됩니다."
//   확인해 보니 없었다. 지원이 끝난 소프트웨어는 취약점이 나와도 **고칠 패치가 없다.**
//
// ⚠⚠ 이 시험이 지키는 가장 중요한 것: **확인 전 날짜를 확인된 것처럼 보이게 하지 않는다.**
//   보안 제품에서 틀린 지원종료일은 "패치가 있는 줄 알았는데 없다"를 만든다.
import { describe, expect, it } from "vitest";
import { EOL_SEED, eol찾기, eol한줄, eol표상태 } from "../src/engine/eol-seed";

describe("★ 출처 없는 줄은 없다", () => {
  it("모든 줄에 출처가 적혀 있다", () => {
    for (const r of EOL_SEED) {
      expect(r.출처, `${r.제품} ${r.버전 ?? ""}에 출처가 없다`).toBeTruthy();
      expect(r.출처.length).toBeGreaterThan(3);
    }
  });

  it("★★ 확인 전 항목은 **확인 전이라고 표시돼 있다**", () => {
    // 지금은 전부 확인 전이다. 누군가 벤더 공지로 대조하면 확인필요를 내리고 확인일을 적는다.
    for (const r of EOL_SEED) {
      if (r.확인필요) continue;
      expect(r.확인일, `${r.제품}: 확인했다면 **확인일**이 있어야 한다`).toBeTruthy();
    }
  });

  it("날짜가 있으면 형식이 맞다 — 엉뚱한 값이 들어가면 계산이 조용히 틀린다", () => {
    for (const r of EOL_SEED) {
      if (!r.종료일) continue;
      expect(r.종료일, `${r.제품} 날짜 형식`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(r.종료일 + "T00:00:00").getTime())).toBe(false);
    }
  });
});

describe("eol찾기 — 모르면 모른다고 한다", () => {
  it("제품·버전으로 찾는다", () => {
    expect(eol찾기("CentOS Linux", "7.9.2009")?.버전).toBe("7");
    expect(eol찾기("openssl", "1.1.1k-9.el8")?.버전).toBe("1.1.1");
  });

  it("★ 표에 없으면 null — **지원 중이라는 뜻이 아니다**", () => {
    expect(eol찾기("우리회사 자체제작 데몬", "1.0")).toBeNull();
    expect(eol찾기("")).toBeNull();
  });

  it("버전이 안 맞으면 그 대역으로 넘겨짚지 않는다", () => {
    // ubuntu 22.04는 표에 없다 — 18.04/20.04 줄을 갖다 붙이면 **틀린 날짜**를 말하게 된다.
    expect(eol찾기("ubuntu", "22.04")).toBeNull();
  });
});

describe("★★ eol한줄 — 확인 전이라는 사실을 반드시 말한다", () => {
  it("지원이 끝났으면 패치가 없다고 말한다", () => {
    const 글 = eol한줄({ 제품: "centos", 버전: "7", 종료일: "2024-06-30", 출처: "x공지", 확인필요: true }, new Date("2026-08-04"));
    expect(글).toContain("지원이 끝난 버전");
    expect(글).toContain("고칠 패치가 없습니다");
  });

  it("★★ 확인 전이면 **조치 전에 확인하라**고 붙는다 — 이게 없으면 확정 사실로 읽힌다", () => {
    const 글 = eol한줄({ 제품: "x", 종료일: "2020-01-01", 출처: "어디공지", 확인필요: true });
    expect(글).toContain("대조하지 않은 값");
    expect(글).toContain("확인해 주세요");
  });

  it("대조를 마쳤으면 그렇게 적고 언제 했는지 남긴다", () => {
    const 글 = eol한줄({ 제품: "x", 종료일: "2020-01-01", 출처: "벤더공지", 확인필요: false, 확인일: "2026-08-10" });
    expect(글).not.toContain("확인해 주세요");
    expect(글).toContain("2026-08-10");
  });

  it("날짜를 모르면 모른다고 한다 — 지어내지 않는다", () => {
    expect(eol한줄({ 제품: "x", 출처: "어디공지", 확인필요: true })).toContain("모릅니다");
  });

  it("아직 안 끝난 것은 「끝났다」고 하지 않는다", () => {
    const 글 = eol한줄({ 제품: "x", 종료일: "2030-01-01", 출처: "공지", 확인필요: true }, new Date("2026-08-04"));
    expect(글).not.toContain("지원이 끝난");
    expect(글).toContain("종료 예정일");
  });
});

describe("eol표상태 — 얼마나 믿을 수 있는지 밝힌다", () => {
  // ⚠ 예전엔 「지금은 전부 확인 전」을 못박아 두었다가, 2026-09-02에 벤더 대조를 끝내자
  //   **시험이 낡아서 빨간불**이 났다(시험 스스로 「시험 전제가 낡았다」고 적어 두었다).
  //   그래서 **지금 데이터 상태가 아니라 기계**를 시험한다 — 확인 전이 있으면 그렇다고,
  //   없으면 「전부 대조 완료」라고 말하는지.
  it("확인 전 줄이 있으면 그렇다고, 없으면 「대조 완료」라고 말한다", () => {
    const s = eol표상태();
    expect(s).toMatch(/\d+줄/);
    const 확인전 = EOL_SEED.filter((r) => r.확인필요).length;
    if (확인전 > 0) {
      expect(s, "확인 전 줄이 있는데 안 밝힌다").toContain("확인 전");
      expect(s).toContain(String(확인전));
    } else {
      expect(s, "전부 대조했는데 그렇다고 안 말한다").toContain("대조 완료");
    }
    expect(s, "왜 온라인 조회를 안 쓰는지도 밝힌다").toContain("폐쇄망");
  });

  it("★ 유상 연장이 있는 줄이 있으면 표 상태가 **그 사실을 밝힌다**", () => {
    const 연장 = EOL_SEED.filter((r) => r.유상연장).length;
    if (!연장) return; // 없으면 할 말이 없다
    const s = eol표상태();
    expect(s, "유상 연장이 있는데 안 밝힌다 — 담당자가 멀쩡한 서버를 교체 대상에 올린다").toContain("유상 연장");
    expect(s, "계약 여부를 우리가 모른다는 것도 밝혀야 한다").toMatch(/알 수 없|확인/);
  });
});
