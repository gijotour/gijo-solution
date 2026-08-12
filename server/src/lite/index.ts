// server/src/lite/index.ts — **라이트 에디션 진입점.**
//
// ■ 왜 진입점을 따로 두나 (작업경계 §0 원칙 3: max는 새 파일만 만든다)
//   부팅 경로(`src/index.ts`)에 훅이 없다 — 명시적 import 목록이다. 거기에 한 줄을 넣으면
//   그건 **공용 파일 수정**이고, 2026-08-12 하루에 그런 수정으로 세 번 부딪혔다.
//   대신 라이트가 **자기 진입점**을 갖는다: 도구 목록을 먼저 걸고 본 서버를 그대로 부팅한다.
//   → 공용 파일 0줄 수정. 부팅 논리도 0줄 중복(본 서버를 그대로 부른다).
//
// ■ 순서가 전부다
//   `setToolAllowlist`를 **본 서버가 뜨기 전에** 걸어야 한다. CommonJS라 위에서 아래로 돌고,
//   `require("../index")`는 런타임 호출이라 그 시점에 실행된다. import 문 뒤에 두면 늦는다.
//
// ■ 쓰는 법
//   node dist/lite/index.js                      (기본 4000)
//   GIJO_SERVER_PORT=4100 node dist/lite/index.js  (본 서버와 같이 띄워 비교할 때)
//
// ⚠ 이 파일은 **티어를 바꾸지 않는다.** 메모리 등급(10GB·ctx 8192)은 설치할 때 정해지는 것이고
//   여기서 바꾸면 「라이트를 켰더니 문맥이 줄었다」가 조용히 일어난다. 등급은 설정 화면의 몫이다.

// ⚠ 이 import가 **반드시 첫 줄**이어야 한다 — 동봉물 경로(env)를 registry의 import 사슬이
//   localengine에 닿기 전에 알려야 한다. 순서를 바꾸면 오류 없이 조용히 무시된다(env.ts 머리말).
import "./env";
import { setToolAllowlist, findAgentTool } from "../engine/agenttools/registry";
import liteTools from "./lite-tools.json";

const 켤것: string[] = liteTools.tools.map((t) => t.id);

// 목록에 오타가 있으면 여기서 죽는 게 낫다 — setToolAllowlist도 모르는 이름이면 던진다(win 337d469).
// ⚠ 조용히 빠지면 「그 기능이 원래 없나 보다」로 읽힌다. 2026-08-12 라우팅 결함이 그렇게 오래 남았다.
const 없는것 = 켤것.filter((n) => !findAgentTool(n));
if (없는것.length) {
  console.error(`[lite] ★ lite-tools.json에 없는 도구 이름이 있다: ${없는것.join(", ")}`);
  process.exit(2);
}

setToolAllowlist(켤것);
console.log(`[lite] 라이트 에디션으로 부팅합니다 — 도구 ${켤것.length}개만 켭니다.`);
console.log(`[lite] ${켤것.join(" · ")}`);

// ⚠ 본 서버 부팅. import 문으로 올리면 위 코드보다 **먼저** 돌아 허용목록이 늦게 걸린다.
//   require는 런타임 호출이라 여기서 실행된다 — 이 줄의 위치가 이 파일의 전부다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("../index");
