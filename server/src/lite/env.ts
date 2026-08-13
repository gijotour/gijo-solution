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
// ■ 무엇을 알리나 (출하 결정서 2026-08-13: ⓑ llama-server 넣는다 · ⓒ-1 모델 전부 동봉)
//   패키징본의 Resources/server-dist/ 안에 실행부와 모델이 함께 실린다:
//     server-dist/dist/lite/env.js    ← 이 파일 (__dirname = server-dist/dist/lite)
//     server-dist/llama-metal/llama-server
//     server-dist/models/{gijo-main-orchestrator, bge-m3}
//   localengine의 기본 경로는 **cwd 상대**(`models`)인데 패키징본의 cwd는 userData다
//   (main.ts가 DB를 번들 밖으로 보내는 그 설계). 그래서 절대경로로 알려 준다.
//   환경변수가 이미 있으면 건드리지 않는다 — 개발·측정에서 덮어쓸 수 있어야 한다.
//
// ⚠ **이 자리는 읽기 전용이다.** 앱 번들 안에 한 글자라도 쓰면 코드 서명 봉인이 깨진다 —
//   2026-08-09에 XProtect가 그런 앱을 「악성」으로 휴지통에 넣었다(client/src/main.ts:133 실사고).
//   모델을 **받거나 지우는** 기능을 라이트에 들이려면 그때는 userData로 복사부터 해야 한다.
//   (지금 라이트 화면·도구 13개에는 models/에 쓰는 경로가 없다 — 2026-08-13 전수 확인.)

import path from "path";
import fs from "fs";

const 뿌리 = path.resolve(__dirname, "..", "..");

const 실행부 = path.join(뿌리, "llama-metal", "llama-server");
if (!process.env.GIJO_LLAMA_SERVER_PATH && fs.existsSync(실행부)) {
  process.env.GIJO_LLAMA_SERVER_PATH = 실행부;
  console.log(`[lite] 동봉 llama-server 사용: ${실행부}`);
}

const 모델자리 = path.join(뿌리, "models");
if (!process.env.GIJO_MODELS_DIR && fs.existsSync(모델자리)) {
  process.env.GIJO_MODELS_DIR = 모델자리;
  console.log(`[lite] 동봉 모델 자리 사용: ${모델자리}`);
}

// 라이트의 기본 채팅 모델은 동봉되는 그 모델이다. 제품 기본(qwen3-14b, 9GB급)은
// 라이트 대상 사양(10GB, 결정서 ⓐ-1)에 화면 몫(~0.7GiB)까지 재면 안 들어간다.
if (!process.env.GIJO_DEFAULT_MODEL_ID) {
  process.env.GIJO_DEFAULT_MODEL_ID = "gijo-main-orchestrator";
}

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
