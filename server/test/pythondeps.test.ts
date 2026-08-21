// 서버가 쓰는 파이썬 모듈이 requirements.txt에 **적혀 있는가** (2026-08-09 실사고 두 건).
//
// ■ 무슨 일이 있었나
//   · pypdf   — requirements.txt에 **적혀 있었는데 운영에 설치가 안 돼** PDF 추출이 통째로
//               죽어 있었다(몇 달간 아무도 몰랐다).
//   · netmiko — 장비 접속이 쓰는데 requirements.txt에 **적혀 있지도 않았다.** 운영에도 없었다.
//               같은 날 pypdf를 파다가 발견했다 — 즉 이건 한 번의 사고가 아니라 **계열**이다.
//
// ■ 두 짝이 필요하다 — 한쪽만으로는 못 막는다
//   이 시험(소스)   : 쓰는데 **안 적힌 것**을 잡는다. 어느 환경에서든 돈다.
//   check-python-deps.mjs(런타임): 적혔는데 **설치 안 된 것**을 잡는다. 돌아갈 환경에서 실행.
//   ⚠ 이 시험이 런타임 확인을 대신할 수 없다 — 개발 기계(Windows)와 제품(WSL)은 **다른
//     환경**이고, Windows의 python3은 0바이트 껍데기라 여기서 통과해도 운영을 보증 못 한다.
//
// ■ 학습용은 제외한다
//   torch·transformers·unsloth 등은 **별도 환경**(trainenv.ts의 venv-train)이 담당한다.
//   그래서 「serverPython()으로 스폰되는 스크립트」만 본다 — 목록을 손으로 적으면 반드시
//   어긋나므로 **소스에서 유도**한다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 서버루트 = path.join(__dirname, "..");

/** 파이썬 표준 라이브러리(우리가 쓰는 범위) — 설치가 필요 없는 것들. */
const 표준 = new Set([
  "argparse", "base64", "collections", "contextlib", "csv", "dataclasses", "datetime",
  "functools", "glob", "hashlib", "importlib", "io", "itertools", "json", "logging",
  "math", "os", "pathlib", "random", "re", "shutil", "signal", "socket", "string",
  "subprocess", "sys", "tempfile", "textwrap", "time", "traceback", "typing", "urllib",
  "uuid", "warnings", "xml", "zipfile",
]);

function ts파일들(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ts파일들(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** serverPython()으로 스폰되는 .py 파일 — 소스에서 유도한다(손 목록 금지). */
function 서버용스크립트(): string[] {
  const 이름 = new Set<string>();
  for (const f of ts파일들(path.join(서버루트, "src"))) {
    const src = fs.readFileSync(f, "utf8");
    // ⚠ `serverPython()`(빈 괄호)로 찾으면 안 된다 — 2026-08-22에 용도 인자가 생겨
    //   `serverPython("docs")`가 되면서 **dataset.ts가 필터에서 빠졌다.** 그런데도 extract_doc.py가
    //   계속 잡힌 이유는 pythonbin.ts **주석**에 두 문자열이 우연히 함께 있어서였다 —
    //   즉 감시가 주석에 기대고 있었고, 주석을 정리하는 순간 pypdf·OCR 의존 감시가 조용히 죽는다.
    //   여는 괄호까지만 봐서 인자 유무와 무관하게 잡는다(설계관 2026-08-22 적발).
    if (!src.includes("serverPython(")) continue;
    for (const m of src.matchAll(/["']([A-Za-z0-9_\-/]+\.py)["']/g)) 이름.add(path.basename(m[1]));
  }
  // 실제로 존재하는 것만(scripts/ 아래 또는 서버 루트 — modelscan_wrapper.py가 루트에 있다).
  const 경로: string[] = [];
  for (const n of 이름) {
    for (const c of [path.join(서버루트, "scripts", n), path.join(서버루트, n)]) {
      if (fs.existsSync(c)) { 경로.push(c); break; }
    }
  }
  return 경로;
}

/** .py가 import 하는 외부 모듈(최상위 이름). 표준 라이브러리와 상대 import는 뺀다. */
function 외부모듈(py: string): string[] {
  const src = fs.readFileSync(py, "utf8");
  const mods = new Set<string>();
  for (const line of src.split("\n")) {
    const s = line.trim();
    if (s.startsWith("#")) continue;
    const m = /^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(s);
    if (m && !표준.has(m[1])) mods.add(m[1]);
  }
  return [...mods];
}

function 선언된것(): Set<string> {
  // ⚠ requirements.txt(필수)와 **requirements-ocr.txt(옵션·OCR)** 둘 다 읽는다(2026-08-21 설계관 지적):
  //   OCR 라이브러리(fitz·rapidocr)를 extract_doc.py가 import하는데, requirements.txt에 넣으면
  //   check-python-deps가 OCR을 「강제」로 봐(옵션이 아니게) WSL·라이트에서 실패한다. 그래서 별
  //   파일에 두되, **이 소스 감시는 두 파일을 합쳐** 봐서 「쓰는데 안 적힌 것」만 잡는다.
  //   (check-python-deps.mjs는 requirements.txt만 읽어 OCR을 옵션으로 남긴다 — 비대칭이 핵심.)
  const 표: Record<string, string> = { "opencv-python": "cv2", pillow: "PIL", pyyaml: "yaml", pymupdf: "fitz" };
  const s = new Set<string>();
  for (const 파일 of ["requirements.txt", "requirements-ocr.txt"]) {
    const p = path.join(서버루트, 파일);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      const pkg = l.replace(/#.*$/, "").trim().split(/[=<>!~[\s]/)[0].trim();
      if (!pkg) continue;
      s.add(pkg.replace(/-/g, "_"));
      if (표[pkg.toLowerCase()]) s.add(표[pkg.toLowerCase()]);
    }
  }
  return s;
}

describe("서버가 쓰는 파이썬 모듈은 requirements.txt에 적혀 있어야 한다", () => {
  const 스크립트 = 서버용스크립트();
  const 선언 = 선언된것();

  it("검사 대상을 실제로 찾았다 — 0건이면 이 시험이 헛돌고 있다", () => {
    // 정규식이 낡아 아무것도 안 잡으면 **조용히 통과**한다. 그게 가장 나쁜 실패다.
    expect(스크립트.length, "serverPython()으로 스폰되는 .py를 하나도 못 찾았다").toBeGreaterThan(0);
    expect(선언.size, "requirements.txt에서 읽은 항목이 0개다").toBeGreaterThan(0);
  });

  it("★ 쓰는데 안 적힌 모듈이 없다 — netmiko가 정확히 이 구멍이었다", () => {
    const 빠진것: string[] = [];
    for (const py of 스크립트) {
      for (const m of 외부모듈(py)) {
        if (!선언.has(m)) 빠진것.push(`${m} (${path.basename(py)})`);
      }
    }
    expect(빠진것, "requirements.txt에 없으면 배포한 기계에 설치되지 않아 기능이 조용히 죽는다").toEqual([]);
  });

  it("★★ 런타임 확인 스크립트가 살아 있다 — 소스 검사만으로는 「적혔지만 미설치」를 못 잡는다", () => {
    // pypdf 사고가 바로 그 유형이었다: 적혀 있었고, 설치가 안 돼 있었다.
    const p = path.join(서버루트, "scripts", "check-python-deps.mjs");
    expect(fs.existsSync(p), "scripts/check-python-deps.mjs 가 있어야 한다").toBe(true);
    const src = fs.readFileSync(p, "utf8");
    expect(src, "requirements를 읽어야 한다").toContain("requirements.txt");
    expect(src, "0건이면 실패로 처리해야 한다").toContain("검사가 헛돌고 있습니다");
  });
});
