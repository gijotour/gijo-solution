// 원격 GPU를 **내주는 쪽** — 경계가 실제로 막는가 (2026-08-14)
//
// ■ 무엇을 지키나
//   이 PC의 GPU를 VPN 안의 다른 GIJO에게 내주는 창구다. 잘못 열리면 **인증 없는 추론 서버**가
//   망에 서는 것이라, 경계 셋을 코드가 지키는지 못박는다:
//     ① 기본 꺼짐  ② VPN·사설 대역에서 온 요청만  ③ 에어갭이면 켜져 있어도 막힘
//   ⚠ X-Forwarded-For를 믿지 않는 것도 여기서 지킨다 — 헤더는 보내는 쪽이 지어낼 수 있어,
//     믿으면 공인 IP가 사설인 척할 수 있다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { db } from "../src/db";
import { llmServeConfig, llmServeOn, requesterAllowed, browserOriginated, proxyDetected, servePort, serveInFlight, 상대가쓸수있나 } from "../src/engine/llmserve";

const put = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const del = db.prepare("DELETE FROM app_state WHERE key = ?");

beforeEach(() => { del.run("llm_serve"); delete process.env.GIJO_AIRGAP; });

/** 소켓 주소만 가진 최소 Request 흉내 — requesterAllowed가 보는 것이 그것뿐임을 함께 못박는다. */
function 요청(remoteAddress: string, headers: Record<string, string> = {}): Request {
  return { socket: { remoteAddress }, headers } as unknown as Request;
}

describe("기본은 꺼짐 — 켠 적 없으면 안 내준다", () => {
  it("설정이 없으면 꺼짐", () => {
    expect(llmServeConfig().enabled).toBe(false);
    expect(llmServeOn()).toBe(false);
  });
  it("켜면 켜짐", () => {
    put.run("llm_serve", JSON.stringify({ enabled: true, lastServedAt: null }));
    expect(llmServeOn()).toBe(true);
  });
  it("★ 저장 뒤 에어갭을 켜면 막힌다 — 저장 시에만 보면 이 틈이 샌다", () => {
    put.run("llm_serve", JSON.stringify({ enabled: true, lastServedAt: null }));
    process.env.GIJO_AIRGAP = "1";
    try { expect(llmServeOn()).toBe(false); } finally { delete process.env.GIJO_AIRGAP; }
  });
  it("깨진 저장값은 조용히 꺼짐으로 — 설정 하나가 서버를 죽이면 안 된다", () => {
    put.run("llm_serve", "{JSON 아님");
    expect(llmServeConfig().enabled).toBe(false);
  });
});

describe("누가 붙을 수 있나 — VPN·사설 대역만", () => {
  it("사설·CGNAT·루프백은 통과", () => {
    for (const h of ["10.8.0.11", "192.168.0.5", "172.20.1.9", "100.64.3.2", "127.0.0.1", "::1", "::ffff:10.8.0.11"]) {
      expect(requesterAllowed(요청(h)), h).toBe(true);
    }
  });
  it("★ 공인 IP는 거절", () => {
    for (const h of ["8.8.8.8", "203.0.113.7", "100.128.0.1", "::ffff:8.8.8.8"]) {
      expect(requesterAllowed(요청(h)), h).toBe(false);
    }
  });
  it("★ X-Forwarded-For로 사설인 척해도 안 통한다 — 헤더는 지어낼 수 있다", () => {
    expect(requesterAllowed(요청("8.8.8.8", { "x-forwarded-for": "10.8.0.11" }))).toBe(false);
    expect(requesterAllowed(요청("203.0.113.7", { "x-real-ip": "192.168.0.2" }))).toBe(false);
  });
  it("주소를 못 읽으면 거절한다(모르면 막는다 — airgap의 default-deny와 같은 자세)", () => {
    expect(requesterAllowed(요청(""))).toBe(false);
  });
});

describe("★ 배선 — 창구가 실제로 열려 있고, 열린 중계기가 아니다 (소스 감시)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/engine/llmserve.ts"), "utf8");
  const appSrc = fs.readFileSync(path.join(__dirname, "../src/app.ts"), "utf8");

  it("app.ts가 라우트를 등록한다 — 안 부르면 설계만 있고 쓰인 적 없는 것이 된다", () => {
    expect(appSrc).toMatch(/registerLlmServeRoutes\(app\)/);
  });
  it("붙는 쪽이 기대하는 두 경로가 있다(/models · /chat/completions)", () => {
    expect(src).toMatch(/\/api\/llm\/serve\/v1\/models/);
    expect(src).toMatch(/\/api\/llm\/serve\/v1\/chat\/completions/);
  });
  it("★ 창구 경로 **전부**가 관문을 지난다 — 라우트 수와 관문 호출 수를 맞춘다", () => {
    // ⚠ 예전엔 관문 호출이 「2개인지」만 봤다(검토관 지적 M10). 그러면 관문 없는 라우트를
    //   새로 더해도 2로 남아 **통과**하고, 관문을 제대로 붙인 라우트를 더하면 3이 되어
    //   **거짓 실패**한다 — 「하나라도 빠지면 구멍」이라 적어 둔 시험이 그 구멍을 못 봤다.
    //   이제 등록된 창구 라우트 수를 세서 관문 호출 수와 **같은지**를 본다.
    // 관문은 **미들웨어 하나**로 두고 모든 창구 라우트에 같은 방식으로 붙인다(형태를 섞으면
    // 이 시험이 형태 차이에 걸려 헛돈다 — 실제로 한 번 그랬다).
    const 라우트 = src.match(/["'`]\/api\/llm\/serve\/v1\//g) ?? [];
    const 관문붙임 = src.match(/^\s*관문미들,\s*$/gm) ?? [];
    expect(라우트.length, "창구 라우트가 하나도 안 잡혔다 — 이 시험의 정규식을 확인하라").toBeGreaterThan(0);
    expect(관문붙임.length, `창구 라우트 ${라우트.length}개 중 관문미들이 붙은 것이 ${관문붙임.length}개다`).toBe(라우트.length);
  });

  it("★ 관문은 **대역 판정을 맨 앞에서** 한다 — 밖에서 훑는 쪽에 제품 정보를 주지 않는다", () => {
    // ⚠ 관문 **정의 뒤**의 첫 라우트까지를 자른다 — 그냥 indexOf("app.get(")를 쓰면 파일 위쪽의
    //   상태 조회 라우트를 잡아 빈 문자열이 된다(이 시험이 처음에 그렇게 헛돌았다).
    const 시작 = src.indexOf("const 관문");
    const 본문 = src.slice(시작, src.indexOf("app.get(", 시작));
    const 대역 = 본문.indexOf("requesterAllowed");
    const 꺼짐 = 본문.indexOf("llmServeConfig().enabled");
    const 에어갭 = 본문.indexOf("isAirgapOn");
    expect(대역, "관문에 대역 판정이 없다").toBeGreaterThan(-1);
    expect(대역, "꺼짐 응답이 대역 판정보다 먼저다 — 밖에서 제품 존재를 알아낸다").toBeLessThan(꺼짐);
    expect(대역, "에어갭 응답이 대역 판정보다 먼저다").toBeLessThan(에어갭);
  });

  it("★ 브라우저에서 온 요청을 거절한다 — CORS가 열린 배포에서 남의 웹페이지가 부를 수 있었다", () => {
    expect(src, "browserOriginated 판정이 없다").toMatch(/browserOriginated/);
    expect(browserOriginated(요청("10.8.0.11", { origin: "https://evil.example.com" }))).toBe(true);
    expect(browserOriginated(요청("10.8.0.11", { referer: "https://evil.example.com/p" }))).toBe(true);
    expect(browserOriginated(요청("10.8.0.11", {})), "서버 대 서버 호출은 통과해야 한다").toBe(false);
  });

  it("★ 포트는 GIJO_SERVER_PORT에서 읽는다 — PORT는 이 저장소에서 아무도 넣지 않는다", () => {
    // 실사고(2026-08-14): PORT로 읽어 카드가 **항상 4000**을 보였다. 라이트 7445·표준 7446인데
    // 상대에게 알려 줄 주소가 틀려, 「붙을 상대가 없다」가 한 겹 위에서 재발할 자리였다.
    // ⚠ 주석에도 이 이름이 나온다(왜 안 쓰는지 적어 뒀다) — **코드만** 본다.
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(코드만, "process.env.PORT를 다시 쓰고 있다").not.toMatch(/process\.env\.PORT/);
    expect(코드만).toMatch(/process\.env\.GIJO_SERVER_PORT/);
    const 전 = process.env.GIJO_SERVER_PORT;
    try {
      process.env.GIJO_SERVER_PORT = "7445";
      expect(servePort()).toBe(7445);
    } finally {
      if (전 === undefined) delete process.env.GIJO_SERVER_PORT; else process.env.GIJO_SERVER_PORT = 전;
    }
  });

  it("★ 상류 스트림을 pipe로 잇지 않는다 — 리스너 없는 error가 서버를 죽인다", () => {
    // pipe는 에러를 전달하지 않고, 이 저장소에는 process.on("uncaughtException")이 없다.
    // 운영 서버가 죽으면 전 사용자 세션이 끊긴다(CLAUDE.md).
    // ⚠ `\.pipe\(res\)`만 보면 `.pipe(res, {end:true})`를 놓친다(재검토 D) — 인자를 넓게 잡는다.
    expect(src, "pipe(res…)가 남아 있다 — pipeline+콜백을 쓸 것").not.toMatch(/\.pipe\(\s*res\b/);
    expect(src).toMatch(/pipeline\(/);
    expect(src, "클라이언트가 끊었을 때 상류를 취소하지 않는다").toMatch(/res\.on\("close"/);
  });

  it("무인증 추론에 감사 기록을 남긴다 — 활동 감사는 actor가 없어 통째로 건너뛴다", () => {
    expect(src).toMatch(/recordAudit\(/);
  });

  it("★ 앞단 프록시가 감지되면 막는다 — 안 막으면 대역 판정이 전원 통과가 된다(fail-open)", () => {
    // nginx 같은 것이 앞에 있으면 소켓 주소가 전부 127.0.0.1이 되어 인터넷도 「사설」로 읽힌다.
    expect(proxyDetected(요청("10.8.0.11", { "x-forwarded-for": "8.8.8.8" }))).toBe(true);
    expect(proxyDetected(요청("10.8.0.11", { "x-real-ip": "8.8.8.8" }))).toBe(true);
    expect(proxyDetected(요청("10.8.0.11", { forwarded: "for=8.8.8.8" }))).toBe(true);
    expect(proxyDetected(요청("10.8.0.11", {})), "프록시 없는 정상 요청은 통과해야 한다").toBe(false);
    expect(src, "관문이 프록시 검사를 안 부른다").toMatch(/proxyDetected\(req\)/);
  });

  it("★ 창구는 **전역 200mb 파서보다 먼저** 등록된다 — 순서가 뒤집히면 상한이 조용히 돌아간다", () => {
    // 무인증 경로에 200mb를 열어 두면 사설망의 아무 장치가 그만큼을 메모리에 밀어넣을 수 있다.
    const 창구 = appSrc.indexOf("registerLlmServeGateway(app)");
    const 전역파서 = appSrc.indexOf('express.json({ limit: "200mb" })');
    expect(창구, "app.ts가 창구를 등록하지 않는다").toBeGreaterThan(-1);
    expect(전역파서).toBeGreaterThan(-1);
    expect(창구, "창구가 전역 파서 뒤에 등록돼 8mb 상한이 무효다").toBeLessThan(전역파서);
    expect(src, "창구가 자기 본문 상한을 안 갖고 있다").toMatch(/express\.json\(\{ limit: "8mb" \}\)/);
  });

  it("★ 동시 처리 상한이 있고, 끝나면 반드시 되돌린다 — 안 되돌리면 창구가 영영 막힌다", () => {
    expect(src).toMatch(/처리중 >= 동시상한/);
    expect(src, "429로 정직하게 거절하지 않는다").toMatch(/status\(429\)/);
    // 놓기()가 정상 종료·에러·끊김 세 길에서 모두 불려야 한다.
    const 놓기호출 = src.match(/놓기\(\)/g) ?? [];
    expect(놓기호출.length, `놓기() 호출이 ${놓기호출.length}곳 — 빠진 길이 있으면 상한이 새다`).toBeGreaterThanOrEqual(4);
    expect(serveInFlight().상한).toBeGreaterThan(0);
  });

  it("★ 취소 통로가 **첫 await보다 먼저** 만들어진다 — 늦으면 그 사이 끊긴 요청을 못 잡는다", () => {
    // 3차 검토 H-4: close 리스너가 둘로 쪼개져 있어, localBaseUrl() await 중에 끊기면
    // 뒤에 등록될 리스너가 그 이벤트를 **영영 못 받았다**(EventEmitter는 재생하지 않는다).
    // 결과: 상류 llama가 안 멈추고, 슬롯만 반납돼 **동시 상한이 우회**됐다.
    const 시작 = src.indexOf("처리중 += 1");
    const 취소생성 = src.indexOf("new AbortController()", 시작);
    const 첫await = src.indexOf("await localBaseUrl()", 시작);
    expect(취소생성, "취소 통로를 안 만든다").toBeGreaterThan(-1);
    expect(첫await).toBeGreaterThan(-1);
    expect(취소생성, "첫 await보다 뒤에서 취소 통로를 만든다 — 그 사이 끊기면 못 잡는다").toBeLessThan(첫await);
    // close 리스너는 **하나**여야 한다(쪼개면 같은 틈이 다시 생긴다).
    const 리스너 = src.match(/res\.on\("close"/g) ?? [];
    expect(리스너.length, `res.on("close")가 ${리스너.length}곳 — 하나로 합칠 것`).toBe(1);
  });

  it("★ 상한 검사와 계수 증가 사이에 await가 없다 — 있으면 폭주에 안 듣는다(TOCTOU)", () => {
    // 실사고 직전(재검토 A-6): 사이에 localBaseUrl()이 있어, 동시에 20건을 밀면 전부
    // 「처리중 0」에서 통과했다. 상한이 막으려던 바로 그 상황이다.
    const 검사 = src.indexOf("처리중 >= 동시상한");
    const 증가 = src.indexOf("처리중 += 1");
    expect(검사).toBeGreaterThan(-1);
    expect(증가, "계수 증가가 검사보다 앞이다").toBeGreaterThan(검사);
    const 사이 = src.slice(검사, 증가);
    expect(사이, "검사와 증가 사이에 await가 있다 — 그 틈으로 전부 통과한다").not.toMatch(/\bawait\b/);
  });

  it("★ 관문이 본문 파서보다 **앞**에 붙는다 — 뒤면 대역 밖 요청도 8MB를 먼저 파싱한다", () => {
    const 라우트 = src.slice(src.indexOf('"/api/llm/serve/v1/chat/completions"'));
    const 관문자리 = 라우트.indexOf("관문미들,");
    const 파서자리 = 라우트.indexOf("본문,");
    expect(관문자리, "이 라우트에 관문미들이 안 붙었다").toBeGreaterThan(-1);
    expect(파서자리).toBeGreaterThan(-1);
    expect(관문자리, "본문 파서가 관문보다 먼저다 — 무인증 파싱이 남는다").toBeLessThan(파서자리);
  });

  it("★ 무인증 거절이 DB에 쓰지 않는다 — 두드리는 쪽이 쓰기 원시기능을 갖는다", () => {
    // 재검토 B-1: 관문 첫 줄부터 recordAudit이면 스캐너가 audit_log를 채워 **실제 보안 사건이
    // 밀려나고**, 동기 쓰기가 이벤트 루프를 멈춘다. 거절은 로그로 접는다.
    const 관문본문 = src.slice(src.indexOf("const 관문"), src.indexOf("const 본문"));
    expect(관문본문, "관문 안에서 recordAudit을 부른다").not.toMatch(/recordAudit\(/);
    expect(관문본문, "거절을 접어서 로그로 남기지 않는다").toMatch(/거절로그\(/);
  });

  it("★ 추론 감사는 **끝난 뒤에** 남는다 — 하기 전에 ok로 적으면 거짓 기록이다", () => {
    // activityaudit.ts가 res.on("finish")를 기다리는 것과 같은 이유(B-2).
    expect(src).toMatch(/마무리기록\(/);
    const 마무리 = src.indexOf("const 마무리기록");
    const 상류 = src.indexOf("await fetch(`${base}/chat/completions`");
    expect(마무리, "마무리기록 정의가 없다").toBeGreaterThan(-1);
    expect(상류, "상류 호출을 못 찾았다").toBeGreaterThan(마무리); // 정의는 앞, 호출은 뒤
    // 상류 호출 **이전**에 성공 기록이 실행되지 않아야 한다.
    const 이전 = src.slice(마무리, 상류);
    expect(이전, "상류를 부르기 전에 마무리기록(true)를 실행한다").not.toMatch(/마무리기록\(true\)/);
  });

  it("★ 상대에게 줄 주소 판정은 루프백을 거른다 — 사설이라고 다 쓸 수 있는 주소가 아니다", () => {
    // 재검토 A-2: isVpnRangeIp는 127.x를 사설로 통과시킨다(에어갭에선 맞다). 그대로 쓰면
    // 화면이 「이 주소를 상대에게 주세요」라며 127.0.0.1을 확언한다 — H2와 같은 실패의 재발.
    for (const h of ["127.0.0.1", "::1", "localhost", "169.254.1.2", "0.0.0.0"]) {
      expect(상대가쓸수있나(h), `${h}는 상대가 쓸 수 없는 주소다`).toBe(false);
    }
    for (const h of ["10.8.0.12", "192.168.0.5", "172.20.1.9", "100.64.3.2"]) {
      expect(상대가쓸수있나(h), `${h}는 상대가 쓸 수 있어야 한다`).toBe(true);
    }
  });
  it("★ 임의 URL로 넘기지 않는다 — 요청 본문의 주소를 프록시 대상으로 쓰면 열린 중계기가 된다", () => {
    // 프록시 대상은 localBaseUrl()이 준 것만이어야 한다.
    expect(src).toMatch(/const base = await localBaseUrl\(\)/);
    expect(src, "요청에서 받은 값을 fetch 대상으로 쓰고 있다").not.toMatch(/fetch\(\s*(?:`\$\{)?req\.(body|query|params)/);
  });
  it("VPN 판정은 airgap.ts 한 곳을 쓴다 — 새 판정기를 만들지 않는다", () => {
    expect(src).toMatch(/import \{[^}]*isVpnRangeIp[^}]*\} from "\.\/airgap"/);
  });
});
