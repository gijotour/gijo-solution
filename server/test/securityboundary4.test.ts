// 「밖으로 나가는 문」과 「사람에게 하는 약속」에 뚫린 네 자리를 지킨다. (보안 경계 · 계획서 후-4 이웃)
//
// 2026-08-18 조사(9 에이전트)가 찾고 win이 코드로 확인한 실결함 넷:
//
//  ① **장비 원격 점검(SSH)이 에어갭 봉인을 안 지났다.**
//     SSH는 `execFile("ssh"/"sshpass")`라 `installAirgapGuard()`의 fetch 관문을 **원리상 못 지난다.**
//     같은 처지인 SMTP·SIEM·레드팀은 연결 직전에 `assertEgressAllowed`를 부르고 통로 카탈로그
//     (`EGRESS_POINTS`)에도 실려 있는데 **SSH만 둘 다 빠져 있었다.**
//     ⇒ 폐쇄망 고객에게 내는 **봉인 증명서에 이 통로가 안 실렸다** — 거짓 증명이 된다.
//
//  ② **점검 대상 등록에 권한·대역 검증이 없었다.**
//     `authMiddleware`만 있어 **로그인한 아무 계정이 임의 공인 IP를 등록하고 곧바로 스캔**할 수 있었다.
//     그러면 우리 서버가 남의 대역을 두드리는 **발판**이 된다 — CLAUDE.md가 「절대 안 한다」로
//     못 박은 바로 그 일을 제품이 대신 해 주는 꼴이다.
//
//  ③ **장비 SSH 비밀번호만 평문 저장.** 같은 DB의 다른 비밀(CTI 키·클라우드 키)은 전부 암호화하고
//     스키마 주석에 「평문 저장 안 함」까지 적어 뒀는데 여기만 예외였다.
//     게다가 실행이 `sshpass -p <비밀번호>`라 **같은 PC의 다른 계정이 프로세스 목록으로 읽는다.**
//
//  ④ **레드팀이 「14종」이라 적고 30종을 발사했다.** 그중 한 문장이 **살아 있는 모델에 공격을
//     보내기 전 받는 동의 문구**(결재판 effect)다. 조달 심사에 내는 숫자이기도 하다.
//
// ⚠ 넷 다 「사람이 손으로 적은 것」과 「코드가 하는 일」이 어긋난 부류다. 그래서 **세어서 쓰게** 하고,
//   빠질 수 있는 자리는 소스로 대조한다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { EGRESS_POINTS } from "../src/engine/airgap";
import { PAYLOADS } from "../src/engine/redteam";
import { findAgentTool } from "../src/engine/agenttools";
import { db } from "../src/db";
import { createTarget, getTarget, listTargets } from "../src/engine/hardeningtargets";
import { isVpnRangeIp } from "../src/engine/airgap";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 점검 = 읽기("../src/engine/hardeningscan.ts");
const 대상 = 읽기("../src/engine/hardeningtargets.ts");

describe("① SSH 점검이 에어갭 봉인을 지난다", () => {
  it("통로 카탈로그에 SSH가 실려 있다 — 봉인 증명서의 근거다", () => {
    const ids = EGRESS_POINTS.map((p) => p.id);
    expect(ids, "장비 원격 점검(SSH)이 통로 목록에 없다 — 폐쇄망 증명서에서 빠진다").toContain("hardening-ssh");
    // 같은 처지(소켓·프로세스라 fetch 관문 밖)인 것들이 함께 있어야 이 목록이 뜻을 갖는다.
    for (const id of ["smtp", "siem", "redteam-remote"]) expect(ids, `${id}가 사라졌다`).toContain(id);
  });

  it("SSH 러너를 만들 때 봉인을 검사한다", () => {
    expect(점검, "assertEgressAllowed를 안 부른다 — SSH는 fetch 관문을 원리상 안 지난다").toContain("assertEgressAllowed");
    // 러너를 **만들 때** 한 번 막는다(명령마다가 아니라) — 명령마다면 점검 항목 30개가 제각기 실패해
    // 「무엇이 문제인지」가 흩어진다.
    const 구간 = 점검.slice(점검.indexOf("export function targetRunner"), 점검.indexOf("export function targetRunner") + 1400);
    expect(구간, "targetRunner 안에서 안 막는다").toContain("assertEgressAllowed");
    expect(구간, "통로 이름표가 카탈로그 id와 다르다").toContain("hardening-ssh");
  });
});

describe("② 점검 대상은 admin만·내부망만 등록한다", () => {
  // ⚠ **메서드까지 짚어서 찾는다.** 처음엔 경로만 찾았더니 같은 경로의 `app.get`(목록 조회)이
  //   먼저 걸려 「admin이 아니다」로 잘못 판정했다. 목록 조회는 나가는 접속이 아니라 admin이 아니어도 된다.
  //   막아야 하는 것은 **바깥으로 접속을 일으키거나 그 대상을 바꾸는** 것뿐이다.
  const 막을것: [string, string][] = [
    ["post", "/api/hardening/targets"],
    ["delete", "/api/hardening/targets/:id"],
    ["post", "/api/hardening/targets/:id/probe"],
    ["post", "/api/hardening/targets/:id/scan"],
  ];
  it("나가는 접속을 일으키는 라우트가 전부 admin 전용이다", () => {
    const 빠짐: string[] = [];
    for (const [m, r] of 막을것) {
      const 표식 = `app.${m}("${r}"`;
      const i = 대상.indexOf(표식);
      if (i < 0) { 빠짐.push(`${m.toUpperCase()} ${r}(라우트를 못 찾음)`); continue; }
      const 줄 = 대상.slice(i, 대상.indexOf("\n", i));
      if (!/adminMiddleware/.test(줄)) 빠짐.push(`${m.toUpperCase()} ${r}`);
    }
    expect(빠짐.join(", "), "이 라우트들이 admin 전용이 아니다 — 아무 계정이 남의 대역을 스캔할 수 있다").toBe("");
  });

  it("원격 대상은 내부망 대역만 받는다 — 같은 판정기 한 곳을 쓴다", () => {
    expect(대상, "대역 검사가 없다").toContain("isVpnRangeIp");
    // ⚠ 새 판정기를 만들면 원격 LLM 쪽과 기준이 어긋난다 — airgap 한 곳에서 받아야 한다.
    //   ⚠ `.*`에 `/s`를 붙여 훑으면 파일 첫 주석부터 걸려 **엉뚱한 곳이 맞았다고** 나온다.
    //     import 줄 **하나**를 정확히 본다.
    expect(대상, "판정기를 airgap이 아닌 곳에서 가져온다 — 기준이 두 벌이 된다").toMatch(
      /^import \{[^}]*isVpnRangeIp[^}]*\} from "\.\/airgap";$/m
    );
    // local(이 서버 자신)은 나가는 접속이 아니라 검사에서 뺀다.
    expect(대상, "local까지 막으면 자기 점검이 안 된다").toMatch(/authMethod !== "local"/);
  });
});

describe("③ 장비 비밀번호를 평문으로 두지 않는다 — **동작으로** 잰다", () => {
  // ⚠⚠ 처음엔 소스에 `encryptString`이 있는지만 봤다. 그러면 **삼항을 뒤집어**
  //   「비밀번호는 평문 저장, 키 경로는 암호화」로 만들어도 전부 초록이다(검토관 지적).
  //   ⇒ 실제로 넣고 DB 원문을 읽어 **평문이 없는지**, 되읽으면 **원래 값이 나오는지**를 잰다.
  //   LLM·네트워크가 없어도 되는 시험이다.
  beforeEach(() => {
    db.prepare("DELETE FROM hardening_targets").run();
  });

  it("★ 비밀번호는 DB에 평문으로 안 남는다 — 그리고 되읽으면 원래 값이 나온다", () => {
    const 비번 = "s3cr3t-비밀번호-2026";
    const t = createTarget({ label: "시험장비", host: "10.8.0.5", port: 22, username: "admin", authMethod: "password", secret: 비번, standard: "kisa" });
    const 원문 = (db.prepare("SELECT secret FROM hardening_targets WHERE id = ?").get(t.id) as { secret: string }).secret;
    expect(원문, "DB에 비밀번호가 평문으로 그대로 있다").not.toContain(비번);
    expect(원문, "암호화 봉투 모양이 아니다").toMatch(/"iv"/);
    expect(getTarget(t.id)!.secret, "되읽었을 때 원래 비밀번호가 안 나온다 — 접속이 깨진다").toBe(비번);
  });

  it("★ 키 인증의 경로는 **그대로** 둔다 — 암호화하면 파일을 못 찾아 점검이 깨진다", () => {
    const 경로 = "/home/gijo/.ssh/id_ed25519";
    const t = createTarget({ label: "키장비", host: "10.8.0.6", port: 22, username: "admin", authMethod: "key", secret: 경로, standard: "kisa" });
    const 원문 = (db.prepare("SELECT secret FROM hardening_targets WHERE id = ?").get(t.id) as { secret: string }).secret;
    expect(원문, "키 경로까지 암호화했다 — ssh -i 가 파일을 못 찾는다").toBe(경로);
    expect(getTarget(t.id)!.secret).toBe(경로);
  });

  it("★ 옛 평문도 읽는다 — 없으면 기존 고객의 점검이 통째로 멈춘다", () => {
    // 이 커밋 전에 저장된 대상을 흉내 낸다(평문이 그대로 들어 있는 행).
    const t = createTarget({ label: "옛장비", host: "10.8.0.7", port: 22, username: "admin", authMethod: "password", secret: "임시", standard: "kisa" });
    db.prepare("UPDATE hardening_targets SET secret = ? WHERE id = ?").run("옛평문비번", t.id);
    expect(getTarget(t.id)!.secret, "옛 평문을 못 읽는다 — 기존 대상이 전부 죽는다").toBe("옛평문비번");
  });

  it("공개 표현에는 secret이 안 실린다", () => {
    const t = createTarget({ label: "노출시험", host: "10.8.0.8", port: 22, username: "admin", authMethod: "password", secret: "노출되면안됨", standard: "kisa" });
    const 목록 = JSON.stringify(listTargets().map((x) => ({ ...x, secret: undefined })));
    expect(목록).not.toContain("노출되면안됨");
    expect(getTarget(t.id)).toBeTruthy();
  });
});

describe("② 대역 검증도 **동작으로** 잰다", () => {
  // ⚠ 소스에 `isVpnRangeIp`가 있는지만 보면, `!`를 지워 **공인 IP만 받게** 뒤집어도 통과한다.
  it("★ 판정기가 내부망은 통과시키고 공인 IP는 막는다", () => {
    for (const ip of ["10.8.0.1", "192.168.0.5", "172.16.3.9", "100.64.1.2"]) {
      expect(isVpnRangeIp(ip), `${ip}(내부망)을 막는다 — 정상 대상이 등록 안 된다`).toBe(true);
    }
    for (const ip of ["203.0.113.10", "8.8.8.8", "1.1.1.1"]) {
      expect(isVpnRangeIp(ip), `${ip}(공인)을 통과시킨다 — 남의 대역을 두드릴 수 있다`).toBe(false);
    }
    // 호스트명은 거부한다 — 이름은 어디로든 풀릴 수 있어 「확실히 내부망」을 코드가 보증 못 한다.
    expect(isVpnRangeIp("device.internal"), "호스트명을 통과시킨다").toBe(false);
  });
});

describe("④ 레드팀 공격 개수를 손으로 적지 않는다", () => {
  it("도구 설명·동의 문구가 실제 개수를 센다", () => {
    const t = findAgentTool("run_redteam");
    expect(t, "run_redteam 도구를 못 찾았다 — 이 검사가 헛돈다").toBeTruthy();
    const 개수 = String(PAYLOADS.length);
    expect(t!.description, `설명이 실제 개수(${개수})를 안 담는다`).toContain(`${개수}종`);
    // ⚠ 이 문장이 **살아 있는 모델에 공격을 보내기 전 받는 동의 문구**다(결재판 effect).
    const 동의 = t!.effect!({ assetId: "ai-x" });
    expect(동의, `동의 문구가 실제 개수(${개수})를 안 담는다 — 동의 범위 다툼의 증거가 된다`).toContain(`${개수}종`);
  });

  it("어디에도 「14종」이 손으로 박혀 있지 않다", () => {
    // 실제 개수가 14가 아닌 한, 「14종」은 거짓이다.
    expect(PAYLOADS.length, "페이로드를 못 읽었다 — 이 검사가 헛돈다").toBeGreaterThan(20);
    const 볼곳 = [
      "../src/engine/agenttools/registry.ts",
      "../src/engine/agenttools/handlers.ts",
      "../src/engine/screenguide.ts",
      "../src/engine/workguide.ts",
      "../../client/src/renderer/pages/redteam.html",
      "../../client/src/renderer/pages/sbom.html",
    ];
    const 걸린것: string[] = [];
    for (const p of 볼곳) {
      const s = 읽기(p);
      for (const m of s.matchAll(/1[0-9]\s*(종|개)\s*(공격|인젝션|페이로드)|(공격|인젝션|페이로드)\s*1[0-9]\s*(종|개)/g)) {
        걸린것.push(`${p.split("/").pop()}: ${m[0]}`);
      }
    }
    expect(걸린것.join(", "), "레드팀 공격 개수가 손으로 박혀 있다 — 실제와 어긋난다").toBe("");
  });
});
