// 401 경합 검증용 시험 서버 — 세션 갱신(refresh token 회전) 경합을 재현하기 위한 짧은 만료 서버.
// 실제 서버 코드(createApp)를 그대로 쓰되, 운영과 완전히 분리한다:
// · DB는 :memory: (운영 DB 무접촉 — 개발 기본계정 jyh/changeme가 시드됨)
// · access token 만료 15초 (경합 상황을 수 초 안에 만들 수 있게)
// · LLM 경로는 없는 경로로 막음 (엔진 스폰 금지 — 운영 WSL과 포트/VRAM 충돌 방지)
// · 포트 4100 (운영 4000과 무충돌)
//
// ⚠ 실행마다 재시작할 것 — :memory: 세션이 남아 있으면 다음 로그인이 중복로그인 방지(409)에
//   걸려 확인창이 떠서 자동화가 멈춘다.
//
// 사용: node tools/auth-race-check/auth-test-server.mjs   (server/ 가 빌드돼 있어야 함)
process.env.GIJO_DB_PATH = ":memory:";
process.env.GIJO_ACCESS_TOKEN_TTL = "15s";
process.env.GIJO_LLAMA_SERVER_PATH = "C:/nonexistent/llama-server.exe";

import http from "http";
const { createApp } = await import(new URL("../../server/dist/app.js", import.meta.url));

const app = createApp();
const srv = http.createServer((req, res) => {
  // 인증 경로만 기록 — 경합의 서버측 증거(refresh 200/401 쌍)가 여기 남는다
  if (req.url && req.url.startsWith("/api/auth/")) {
    const t = Date.now();
    res.on("finish", () => {
      console.log(`[srv] ${new Date(t).toISOString().slice(11, 23)} ${req.method} ${req.url} -> ${res.statusCode} (+${Date.now() - t}ms)`);
    });
  }
  app(req, res);
});
srv.listen(4100, () => console.log("[srv] auth-test-server on :4100 (TTL 15s, db=:memory:)"));
