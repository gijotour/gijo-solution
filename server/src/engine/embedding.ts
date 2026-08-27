// engine/embedding.ts — 임베딩 호출. **잎 모듈**이다(2026-08-28, 의존 수리 화살 #12).
//
// ★ 왜 갈랐나
//   embed()는 원래 llm.ts에 살았다. 그런데 memory.ts(지식 층)가 embed를 쓰려고 llm.ts를
//   정적으로 물었고, llm.ts는 다시 RAG를 쓰려고 memory를 동적으로 물어 **llm ⇄ memory**
//   순환이 됐다(그래프의 마지막 큰 덩어리의 목줄). embed가 쓰는 것은 http/https·환경변수·
//   llmactivity(잎)뿐이라 아래로 내려가는 데 걸리는 것이 없다.
//   llm.ts는 재수출해 옛 호출부(라우트·시험)는 한 줄도 안 바뀐다.
//
// ⚠ 임베딩 서버 주소·타임아웃은 여기가 정본이다 — llm.ts와 값을 나눠 적지 않는다.
import * as http from "http";
import * as https from "https";
import { emitLlmActivity } from "./llmactivity";

const EMBEDDING_SERVER_URL = process.env.GIJO_EMBEDDING_URL ?? "http://localhost:8081/v1";
const LLM_TIMEOUT_MS = Number(process.env.GIJO_LLM_TIMEOUT_MS ?? 120_000);

// 임베딩 서버로 보내는 POST — 매 요청 새 연결(keepAlive:false)로 한다.
// 왜: 전역 fetch(undici)는 연결을 재사용하는데, 임베딩 llama-server가 (모니터의 hang 복구 등으로)
// 재기동되면 풀에 남은 죽은 소켓을 계속 재사용해 embed가 통째로 실패한다 — 임베딩 서버는 멀쩡한데
// 실행 서버만 못 붙는 현상(2026-07-20 실측: 새 프로세스는 정상, 실행 서버는 지속 실패). node:http로
// keepAlive를 끄면 매 호출 새 연결이라 stale 소켓 재사용이 원천 차단된다(외부 의존성 없이 근본 해결).
function embedPost(url: string, bodyObj: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const body = Buffer.from(JSON.stringify(bodyObj));
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
        agent: new mod.Agent({ keepAlive: false }), // 재사용 안 함 — 죽은 소켓 원천 차단
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, text: data }));
      }
    );
    req.on("error", () => resolve({ ok: false, status: 0, text: "" }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, text: "" }); });
    req.write(body);
    req.end();
  });
}

export async function embed(texts: string[]): Promise<number[][]> {
  const started = Date.now();
  // EMBEDDING_SERVER_URL에는 이미 /v1이 포함돼 있다(기본값 http://localhost:8081/v1).
  // 따라서 여기서는 /embeddings만 붙여야 OpenAI 호환 경로가 된다 — /v1/embeddings를 붙이면
  // /v1/v1/embeddings가 되어 404가 나고, RAG가 조용히 죽는다(2026-07-19 실제 발생).
  const res = await embedPost(`${EMBEDDING_SERVER_URL}/embeddings`, { model: "local", input: texts }, LLM_TIMEOUT_MS);

  if (!res.ok) {
    // 연결 실패(status 0)와 HTTP 거절(4xx/5xx)은 원인이 정반대다 — 전자는 서버가 없는 것,
    // 후자는 서버는 멀쩡한데 **요청이 잘못된 것**(입력이 문자열이 아님·ubatch 초과 등).
    // 실측(2026-08-06): 잘못된 인자로 온 500을 "연결할 수 없습니다"로 안내해 1시간을
    // 연결 문제로 헤맸다. 상태코드와 응답 본문을 그대로 보인다 — 오류문은 진단서다.
    // FAIL_MARKS-예외: 이 문구는 throw로 나가는 **진짜 실패**다 — 점검 도구가 실패로 세는 것이 옳다.
    //   (emptyanswer-guidance의 파일 전체 대조가 이 표시를 보고 이 줄을 건너뛴다. 정직한
    //    「없다」 답변과 실제 오류를 가르는 표시이니, 답변 문자열에는 절대 붙이지 말 것.)
    const 원인 = res.status === 0
      ? "임베딩 서버에 연결할 수 없습니다. 별도 llama-server를 --embedding 플래그로 " + EMBEDDING_SERVER_URL + " 에 기동하세요."
      : `임베딩 서버가 요청을 거절했습니다(HTTP ${res.status}) — 입력 형식(문자열 배열)·길이를 확인하세요. 응답: ${res.text.slice(0, 200)}`;
    emitLlmActivity({ kind: "embed", phase: "error", model: "임베딩", detail: res.status === 0 ? "임베딩 서버 연결 실패" : `임베딩 HTTP ${res.status}` });
    throw new Error(원인);
  }
  const data = JSON.parse(res.text) as { data?: { embedding: number[] }[] };
  if (!data.data) throw new Error("임베딩 서버 응답 형식이 올바르지 않습니다.");
  // 장기 기억 검색·수집 때 임베딩이 실제로 도는 것도 보이게 한다(추론 파이프라인의 일부).
  emitLlmActivity({
    kind: "embed",
    phase: "done",
    model: "임베딩 서버",
    detail: `${texts.length}개 임베딩`,
    latencyMs: Date.now() - started,
  });
  return data.data.map((d) => d.embedding);
}
