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
//   기본으로 있는 tar(bsdtar)를 쓴다. 선례 둘도 외부 꾸러미 0개다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ⚠ Windows 전용이다. mac은 서명 절차(개별 ad-hoc 서명)가 더 붙어 별도 작업으로 남겼다 —
//   dist:lite 선행 단계로 묶여도 mac에서 깨지지 않게 여기서 비켜 준다(stage-llama-cuda와 같은 가드).
if (process.platform !== "win32") {
  console.log("[stage-python] Windows가 아니라 건너뜁니다 — mac 동봉은 아직 별도 과제입니다.");
  process.exit(0);
}

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(루트, "client", "build", "python-dist");
// 판 고정 — 운영(WSL)이 3.12.3이라 같은 계열로 맞춘다. 바꿀 땐 env로 덮어쓴다.
const 판 = process.env.GIJO_PYTHON_VERSION || "3.12.10";
const URL = `https://www.python.org/ftp/python/${판}/python-${판}-embed-amd64.zip`;
const 표식 = path.join(OUT, "GIJO-PYTHON-VERSION.json");

// 멱등 — 이미 같은 판이 꾸려져 있으면 다시 받지 않는다(fetch-smartmd의 --keep과 같은 뜻).
if (fs.existsSync(표식)) {
  try {
    const 있는판 = JSON.parse(fs.readFileSync(표식, "utf8"));
    if (있는판.version === 판 && fs.existsSync(path.join(OUT, "python.exe"))) {
      console.log(`[stage-python] 이미 ${판}이 꾸려져 있습니다 — 건너뜁니다(다시 받으려면 폴더를 지우세요).`);
      process.exit(0);
    }
  } catch { /* 표식이 깨졌으면 새로 꾸린다 */ }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ① 내려받기 — 실패를 **시끄럽게** 낸다. 조용히 넘어가면 파이썬 없는 설치본이 나간다.
const zip = path.join(OUT, "python-embed.zip");
console.log(`[stage-python] 1/4 내려받기 ${URL}`);
try {
  execFileSync("curl", ["-sSL", "--fail", "-o", zip, URL], { stdio: ["ignore", "inherit", "inherit"], timeout: 300_000 });
} catch (e) {
  console.error(`★ 파이썬 임베더블을 못 받았습니다(${URL}) — 인터넷이 막힌 빌드 머신이면 미리 받아 ${OUT}에 풀어 두세요.`);
  process.exit(1);
}

// ② 풀기 — PowerShell의 Expand-Archive(Windows 기본 탑재). 외부 꾸러미를 안 쓰는 이유다.
//   ⚠ tar를 쓰지 않는다: bsdtar는 `D:\...` 를 **원격 호스트 D**로 읽어 「Cannot connect to D」로 죽는다
//     (실제로 밟았다 — 드라이브 문자가 든 경로에서 나는 고전적인 함정이다).
console.log("[stage-python] 2/4 풀기");
execFileSync(
  "powershell",
  ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${OUT.replace(/'/g, "''")}' -Force`],
  { stdio: ["ignore", "inherit", "inherit"], timeout: 180_000 },
);
fs.rmSync(zip, { force: true });

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
const 표준zip = (원본.match(/^python\d+\.zip$/m) || ["python312.zip"])[0];
fs.writeFileSync(
  path.join(OUT, pth),
  `${표준zip}\n.\nsite-packages\n\n# site를 켠다 — 아래 site-packages의 pypdf를 찾게 하려면 필요하다.\n# ⚠ 이 파일 자체는 지우지 말 것: 고객 기계의 PYTHONPATH/PYTHONHOME이 우리 파이썬을\n#   오염시키지 못하게 막는 고립(isolated) 보호가 여기서 나온다.\nimport site\n`,
  "utf8",
);

// ④ pypdf 심기 — 순수 파이썬이라 플랫폼 무관. 빌드 머신의 pip으로 --target에 평평하게 넣는다
//   (venv를 만들지 않는다 — venv는 빌드 머신 절대경로를 품어 고객 기계에서 깨진다).
console.log("[stage-python] 3/4 pypdf 심기");
const 사이트 = path.join(OUT, "site-packages");
const pip후보 = [process.env.GIJO_BUILD_PIP, "pip", "pip3"].filter(Boolean);
let 심음 = false;
for (const pip of pip후보) {
  try {
    execFileSync(pip, ["install", "--quiet", "--upgrade", "--target", 사이트, "pypdf"], {
      stdio: ["ignore", "inherit", "inherit"], timeout: 300_000,
    });
    심음 = true;
    break;
  } catch { /* 다음 후보 */ }
}
if (!심음) {
  console.error("★ pypdf를 못 심었습니다 — 빌드 머신에 pip이 필요합니다(GIJO_BUILD_PIP로 지정 가능).\n  PDF 없이 나가면 「추출 도구가 없다」와 같은 결과가 됩니다.");
  process.exit(1);
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
  const out = execFileSync(path.join(OUT, "python.exe"), ["-c", "import pypdf,sys;print(pypdf.__version__, sys.version.split()[0])"], {
    env: 깨끗한env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  });
  const [pypdf판, py판] = String(out).trim().split(/\s+/);
  fs.writeFileSync(표식, JSON.stringify({ version: 판, python: py판, pypdf: pypdf판, stagedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  const 파일수 = 세기(OUT);
  console.log(`[stage-python] 완료: ${OUT} — 파이썬 ${py판} · pypdf ${pypdf판} · ${파일수.n}개 파일 · ${(파일수.합 / 1048576).toFixed(1)}MB`);
} catch (e) {
  const msg = String((e && e.stderr) || (e && e.message) || e);
  console.error(`★ 빈 PATH 자가 검증 실패 — 동봉본만으로는 안 돕니다(고객 기계에서 죽는다는 뜻).\n${msg.slice(0, 500)}`);
  process.exit(1);
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
