// tools/stage-python.mjs — Windows 설치본에 동봉할 **파이썬 런타임**을 꾸린다.
//
// ■ 왜 (2026-08-22 사장님 「b」 결정)
//   추출기 스크립트는 이미 설치본에 실었는데(커밋 aacb94ed) **파이썬 자체가 없어서**
//   고객 기계에 파이썬이 안 깔려 있으면 PDF·한글(HWPX)·오피스 업로드가 전부 죽었다.
//   주 고객이 폐쇄망이라 `pip install`을 시킬 수도 없다 — 빌드 머신에서 미리 구워 담는다
//   (node_modules를 `npm ci`로 미리 굽는 것과 똑같은 생각이다).
//
// ■ 실측(2026-08-22, 이 스크립트를 만들기 전에 손으로 재 봤다)
//   임베더블 zip 10.6MB → 해제 21.5MB(35개 파일) + pypdf 3.5MB = **25.0MB / 156개 파일**.
//   그 상태로 실제 한글 PDF에서 9,238자 추출 성공. 빈 PATH에서도 성공(고객 기계 모양).
//
// ■ 선례를 따른다 — tools/stage-llama-cuda.mjs의 골격 그대로:
//   ① 플랫폼 가드 ② 없으면 exit 1(조용히 넘어가지 않는다) ③ **자가 검증** ④ 크기 보고.
//   ⚠ 특히 ③: 개발 기계에는 파이썬이 있어서, 동봉이 잘못돼도 폴백(python3)으로 돌아
//     **거짓 통과**한다. 그래서 PATH를 비우고 동봉본만으로 실제 추출을 돌려 본다.
//     llama-cuda가 「빈 PATH 자가검증이 잡아낸 누락 1호」를 남긴 것과 같은 이유다.
//
// ■ 저장소에 파이썬을 커밋하지 않는다 — client/scripts/fetch-smartmd.mjs와 같은 방침이다
//   (두 벌이 되면 저쪽이 올라가도 이쪽은 낡는다). 판은 env로 고정하고 받은 판을 파일로 남긴다.
//
// ⚠ 외부 꾸러미를 쓰지 않는다(server/test/toolsdeps.test.ts 계약) — 압축 해제는 Windows에
//   기본으로 있는 **PowerShell Expand-Archive**를 쓴다. 선례 둘도 외부 꾸러미 0개다.
//   (tar는 쓰지 않는다 — bsdtar가 `D:\...`를 원격 호스트로 읽어 죽는다. 아래 해제 자리에 자세히.)
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ⚠ Windows 전용이다. mac은 서명 절차(개별 ad-hoc 서명)가 더 붙어 별도 작업으로 남겼다 —
//   dist:lite 선행 단계로 묶여도 mac에서 깨지지 않게 여기서 비켜 준다(stage-llama-cuda와 같은 가드).
if (process.platform !== "win32") {
  console.log("[stage-python] Windows가 아니라 건너뜁니다 — mac 동봉은 아직 별도 과제입니다.");
  process.exit(0);
}

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── 어떤 MSVC 런타임을 동봉해야 하는가 — **손 목록 대신 바이너리에서 읽는다** ────────────────
//
// ■ 왜 (2026-08-22, 게시 전 검토관 [높음] + 설계관 실증)
//   동봉 목록을 손으로 적었더니 **양쪽으로 다 틀렸다**: onnxruntime이 무는 `msvcp140_1.dll`이
//   빠져 깨끗한 고객 PC에서 OCR이 통째로 죽는데, 정작 목록에 있던 `vcomp140.dll`은 이 트리에서
//   **아무도 안 문다**. 목록이 llama-cuda 것을 물려받았는데 llama.cpp가 무는 것과 onnxruntime이
//   무는 것이 달랐던 것이다.
//
// ⚠ **「빈 PATH로 검증했다」로는 이 부류를 원리상 못 잡는다.** 윈도우 DLL 탐색 순서가
//   ①적재됨 ②API set ③**응용프로그램 디렉터리** ④**System32** ⑤현재 디렉터리 ⑥PATH라서,
//   System32는 PATH와 무관하게 늘 검색된다. 실증: PATH를 빈 문자열로 줘도 `import onnxruntime`이
//   성공하고, 적재 경로를 뽑으면 `C:\WINDOWS\SYSTEM32\MSVCP140_1.dll`이 조용히 채워져 있었다.
//   개발 기계에서는 영원히 초록이고 고객 PC에서만 터진다. 그래서 **정적 분석**이 유일한 관문이다.
//
// ■ 어떻게 — PE 헤더의 임포트 표를 직접 읽는다(node 내장만, toolsdeps.test 계약).
//   지연 임포트(DataDirectory[13])도 함께 본다 — 다른 표라서 빼면 안 보인다.
const OS기본DLL = new Set([
  // 윈도우가 늘 갖고 있는 것들 — 동봉 대상이 아니다(API set ms-win-*는 접두어로 거른다).
  "kernel32.dll", "user32.dll", "advapi32.dll", "shell32.dll", "ole32.dll", "oleaut32.dll",
  "ws2_32.dll", "crypt32.dll", "bcrypt.dll", "ntdll.dll", "rpcrt4.dll", "gdi32.dll",
  "comdlg32.dll", "shlwapi.dll", "version.dll", "winmm.dll", "imm32.dll", "psapi.dll",
  "userenv.dll", "secur32.dll", "iphlpapi.dll", "dbghelp.dll", "powrprof.dll", "cabinet.dll",
  "wldap32.dll", "normaliz.dll", "setupapi.dll", "cfgmgr32.dll", "dnsapi.dll", "mswsock.dll",
  "mf.dll", "mfplat.dll", "mfreadwrite.dll", "d3d11.dll", "dxgi.dll", "dwmapi.dll", "uxtheme.dll",
  "opengl32.dll", "glu32.dll", "avifil32.dll", "avicap32.dll", "msvfw32.dll", "comctl32.dll",
]);

/** PE 파일 하나가 무는 DLL 이름들(정적 + 지연). 못 읽으면 빈 집합 — 판단은 부르는 쪽에서. */
function PE임포트(파일) {
  const 이름들 = new Set();
  let b;
  try { b = fs.readFileSync(파일); } catch { return 이름들; }
  try {
    if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return 이름들;   // "MZ"
    const peOff = b.readUInt32LE(0x3c);
    if (peOff + 24 > b.length || b.readUInt32LE(peOff) !== 0x00004550) return 이름들;  // "PE\0\0"
    const 섹션수 = b.readUInt16LE(peOff + 6);
    const opt = peOff + 24;
    const magic = b.readUInt16LE(opt);
    const pe32plus = magic === 0x20b;
    // DataDirectory 시작 = optional header + (PE32는 96, PE32+는 112)
    const dd = opt + (pe32plus ? 112 : 96);
    const 섹션시작 = opt + b.readUInt16LE(peOff + 20);
    const 섹션들 = [];
    for (let i = 0; i < 섹션수; i++) {
      const s = 섹션시작 + i * 40;
      if (s + 40 > b.length) break;
      섹션들.push({ va: b.readUInt32LE(s + 12), size: b.readUInt32LE(s + 16), ptr: b.readUInt32LE(s + 20) });
    }
    const rva에서오프셋 = (rva) => {
      for (const s of 섹션들) if (rva >= s.va && rva < s.va + Math.max(s.size, 1)) return s.ptr + (rva - s.va);
      return -1;
    };
    const 문자열 = (off) => {
      if (off < 0 || off >= b.length) return "";
      let e = off;
      while (e < b.length && b[e] !== 0) e++;
      return b.toString("latin1", off, e);
    };
    // [1] = 임포트 표(20바이트 항목, 이름 RVA는 +12), [13] = 지연 임포트(32바이트 항목, 이름 RVA는 +4)
    for (const [칸, 항목크기, 이름칸] of [[1, 20, 12], [13, 32, 4]]) {
      const rva = b.readUInt32LE(dd + 칸 * 8);
      if (!rva) continue;
      let p = rva에서오프셋(rva);
      if (p < 0) continue;
      for (let i = 0; i < 4096 && p + 항목크기 <= b.length; i++, p += 항목크기) {
        const 조각 = b.subarray(p, p + 항목크기);
        if (조각.every((v) => v === 0)) break;                    // 널 항목이 표의 끝
        const 이름rva = b.readUInt32LE(p + 이름칸);
        if (!이름rva) continue;
        const n = 문자열(rva에서오프셋(이름rva)).toLowerCase();
        if (n.endsWith(".dll")) 이름들.add(n);
      }
    }
  } catch { /* 형식이 낯설면 조용히 비운다 — 아래에서 손 목록이 최소선을 받친다 */ }
  return 이름들;
}

/**
 * 꾸린 트리가 실제로 무는 것 중 **트리에도 없고 OS 기본도 아닌** MSVC 런타임 이름들.
 * 이것이 「동봉해야 할 것」의 정답이다 — 사람이 적은 목록이 아니라.
 */
function 필요한MSVC(뿌리) {
  const 검사대상 = [];
  const 가진것 = new Set();
  (function 훑기(d) {
    let 목록;
    try { 목록 = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of 목록) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { 훑기(p); continue; }
      const 소문자 = e.name.toLowerCase();
      if (/\.(dll|pyd|exe)$/.test(소문자)) {
        검사대상.push(p);
        if (소문자.endsWith(".dll")) 가진것.add(소문자);
      }
    }
  })(뿌리);
  const 모자란것 = new Set();
  for (const f of 검사대상) {
    for (const n of PE임포트(f)) {
      if (가진것.has(n) || OS기본DLL.has(n) || n.startsWith("api-ms-win-") || n.startsWith("ext-ms-")) continue;
      // 우리가 채울 수 있는 것은 System32에 있는 MSVC 런타임뿐이다. 그 밖의 결손은 아래에서 알린다.
      모자란것.add(n);
    }
  }
  const 채울수있는것 = [];
  const 못채우는것 = [];
  for (const n of [...모자란것].sort()) {
    const s = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", n);
    (fs.existsSync(s) && /^(msvcp|vcruntime|vcomp|concrt)\d/.test(n) ? 채울수있는것 : 못채우는것).push(n);
  }
  if (못채우는것.length) {
    // 조용히 넘기지 않는다 — cv2가 무는 Media Foundation처럼 **OS 기능**이라 동봉으로 못 푸는 것도 있다.
    console.log(`[stage-python]   ⚠ 트리에 없고 동봉으로도 못 채우는 참조: ${못채우는것.join(", ")} (OS 기능일 수 있음)`);
  }
  return 채울수있는것;
}
const OUT = path.join(루트, "client", "build", "python-dist");
// 판 고정 — 운영(WSL)이 3.12.3이라 같은 계열로 맞춘다. 바꿀 땐 env로 덮어쓴다.
const 판 = process.env.GIJO_PYTHON_VERSION || "3.12.10";
const URL = `https://www.python.org/ftp/python/${판}/python-${판}-embed-amd64.zip`;
const 표식 = path.join(OUT, "GIJO-PYTHON-VERSION.json");

// 멱등 — 이미 같은 판이 **온전히** 꾸려져 있으면 다시 받지 않는다(fetch-smartmd의 --keep과 같은 뜻).
//
// ⚠ 「파일이 있다」를 증거로 삼지 않는다(검토관 2026-08-22 [중]). 예전엔 표식과 python.exe만 보고
//   건너뛰었는데, 그러면 site-packages/pypdf가 지워지거나 ._pth가 원본으로 되돌아간 상태에서도
//   **자가 검증까지 통째로 건너뛰고** 그 폴더가 그대로 설치본에 실렸다 — 25MB를 싣고도 PDF는
//   안 읽히는 상태가 조용히 출하된다(이 스크립트가 막으려던 바로 그 실패 모드).
//   실제로 pypdf를 지우고 돌려 재현했다. 그래서 **꾸림의 결과물 셋을 다 확인**한다.
// ★★ **「무엇으로 꾸렸는가」를 지문으로 남기고, 그것이 바뀌면 무조건 다시 꾸린다**(2026-08-22).
//
//   ⚠ 위의 「결과물 셋을 다 확인」만으로는 **부족했다.** 설계관이 실증한 실패 모드:
//     오늘 AGPL 부품(PyMuPDF)을 걷어내려고 requirements-ocr.txt를 고치고 MSVC 목록을 고쳤는데,
//     이미 꾸려진 폴더는 손으로 적은 확인 목록(python.exe·pypdf·모델·msvcp140·._pth)을
//     **여전히 전부 만족**한다. 그래서 `npm run dist`를 돌려도 여기서 exit 0으로 건너뛰고
//     **AGPL이 그대로 출하되고, 새 부품(pypdfium2)은 안 심기고, 자가검증도 안 돈다.**
//     즉 라이선스 사고를 고쳤다고 믿는 사람과 실제 출하물이 달라진다.
//   뿌리는 판정 조건에 **입력**(요구 파일·판·목록)이 하나도 안 들어 있던 것이다.
//   결과물 목록은 사람이 적는 한 늘 뒤처지지만, 지문은 입력이 바뀌면 자동으로 바뀐다.
const OCR요구파일 = path.join(루트, "server", "requirements-ocr.txt");
function 꾸림지문() {
  const ocr = fs.existsSync(OCR요구파일)
    ? fs.readFileSync(OCR요구파일, "utf8").replace(/#.*$/gm, "").replace(/\s+/g, " ").trim()
    : "";
  return createHash("sha256").update(JSON.stringify({
    판,
    pypdf: process.env.GIJO_PYPDF_VERSION || "",
    ocr,                                        // 부품 목록·판이 한 글자라도 바뀌면 다시 꾸린다
    ocr넣나: process.env.GIJO_SKIP_OCR !== "1",   // 건너뛰기로 구운 폴더를 「온전함」으로 오인하지 않는다
    꾸림규약: 2,                                  // 이 스크립트의 꾸리는 방식 자체가 바뀌면 손으로 올린다
  })).digest("hex").slice(0, 16);
}

if (fs.existsSync(표식)) {
  try {
    const 있는판 = JSON.parse(fs.readFileSync(표식, "utf8"));
    const pth전 = fs.readdirSync(OUT).find((f) => /^python\d+\._pth$/.test(f));
    if (있는판.recipe !== 꾸림지문()) {
      console.log("[stage-python] 꾸림 재료가 바뀌었습니다(부품 목록·판·OCR 여부) — 다시 꾸립니다.");
      throw new Error("recipe-changed");   // 아래 catch가 받아 새로 꾸리게 한다
    }
    // ⚠ OCR까지 본다 — 안 그러면 OCR을 넣기 전에 꾸린 폴더가 「온전함」으로 통과해
    //   **OCR 없는 설치본**이 조용히 나간다(pypdf를 지우고 재현했던 것과 같은 부류).
    //   ⚠ 확인 항목이 **한 개씩만** 있었다(rec 모델 1개 + msvcp140 1개). 그러면 det 모델이나
    //     onnxruntime이 사라진 폴더도 「온전함」으로 통과한다 — 실제로 그렇게 통과했다.
    //     지금은 OCR이 돌기 위해 **반드시 있어야 하는 것 전부**를 본다. 건너뛰기(SKIP) 갈래는
    //     위의 꾸림지문이 이미 갈라 주므로, 여기서는 「넣기로 했으면 다 있나」만 본다.
    const OCR확인 = process.env.GIJO_SKIP_OCR === "1" || [
      path.join(OUT, "site-packages", "rapidocr", "models", "ch_PP-OCRv5_det_mobile.onnx"),
      path.join(OUT, "site-packages", "rapidocr", "models", "korean_PP-OCRv5_rec_mobile.onnx"),
      path.join(OUT, "site-packages", "onnxruntime"),
      path.join(OUT, "site-packages", "pypdfium2"),
    ].every((p) => fs.existsSync(p));
    const 온전한가 =
      있는판.version === 판 &&
      fs.existsSync(path.join(OUT, "python.exe")) &&
      fs.existsSync(path.join(OUT, "site-packages", "pypdf")) &&
      OCR확인 &&
      !!pth전 &&
      /^import site$/m.test(fs.readFileSync(path.join(OUT, pth전), "utf8"));
    if (온전한가) {
      console.log(`[stage-python] 이미 ${판}이 꾸려져 있습니다 — 건너뜁니다(다시 받으려면 폴더를 지우세요).`);
      process.exit(0);
    }
    console.log("[stage-python] 표식은 있지만 내용이 온전하지 않습니다(pypdf·site 설정 확인) — 다시 꾸립니다.");
  } catch { /* 표식이 깨졌으면 새로 꾸린다 */ }
}

// ★ 폐쇄망 빌드 머신용 탈출구 — 사람이 미리 받아 둔 zip을 **지우기 전에** 먼저 찾는다.
//   ⚠ 예전엔 안내만 있고 코드가 반대였다(검토관 2026-08-22): 「미리 받아 OUT에 풀어 두세요」라고
//     해 놓고, 다음 실행 첫 동작이 그 폴더를 통째로 지우고 다시 인터넷으로 갔다 — 원리상 따를 수
//     없는 안내였다. 이제 zip을 캐시 자리에 두면 그것을 쓴다.
const 캐시zip = process.env.GIJO_PYTHON_ZIP || path.join(루트, "client", "build", `python-${판}-embed-amd64.zip`);
const 미리받음 = fs.existsSync(캐시zip);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ① 내려받기 — 실패를 **시끄럽게** 낸다. 조용히 넘어가면 파이썬 없는 설치본이 나간다.
const zip = path.join(OUT, "python-embed.zip");
if (미리받음) {
  console.log(`[stage-python] 1/4 미리 받아 둔 zip 사용: ${캐시zip}`);
  fs.copyFileSync(캐시zip, zip);
} else {
  console.log(`[stage-python] 1/4 내려받기 ${URL}`);
  try {
    execFileSync("curl", ["-sSL", "--fail", "-o", zip, URL], { stdio: ["ignore", "inherit", "inherit"], timeout: 300_000 });
  } catch {
    console.error(
      `★ 파이썬 임베더블을 못 받았습니다(${URL})\n` +
      `  인터넷이 막힌 빌드 머신이라면 그 zip을 **다음 자리에 두세요**(폴더가 아니라 zip 파일 그대로):\n` +
      `    ${캐시zip}\n  또는 GIJO_PYTHON_ZIP 환경변수로 zip 경로를 알려 주세요.`,
    );
    process.exit(1);
  }
}
// 해시 — 고객 설치본에 실릴 제3자 런타임이라 **무엇을 실었는지 기록**한다(검토관 2026-08-22 [중]).
//   기대값(GIJO_PYTHON_SHA256)이 주어지면 대조하고, 없으면 계산해 표식에 남긴다.
const 해시 = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
if (process.env.GIJO_PYTHON_SHA256 && process.env.GIJO_PYTHON_SHA256.toLowerCase() !== 해시) {
  console.error(`★ 내려받은 파이썬의 sha256이 기대값과 다릅니다.\n  기대: ${process.env.GIJO_PYTHON_SHA256}\n  실제: ${해시}`);
  process.exit(1);
}

// ② 풀기 — PowerShell의 Expand-Archive(Windows 기본 탑재). 외부 꾸러미를 안 쓰는 이유다.
//   ⚠ tar를 쓰지 않는다: bsdtar는 `D:\...` 를 **원격 호스트 D**로 읽어 「Cannot connect to D」로 죽는다
//     (실제로 밟았다 — 드라이브 문자가 든 경로에서 나는 고전적인 함정이다).
console.log("[stage-python] 2/4 풀기");
execFileSync(
  "powershell",
  ["-NoProfile", "-NonInteractive", "-Command",
    // ⚠ $ErrorActionPreference='Stop' — PowerShell은 비종료 오류에 종료코드 0을 준다. 그대로 두면
    //   손상 zip·디스크 부족이 여기서 안 잡히고, 뒤의 「._pth를 못 찾음」으로 **원인이 뒤바뀌어**
    //   보고된다(사람이 python.org 구조 변화를 조사하러 간다). 검토관 2026-08-22 지적.
    `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${OUT.replace(/'/g, "''")}' -Force`],
  { stdio: ["ignore", "inherit", "inherit"], timeout: 180_000 },
);
fs.rmSync(zip, { force: true });
if (!fs.existsSync(path.join(OUT, "python.exe"))) {
  console.error(`★ 압축은 풀렸는데 python.exe가 없습니다(${OUT}) — zip이 손상됐거나 디스크가 부족합니다.`);
  process.exit(1);
}

// ③ site 켜기 — ★ 이게 없으면 pypdf를 **못 찾는다.**
//   임베더블 배포판은 `._pth`에서 `import site`를 주석 처리해 둔다(고립 실행이 기본).
//   그 고립은 지켜야 한다(고객 기계의 PYTHONPATH·PYTHONHOME이 우리 파이썬을 오염시키지 못한다) —
//   그래서 파일을 지우지 않고 **site-packages 한 줄만 더한다.**
const pth = fs.readdirSync(OUT).find((f) => /^python\d+\._pth$/.test(f));
if (!pth) {
  console.error(`★ ._pth 파일을 못 찾았습니다 — 임베더블 배포 구조가 바뀐 것 같습니다(${OUT})`);
  process.exit(1);
}
const 원본 = fs.readFileSync(path.join(OUT, pth), "utf8");
// ⚠ 못 찾으면 **추측하지 않고 멈춘다**(검토관 2026-08-22). 예전엔 조용히 "python312.zip"을 적었는데,
//   다른 판에서 구조가 바뀌면 없는 zip을 sys.path에 적어 표준 라이브러리가 통째로 빠진다 —
//   증상은 `import pypdf` 실패 한 줄로만 나와 원인을 못 짚는다.
const 표준zip매치 = 원본.match(/^python\d+\.zip$/m);
if (!표준zip매치) {
  console.error(`★ ._pth에서 표준 라이브러리 zip 이름을 못 찾았습니다 — 임베더블 배포 구조가 바뀐 것 같습니다.\n  파일 내용:\n${원본.slice(0, 200)}`);
  process.exit(1);
}
const 표준zip = 표준zip매치[0];
fs.writeFileSync(
  path.join(OUT, pth),
  `${표준zip}\n.\nsite-packages\n\n# site를 켠다 — 아래 site-packages의 pypdf를 찾게 하려면 필요하다.\n# ⚠ 이 파일 자체는 지우지 말 것: 고객 기계의 PYTHONPATH/PYTHONHOME이 우리 파이썬을\n#   오염시키지 못하게 막는 고립(isolated) 보호가 여기서 나온다.\nimport site\n`,
  "utf8",
);

// ④ pypdf 심기 — 순수 파이썬이라 플랫폼 무관. 빌드 머신의 pip으로 --target에 평평하게 넣는다
//   (venv를 만들지 않는다 — venv는 빌드 머신 절대경로를 품어 고객 기계에서 깨진다).
console.log("[stage-python] 3/4 pypdf 심기");
const 사이트 = path.join(OUT, "site-packages");
// pypdf도 **판을 고정한다**(검토관 2026-08-22) — 안 그러면 같은 커밋에서 빌드해도 날마다 다른
//   물건이 나가, 「고객 A와 B가 다른 pypdf를 받는」 상태가 된다. 재현 가능한 빌드가 이 동봉의 전제다.
const pypdf판 = process.env.GIJO_PYPDF_VERSION || "6.16.1";
let 쓴pip = "";
// ⚠ 운영자가 GIJO_BUILD_PIP를 **명시 지정했으면 그것만 쓴다.** 예전엔 실패를 조용히 삼키고
//   시스템 pip으로 넘어가, 「동봉본과 같은 계열의 pip을 쓰라」는 의도가 소리 없이 무시됐다.
const 지정pip = process.env.GIJO_BUILD_PIP;
const pip후보 = 지정pip ? [지정pip] : ["pip", "pip3"];
for (const pip of pip후보) {
  try {
    execFileSync(pip, ["install", "--quiet", "--target", 사이트, `pypdf==${pypdf판}`], {
      stdio: ["ignore", "inherit", "inherit"], timeout: 300_000,
    });
    쓴pip = pip;
    break;
  } catch (e) {
    if (지정pip) {
      console.error(`★ 지정하신 pip(GIJO_BUILD_PIP=${지정pip})으로 pypdf를 못 심었습니다 — 다른 pip으로 몰래 바꾸지 않습니다.\n${String((e && e.message) || e).slice(0, 300)}`);
      process.exit(1);
    }
    /* 지정이 없을 때만 다음 후보 */
  }
}
if (!쓴pip) {
  console.error("★ pypdf를 못 심었습니다 — 빌드 머신에 pip이 필요합니다(GIJO_BUILD_PIP로 지정 가능).\n  PDF 없이 나가면 「추출 도구가 없다」와 같은 결과가 됩니다.");
  process.exit(1);
}

// ④-2 OCR 부품 — 스캔 문서·이미지를 읽는다(사장님 2026-08-22 「OCR 기능도 양쪽 다 넣어줘」).
//   ⚠ 크기 실측: **322.6MB**(Windows 디스크, 3,473개 파일). requirements-ocr.txt 주석의 「~480MB」와
//     웹 재구성 「130MB」 둘 다 틀렸다 — 전자는 리눅스 기준, 후자는 압축 크기였다.
//   ⚠ 이건 오늘 잰 값이다. 판이 바뀌면 다시 재야 한다.
const OCR넣기 = process.env.GIJO_SKIP_OCR !== "1";
// 동봉한 MSVC 런타임 목록 — 아래 블록에서 채우고 **표식에 남긴다**(어떤 판이 나갔는지 소명용).
let MSVC = [];
if (OCR넣기) {
  console.log("[stage-python] 3.5/5 OCR 부품 심기(약 320MB — 시간이 걸립니다)");
  const ocr목록 = fs.readFileSync(path.join(루트, "server", "requirements-ocr.txt"), "utf8")
    .split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  try {
    // ⚠ `--only-binary=:all:` — 소스 빌드로 새면 빌드 머신에 컴파일러가 필요해지고, 무엇보다
    //   **딴 판이 조용히 들어간다**. wheel만 받는다.
    execFileSync(쓴pip, ["install", "--quiet", "--target", 사이트, "--only-binary=:all:", ...ocr목록], {
      stdio: ["ignore", "inherit", "inherit"], timeout: 1_800_000,
    });
  } catch (e) {
    console.error(`★ OCR 부품을 못 심었습니다 — 스캔 문서·이미지를 못 읽는 설치본이 됩니다.\n${String((e && e.message) || e).slice(0, 300)}`);
    process.exit(1);
  }
  // ★ 안 쓰는 모델을 지운다 — RapidOCR wheel이 PP-OCRv6 모델을 싣고 오는데 **한국어를 지원하지
  //   않아 영원히 안 쓴다**(extract_doc.py가 v5로 핀 고정). 실측 30.5MB를 그냥 버리는 셈이다.
  let 지운양 = 0;
  for (const f of ["PP-OCRv6_det_small.onnx", "PP-OCRv6_rec_small.onnx"]) {
    const p = path.join(사이트, "rapidocr", "models", f);
    if (fs.existsSync(p)) { 지운양 += fs.statSync(p).size; fs.rmSync(p, { force: true }); }
  }
  // ⚠ 못 찾으면 **소리를 낸다**(2026-08-22 검토관). 조용히 넘어가면 rapidocr 판이 올라
  //   파일 이름이 바뀐 날부터 「안 쓰는 모델 제거」가 아무도 모르게 사라지고 설치본이 30MB 불어난다.
  if (지운양) console.log(`[stage-python]   · 안 쓰는 v6 모델 제거: ${(지운양 / 1048576).toFixed(1)}MB(한국어 미지원)`);
  else console.log("[stage-python]   ⚠ 지울 v6 모델을 못 찾았습니다 — rapidocr 판이 바뀌어 파일 이름이 달라졌는지 확인하세요.");
  // ★ 한국어 v5 모델을 **미리 담는다** — 안 담으면 고객 기계가 첫 실행 때 중국 CDN(modelscope.cn)으로
  //   나간다. 폐쇄망에서는 실패하고, 폐쇄망이 아니어도 **우리가 봉인한 egress를 새로 뚫는 셈**이다.
  //   ⚠ RapidOCR은 파일이 있어도 **sha256이 자기 목록과 다르면 지우고 다시 받는다** — 해시를
  //     맞춰 담아야 진짜로 안 나간다(설계관 2026-08-22 적발).
  await 모델담기(사이트);
  // ★ MSVC 런타임 — onnxruntime·opencv가 msvcp140을 문다. 동봉 파이썬에는 vcruntime140만 있다.
  //   ⚠ **빈 PATH 자가검증으로는 이 누락을 원리상 못 잡는다** — System32는 PATH와 무관하게
  //     검색되므로 개발 기계에서는 늘 성공한다(설계관 2026-08-22 지적). 깨끗한 고객 PC에서만
  //     터지는 부류라, llama-cuda가 쓰는 방식 그대로 **exe 옆에 동봉**한다(MS 공식 허용 방식).
  //   ⚠ **손으로 적은 목록은 반드시 어긋난다**(2026-08-22 실증). 이 목록이 llama-cuda 것을
  //     물려받은 탓에 실제와 두 군데 어긋나 있었다: onnxruntime이 무는 **msvcp140_1.dll이 빠졌고**
  //     (깨끗한 고객 PC에서 OCR이 통째로 죽는다), 반대로 vcomp140.dll은 여기서 **아무도 안 문다**.
  //     그래서 목록을 손으로 적는 대신 **꾸린 트리에서 직접 읽어** 정한다(아래 필요한MSVC).
  MSVC = [...필요한MSVC(OUT)];
  for (const f of MSVC) {
    const s = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", f);
    if (!fs.existsSync(s)) { console.error(`★ MSVC 런타임 없음: ${s}`); process.exit(1); }
    fs.copyFileSync(s, path.join(OUT, f));
  }
  console.log(`[stage-python]   · MSVC 런타임 ${MSVC.length}개 동봉(바이너리에서 유도): ${MSVC.join(", ")}`);
}

// ⑤ 자가 검증 — ★ **PATH를 비워 「고객 기계 모양」으로** 돌린다.
//   개발 기계에는 파이썬이 있어 동봉이 잘못돼도 폴백으로 돌아 거짓 통과한다(llama-cuda 교훈).
console.log("[stage-python] 4/4 자가 검증(빈 PATH)");
const 깨끗한env = {
  SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
  PATH: (process.env.SystemRoot ?? "C:\\Windows") + "\\System32",
  PYTHONUTF8: "1",
};
try {
  // ★ **제품이 실제로 부르는 경로 그대로** 돌린다(검토관 2026-08-22 [중]).
  //   예전엔 `import pypdf` 한 줄만 봤는데, 그건 「pypdf가 import된다」를 재고
  //   「고객 기계에서 한글 PDF가 읽힌다」를 주장하는 것이었다 — 다른 명제다.
  //   여기서는 extract_doc.py에 진짜 PDF를 물려 **한글이 나오는지**까지 본다
  //   (stdout 격리·인코딩·zip 경로가 전부 이 한 번에 걸린다).
  const 표본 = path.join(OUT, "_selfcheck.pdf");
  fs.writeFileSync(표본, 표본PDF());
  const 추출기 = path.join(루트, "server", "scripts", "extract_doc.py");
  const 글 = String(execFileSync(path.join(OUT, "python.exe"), [추출기, 표본], {
    env: 깨끗한env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
  }));
  fs.rmSync(표본, { force: true });
  if (!/기조/.test(글)) {
    console.error(`★ 자가 검증 실패 — 동봉본이 PDF에서 한글을 못 뽑았습니다(고객 기계에서 죽는다는 뜻).\n뽑힌 글: ${JSON.stringify(글.slice(0, 200))}`);
    process.exit(1);
  }
  // ★ OCR도 **제품 경로 그대로 실제로 읽혀 본다**(2026-08-22 검토관 [중] 수리).
  //   ⚠ 예전엔 `import rapidocr,fitz,onnxruntime` + 모델 **파일 이름 나열**이 전부였는데,
  //     주석과 커밋 메시지는 「OCR 실제 로드」라고 적었다 — **관문의 문구가 실제 검사보다 셌다.**
  //     그래서 바로 그날 고친 결함(모델 자리를 Path로 넘겨 엔진 생성이 거부되던 것)이 재발해도
  //     이 관문은 초록이었다. 엔진 생성 시점의 실패는 import로는 원리상 안 잡힌다.
  //   이제 저장소의 한글 스캔 표본을 **extract_doc.py에 물려** 한글이 나오는지까지 본다.
  if (OCR넣기) {
    const 표본이미지 = path.join(루트, "server", "test", "fixtures", "scan-ko.png");
    if (!fs.existsSync(표본이미지)) {
      console.error(`★ OCR 자가 검증 표본이 없습니다: ${표본이미지}`);
      process.exit(1);
    }
    let 읽은글 = "";
    try {
      읽은글 = String(execFileSync(path.join(OUT, "python.exe"), [추출기, 표본이미지], {
        env: 깨끗한env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000,
      }));
    } catch (e) {
      console.error(`★ OCR 자가 검증 실패 — 동봉본이 한글 이미지를 못 읽었습니다(고객 기계에서 죽는다는 뜻).\n${String((e && e.stderr) || (e && e.message) || e).slice(0, 500)}`);
      process.exit(1);
    }
    if (!/[가-힣]/.test(읽은글)) {
      console.error(`★ OCR 자가 검증 실패 — 한글이 한 글자도 안 나왔습니다.\n뽑힌 글: ${JSON.stringify(읽은글.slice(0, 200))}`);
      process.exit(1);
    }
    console.log(`[stage-python]   · OCR 자가 검증(실제 읽기): ${JSON.stringify(읽은글.trim().slice(0, 40))}`);
  }
  const out = execFileSync(path.join(OUT, "python.exe"), ["-c", "import pypdf,sys;print(pypdf.__version__, sys.version.split()[0])"], {
    env: 깨끗한env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  });
  const [심은pypdf, py판] = String(out).trim().split(/\s+/);
  // 무엇을 실었는지 남긴다 — 사후에 「그때 어떤 물건이 나갔나」를 되짚을 근거(검토관 2026-08-22).
  //   ⚠ 예전엔 이 기록에 **OCR이 한 글자도 없었다** — 300MB가 넘는 물건을 싣고도 표식에는
  //     python·pypdf만 있었다. 그래서 「그 게시본에 OCR이 있었나·무슨 판이었나」에 답할 근거가
  //     없었고, 하필 라이선스 사고를 낸 부품(PyMuPDF)이 바로 그 기록 밖에 있었다.
  //     이제 심은 OCR 부품의 **판까지** 남긴다(라이선스 소명·재현 둘 다 여기서 시작한다).
  let OCR판 = null;
  if (OCR넣기) {
    try {
      const 재기 = [
        "import json, importlib.metadata as md",
        "r = {}",
        "for p in ['rapidocr','onnxruntime','pypdfium2','opencv-python','numpy','pillow','pypdf']:",
        "    try: r[p] = md.version(p)",
        "    except Exception: pass",
        "print(json.dumps(r))",
      ].join("\n");
      OCR판 = JSON.parse(String(execFileSync(path.join(OUT, "python.exe"), ["-c", 재기], {
        env: 깨끗한env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
      })).trim());
    } catch (e) {
      // 판을 못 읽는 것은 치명은 아니지만 **조용히 넘기지 않는다** — 기록의 목적이 사라진다.
      console.log(`[stage-python]   ⚠ OCR 부품 판을 기록하지 못했습니다: ${String((e && e.message) || e).slice(0, 160)}`);
    }
  }
  fs.writeFileSync(표식, JSON.stringify({
    version: 판, python: py판, pypdf: 심은pypdf, pypdfRequested: pypdf판,
    sha256: 해시, pip: 쓴pip, source: 미리받음 ? 캐시zip : URL,
    ocr: OCR넣기, ocrPackages: OCR판, msvc: OCR넣기 ? MSVC : [],
    recipe: 꾸림지문(),   // ★ 이 값이 달라지면 다음 빌드가 무조건 다시 꾸린다
    stagedAt: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  const 파일수 = 세기(OUT);
  console.log(`[stage-python] 완료: ${OUT} — 파이썬 ${py판} · pypdf ${심은pypdf} · ${파일수.n}개 파일 · ${(파일수.합 / 1048576).toFixed(1)}MB`);
} catch (e) {
  const msg = String((e && e.stderr) || (e && e.message) || e);
  console.error(`★ 빈 PATH 자가 검증 실패 — 동봉본만으로는 안 돕니다(고객 기계에서 죽는다는 뜻).\n${msg.slice(0, 500)}`);
  process.exit(1);
}

/** 자가 검증용 한 장짜리 PDF — 한글 「기조」가 든 최소 파일을 손으로 짓는다.
 *  ⚠ 저장소에 표본 바이너리를 두지 않으려고 여기서 만든다(파일이 늘면 관리 대상도 는다).
 *    글자는 ToUnicode 없이도 pypdf가 뽑을 수 있게 **WinAnsi 밖 문자를 8진 이스케이프**로 넣는다 —
 *    한글이 통과하는지가 이 검증의 요점이라 ASCII만으로는 뜻이 없다. */
/** 한국어 OCR 모델 2개를 미리 담는다 — 고객 기계가 첫 실행에 CDN으로 나가지 않게.
 *
 *  ⚠ 3개가 아니라 **2개**다(설계관 2026-08-22 정정) — 각도분류 모델은 wheel에 이미 실려 있다.
 *  ⚠ RapidOCR은 **sha256이 자기 목록과 다르면 파일이 있어도 지우고 다시 받는다.** 그래서
 *    해시를 맞춰 담아야 진짜로 안 나간다. 목록은 site-packages의 default_models.yaml에서 읽는다 —
 *    여기 손으로 적으면 판이 바뀔 때 조용히 어긋난다(같은 것을 두 곳에 적지 않는다).
 *  ⚠ 빌드 머신이 인터넷을 못 쓰면 GIJO_OCR_MODEL_DIR에 미리 받아 둔 파일을 둘 수 있다.
 */
async function 모델담기(사이트) {
  const 모델방 = path.join(사이트, "rapidocr", "models");
  const yml = path.join(사이트, "rapidocr", "default_models.yaml");
  if (!fs.existsSync(yml)) {
    console.error(`★ default_models.yaml을 못 찾았습니다(${yml}) — RapidOCR 구조가 바뀐 것 같습니다.`);
    process.exit(1);
  }
  const 전체원문 = fs.readFileSync(yml, "utf8");
  // ⚠ **엔진 칸을 먼저 자른다**(2026-08-22 검토관 [중]). 이 파일은 최상위에 엔진별 칸이
  //   여럿이고(onnxruntime·openvino·mnn·paddle·torch) **같은 모델 이름이 10번쯤 나온다.**
  //   앞에서부터 찾으면 지금은 우연히 맞을 뿐이다 — onnxruntime 칸이 맨 앞이라서.
  //   판이 올라 순서가 바뀌면 .mnn 파일이나 디렉터리 주소를 집어 조용히 엉뚱한 것을 담는다.
  //   우리가 쓰는 엔진은 onnxruntime 하나다(extract_doc.py의 RapidOCR 기본 엔진).
  const 엔진칸시작 = 전체원문.search(/^onnxruntime:/m);
  if (엔진칸시작 < 0) {
    console.error("★ default_models.yaml에 onnxruntime 칸이 없습니다 — RapidOCR 구조가 바뀐 것 같습니다.");
    process.exit(1);
  }
  const 다음칸 = 전체원문.slice(엔진칸시작 + 1).search(/^[A-Za-z_][A-Za-z0-9_]*:/m);
  const 원문 = 다음칸 < 0 ? 전체원문.slice(엔진칸시작) : 전체원문.slice(엔진칸시작, 엔진칸시작 + 1 + 다음칸);
  // 우리가 쓰는 두 모델의 URL·sha256을 그 파일에서 뽑는다(핀은 extract_doc.py가 v5로 잡는다).
  const 필요 = ["ch_PP-OCRv5_det_mobile", "korean_PP-OCRv5_rec_mobile"];
  fs.mkdirSync(모델방, { recursive: true });
  for (const 이름 of 필요) {
    const i = 원문.indexOf(이름);
    if (i < 0) { console.error(`★ ${이름} 항목을 onnxruntime 칸에서 못 찾았습니다.`); process.exit(1); }
    const 조각 = 원문.slice(i, i + 600);
    const url = (조각.match(/model_dir:\s*(\S+)/) || [])[1];
    const sha = (조각.match(/SHA256:\s*(\S+)/i) || [])[1];
    if (!url || !sha) { console.error(`★ ${이름}의 주소·해시를 못 읽었습니다.`); process.exit(1); }
    // ⚠ **뽑은 주소가 정말 그 모델인지 대조한다.** 600자 창이 다음 항목까지 넘어가면
    //   엉뚱한 url+sha 쌍을 **짝이 맞는 채로** 집어 해시 검사까지 통과한다 — 조용한 오염이다.
    if (!url.includes(이름)) {
      console.error(`★ ${이름}의 주소를 잘못 읽었습니다(창이 다음 항목까지 넘어간 듯): ${url}`);
      process.exit(1);
    }
    const 파일명 = url.split("/").pop();
    if (!/\.onnx$/i.test(파일명)) {
      console.error(`★ ${이름}이 onnx 파일이 아닙니다(${파일명}) — 엔진 칸을 잘못 골랐을 수 있습니다.`);
      process.exit(1);
    }
    const 목적지 = path.join(모델방, 파일명);
    // 이미 맞는 파일이 있으면 그대로 쓴다(멱등).
    if (fs.existsSync(목적지) && createHash("sha256").update(fs.readFileSync(목적지)).digest("hex") === sha) continue;
    // 폐쇄망 빌드 머신 탈출구 — 미리 받아 둔 파일을 먼저 본다.
    const 캐시 = process.env.GIJO_OCR_MODEL_DIR ? path.join(process.env.GIJO_OCR_MODEL_DIR, 파일명) : "";
    if (캐시 && fs.existsSync(캐시)) {
      fs.copyFileSync(캐시, 목적지);
    } else {
      try {
        execFileSync("curl", ["-sSL", "--fail", "-o", 목적지, url], { stdio: ["ignore", "inherit", "inherit"], timeout: 600_000 });
      } catch {
        console.error(`★ OCR 모델을 못 받았습니다(${url})\n  인터넷이 막힌 빌드 머신이면 그 파일을 GIJO_OCR_MODEL_DIR 폴더에 두세요.`);
        process.exit(1);
      }
    }
    const 실제 = createHash("sha256").update(fs.readFileSync(목적지)).digest("hex");
    if (실제 !== sha) {
      console.error(`★ ${파일명}의 sha256이 다릅니다 — 고객 기계가 첫 실행에 CDN으로 나가게 됩니다.\n  기대 ${sha}\n  실제 ${실제}`);
      process.exit(1);
    }
    console.log(`[stage-python]   · 모델 담음: ${파일명} (${(fs.statSync(목적지).size / 1048576).toFixed(1)}MB)`);
  }
}

function 표본PDF() {
  // 한글을 UTF-16BE로 넣고 pypdf가 그대로 읽게 한다(Identity-H 없이도 텍스트 연산자는 보존된다).
  const 글 = "기조 AS 자가검증";
  const hex = Buffer.from(글, "utf16le").swap16().toString("hex").toUpperCase();
  const 내용 = `BT /F1 12 Tf 72 720 Td <${hex}> Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${내용.length} >>\nstream\n${내용}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Noto /Encoding /Identity-H /DescendantFonts [] /ToUnicode 6 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const 오프셋 = [];
  objs.forEach((o, i) => { 오프셋.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of 오프셋) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function 세기(dir) {
  let n = 0, 합 = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = 세기(p); n += r.n; 합 += r.합; }
    else { n++; 합 += fs.statSync(p).size; }
  }
  return { n, 합 };
}
