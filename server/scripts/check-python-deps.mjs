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

/** util/pythonbin.ts의 serverPython()과 **같은 순서**로 고른다. 두 곳이 어긋나면 검사가 거짓말을 한다. */
function 서버파이썬() {
  const 후보 = [];
  if (process.env.GIJO_PYTHON) 후보.push(process.env.GIJO_PYTHON);
  후보.push(
    process.platform === "win32"
      ? path.join(서버루트, "venv", "Scripts", "python.exe")
      : path.join(서버루트, "venv", "bin", "python"),
    "python3",
    "python",
  );
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
 *  ⚠ 이 검사는 requirements.txt만 읽는다(OCR은 requirements-ocr.txt로 옵션이라 여기서 강제 안 함).
 *   pymupdf→fitz 매핑은 pythondeps.test와 표를 맞추려 함께 둔다(pymupdf가 requirements.txt에 들어올 때 대비). */
const IMPORT_NAME = { "opencv-python": "cv2", "pillow": "PIL", "pyyaml": "yaml", "pymupdf": "fitz" };
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
