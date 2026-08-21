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
  // venv는 **서버 뿌리** 기준으로 찾는다(2026-08-22 수리).
  //   ⚠ 예전엔 process.cwd()만 봤는데, 패키징 설치본은 cwd가 사용자 데이터 폴더(userData)라
  //     고객이 서버 폴더에 venv를 만들어도 **엉뚱한 자리를 봤다** — 「파이썬을 깔면 됩니다」라는
  //     안내조차 실제로는 안 통했다. 더구나 짝인 scripts/check-python-deps.mjs는 처음부터
  //     서버 루트 기준이라, 주석이 경고한 「두 곳이 어긋나면 검사가 거짓말을 한다」가
  //     패키징본에서 실현돼 있었다(점검은 초록인데 제품은 못 찾는 상태).
  //   개발·WSL 운영에서는 뿌리와 cwd가 같아 동작이 그대로다. 둘 다 후보에 두어 안전하게 넓힌다.
  const 뿌리 = process.env.GIJO_SERVER_ROOT || process.cwd();
  const venv경로 = (base: string) => process.platform === "win32"
    ? path.join(base, "venv", "Scripts", "python.exe")
    : path.join(base, "venv", "bin", "python");
  후보.push(venv경로(뿌리));
  if (path.resolve(뿌리) !== path.resolve(process.cwd())) 후보.push(venv경로(process.cwd()));
  // 설치본에 **동봉된** 파이썬(2026-08-22, 사장님 「b」 결정) — 고객 기계에 파이썬이 없어도
  //   PDF·한글·오피스 문서를 읽을 수 있게 앱과 함께 나간다(임베더블 21.5MB + pypdf 3.5MB).
  //   ⚠ 자리가 **venv 뒤·python3 앞**인 데는 이유가 있다:
  //     · venv보다 뒤 — 동봉본에는 pypdf만 있다. 운영자가 만든 venv에는 netmiko·modelscan·OCR까지
  //       들어 있을 수 있으니, 있으면 그쪽이 더 많은 일을 한다. 앞에 두면 그 환경을 가린다.
  //     · python3보다 앞 — 시스템 파이썬은 **있어도 pypdf가 없을 수 있다**(그러면 PDF가 조용히
  //       실패한다). 동봉본은 pypdf가 확실히 있다.
  //   ⚠ main.ts에서 GIJO_PYTHON을 대입하지 **않는다** — 그러면 운영자 지정(README 환경변수 표·
  //     배포 가이드가 안내하는 탈출구)을 덮어쓴다(설계관 2026-08-22 적발). 뿌리만 알려 주고
  //     고르는 일은 이 함수 한 곳에서 한다.
  후보.push(
    process.platform === "win32"
      ? path.join(뿌리, "python", "python.exe")
      : path.join(뿌리, "python", "bin", "python3"),
  );
  후보.push("python3", "python");
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

/**
 * 파이썬 스크립트의 **실제 자리**를 고르는 단 한 곳(2026-08-22 신설).
 *
 * ■ 왜 생겼나 — 설치본에서 PDF·한글 업로드가 통째로 죽어 있었다
 *   패키징된 앱은 서버를 `cwd = userData`(사용자 데이터 폴더)로 띄운다 — DB를 앱 번들 안에
 *   쓰면 업데이트 때 지워지고 서명 봉인이 깨지기 때문이다. 그런데 스크립트는 앱 안
 *   `resources/server-dist/`에 있다. 그래서 상대경로 `"scripts/extract_doc.py"`는
 *   **없는 자리**를 가리켰다. 라이트는 항상 이 단독 모드라 100% 걸리고, 표준·프로도
 *   단독 모드(데모·오프라인 시연)면 똑같이 걸린다.
 *
 * ⚠ **호출할 때마다 읽는다** — 모듈 로드 시점 상수로 굳히면 import 이후의 환경변수 변경이
 *   조용히 무시된다(docsbundle.ts:21-24가 같은 이유로 못박아 둔 규칙이다).
 * ⚠ 스크립트 **이름 문자열은 호출부에 그대로 남겨 둔다** — pythondeps 시험이 `serverPython()`이
 *   든 파일에서 `".py"` 리터럴을 긁어 「쓰는데 requirements에 안 적힌 모듈」을 잡는다.
 *   이름을 이 파일로 모으면 그 감시가 **아무도 모르게** 죽는다.
 *
 * @param 상대 서버 뿌리 기준 상대 경로. 예: "scripts/extract_doc.py", "modelscan_wrapper.py"
 */
export function serverScript(상대: string): string {
  // GIJO_SERVER_ROOT는 패키징 앱(main.ts)이 넣어 준다. 개발·WSL 운영에는 없고, 그때는
  // cwd가 곧 서버 뿌리라 예전과 똑같이 동작한다(기존 경로를 안 깨는 것이 이 폴백의 목적).
  const 뿌리 = process.env.GIJO_SERVER_ROOT || process.cwd();
  return path.join(뿌리, 상대);
}

/** 시험 전용 — 환경을 바꿔 가며 확인할 때 캐시를 비운다. */
export function resetPythonBinCache(): void {
  캐시 = null;
}
