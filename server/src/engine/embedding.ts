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

const 기본임베딩주소 = "http://localhost:8081/v1";

/**
 * 지금 이 서버가 **어느 임베딩 두뇌를 보고 있나**. 기본값에 이미 `/v1`이 들어 있다 — 끝에 `/embeddings`만 붙인다.
 *
 * ⚠ **부를 때** 읽는다(적재 때 상수로 굳히지 않는다). 2026-09-10 검토관 적발: 잠깐 상수와 함수가
 *   함께 있었고, 제품(embed)은 상수를, 진단은 함수를 읽었다 — 같은 설정을 두 번 읽는 자리는
 *   「진단은 초록인데 제품은 딴 주소를 본다」의 씨앗이다. 이 파일 머리말의 「값을 나눠 적지 않는다」
 *   그대로, 주소를 아는 곳은 이 함수 **하나**다.
 */
function 임베딩주소(): string {
  return process.env.GIJO_EMBEDDING_URL ?? 기본임베딩주소;
}

/**
 * **임베딩을 나눠 쓰는 설치인가** — 주소를 설정으로 갈아 끼웠으면 참이다.
 * 자가 진단이 「안 답할 때 무엇을 하라고 할지」를 가르는 데 쓴다(나눠 쓰는 설치의 모델 폴더는
 * 일부러 비어 있다 — 거기에 대고 「모델 파일을 확인하세요」라고 하면 따라 할수록 나빠진다).
 * ⚠ 설정을 **다시 읽지 않는다** — 위 임베딩주소()가 내놓은 값이 기본값과 다른지만 본다.
 *   진단이 제 손으로 env를 읽으면 주소를 아는 곳이 또 둘이 된다(이 파일이 방금 고친 그 결함).
 */
export function 임베딩나눠쓰기(): boolean {
  return 임베딩주소() !== 기본임베딩주소;
}

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
  // 임베딩주소()에는 이미 /v1이 포함돼 있다(기본값 http://localhost:8081/v1).
  // 따라서 여기서는 /embeddings만 붙여야 OpenAI 호환 경로가 된다 — /v1/embeddings를 붙이면
  // /v1/v1/embeddings가 되어 404가 나고, RAG가 조용히 죽는다(2026-07-19 실제 발생).
  // 짝 잃은 서로게이트(이모지를 반으로 자른 흔적)가 하나라도 있으면 llama.cpp가 요청 전체를 500으로 거절한다
  // (2026-09-03 실사고 — memory.chunkText도 고쳤지만 입구는 입구대로 막는다. 어느 호출자가 와도 여기가 마지막 문).
  const 정리 = texts.map((t) => String(t ?? "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ""));
  const res = await embedPost(`${임베딩주소()}/embeddings`, { model: "local", input: 정리 }, LLM_TIMEOUT_MS);

  if (!res.ok) {
    // 연결 실패(status 0)와 HTTP 거절(4xx/5xx)은 원인이 정반대다 — 전자는 서버가 없는 것,
    // 후자는 서버는 멀쩡한데 **요청이 잘못된 것**(입력이 문자열이 아님·ubatch 초과 등).
    // 실측(2026-08-06): 잘못된 인자로 온 500을 "연결할 수 없습니다"로 안내해 1시간을
    // 연결 문제로 헤맸다. 상태코드와 응답 본문을 그대로 보인다 — 오류문은 진단서다.
    // FAIL_MARKS-예외: 이 문구는 throw로 나가는 **진짜 실패**다 — 점검 도구가 실패로 세는 것이 옳다.
    //   (emptyanswer-guidance의 파일 전체 대조가 이 표시를 보고 이 줄을 건너뛴다. 정직한
    //    「없다」 답변과 실제 오류를 가르는 표시이니, 답변 문자열에는 절대 붙이지 말 것.)
    const 원인 = res.status === 0
      ? "임베딩 서버에 연결할 수 없습니다. 별도 llama-server를 --embedding 플래그로 " + 임베딩주소() + " 에 기동하세요."
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

/**
 * 임베딩 서버가 **실제로 답할 때까지** 기다린다 — 부팅 인입이 헛돌지 않게 (2026-09-05).
 *
 * ■ 왜 필요한가(재시작마다 나던 로그)
 *   `[memory] 임베딩 일시 실패(시도 1/5, N건) — 10초 후 재시도`
 *   재시작 직후 부팅 인입(제품 문서·사례·승인 문답)이 임베딩 llama-server(8081)의 모델 적재보다
 *   먼저 달려들어 HTTP 503(Loading model)을 맞는다. 결과는 재시도로 **정상**이지만, 매 재시작에
 *   사고 흔적이 남아 진짜 사고와 구별이 안 된다 — 로그가 늘 빨가면 아무도 안 본다.
 *
 * ■ 무엇을 바꾸나 / 안 바꾸나
 *   · 바꾸는 것: 부팅 인입을 **준비 신호 뒤에 시작**한다(index.ts 한 곳).
 *   · 안 바꾸는 것: memory.embedWithRetry의 재시도(5회·10초)는 그대로 둔다. 대기가 실패해도
 *     종전 동작 그대로 진행한다 — 이 대기는 **로그를 깨끗하게 하는 장치**이지 새 관문이 아니다.
 *     (임베딩이 영영 안 뜨는 기계에서 부팅 인입을 영구히 막으면 그게 더 나쁜 회귀다.)
 *
 * ⚠ /health·/v1/models로 재지 않는다 — 그 둘은 모델이 아직 안 올라와도 200을 준다.
 *   실제 임베딩을 한 번 돌려 봐야 「반쯤 죽은」 서버를 준비됨으로 오인하지 않는다
 *   (localengine.자동시작_임베딩이 같은 이유로 같은 방식으로 잰다 — 잣대를 나눠 적지 않으려고
 *    주소·판정 방식을 이 파일 한 곳에 둔다).
 * ⚠ 못 기다렸을 때 **조용히 넘어가지 않는다** — 기다렸다는 사실을 로그로 남긴다.
 *
 * @returns 준비되면 true, 기한을 넘기면 false(호출자는 그대로 진행한다)
 */
export async function 임베딩준비대기(timeoutMs = 60_000, 간격Ms = 2_000): Promise<boolean> {
  const 시작 = Date.now();
  const 기한 = 시작 + timeoutMs;
  for (let 시도 = 1; ; 시도 += 1) {
    const res = await embedPost(`${임베딩주소()}/embeddings`, { model: "local", input: ["ready"] }, 5_000);
    if (res.ok) {
      const 걸린초 = Math.round((Date.now() - 시작) / 1000);
      // 첫 번에 떴으면 조용히 간다 — 평상시 부팅 로그를 한 줄도 안 늘린다.
      if (시도 > 1) console.log(`[embedding] 임베딩 서버 준비됨 — ${걸린초}초 기다린 뒤 부팅 인입을 시작합니다(시도 ${시도}회).`);
      return true;
    }
    if (Date.now() + 간격Ms >= 기한) {
      console.warn(
        `[embedding] 임베딩 서버가 ${Math.round(timeoutMs / 1000)}초 안에 준비되지 않았습니다(시도 ${시도}회) — ` +
        `부팅 인입을 그대로 시작합니다. 인입 쪽 재시도가 이어받습니다.`
      );
      return false;
    }
    await new Promise((r) => setTimeout(r, 간격Ms));
  }
}

/**
 * **지금 임베딩 두뇌가 답하나** — 자가 진단이 쓰는 하나의 잣대다.
 *
 * ■ 왜 생겼나(2026-09-10 고객 QA 인스턴스 실측): 고객 인스턴스는 제 모델 폴더가 비어 있고
 *   다른 기계에서 띄운 임베딩 서버를 **주소로 나눠 쓴다**. 문서 검색도 근거 인용도 멀쩡히
 *   도는데 자가 진단은 「임베딩 서버가 떠 있지 않습니다」라며 빨강을 냈다 — 「내 프로세스가
 *   있나」(!!embeddingProcess)만 봤기 때문이다. 그 빨강이 나가는 자리는 자가 진단 답(챗봇)·조치 요청서·
 *   정기 알림 메일이고, AI 엔진 화면의 임베딩 배지도 같은 뿌리로 사라진다 — 어느 쪽이든 **제품 고장**으로 읽힌다.
 *   물어야 할 것은 프로세스의 존재가 아니라 **응답**이다.
 *
 * ⚠ /health·/v1/models로 재지 않는다 — 위 임베딩준비대기와 같은 까닭(모델이 안 올라와도 200).
 *   재는 방식을 그 함수와 **똑같이** 맞춘다: 잣대를 둘로 적지 않는다.
 * ⚠ 상한이 짧다(기본 1.5초). 진단은 자주 불린다 — 오래 잡고 있으면 화면이 멈춘 것처럼 보인다.
 *   여기서 false가 나와도 그것은 「지금 이 순간 안 답한다」일 뿐, 인입 경로의 재시도와는 별개다.
 */
export async function 임베딩응답확인(timeoutMs = 1_500): Promise<boolean> {
  const res = await embedPost(`${임베딩주소()}/embeddings`, { model: "local", input: ["ready"] }, timeoutMs);
  return res.ok;
}
