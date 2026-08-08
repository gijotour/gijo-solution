// util/pythonbin.ts — **서버 도구용 파이썬을 고르는 단 한 곳.**
//
// ■ 왜 생겼나 — 문서를 넣었는데 지식이 쓰레기였다(2026-08-08 실측)
//   운영(WSL)에는 `python`이라는 명령이 **아예 없다**(python3만 있다). 그런데 문서 추출은
//   `execFile("python", …)`으로 부르고 있었다. 그러니 PDF 텍스트 추출은 애초에 한 번도
//   성공한 적이 없고, 경로 인입은 PDF를 UTF-8 글자로 그냥 읽어 **압축 바이트가 지식이 됐다**
//   (저장소 조각의 73%가 사람이 읽을 수 없는 상태였다 — Tenable 매뉴얼 4종 등).
//
//   학습 쪽에서 똑같은 병이 먼저 발견됐다(engine/trainenv.ts). 거기는 "학습 전용 환경"을 고르고,
//   여기는 "서버 자신의 환경"을 고른다 — 필요한 라이브러리가 서로 다른 방에 있다.
//   ⚠ 새로 파이썬을 부르는 코드를 쓸 때 `"python"`이라고 적지 말 것. 그게 이 사고의 씨앗이었다.

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

let 캐시: string | null = null;

/**
 * 서버 도구(문서 추출·모델 스캔 등)를 돌릴 파이썬.
 *   ① GIJO_PYTHON(운영자 지정) → ② 서버 venv → ③ python3 → ④ python
 * 실제로 실행되는 것만 고른다 — 존재하지 않는 이름을 돌려주면 조용한 실패로 이어진다.
 */
export function serverPython(): string {
  if (캐시) return 캐시;
  const 후보: string[] = [];
  if (process.env.GIJO_PYTHON) 후보.push(process.env.GIJO_PYTHON);
  const venv = process.platform === "win32"
    ? path.join(process.cwd(), "venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "venv", "bin", "python");
  후보.push(venv, "python3", "python");
  for (const c of 후보) {
    if (c.includes(path.sep) && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ["--version"], { encoding: "utf-8" });
    if (r.status === 0) {
      캐시 = c;
      return c;
    }
  }
  캐시 = "python3"; // 마지막 폴백 — 실패하면 호출부가 오류를 그대로 보고한다
  return 캐시;
}

/** 시험 전용 — 환경을 바꿔 가며 확인할 때 캐시를 비운다. */
export function resetPythonBinCache(): void {
  캐시 = null;
}
