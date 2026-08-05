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
  it("코드의 외부 https 호출 호스트가 모두 EGRESS_POINTS에 있다", () => {
    const dir = path.join(__dirname, "../src/engine");
    // fetch로 외부에 나가는 파일들 — 새 파일이 생기면 여기에 더한다(그 자체가 검토 지점).
    const files = ["cloudllm.ts", "cti.ts", "kev.ts", "lawinfo.ts", "hfmodels.ts", "modelauth.ts", "reposcan.ts"];
    const catalog = EGRESS_POINTS.map((p) => p.host).join(" ");
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8")
        .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n"); // 주석 줄 제외(문서 URL 오탐 방지)
      for (const u of src.match(/https:\/\/[a-zA-Z0-9.-]+/g) ?? []) {
        const host = u.replace("https://", "").toLowerCase();
        if (host.endsWith(".local")) continue;            // 내부망 예시(gitlab.mycorp.local)
        if (isPrivateIp(host)) continue;                  // 사설 IP는 봉인 대상 아님
        if (!catalog.toLowerCase().includes(host)) missing.push(`${f}: ${host}`);
      }
    }
    expect(missing, `카탈로그에 없는 외부 호스트(봉인 사각지대):\n  ${missing.join("\n  ")}`).toEqual([]);
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
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools.ts"), "utf8");
    const i = src.indexOf("에어갭 봉인: 🔒 ON");
    expect(i, "봉인 ON 문구를 못 찾음 — 이 시험이 헛돌고 있다").toBeGreaterThan(0);
    const 문구 = src.slice(i, i + 600);
    expect(문구).toContain("제품이 직접 여는");   // 범위 명시
    expect(문구).toContain("완전한 차단은 아닙니다"); // 한계 명시
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
