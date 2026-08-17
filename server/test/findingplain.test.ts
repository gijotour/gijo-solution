// 취약점 이름 옆 **한글 한 줄** — [2026-08-04 파트너 지적 · 계획서 전-7]
//
// ★ 지적: "조치 관련 사항 및 설명에 일부 영문이 보인다."
//   실측: 취약점 4,833건 중 **4,661건(96%)에 한글이 하나도 없다.**
//
// ⚠ 이름 자체는 번역하지 않는다 — 원문이 검색·벤더 대조의 열쇠다. 옆에 한 줄을 붙인다.
// ⚠ 이름별 번역표를 만들지 않은 이유: 이름이 **2,185가지**로 흩어져 상위 25개가 18%뿐이다.
//   같은 낱말을 쓰는 **종류 규칙**이 훨씬 멀리 간다(실측 45%).
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import { 한줄풀이찾기, 한줄풀이글, 조사정보인가, 덮는범위 } from "../src/engine/findingplain";
import { agenttoolsSource } from "./util/toolsrc";

describe("한줄풀이 — 종류를 알아본다", () => {
  it("가장 위험한 것부터 알아본다", () => {
    expect(한줄풀이찾기("Apache Log4j < 2.15.0 Remote Code Execution (Nix)")!.종류).toBe("실행");
    expect(한줄풀이찾기("Netlogon Elevation of Privilege (CVE-2020-1472)")!.종류).toBe("권한");
    expect(한줄풀이찾기("SSL Self-Signed Certificate")!.종류).toBe("암호화");
    expect(한줄풀이찾기("Missing Security Update KB5001234")!.종류).toBe("구식");
  });

  it("★ 조사 항목을 「취약점이 아니다」라고 말해 준다 — 4,833건에 겁먹는 큰 이유다", () => {
    for (const n of ["Service Detection", "OS Fingerprints Detected", "Nessus Scan Information", "Common Platform Enumeration (CPE)"]) {
      expect(조사정보인가(n), `${n}이 조사 항목으로 안 잡힌다`).toBe(true);
    }
    expect(한줄풀이찾기("Service Detection")!.말).toContain("조치 대상이 아닙니다");
  });

  it("배포판 보안권고(RHSA/RLSA…)·< 버전은 '업데이트' 안내를 붙인다 — 특정 유형은 우선 (2026-08-17 커버리지 확대)", () => {
    expect(한줄풀이찾기("RHEL 8 : freerdp (RHSA-2026:8945)")!.종류).toBe("구식");
    expect(한줄풀이찾기("RHEL 8 : freerdp (RHSA-2026:8945)")!.말).toContain("업데이트");
    expect(한줄풀이찾기("Rocky Linux 9 : kernel (RLSA-2025:1234)")!.종류).toBe("구식");
    expect(한줄풀이찾기("Mozilla Firefox 118.x < 119.0 Multiple Vulnerabilities")!.말).toContain("낡아");
    expect(한줄풀이찾기("OpenSSH < 9.6 Multiple Vulnerabilities")!.종류).toBe("구식");
    // 구체적 유형(RCE)은 배포판 규칙보다 위 — 더 정확한 게 이긴다
    expect(한줄풀이찾기("RHEL 8 : kernel remote code execution (RHSA-2026:1)")!.종류).toBe("실행");
  });

  it("★★ CVE가 붙었으면 「조치 대상이 아니다」라고 말하지 않는다", () => {
    // 실측: `RPC portmapper Service Detection (CVE-1999-0632)` — 이름은 조사인데 CVE가 있다.
    // 틀릴 거면 **더 보게 만드는 쪽으로** 틀린다. 넘기게 만드는 쪽이 훨씬 위험하다.
    const p = 한줄풀이찾기("RPC portmapper Service Detection (CVE-1999-0632)")!;
    expect(p.말).not.toContain("조치 대상이 아닙니다");
    expect(p.말).toContain("확인해 주세요");
  });

  it("⚠ 정규식 함정 — 복수형·하이픈을 놓치지 않는다", () => {
    // 처음에 `\bfingerprint\b`가 「Fingerprints」를(42건), `sha1`이 「SHA-1」을(14건) 놓쳤다.
    expect(한줄풀이찾기("OS Fingerprints Detected")).not.toBeNull();
    expect(한줄풀이찾기("SSH SHA-1 HMAC Algorithms Enabled")).not.toBeNull();
    expect(한줄풀이찾기("ICMP Timestamp Request Remote Date Disclosure")!.종류).toBe("노출");
  });

  it("이미 우리말로 적힌 이름에는 덧붙이지 않는다 — 같은 말이 두 번 나온다", () => {
    expect(한줄풀이찾기("자체 서명 인증서 사용으로 인한 중간자 공격 위험")).toBeNull();
    expect(한줄풀이글("자체 서명 인증서 사용으로 인한 중간자 공격 위험")).toBe("");
  });

  it("★ 모르면 모른다고 한다 — 그럴듯한 한 줄을 지어내지 않는다", () => {
    expect(한줄풀이찾기("Zzz Proprietary Widget Check 9000")).toBeNull();
    expect(한줄풀이글("Zzz Proprietary Widget Check 9000"), "빈 값이어야 화면이 원문만 보여 준다").toBe("");
  });

  it("★ 소스 감시 — 만들어만 두고 안 부르면 아무 일도 안 일어난다", () => {
    // 이 저장소의 단골 결함: 함수를 만들어 놓고 호출부가 안 부른다(9곳 실측된 적 있다).
    // 취약점 이름이 나가는 **목록 두 곳**(finding_status · 통합 검색)이 실제로 부르는지 읽는다.
    const src = agenttoolsSource();
    const 부른횟수 = (src.match(/한줄풀이글\(/g) || []).length;
    expect(부른횟수, "취약점 이름을 내는 목록 두 곳이 불러야 한다").toBeGreaterThanOrEqual(2);
    // 헛돌지 않는지 — import가 실제로 있어야 위 숫자가 뜻이 있다.
    // 경로 깊이는 묻지 않는다 — agenttools가 폴더로 나뉘며 "../findingplain"이 됐다(2026-08-06).
    expect(src, "import 없이 이름만 세면 주석도 세어 통과한다").toMatch(/from "\.\.?\/findingplain"/);
  });

  it("덮는범위는 **얼마나 덮는지 밝힌다** — 안 밝히면 「다 설명된다」로 읽힌다", () => {
    const c = 덮는범위(["Service Detection", "SSL Self-Signed Certificate", "Zzz Unknown Thing 9000"]);
    expect(c.전체).toBe(3);
    expect(c.덮음).toBe(2);
    expect(c.비율).toBe(67);
    expect(c.종류별).toHaveProperty("조사정보");
  });
});
