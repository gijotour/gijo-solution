// 후-4 에어갭 봉인 — default-deny 관문·egress 카탈로그·상태·라우팅.
// [전중후 계획서 정렬] 후-4: "인터넷으로 아무것도 안 나간다"를 **증명**할 수 있어야 한다.
//   단일 관문(globalThis.fetch 가드) + 자가확인 목록으로 봉인을 보이게 한다.
//
// ⚠ 이 시험이 지키는 것:
//   ① default-deny — 내부(루프백·사설·명시허용)만 통과, 나머지 전부 차단.
//   ② 카탈로그가 **실제 외부 호출을 다 덮는지**(빠지면 봉인 사각지대) — 소스를 훑어 대조.
//   ③ 관문이 실제로 globalThis.fetch를 봉인하는지 — 스텁으로 실측.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { egressAllowed, isPrivateIp, airgapStatus, EGRESS_POINTS, installAirgapGuard, assertEgressAllowed } from "../src/engine/airgap";
import { forcedToolFor } from "../src/engine/agentloop";
import { findAgentTool } from "../src/engine/agenttools";
import { agenttoolsSource } from "./util/toolsrc";

describe("에어갭 — 내부/외부 판정(default-deny)", () => {
  it("루프백·사설 IP는 허용", () => {
    for (const u of [
      "http://localhost:4000/x", "http://127.0.0.1:8081/e", "http://10.1.2.3/",
      "http://192.168.0.5:9000/", "http://172.16.5.5/", "http://172.31.9.9/", "http://[::1]:4000/",
    ]) {
      expect(egressAllowed(u).allowed, u).toBe(true);
    }
  });

  it("공개 외부 호스트는 차단", () => {
    for (const u of [
      "https://api.anthropic.com/v1/messages", "https://www.cisa.gov/x.json",
      "https://huggingface.co/api", "https://otx.alienvault.com/api", "https://www.law.go.kr/DRF",
      "https://api.openai.com/v1", "https://generativelanguage.googleapis.com/v1beta", "https://8.8.8.8/",
    ]) {
      expect(egressAllowed(u).allowed, u).toBe(false);
    }
  });

  // ★ 2026-08-05 검토관 발견(높음): IPv6 ULA 접두사(fc/fd/fe80) 판정을 **호스트명에도** 적용해
  //   fcm.googleapis.com·fd-cdn.example.com 같은 외부 도메인이 "내부"로 통과했다.
  //   봉인 ON인 기밀 배치에서 SIEM 호스트를 그런 이름으로 잡으면 감사가 그대로 밖으로 나간다.
  it("fc/fd/fe80로 시작하는 **도메인**은 내부가 아니다 (IPv6 리터럴만 인정)", () => {
    for (const h of ["fcm.googleapis.com", "fd-cdn.example.com", "fdx.attacker.io", "fe80-cdn.example.net", "fconnect.io"]) {
      expect(isPrivateIp(h), h).toBe(false);
      expect(egressAllowed(`https://${h}/x`).allowed, h).toBe(false);
    }
    // 진짜 IPv6 리터럴은 그대로 통과해야 한다(내부망 ULA·link-local)
    for (const h of ["fd00::1", "fc00::abcd", "fe80::1", "::1"]) expect(isPrivateIp(h), h).toBe(true);
    expect(egressAllowed("http://[fd00::1]:514/").allowed).toBe(true);
  });

  it("172 대역 경계를 정확히 가른다", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false); // /12 밖
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("11.0.0.1")).toBe(false);
  });

  it("명시 허용(GIJO_AIRGAP_ALLOW)만 예외로 통과", () => {
    vi.stubEnv("GIJO_AIRGAP_ALLOW", "gitlab.mycorp.local, siem.internal");
    expect(egressAllowed("https://gitlab.mycorp.local/api").allowed).toBe(true);
    expect(egressAllowed("https://siem.internal:514/").allowed).toBe(true);
    expect(egressAllowed("https://evil.example.com/").allowed).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("에어갭 카탈로그 — 실제 외부 호출을 다 덮는다(봉인 사각지대 방지)", () => {
  // ⚠ **engine/ 전체를 훑는다**(2026-08-05 검토 지적으로 넓힘). 예전엔 파일 7개를 손으로
  //   적어 뒀는데, 그건 **이미 카탈로그에 있는 것만 다시 확인**하는 꼴이었다 —
  //   새 파일이 외부로 나가면 시험은 조용히 통과한다. 사각지대 방지가 목적인 감시가
  //   사각지대를 못 보면 없느니만 못하다. http도 함께 본다(외부 평문 호출도 통로다).
  it("engine 전체에서 외부 호출 호스트가 모두 EGRESS_POINTS에 있다 (파일을 손으로 적지 않는다)", () => {
    const dir = path.join(__dirname, "../src/engine");
    const catalog = EGRESS_POINTS.map((p) => p.host).join(" ").toLowerCase();
    const missing: string[] = [];
    let 훑은파일 = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8")
        .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n"); // 주석 줄 제외(문서 URL 오탐)
      훑은파일++;
      // ⚠ **나가는 호출만** 본다. URL 문자열이 코드에 있다고 다 통로가 아니다 —
      //   SPDX documentNamespace(문서 식별자)나 지식 문서 본문에 실린 참고 URL은 접속하지 않는다.
      //   그래서 "fetch(…" / "axios(…" 같은 **호출 자리에 붙은 URL**만 대조한다.
      //   (소켓 통로는 호스트가 설정값이라 이 정규식으로 안 잡히고, 카탈로그·별도 시험이 덮는다.)
      const 호출 = src.match(/\b(?:fetch|axios(?:\.\w+)?|got|request)\s*\(\s*[`'"]https?:\/\/[a-zA-Z0-9.-]+/g) ?? [];
      for (const m of 호출) {
        const host = (m.match(/https?:\/\/([a-zA-Z0-9.-]+)/) ?? [])[1]?.toLowerCase() ?? "";
        if (!host) continue;
        if (host.endsWith(".local") || host.endsWith(".internal")) continue; // 내부망 예시
        if (host === "localhost" || host.startsWith("127.") || host === "0.0.0.0") continue;
        if (isPrivateIp(host)) continue;                  // 사설 IP는 봉인 대상 아님
        if (!catalog.includes(host)) missing.push(`${f}: ${host}`);
      }
    }
    expect(훑은파일, "engine 디렉터리를 못 읽었다 — 이 감시가 헛돌고 있다").toBeGreaterThan(50);
    expect(missing, `카탈로그에 없는 외부 호스트(봉인 사각지대):\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  // ⚠ **이 감시가 실제로 잡을 수 있는지**를 잰다. 통과만 하고 아무것도 못 보는 감시가
  //   가장 위험하다(넓히기 전 버전이 딱 그랬다 — 파일 7개를 손으로 적어 새 파일을 못 봤다).
  it("감시가 새 사각지대를 실제로 잡는다 (일부러 만든 미등록 호출)", () => {
    const dir = path.join(__dirname, "../src/engine");
    const 가짜 = path.join(dir, "__airgap_probe_tmp.ts");
    fs.writeFileSync(가짜, 'export const x = () => fetch("https://telemetry.notinthecatalog.example/beacon");\n');
    try {
      const catalog = EGRESS_POINTS.map((p) => p.host).join(" ").toLowerCase();
      const found: string[] = [];
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        for (const m of src.match(/\b(?:fetch|axios(?:\.\w+)?|got|request)\s*\(\s*[`'"]https?:\/\/[a-zA-Z0-9.-]+/g) ?? []) {
          const host = (m.match(/https?:\/\/([a-zA-Z0-9.-]+)/) ?? [])[1]?.toLowerCase() ?? "";
          if (host && !catalog.includes(host) && !host.endsWith(".local")) found.push(host);
        }
      }
      expect(found, "새 외부 호출을 못 잡는다 — 감시가 헛돌고 있다").toContain("telemetry.notinthecatalog.example");
    } finally {
      fs.rmSync(가짜, { force: true }); // 흔적을 남기지 않는다
    }
  });

  // ★ 2026-08-05 검토관 발견(중간): fetch·소켓 관문은 **우리 프로세스 안**에서만 돈다.
  //   spawn한 python·HF CLI는 관문 밖이라 "전부 막힘"은 과장이었다 — v2가 없애려던 거짓 안심.
  it("자식 프로세스 통로가 카탈로그에 있고, 봉인 시 오프라인 env가 물린다", async () => {
    const { airgapChildEnv } = await import("../src/engine/airgap");
    expect(EGRESS_POINTS.map((p) => p.id)).toContain("child"); // 정직하게 실려 있다
    expect(airgapChildEnv(), "봉인 아니면 무영향이어야 한다").toEqual({});
    vi.stubEnv("GIJO_AIRGAP", "1");
    try {
      const env = airgapChildEnv();
      expect(env.HF_HUB_OFFLINE).toBe("1");
      expect(env.TRANSFORMERS_OFFLINE).toBe("1");
    } finally { vi.unstubAllEnvs(); }
    // 실제 spawn 자리가 이 env를 물었는지 — 만들어 놓고 안 부르면 아무 소용이 없다
    const dir = path.join(__dirname, "../src/engine");
    for (const f of ["hfmodels.ts", "learnloop.ts", "finetune.ts"]) {
      expect(fs.readFileSync(path.join(dir, f), "utf8"), `${f}가 airgapChildEnv를 안 씀`).toContain("airgapChildEnv()");
    }
  });

  it("상태 문구가 '전부 막혔다'고 과장하지 않는다 (범위를 밝힌다)", () => {
    const src = agenttoolsSource();
    const i = src.indexOf("에어갭 봉인: 🔒 ON");
    expect(i, "봉인 ON 문구를 못 찾음 — 이 시험이 헛돌고 있다").toBeGreaterThan(0);
    const 문구 = src.slice(i, i + 600);
    expect(문구).toContain("제품이 직접 여는");   // 범위 명시
    expect(문구).toContain("완전한 차단은 아닙니다"); // 한계 명시
  });

  // ★ 2026-08-05 실사고: 봉인 실증용 임시 인스턴스(별 포트·별 DB)가 **운영의 llama-server를
  //   고아로 보고 죽였다**. 포트·DB를 갈라도 llama 자식은 공유 자원이라 격리가 안 된다.
  it("다른 GIJO 서버가 살아 있으면 고아 정리를 건너뛴다 (형제의 자식을 죽이지 않는다)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/localengine.ts"), "utf8");
    const i = src.indexOf("function reapOrphanEngines");
    expect(i, "고아 정리 함수를 못 찾았다 — 이 감시가 헛돌고 있다").toBeGreaterThan(0);
    const 본문 = src.slice(i, i + 2000);
    expect(본문, "형제 서버 탐지가 없다").toMatch(/pgrep[\s\S]{0,80}node/);
    expect(본문, "형제가 있으면 조기 반환해야 한다").toMatch(/형제\.length[\s\S]{0,400}return;/);
    // 형제 확인이 **kill보다 먼저**여야 의미가 있다
    expect(본문.indexOf("형제.length"), "형제 확인이 kill보다 뒤면 이미 죽인 뒤다")
      .toBeLessThan(본문.indexOf("process.kill"));
  });

  it("이 대조가 헛돌지 않는다 — 카탈로그가 비지 않았다", () => {
    expect(EGRESS_POINTS.length, "카탈로그가 너무 작다").toBeGreaterThanOrEqual(6);
    expect(EGRESS_POINTS.every((p) => p.host && p.대체), "통로마다 호스트·대체가 있어야 한다").toBe(true);
  });
});

describe("에어갭 소켓 관문 — SMTP·SIEM(fetch가 아닌 통로)", () => {
  it("assertEgressAllowed: 봉인+외부는 던지고, 내부·꺼짐은 통과", () => {
    expect(() => assertEgressAllowed("smtp.gmail.com", "SMTP"), "봉인 꺼짐이면 무엇이든 통과").not.toThrow();
    vi.stubEnv("GIJO_AIRGAP", "1");
    try {
      expect(() => assertEgressAllowed("smtp.gmail.com", "SMTP 메일 발송"), "외부 메일 서버").toThrow(/에어갭/);
      expect(() => assertEgressAllowed("10.0.0.5", "SIEM 전달"), "사설 IP").not.toThrow();
      expect(() => assertEgressAllowed("127.0.0.1", "SMTP"), "루프백").not.toThrow();
    } finally { vi.unstubAllEnvs(); }
  });

  it("email.ts·siem.ts가 실제로 소켓 관문을 부른다(카탈로그가 봉인을 약속하고 코드가 안 지키는 것 방지)", () => {
    const dir = path.join(__dirname, "../src/engine");
    for (const f of ["email.ts", "siem.ts"]) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src.includes("assertEgressAllowed("), `${f}가 소켓 관문을 안 부른다 — 카탈로그는 봉인을 약속하는데 코드가 안 지킨다`).toBe(true);
    }
    // 카탈로그에 SMTP·SIEM이 실려 있어야 상태 도구가 "전부"를 정직하게 말한다.
    const ids = EGRESS_POINTS.map((p) => p.id);
    expect(ids).toContain("smtp");
    expect(ids).toContain("siem");
  });
});

describe("에어갭 관문 — globalThis.fetch를 봉인한다", () => {
  it("봉인 ON이면 외부 fetch는 던지고 내부는 원래 fetch로 통과", async () => {
    const realFetch = globalThis.fetch;
    try {
      const stub = vi.fn(async () => new Response("ok"));
      globalThis.fetch = stub as unknown as typeof fetch; // 원래 fetch 자리에 스텁(가드가 이걸 감쌈)
      vi.stubEnv("GIJO_AIRGAP", "1");
      installAirgapGuard(); // 첫 설치 — 스텁을 봉인으로 감싼다

      await expect(globalThis.fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow(/에어갭/);
      expect(stub, "외부 요청이 스텁까지 새어 나갔다").not.toHaveBeenCalled();

      await globalThis.fetch("http://127.0.0.1:8081/health"); // 내부는 통과
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = realFetch;
      vi.unstubAllEnvs();
    }
  });
});

describe("에어갭 라우팅·도구", () => {
  it("「에어갭 상태」류는 airgap_status로 간다", () => {
    for (const q of ["에어갭 상태", "인터넷 막혀 있어?", "외부로 나가는 거 있어?", "봉인 상태 어때"]) {
      expect(forcedToolFor(q, {})?.tool, `"${q}"`).toBe("airgap_status");
    }
  });

  // 봉인 증명서 — 감사관 제출물. **거짓 증명을 만들지 않는 것**이 이 시험의 요지다.
  it("증명서는 봉인 OFF를 감추지 않고, 관문 밖 한계를 반드시 밝힌다", async () => {
    const { airgapCertificate } = await import("../src/engine/airgap");
    const 꺼짐 = airgapCertificate([]);
    expect(꺼짐).toMatch(/적용 안 됨\(OFF\)/);          // 모양만 갖춘 종이를 만들지 않는다
    expect(꺼짐).toContain("완전한 차단은 아닙니다");     // 한계 명시(자식 프로세스)
    expect(꺼짐).toContain("기본 거부");                 // 판정 기준
    expect(꺼짐).toMatch(/봉인 대상 통로 \d+종/);
    vi.stubEnv("GIJO_AIRGAP", "1");
    try {
      const 켜짐 = airgapCertificate([{ at: Date.now(), target: "api.openai.com", detail: "막은 요청: https://api.openai.com/v1" }]);
      expect(켜짐).toMatch(/적용됨\(ON\)/);
      expect(켜짐).toContain("api.openai.com");         // 차단 실적이 실려야 증명이다
      expect(켜짐).toContain("완전한 차단은 아닙니다");   // 켜져 있어도 한계는 그대로 밝힌다
    } finally { vi.unstubAllEnvs(); }
  });

  it("증명서 라우팅은 상태 조회보다 먼저 잡는다", async () => {
    const { forcedToolFor } = await import("../src/engine/agentloop");
    for (const q of ["에어갭 봉인 증명서", "에어갭 증명해줘", "봉인 감사 자료 뽑아줘"]) {
      expect(forcedToolFor(q, {})?.tool, `"${q}"`).toBe("airgap_certificate");
    }
    expect(forcedToolFor("에어갭 상태", {})?.tool).toBe("airgap_status"); // 조회는 그대로
  });

  it("읽기 도구이고 봉인 여부·통로·대체를 답한다", async () => {
    const t = findAgentTool("airgap_status");
    expect(t, "airgap_status 도구가 없다").toBeTruthy();
    expect(t!.write).toBe(false);
    const out = String(await t!.run({}));
    expect(out).toMatch(/에어갭 봉인/);
    expect(out).toMatch(/대체/);
    expect(out).toContain("클라우드 LLM");
  });

  it("airgapStatus는 카탈로그와 env를 그대로 싣는다", () => {
    const s = airgapStatus();
    expect(s.points.length).toBe(EGRESS_POINTS.length);
    expect(typeof s.on).toBe("boolean");
  });
});
