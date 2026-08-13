// server/src/lite/env.ts — 라이트 동봉물의 자리를 **모든 엔진 모듈보다 먼저** 알린다.
//
// ■ 왜 별도 파일인가 — import 끌어올림(hoisting)
//   index.ts 본문에 이 코드를 두면 늦는다: `import { setToolAllowlist } … from registry`가
//   본문보다 **먼저** 실행되고, registry의 import 사슬이 localengine.ts에 닿는 순간
//   그 모듈의 상수가 굳는다(localengine.ts:24-25가 env를 **모듈 상수로** 읽는다):
//     const LLAMA_SERVER_PATH = process.env.GIJO_LLAMA_SERVER_PATH ?? …
//     const MODELS_DIR       = process.env.GIJO_MODELS_DIR ?? "models"
//   그 뒤에 env를 바꿔 봐야 아무 데도 안 닿는다 — 오류도 안 난다.
//   → env 설정을 이 파일로 빼고, index.ts가 **첫 import**로 이 파일을 부른다.
//   (tsc가 내는 CommonJS도 import 순서대로 require를 실행한다 — 순서가 지켜진다.)
//
// ■ 무엇을 알리나 (출하 결정 2026-08-13 개정: ⓑ llama-server 동봉 · **챗 LLM은 고객이 등록**)
//   패키징본의 Resources/server-dist/ 안에 실린다:
//     server-dist/dist/lite/env.js    ← 이 파일 (__dirname = server-dist/dist/lite)
//     server-dist/llama-metal/llama-server   (실행부 · 읽기 전용 · OK)
//     server-dist/models/bge-m3              (임베딩만 동봉 — RAG가 첫날부터 돌아야)
//   ★ **챗 모델은 더 이상 동봉하지 않는다**(사장님 결정 2026-08-13). 고객이 등록한다:
//     · 온라인 → 설정에서 「권장 모델 받기」(HF 다운로드)
//     · 폐쇄망 → gguf 파일을 모델 폴더에 넣으면 자동 인식
//
// ■ ⚠ 모델 폴더는 **쓰기 가능한 자리**여야 한다 — 받기·배치가 거기로 간다.
//   앱 번들 안(server-dist/models)은 읽기 전용·서명 봉인이라 쓰면 깨진다(2026-08-09 XProtect 사고).
//   그런데 다행히 **패키징 서버의 cwd가 userData다**(main.ts:183 `cwd: 구성.dataRoot`).
//   그래서 localengine·hfmodels가 둘 다 쓰는 **cwd 상대 `models/`**가 곧 **userData/models**다
//   (hfmodels.ts:142가 MODELS_DIR이 아니라 `path.join("models",…)`로 쓰는 것과도 여기서 일치한다).
//   → GIJO_MODELS_DIR을 **번들로 덮어쓰지 않는다.** cwd/models(쓰기 가능)를 그대로 쓰게 둔다.
//   → 동봉 임베딩(bge-m3)만 그 쓰기 폴더로 **한 번 복사**한다(첫 실행). 그래야 RAG가 바로 돈다.

import path from "path";
import fs from "fs";

const 뿌리 = path.resolve(__dirname, "..", "..");

const 실행부 = path.join(뿌리, "llama-metal", "llama-server");
if (!process.env.GIJO_LLAMA_SERVER_PATH && fs.existsSync(실행부)) {
  process.env.GIJO_LLAMA_SERVER_PATH = 실행부;
  console.log(`[lite] 동봉 llama-server 사용: ${실행부}`);
}

// 쓰기 가능한 모델 폴더 = cwd/models (패키징: userData/models · 개발: server/models).
// GIJO_MODELS_DIR을 명시적으로 그 절대경로로 박는다 — localengine이 이걸 읽는다.
// (안 박으면 localengine 기본값도 cwd/models라 같지만, 로그·명확성을 위해 박는다.)
const 쓰기모델자리 = process.env.GIJO_MODELS_DIR
  ? path.resolve(process.env.GIJO_MODELS_DIR)
  : path.resolve(process.cwd(), "models");
process.env.GIJO_MODELS_DIR = 쓰기모델자리;
try { fs.mkdirSync(쓰기모델자리, { recursive: true }); } catch { /* 이미 있으면 그만 */ }

// 동봉 임베딩(bge-m3)을 쓰기 폴더로 한 번 복사 — RAG는 첫날부터 돌아야 하므로 등록 대상이 아니다.
// ⚠ 챗 모델은 복사하지 않는다(동봉 자체를 뺐다). 없으면 「모델 없음」 상태로 뜨고 고객이 등록한다.
const 동봉임베딩 = path.join(뿌리, "models", "bge-m3");
const 임베딩목적 = path.join(쓰기모델자리, "bge-m3");
if (fs.existsSync(동봉임베딩) && !fs.existsSync(임베딩목적)) {
  try {
    fs.cpSync(동봉임베딩, 임베딩목적, { recursive: true });
    console.log(`[lite] 동봉 임베딩(bge-m3)을 쓰기 폴더로 복사: ${임베딩목적}`);
  } catch (e) {
    console.error(`[lite] ⚠ 임베딩 복사 실패 — RAG가 안 돌 수 있다: ${(e as Error).message}`);
  }
}
console.log(`[lite] 모델 폴더(쓰기 가능): ${쓰기모델자리} — 챗 모델은 고객이 등록`);

// ★ 챗 기본 모델을 **박지 않는다**(동봉이 없으므로). 부팅 자동 시작은 「마지막 사용 모델」을
//   따르고, 첫 실행엔 챗 모델이 없어 「모델 없음」으로 뜬다 — 설정에서 등록하면 그때부터 뜬다.
//   (임베딩 bge-m3는 GIJO_EMBEDDING_MODEL_ID 기본값 그대로 자동으로 뜬다.)

// ⚠ **첫 실행에 등급이 안 정해진다** — 2026-08-13 출하본 실측.
//   `/api/localengine/tier`가 `tier: null`이고, 그러면 `currentTierSettings()`가
//   등급표가 아니라 모듈 기본값(ctx 32768 · 동시 2개)으로 떨어진다.
//   `recommended`는 계산해서 **보여만 주고 아무도 적용하지 않는다.**
//   실측(이 32GB Mac): ctx 32768로 떠서 채팅 7.22GB + 임베딩 2.87GB = **10.09GB**.
//   대상 기계(10GB)라면 **첫날부터 예산을 넘긴다** — 담당자는 설정 화면에 들어가
//   「Lite」를 손으로 골라야 하는데, 그걸 알 방법이 없다.
//   → 라이트 에디션은 **라이트 등급 값으로 시작한다**(ctx 8192 · 동시 1개).
//   화면에서 고른 등급은 app_state에 남고 환경변수보다 우선하므로(localengine.ts:79),
//   담당자가 더 큰 등급을 고르면 그쪽이 이긴다 — 이건 **바닥값**이지 상한이 아니다.
//   ⚠ 등급표(TIER_SPECS) 자체는 「표준 제품 완성 후 다시 본다」는 결정이 서 있어 안 건드린다.
if (!process.env.GIJO_LOCAL_LLM_CTX_SIZE) process.env.GIJO_LOCAL_LLM_CTX_SIZE = "8192";
if (!process.env.GIJO_MAX_LOADED_MODELS) process.env.GIJO_MAX_LOADED_MODELS = "1";

// ★ 라이트 기본 포트 7445 (사장님 지시 2026-08-13 · 라이트 7445 / 스탠다드·프로 7446).
//
// ⚠ max가 이 한 줄을 **일부러 안 켜 두었다** — 클라(헬스 폴링·렌더러 기본 주소)가 아직 4000을
//   보고 있을 때 서버만 7445로 옮기면 **지금 잘 도는 dmg가 깨진다**(서버는 7445, 클라는 4000).
//   그래서 클라 쪽 단일 출처(main.ts 서버포트())와 **같은 커밋**에서 켠다.
// ⚠ 클라가 띄울 때는 spawn env에 GIJO_SERVER_PORT가 이미 실려 오므로 이 줄은 안 덮는다.
//   여기가 사는 자리는 **라이트 서버를 직접 띄우는 길**이다(개발·라이트 게이트 측정) —
//   그 길이 4000으로 뜨면 「제품이 가는 길이 아닌 것」을 재게 된다(max가 32/33에서 겪은 그 함정).
if (!process.env.GIJO_SERVER_PORT) process.env.GIJO_SERVER_PORT = "7445";
console.log(`[lite] 서버 포트: ${process.env.GIJO_SERVER_PORT}`);
