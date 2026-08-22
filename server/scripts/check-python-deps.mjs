// scripts/check-python-deps.mjs — requirements.txt에 적힌 것이 **실제로 import 되는가**.
//
// ■ 왜 생겼나 (2026-08-09 실사고 두 건)
//   requirements.txt에 `pypdf`가 적혀 있었는데 운영(WSL)에 **설치돼 있지 않았다.**
//   PDF 추출이 통째로 죽어 있었고, 아무도 몇 달을 몰랐다. 같은 날 `netmiko`(장비 접속)도
//   같은 상태로 발견됐다 — 그건 requirements.txt에 **적혀 있지도 않았다.**
//
//   2026-08-08에 `python`→`python3`(util/pythonbin)은 고쳤지만, **그 파이썬에 라이브러리를
//   넣는 일**은 아무도 안 했다. 절반만 고친 채였다.
//   → 「목록에 적는 것」과 「설치되는 것」 사이에 아무 기계가 없었다. 이 파일이 그 기계다.
//
// ■ 왜 vitest가 아니라 스크립트인가
//   시험은 개발 기계(Windows 호스트)에서 돌고 제품은 WSL에서 돈다 — **다른 환경**이다.
//   실제로 Windows의 python3은 0바이트 스토어 껍데기라, 여기서 통과해도 운영을 보증하지
//   못한다. 그래서 이 검사는 **돌아갈 환경에서 직접** 실행한다(배포 절차·운영 점검).
//   소스 쪽 짝은 server/test/pythondeps.test.ts — 「쓰는데 안 적힌 것」을 잡는다.
//
// 사용: node scripts/check-python-deps.mjs        (server/ 에서)
//       GIJO_PYTHON=/path/to/python 으로 대상 지정 가능
// 종료코드: 0=전부 import 됨, 1=빠진 것 있음, 2=파이썬 자체를 못 찾음
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 서버루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** util/pythonbin.ts의 serverPython()과 **같은 순서**로 고른다. 두 곳이 어긋나면 검사가 거짓말을 한다.
 *  ⚠ 2026-08-22: 실제로 어긋나 있었다 — 여기는 서버 루트 기준인데 제품은 cwd 기준이라,
 *    패키징 설치본(cwd=userData)에서 **점검은 초록인데 제품은 venv를 못 찾는** 상태였다.
 *    제품 쪽을 GIJO_SERVER_ROOT || cwd 기준으로 고쳤고, 여기도 같은 뿌리를 우선 본다. */
function 서버파이썬() {
  const 후보 = [];
  if (process.env.GIJO_PYTHON) 후보.push(process.env.GIJO_PYTHON);
  const venv경로 = (base) =>
    process.platform === "win32"
      ? path.join(base, "venv", "Scripts", "python.exe")
      : path.join(base, "venv", "bin", "python");
  const 뿌리 = process.env.GIJO_SERVER_ROOT || 서버루트;
  후보.push(venv경로(뿌리));
  if (path.resolve(뿌리) !== path.resolve(서버루트)) 후보.push(venv경로(서버루트));
  // ⚠ 이 점검은 **requirements.txt 전체**(modelscan·pypdf·netmiko)를 보므로 pythonbin의
  //   "tools" 갈래와 같은 순서를 쓴다 — 동봉본에는 **문서 추출용만** 들어 있어(netmiko·modelscan이
  //   없다) 여기선 맨 마지막 수단이다. 순서의 근거가 「pypdf만 있어서」가 아니라
  //   **「장비·모델 부품이 없어서」**임을 못 박아 둔다(2026-08-22 정정 — 예전 문장은
  //   동봉본에 OCR이 들어오면서 사실과 어긋났고, 이 자리는 하루에 세 번 뒤집힌 곳이라
  //   틀린 근거를 남겨 두면 다음 사람이 그것을 믿고 또 뒤집는다).
  //   (문서 추출만 동봉본을 앞세우는 "docs" 갈래는 pythonbin.ts 참조.)
  const 동봉본 =
    process.platform === "win32"
      ? path.join(뿌리, "python", "python.exe")
      : path.join(뿌리, "python", "bin", "python3");
  후보.push("python3", "python", 동봉본);
  for (const c of 후보) {
    if (c.includes(path.sep) && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ["--version"], { encoding: "utf-8" });
    // ⚠ status===0 만 본다 — Windows의 WindowsApps\python3.exe는 0바이트 껍데기라
    //   "있는 것처럼" 보이지만 실행되지 않는다(2026-08-09 실측).
    if (r.status === 0) return { bin: c, version: (r.stdout || r.stderr || "").trim() };
  }
  return null;
}

/** requirements.txt → 모듈 이름. 배포명과 import명이 다른 것만 표로 옮긴다.
 *  ⚠ 이 검사는 requirements.txt만 **실패 판정에** 쓴다 — OCR은 requirements-ocr.txt로 옵션이라
 *    없다고 배포를 막지 않는다(WSL·라이트가 OCR 없이도 돌아야 한다). 대신 아래에서
 *    **상태만 알려 준다** — 「초록인데 스캔 문서가 안 읽힌다」로 담당자가 헤매지 않게(2026-08-22).
 *  ⚠ `pymupdf: "fitz"` 매핑을 **일부러 지웠다** — PyMuPDF는 AGPL-3.0이라 우리가 배포하는
 *    설치본에 실을 수 없어 pypdfium2로 갈아치웠다. 매핑을 남겨 두면 누가 되돌려도 조용히 통과한다. */
const IMPORT_NAME = { "opencv-python": "cv2", "pillow": "PIL", "pyyaml": "yaml" };
function 요구모듈() {
  const p = path.join(서버루트, "requirements.txt");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/[=<>!~[\s]/)[0].trim())
    .filter(Boolean)
    .map((pkg) => ({ pkg, mod: IMPORT_NAME[pkg.toLowerCase()] ?? pkg.replace(/-/g, "_") }));
}

const py = 서버파이썬();
if (!py) {
  console.error("✗ 서버용 파이썬을 찾지 못했습니다 — 실행되는 python이 하나도 없습니다.");
  console.error("  운영(WSL)이면: cd server && python3 -m venv venv && venv/bin/pip install -r requirements.txt");
  process.exit(2);
}
console.log(`파이썬: ${py.bin}  (${py.version})`);

const 모듈들 = 요구모듈();
if (모듈들.length === 0) {
  console.error("✗ requirements.txt에서 읽은 항목이 0개입니다 — 검사가 헛돌고 있습니다.");
  process.exit(1); // 0건 통과는 가장 나쁜 실패다. 조용히 넘기지 않는다.
}

const 빠진것 = [];
for (const { pkg, mod } of 모듈들) {
  const r = spawnSync(py.bin, ["-c", `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(mod)}) else 1)`], {
    encoding: "utf-8",
  });
  const ok = r.status === 0;
  console.log(`  ${ok ? "✓" : "✗"} ${pkg}${mod !== pkg.replace(/-/g, "_") ? ` (import ${mod})` : ""}`);
  if (!ok) 빠진것.push(pkg);
}

if (빠진것.length) {
  console.error(`\n✗ 설치되지 않은 것 ${빠진것.length}개: ${빠진것.join(", ")}`);
  console.error(`  받으려면: ${py.bin} -m pip install ${빠진것.join(" ")}`);
  console.error("  ⚠ 이대로 두면 그 기능이 **조용히 죽습니다** — pypdf(PDF 추출)·netmiko(장비 접속)가 그랬습니다.");
  process.exit(1);
}
console.log(`\n✓ requirements.txt ${모듈들.length}개 전부 import 됩니다.`);

// ── OCR 상태는 **막지 않고 알려만 준다**(2026-08-22 검토관 [중]) ──────────────────
//
// ■ 왜 필요한가
//   OCR을 옵션으로 둔 것은 의도다(없어도 서버가 돌아야 한다). 그런데 제품 화면이
//   「사진·스캔 문서도 읽습니다」라고 **약속하게 되면서**, 「점검은 초록인데 그 기능이 없다」는
//   상태가 생겼다 — pypdf가 몇 달 죽어 있던 그 구멍과 같은 모양이다.
//   막지는 않되 **말은 해 준다.** 담당자가 원인을 엉뚱한 데서 찾지 않게.
//
// ⚠ 여기서 재는 파이썬은 **"tools" 갈래**다. 문서 추출은 "docs" 갈래(동봉본 우선)로 다른 것을
//   고를 수 있으니, 이 결과가 곧 「문서 추출이 OCR을 쓴다」는 뜻은 아니다 — 그래서 그 사실도 적는다.
{
  const OCR모듈 = ["rapidocr", "onnxruntime", "pypdfium2"];
  const 없는것 = OCR모듈.filter((m) => spawnSync(py.bin,
    ["-c", `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(m)}) else 1)`],
    { encoding: "utf-8" }).status !== 0);
  if (없는것.length === 0) {
    console.log(`✓ OCR 부품도 이 파이썬에 있습니다(${OCR모듈.join("·")}) — 스캔 문서·이미지를 읽습니다.`);
  } else {
    console.log(`\nℹ OCR 부품이 없습니다: ${없는것.join(", ")} — **배포를 막지는 않습니다.**`);
    console.log("  없으면 사진·스캔 문서만 못 읽습니다(PDF·한글·오피스는 파이썬 없이 읽습니다).");
    console.log(`  넣으려면: ${py.bin} -m pip install -r requirements-ocr.txt`);
    console.log("  ※ Windows 설치본에는 동봉돼 있어 이 안내가 필요 없습니다.");
    console.log("  ※ 이 검사는 장비·모델용 파이썬을 봅니다 — 문서 추출은 다른 파이썬을 고를 수 있습니다.");
  }
}
