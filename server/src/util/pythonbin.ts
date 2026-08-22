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

const 캐시맵 = new Map<string, string>();

/**
 * 서버 도구를 돌릴 파이썬을 고른다.
 *
 * ■ 용도를 나누는 이유 (2026-08-22 검토관 [중] 수리)
 *   이 함수는 문서 추출만 쓰는 게 아니다 — **장비 접속(netmiko)·모델 검사(modelscan)·GGUF
 *   변환이 함께 쓰는 단 한 곳**이다. 그런데 설치본에 동봉한 파이썬에는 **문서 추출에 쓰는 것만**
 *   들어 있다(pypdf·rapidocr·onnxruntime·pypdfium2 — 2026-08-22 기준. 예전엔 pypdf뿐이었다).
 *   그걸 모든 용도의 앞자리에 두면, 시스템 파이썬에 requirements를 깐 기계에서
 *   **잘 되던 장비 접속·모델 검사가 죽는다**(No module named 'netmiko').
 *   그래서 문서 추출만 동봉본을 앞세우고, 나머지는 예전 순서를 그대로 지킨다.
 *
 *   · docs  — 문서 추출: ①GIJO_PYTHON ②venv ③**동봉본** ④python3 ⑤python
 *   · tools — 장비·모델·변환: ①GIJO_PYTHON ②venv ③python3 ④python ⑤동봉본(마지막 수단)
 *
 * 실제로 실행되는 것만 고른다 — 존재하지 않는 이름을 돌려주면 조용한 실패로 이어진다.
 */
export function serverPython(용도: "docs" | "tools" = "tools"): string {
  const 캐시키 = 용도;
  const 있는것 = 캐시맵.get(캐시키);
  if (있는것) return 있는것;
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
  //   스캔 문서·이미지를 읽을 수 있게 앱과 함께 나간다(임베더블 + pypdf + 한국어 OCR 한 벌).
  //   ⚠ 크기는 **꾸릴 때마다 달라진다** — 여기 숫자를 적어 두면 낡는다. 실제로 무엇이
  //     얼마나 실렸는지는 설치본의 `python/GIJO-PYTHON-VERSION.json`이 판까지 기록한다.
  //   ⚠ main.ts에서 GIJO_PYTHON을 대입하지 **않는다** — 그러면 운영자 지정(README 환경변수 표·
  //     배포 가이드가 안내하는 탈출구)을 덮어쓴다(설계관 2026-08-22 적발). 뿌리만 알려 주고
  //     고르는 일은 이 함수 한 곳에서 한다.
  const 동봉본 = process.platform === "win32"
    ? path.join(뿌리, "python", "python.exe")
    : path.join(뿌리, "python", "bin", "python3");
  // ★ 문서 추출("docs")은 동봉본을 **앞세우고**, 장비·모델("tools")은 시스템을 먼저 본다.
  //
  //   이 자리는 하루에 세 번 뒤집혔고 그때마다 **근거가 실제로 바뀌었다**(2026-08-22):
  //     ① 처음: docs만 앞세움 — 동봉본에 pypdf가 확실히 있어서.
  //     ② PDF가 JS로 넘어가자 그 근거가 사라져 **모든 용도에서 뒤로** 뺐다(동봉본엔 OCR이 없었다).
  //     ③ 오늘 OCR을 동봉하면서 **다시 앞으로** — 이제 동봉본이 한국어 OCR을 가진 **유일한**
  //        파이썬이다. 뒤에 두면 시스템 파이썬이 먼저 잡혀 스캔 문서가 안 읽힌다.
  //   ⚠ 그래도 "tools"는 앞세우지 않는다 — 동봉본엔 netmiko·modelscan이 없어서, 앞세우면
  //     시스템에 그것을 깔아 둔 기계에서 **잘 되던 장비 접속·모델 검사가 죽는다**(검토관이 잡았던 회귀).
  //   ⚠ GIJO_PYTHON·venv는 여전히 맨 앞이다 — 운영자가 모든 부품을 갖춘 환경을 지정했으면 그게 낫다.
  if (용도 === "docs") 후보.push(동봉본, "python3", "python");
  else 후보.push("python3", "python", 동봉본);
  for (const c of 후보) {
    if (c.includes(path.sep) && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ["--version"], { encoding: "utf-8" });
    if (r.status === 0) {
      캐시맵.set(캐시키, c);
      return c;
    }
  }
  캐시맵.set(캐시키, "python3"); // 마지막 폴백 — 실패하면 호출부가 오류를 그대로 보고한다
  return "python3";
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
  캐시맵.clear();
}
