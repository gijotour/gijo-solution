// server/test/nightly4100.test.ts — 야간 회귀 2차 패스(4100)의 안전장치를 소스 감시로 잰다.
// (계획서 §13.5.1 「되돌리기」 2026-09-11 변경 · 사장님 「권고순서대로」 ①)
//
// ■ 왜 소스 감시인가
//   tools/qa-instance/nightly-4100.sh는 실제 계정 비밀(/home/gijo/gijo-qa/secrets/…)과 살아 있는
//   4100 인스턴스에 기대는 쉘 스크립트라, 이 저장소의 vitest(WSL)가 그 경로를 **실행해서** 재는
//   것은 온당치 않다(비번 파일이 없거나 4100이 안 떠 있으면 늘 실패하고, 떠 있으면 진짜 트래픽을
//   쏜다 — 야간 회귀 자체를 수동으로 또 돌리는 셈이 된다). 대신 datasetgrade.test.ts:352-395·
//   nightlygap.test.ts가 쓴 방식대로 **파일 내용을 읽어 약속이 지켜졌는지**를 잰다:
//     ① 비밀번호가 로그·표준출력에 평문으로 안 찍히는가(필터링 파이프 존재)
//     ② 실패 갈래(exit 2)가 실제로 여러 군데 있는가(조용히 다음 단계로 안 넘어가는가)
//     ③ 운영 엔진 포트(8080·8081)를 이 스크립트가 손대지 않는가
//     ④ nightly-ops-sim.ps1이 이 스크립트를 실제로 부르고, 4100의 성패가 4000의 종료코드에
//        안 섞이는가(약속-코드 불일치는 QA가 못 본다 — 검토관만 잡는 부류를 소스 감시로 대신 건다)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 루트 = path.join(__dirname, "..", "..");
const src = (rel: string) => fs.readFileSync(path.join(루트, rel), "utf8");

describe("★ 야간 회귀 2차 패스(4100) — nightly-4100.sh 안전장치", () => {
  const 스크립트 = src("tools/qa-instance/nightly-4100.sh");

  it("비밀번호를 표준출력에 평문으로 안 남긴다 — ops-sim.mjs 출력이 grep -v로 걸러진다", () => {
    expect(스크립트, "필터링 파이프가 없다 — 비밀번호가 로그에 그대로 찍힐 수 있다")
      .toMatch(/node tools\/ops-sim\.mjs[^\n]*\|\s*grep -v "\$QA_PASS"/);
  });

  it("비밀번호를 직접 echo하지 않는다(안내문은 계정·URL만 말한다)", () => {
    // "echo ...$QA_PASS" 꼴(비번 값을 그대로 찍는 줄)이 없어야 한다. grep -v 파이프 안의
    // "$QA_PASS"는 echo가 아니라 grep 인자라 이 정규식에 안 걸린다.
    expect(스크립트).not.toMatch(/echo\s+"[^"\n]*\$QA_PASS/);
    expect(스크립트).not.toMatch(/echo\s+\$QA_PASS\b/);
  });

  it("쓰고 나서 변수를 지운다(unset) — 남겨 두면 스크립트가 죽은 뒤에도 프로세스 환경에 남을 수 있다", () => {
    expect(스크립트).toMatch(/unset[^\n]*\bQA_PASS\b/);
  });

  it("비밀 파일 경로를 코드에 못박지 않는다 — env(QA_SECRETS_FILE)로 바꿔치기할 수 있어야 시험·재사용이 된다", () => {
    expect(스크립트).toMatch(/QA_SECRETS_FILE:-/);
  });

  it("실패 갈래가 조용히 다음 단계로 안 넘어간다 — fail()이 exit 2로 반드시 멈춘다", () => {
    expect(스크립트).toMatch(/fail\(\)\s*\{[^}]*exit 2[^}]*\}/);
    // 여러 사전조건에서 fail을 부르는가(파일 없음·읽기 권한 없음·계정 줄 없음·로그인 전부 실패·주소 오발사).
    const 호출수 = (스크립트.match(/\bfail\s+"/g) || []).length;
    expect(호출수, "fail() 호출이 한둘뿐이면 다른 사전조건은 그냥 통과한다는 뜻이다").toBeGreaterThanOrEqual(4);
  });

  it("운영 엔진 포트(8080·8081)를 이 스크립트가 손대지 않는다 — 건드리는 것은 4100뿐이다", () => {
    expect(스크립트).not.toMatch(/8080/);
    expect(스크립트).not.toMatch(/8081/);
  });

  it("운영(4000) 오발사를 스스로 거부한다 — 4000을 실제 접속 대상(기본값)으로 쓰지 않는다", () => {
    // "4000"이라는 낱말 자체는 이 차단문·설명 주석에 등장한다(그래서 절대 없음을 재지 않는다) —
    // 대신 **접속 기본값**으로 4000을 쓰지 않는지를 잰다: 기본 URL은 4100 하나뿐이어야 한다.
    expect(스크립트, "기본 접속 주소로 4000을 쓴다 — 운영을 향한 하드코딩이다").not.toMatch(/localhost:4000/);
    expect(스크립트, "GIJO_SERVER_URL 기본값이 두 개 이상이다").toMatch(/QA_BASE="\$\{GIJO_SERVER_URL:-http:\/\/localhost:4100\}"/);
    // 4000을 실제로 언급하는 자리는 전부 "거부한다/막는다" 취지의 차단문이어야 한다.
    expect(스크립트, "차단 판별식(case문)이 없다").toMatch(/\*:4000\|\*:4000\/\*\)/);
    expect(스크립트, "차단 안내문이 없다").toContain("운영(4000)을 가리킨다");
  });

  it("기본 대상은 4100이다", () => {
    expect(스크립트).toMatch(/GIJO_SERVER_URL:-http:\/\/localhost:4100/);
  });

  it("계정은 qa-observer다(claude-deploy가 아니다 — 그건 운영 4000 몫)", () => {
    expect(스크립트).toContain('QA_ACCOUNT="qa-observer"');
    expect(스크립트).not.toContain("claude-deploy");
  });
});

describe("★ 야간 회귀 2차 패스가 실제로 배선돼 있다 — nightly-ops-sim.ps1", () => {
  const ps1 = src("tools/nightly-ops-sim.ps1");

  it("4000 패스 뒤에 nightly-4100.sh를 부른다", () => {
    // 머리 주석에도 파일명이 언급되므로(설명용) indexOf 대상은 **실제 호출 문자열**로 좁힌다.
    const 사천패스자리 = ps1.indexOf("node tools/ops-sim.mjs 2>&1");
    const 사천백호출자리 = ps1.indexOf('bash "/mnt/d/Connect AI/tools/qa-instance/nightly-4100.sh"');
    expect(사천패스자리, "4000 패스 호출이 없다").toBeGreaterThan(0);
    expect(사천백호출자리, "4100 패스 실제 호출이 안 배선돼 있다").toBeGreaterThan(0);
    expect(사천백호출자리, "4100 패스가 4000보다 먼저 온다 — 순서 원칙 위반").toBeGreaterThan(사천패스자리);
  });

  it("4100이 죽어 있으면 건너뛴다 — WSL을 무조건 부르지 않는다(health 확인이 먼저)", () => {
    const 건강확인자리 = ps1.indexOf("/api/health");
    const wsl호출자리 = ps1.indexOf("wsl -d Ubuntu-24.04");
    expect(건강확인자리, "4100 health 확인이 없다").toBeGreaterThan(0);
    expect(wsl호출자리, "wsl 호출이 없다").toBeGreaterThan(0);
    expect(건강확인자리, "건강 확인보다 wsl 호출이 먼저다").toBeLessThan(wsl호출자리);
  });

  it("4100의 성패가 4000의 종료코드($코드)에 안 섞인다 — 별도 변수($코드4100)를 쓴다", () => {
    expect(ps1).toContain("$코드4100 = $LASTEXITCODE");
    expect(ps1, "4100 결과를 4000 종료코드에 덮어쓴다 — 4100 실패가 전체 회차를 실패로 만든다").not.toMatch(/\$코드\s*=\s*\$코드4100/);
    // 스크립트 전체를 끝내는 exit는 파일에 **정확히 하나**(마지막 줄) — 4100 블록이 몇 번을 돌든
    // 그 결과가 스크립트 종료코드로 승격되지 않는다는 뜻이다("exit 2"는 사전조건 실패로 다른 문이다).
    // ⚠ \b는 한글에서 신뢰 못 한다(JS 정규식의 \w가 한글을 word로 안 본다) — 줄 끝 고정으로 가른다.
    const 전체종료줄들 = ps1.split("\n").filter((줄) => /^\s*exit\s+\$코드\s*$/.test(줄));
    expect(전체종료줄들.length, "exit $코드가 하나가 아니다 — 어디선가 또 끝낼 수 있다").toBe(1);
    // 그 하나뿐인 exit가 4100 블록(마지막에 등장하는 $코드4100 대입)보다 **뒤**에 있어야
    // "4000 패스가 끝난 뒤 4100을 돌리고, 그래도 전체 종료는 4000 값으로 한다"는 순서가 성립한다.
    expect(ps1.lastIndexOf("exit $코드")).toBeGreaterThan(ps1.lastIndexOf("$코드4100 = $LASTEXITCODE"));
  });

  it("비밀번호를 여기(Windows)에 새로 저장하지 않는다 — WSL 쪽 스크립트가 알아서 읽는다", () => {
    expect(ps1, "4100용 비밀번호를 ps1에 또 넣었다 — win 쪽에 새로 저장하지 않는다는 원칙 위반").not.toMatch(/qa-observer.*=.*["'].+["']/);
  });
});
