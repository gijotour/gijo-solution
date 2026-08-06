// 소스 감시 시험용 — agenttools **전체** 소스(3파일 합본)를 돌려준다.
//
// 2026-08-06 소스 정리 3단계에서 agenttools.ts(3,956줄)가 배럴 + agenttools/handlers.ts +
// agenttools/registry.ts로 나뉘었다. 감시 시험이 agenttools.ts 한 파일만 읽으면
// **부재 단정("…이 없어야 한다")이 배럴 22줄만 보고 헛통과**한다 — 지키는 게 아니라 안 보는 것.
// 그래서 읽기를 여기 한 곳으로 모은다. 파일이 또 나뉘면 이 목록만 고치면 된다.
import * as fs from "node:fs";
import * as path from "node:path";

const ENGINE = path.join(__dirname, "..", "..", "src", "engine");
const FILES = ["agenttools.ts", "agenttools/handlers.ts", "agenttools/registry.ts"];

export function agenttoolsSource(): string {
  return FILES.map((f) => fs.readFileSync(path.join(ENGINE, f), "utf8")).join("\n");
}

// 감시가 헛도는지 스스로 잰다 — 합본이 핸들러·레지스트리 실체를 담고 있어야 한다.
export function agenttoolsSourceSane(src: string): boolean {
  return src.includes("const TOOLS: AgentTool[]") && src.includes("function runListAssets");
}
