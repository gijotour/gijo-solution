// tools/make-fenced-prompts.mjs — **제품의 자료·지시 분리층을 태운** 공격 프롬프트를 뽑는다.
//
// ■ 왜 필요한가
//   redteam-ko-measure.mjs는 모델을 **맨몸으로** 때린다(방어층 없이). 그래서 방어층을 만들고도
//   「그래서 몇 개가 막히나」를 못 잰다. 이 스크립트가 그 사이를 잇는다 —
//   각 페이로드를 **제품 코드(pasteddata.sanitizePastedData)** 에 통과시켜 결과를 파일로 낸다.
//
//   ⚠ 살균 규칙을 여기에 다시 적지 않는다. 다시 적으면 **제품이 아닌 사본을 재게 된다** —
//     이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」가 측정에서 재발한다.
//     그래서 반드시 **빌드된 서버(dist)** 를 불러 쓴다.
//
// 사용:
//   cd server && npm run build          # dist가 최신이어야 한다
//   node tools/make-fenced-prompts.mjs > /tmp/fenced.json
//   node tools/redteam-ko-measure.mjs --base http://10.8.0.12:8080/v1 --prompts /tmp/fenced.json
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "server", "dist", "engine");

// 시험용 격리 — 이 스크립트는 **아무 데이터도 건드리면 안 된다**(측정 도구가 운영을 바꾸면 안 된다).
process.env.GIJO_DB_PATH ??= ":memory:";
process.env.GIJO_ENCRYPTION_KEY ??= "0".repeat(64);

const { PAYLOADS } = await import(pathToFileURL(path.join(DIST, "redteam.js")).href);
const { sanitizePastedData } = await import(pathToFileURL(path.join(DIST, "pasteddata.js")).href);

const out = {};
let 바뀐수 = 0;
for (const p of PAYLOADS) {
  const r = sanitizePastedData(p.prompt, { source: "measure" });
  out[p.id] = r.text;
  if (r.text !== p.prompt) 바뀐수++;
}
process.stderr.write(`페이로드 ${PAYLOADS.length}개 중 ${바뀐수}개가 살균으로 바뀌었다\n`);
console.log(JSON.stringify(out, null, 2));
