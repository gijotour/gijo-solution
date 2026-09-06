// test/shipscripts.test.ts — **서버가 부르는 파이썬은 전부 설치본에 실려야 한다.**
//
// ■ 왜 생겼나 — 같은 실수의 **세 번째**다(2026-08-22)
//   client/scripts/build-server-dist.mjs의 복사 목록은 손으로 적는 배열이다. 여기 없는 것은
//   고객에게 나가지 않는데, 그 사실이 코드 어디에도 걸려 있지 않아 계속 빠졌다:
//     ① encrypt-db.mjs   — 고객이 저장 암호화를 켤 수 없었다(0e5ade71에서 수리)
//     ② 문서 코퍼스       — 첫 기동 지식이 안 들어갔다(2d01e261에서 수리)
//     ③ extract_doc.py    — **PDF·한글·오피스 업로드가 설치본에서 전부 죽어 있었다**(이번)
//   실측(2026-08-22): release/win-unpacked/resources/server-dist/scripts/ 에 .mjs 2개뿐이었다.
//   라이트는 항상 단독 모드라 100% 걸리고, 표준·프로도 단독 모드 데모면 똑같이 걸린다.
//
// ■ 어떻게 잡나 — **소스에서 유도한다**(pythondeps.test.ts와 같은 방식)
//   손으로 적은 목록 둘을 대조하면 둘 다 틀릴 수 있다. 그래서 「서버 코드가 실제로 부르는
//   .py」를 소스에서 긁어 내고, 그것이 배포 스크립트의 복사 목록에 있는지 본다.
//   ⚠ 이 시험이 도는 방식 때문에 스크립트 이름 문자열은 **호출부에 그대로** 있어야 한다
//     (공용 상수로 모으면 이 감시도 pythondeps 감시도 함께 죽는다).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

// ⚠ `new URL(...).pathname`은 **%20을 안 푼다** — 저장소 경로에 공백이 있으면(D:\Connect AI)
//   Windows에서 이 시험이 통째로 헛돌았다(2026-08-22 발견). WSL 관문은 공백 없는 자리로
//   동기화해 돌아서 여태 안 드러났다 — 「환경에 따라 안 도는 시험」의 표본이다.
//   fileURLToPath가 정석이다(디코딩 + 드라이브 문자 처리를 함께 한다).
const 서버루트 = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const 빌드스크립트경로 = path.join(서버루트, "..", "client", "scripts", "build-server-dist.mjs");

function 소스전체(): string {
  const 조각: string[] = [];
  const 훑기 = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) 훑기(p);
      else if (e.name.endsWith(".ts")) 조각.push(fs.readFileSync(p, "utf8"));
    }
  };
  훑기(path.join(서버루트, "src"));
  return 조각.join("\n");
}

// 서버 코드가 실제로 실행하는 .py 파일 이름(경로 부분은 떼고 파일명만).
//
// 제외하는 것 — **우리가 실을 수 있는 파일이 아니거나, 고객 설치본에서 안 도는 것**:
//   · finetune_*·export_gguf — 학습 전용. 개발·학습 머신에서만 돌고 trainenv.ts가 별도 venv로 다룬다.
//   · convert_*_to_gguf      — **llama.cpp 저장소 파일**이다(LLAMA_CPP_DIR 기준, learnloop.ts:651·
//     merge.ts:93). 우리 저장소에 없으니 복사할 대상 자체가 아니고, 모델 합성·어댑터 굽기는
//     고객 설치본이 하는 일이 아니다. (이 시험이 처음 돌 때 실제로 이 둘을 잡았다 — 오탐이라 여기 적는다.)
function 부르는파이썬(): string[] {
  const 학습전용 = /^(finetune_|export_gguf|convert_.*_to_gguf)/;
  const 이름 = new Set<string>();
  for (const m of 소스전체().matchAll(/"([A-Za-z0-9_\-/\\.]+\.py)"/g)) {
    const base = path.basename(m[1]);
    if (!학습전용.test(base)) 이름.add(base);
  }
  return [...이름].sort();
}

describe("★ 출하 목록 — 서버가 부르는 파이썬은 설치본에 실린다", () => {
  it("build-server-dist.mjs의 복사 목록에 빠진 스크립트가 없다", () => {
    expect(fs.existsSync(빌드스크립트경로), `배포 스크립트를 못 찾았다(${빌드스크립트경로}) — 시험이 헛돈다`).toBe(true);
    const 빌드소스 = fs.readFileSync(빌드스크립트경로, "utf8");
    const 부름 = 부르는파이썬();
    // 0건이면 감시가 헛도는 것이다 — 정규식이 안 맞거나 호출부가 이름을 상수로 옮긴 것이다.
    expect(부름.length, "서버 소스에서 .py 호출을 하나도 못 찾았다 — 이 시험이 무력화됐다").toBeGreaterThan(0);
    const 빠진것 = 부름.filter((f) => !빌드소스.includes(`"${f}"`));
    expect(
      빠진것,
      `설치본에 안 실리는 파이썬 ${빠진것.length}건 — 고객 기계에서 그 기능이 죽는다.\n` +
        `client/scripts/build-server-dist.mjs의 복사 목록에 추가할 것: ${빠진것.join(", ")}\n` +
        `(scripts/ 밑인지 서버 루트인지에 따라 두 목록 중 맞는 쪽에 넣는다)`,
    ).toEqual([]);
  });

  it("파이썬 의존 선언(requirements)도 함께 실린다", () => {
    // 스크립트만 실어도 라이브러리가 없으면 안 돈다. 고객이 무엇을 깔아야 하는지 알려면
    // 선언 파일이 설치본에 있어야 한다(필수/옵션 비대칭은 pythondeps.test.ts가 지킨다).
    const 빌드소스 = fs.readFileSync(빌드스크립트경로, "utf8");
    for (const f of ["requirements.txt", "requirements-ocr.txt"]) {
      expect(빌드소스.includes(`"${f}"`), `${f}가 설치본에 안 실린다 — 고객이 무엇을 깔아야 할지 알 수 없다`).toBe(true);
    }
  });

  // ★ 동봉 파이썬(2026-08-22) — 실어 보내는 일이 **빌드 사슬에 묶여 있는가**를 지킨다.
  //   설계관 경고: electron-builder의 extraResources는 `from`이 없어도 **경고만 찍고 계속**한다
  //   (app-builder-lib fileMatcher.js). 즉 스테이징을 사슬에 안 묶으면 「파이썬 없는 설치본」이
  //   조용히 나간다 — 라이트의 llama-cuda가 지금도 사람이 기억해야 하는 상태인 실제 뿌리다.
  it("동봉 파이썬이 빌드 사슬과 출하 목록에 묶여 있다", () => {
    const pkgPath = path.join(서버루트, "..", "client", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
      build: { win?: { extraResources?: { from: string; to: string }[] } };
    };
    expect(pkg.scripts["stage-python"], "stage-python 스크립트가 없다").toBeTruthy();
    for (const 사슬 of ["dist", "dist:lite"]) {
      expect(
        pkg.scripts[사슬],
        `${사슬} 사슬에 stage-python이 없다 — 게시할 때마다 사람이 기억해야 하고, 빠뜨리면 ` +
          `extraResources는 경고만 하고 넘어가 「파이썬 없는 설치본」이 조용히 나간다`,
      ).toContain("stage-python");
    }
    // ⚠ **두 빌드 설정을 다 본다.** 라이트는 electron-builder.lite.json을 쓰므로, 메인에만 넣으면
    //   `dist:lite`가 파이썬을 꾸리고도 설치본엔 안 실린다 — 「꾸렸는데 안 나가는 반쪽」이다
    //   (이번에 실제로 그 상태였고, 검토 전에 잡았다).
    const 라이트 = JSON.parse(fs.readFileSync(path.join(서버루트, "..", "client", "electron-builder.lite.json"), "utf8")) as {
      win?: { extraResources?: { from: string; to: string }[] };
    };
    for (const [이름, 목록] of [
      ["client/package.json", pkg.build.win?.extraResources ?? []],
      ["electron-builder.lite.json", 라이트.win?.extraResources ?? []],
    ] as const) {
      expect(
        목록.some((r) => r.from.includes("python-dist") && r.to.includes("python")),
        `${이름}의 win.extraResources에 python-dist가 없다 — 꾸려도 설치본에 안 실린다`,
      ).toBe(true);
    }
    // ⚠ mac(top-level)이 아니라 **win 아래**여야 한다 — dmg에 Windows용 파이썬이 실리면 안 된다.
    const top = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { build: { extraResources?: { from: string }[] } }).build.extraResources ?? [];
    expect(
      top.some((r) => r.from.includes("python-dist")),
      "python-dist가 top-level extraResources에 있다 — mac dmg에도 Windows 파이썬이 실린다",
    ).toBe(false);
  });

  // ★ 후보 **순서**를 지킨다 — 리터럴이 「있기만 하면」 통과하는 감시는 거짓 초록이다
  //   (검토관 2026-08-22 [중]: 순서가 이 설계의 전부인데 그것을 보는 시험이 없었다).
  //   실제로 함수를 불러 순서를 잰다 — **가짜 동봉본을 지어 놓고** 둘이 다른 답을 내는지 본다.
  //   (소스 대조는 그 짝이다: 런타임은 「지금 이 기계에서 이렇게 고른다」를, 소스는 「의도가
  //    이렇게 적혀 있다」를 지킨다. 하나만 두면 리팩터 한 번에 감시가 죽는다.)
  it("문서 추출은 동봉본을 앞세우고, 장비·모델은 예전 순서를 지킨다", async () => {
    const { serverPython, resetPythonBinCache } = await import("../src/util/pythonbin");
    const 원래 = { root: process.env.GIJO_SERVER_ROOT, py: process.env.GIJO_PYTHON };
    try {
      // 동봉본이 있는 것처럼 꾸민 뿌리(실재하지 않으므로 existsSync에서 걸러진다) —
      // 여기서는 **후보가 다르게 만들어지는가**만 본다. 실행 가능한 것을 고르는 뒷단은 그대로다.
      delete process.env.GIJO_PYTHON;
      // ★ **진짜 동봉본을 하나 지어 놓고 잰다**(2026-08-22 재수리).
      //   ⚠ 예전 몸통은 없는 뿌리를 주고 `expect(docs).toBeTruthy()`만 했다. serverPython은
      //     어떤 경우에도 마지막에 "python3"을 돌려주므로 **구현이 어떻게 망가져도 통과**했다 —
      //     주석은 「함수를 불러 순서를 잰다」고 적어 놓고 실제로는 아무것도 안 재는 거짓 초록이었다.
      //     이 자리는 하루에 세 번 뒤집힌 곳이라, 안전망이 헛돌면 다음 사람이 검증받았다고 착각한다.
      const 가짜뿌리 = path.join(서버루트, "data", "test-tmp", `pybin-${process.pid}`);
      const 가짜동봉 = process.platform === "win32"
        ? path.join(가짜뿌리, "python", "python.exe")
        : path.join(가짜뿌리, "python", "bin", "python3");
      fs.mkdirSync(path.dirname(가짜동봉), { recursive: true });
      process.env.GIJO_SERVER_ROOT = 가짜뿌리;

      if (process.platform === "win32") {
        // 윈도우에서는 --version에 답하는 가짜 .exe를 만들 길이 없다. 그 환경에서는
        // 아래 소스 대조가 계약을 진다(우리 정식 시험 관문은 WSL이라 실측은 거기서 돈다).
        resetPythonBinCache();
        expect(serverPython("docs"), "고를 것이 없으면 마지막 폴백이라도 돌려줘야 한다").toBeTruthy();
      } else {
        fs.writeFileSync(가짜동봉, "#!/bin/sh\necho 'Python 3.12.0'\n");
        fs.chmodSync(가짜동봉, 0o755);
        resetPythonBinCache();
        const docs = serverPython("docs");
        resetPythonBinCache();
        const tools = serverPython("tools");
        // 이제 **다른 답이 나와야** 한다 — 같으면 용도 구분이 죽은 것이다.
        expect(docs, "문서 추출이 동봉본을 앞세우지 않는다 — 스캔 문서가 OCR 없는 파이썬으로 간다")
          .toBe(가짜동봉);
        expect(tools, "장비·모델이 동봉본을 앞세운다 — netmiko·modelscan이 없어 잘 되던 것이 죽는다")
          .not.toBe(가짜동봉);
      }
      fs.rmSync(가짜뿌리, { recursive: true, force: true });
    } finally {
      if (원래.root === undefined) delete process.env.GIJO_SERVER_ROOT; else process.env.GIJO_SERVER_ROOT = 원래.root;
      if (원래.py === undefined) delete process.env.GIJO_PYTHON; else process.env.GIJO_PYTHON = 원래.py;
      resetPythonBinCache();
    }
    // 소스 수준 계약 — **용도에 따라 갈린다**(2026-08-22 최종).
    //   · docs(문서 추출): 동봉본이 앞 — 한국어 OCR을 가진 **유일한** 파이썬이라서.
    //   · tools(장비·모델): 시스템이 앞 — 동봉본엔 netmiko·modelscan이 없어, 앞세우면
    //     그것을 깔아 둔 기계에서 **잘 되던 것이 죽는다**(검토관이 실제로 잡았던 회귀).
    //   ⚠ 이 자리는 하루에 세 번 뒤집혔다. 뒤집을 때마다 **근거가 실제로 바뀌었는지** 먼저 볼 것.
    const 제품 = fs.readFileSync(path.join(서버루트, "src", "util", "pythonbin.ts"), "utf8");
    expect(제품, "docs 갈래가 동봉본을 앞세우지 않는다 — 스캔 문서가 OCR 없는 파이썬으로 간다")
      .toMatch(/용도\s*===\s*"docs"[\s\S]{0,120}?동봉본,\s*"python3"/);
    expect(제품, "tools 갈래에서 동봉본이 시스템보다 앞에 있다 — 장비 접속·모델 검사가 죽는다")
      .toMatch(/else\s+후보\.push\("python3",\s*"python",\s*동봉본\)/);
    const 점검 = fs.readFileSync(path.join(서버루트, "scripts", "check-python-deps.mjs"), "utf8");
    expect(점검, "점검이 tools 순서를 안 쓴다 — requirements 전체를 보는데 동봉본을 앞세우면 거짓말을 한다")
      .toMatch(/후보\.push\("python3",\s*"python",\s*동봉본\)/);
  });

  it("스크립트 자리는 serverScript()가 고른다 — 상대경로 직접 호출이 없다", () => {
    // 패키징 설치본은 cwd(userData)와 스크립트가 있는 자리(resources/server-dist)가 다르다.
    // 상대경로로 부르면 파일을 못 찾아 조용히 죽는다 — 그래서 뿌리를 아는 한 곳을 거친다.
    const 위반: string[] = [];
    const 훑기 = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) 훑기(p);
        else if (e.name.endsWith(".ts")) {
          const src = fs.readFileSync(p, "utf8");
          if (p.includes("trainenv")) continue; // 학습 전용 — 고객 설치본 대상이 아니다
          for (const line of src.split(/\r?\n/)) {
            // execFile 인자로 "…​.py"를 serverScript() 없이 그대로 넘기는 줄
            if (/\[\s*"[A-Za-z0-9_\-/\\.]+\.py"/.test(line)) {
              위반.push(`${path.relative(서버루트, p)}: ${line.trim().slice(0, 90)}`);
            }
          }
        }
      }
    };
    훑기(path.join(서버루트, "src"));
    expect(
      위반,
      `스크립트를 상대경로로 직접 부르는 곳 ${위반.length}건 — 패키징 설치본에서 파일을 못 찾는다.\n` +
        `serverScript("scripts/…​.py")로 감쌀 것.\n${위반.join("\n")}`,
    ).toEqual([]);
  });
});

// ── 게시 스크립트 감시(2026-09-06) ──────────────────────────────────────────
//
// ■ 왜 생겼나 — **게시가 자기 세션을 반납하지 않았다**
//   client/scripts/publish-release.mjs는 `--force`로 로그인한다(계정당 1세션이라 남을 밀어낸다).
//   그런데 게시가 끝나도 로그아웃을 안 해서 그 세션이 서버에 **유휴 만료(30분)까지 유령으로**
//   남았다. 다음 게시·다음 측정은 「이미 다른 곳에서 로그인 중」을 만나 자기 자신을 또 강제로
//   밀어내야 하고, 그 강제는 감사 기록에도 남는다.
//   ⚠ 같은 결함을 UI 관문(tools/publish-gate-ui.mjs)에서 **2026-09-05에 이미 한 번 고쳤다**
//     (K5·K5-2). 게시 스크립트는 그때 같이 안 봤다 — 「세 번째면 소스 감시」라 여기 못 박는다.
//
// ■ 왜 소스 감시인가
//   진짜 게시를 돌려야만 드러나는 결함이라 일반 시험으로는 원리상 못 잡는다(게시는 직렬 자원이고
//   설치본 300MB를 올린다). 대신 **규약이 코드에 적혀 있는지**를 본다.
describe("★ 게시 스크립트 — 끝나면 세션을 반납한다", () => {
  const 게시경로 = path.join(서버루트, "..", "client", "scripts", "publish-release.mjs");

  it("publish-release.mjs가 logout을 부른다 — 헤더 + 본문 refreshToken 둘 다", () => {
    expect(fs.existsSync(게시경로), `게시 스크립트를 못 찾았다(${게시경로}) — 시험이 헛돈다`).toBe(true);
    const src = fs.readFileSync(게시경로, "utf8");

    const 부름 = src.indexOf("/api/auth/logout");
    expect(부름, "게시 스크립트가 로그아웃을 안 부른다 — --force로 잡은 세션이 30분 유령으로 남는다")
      .toBeGreaterThan(-1);

    // ★ 파일 **전체**에서 찾으면 안 된다 (2026-09-06 검토관 적발 · 실측으로 확인).
    //   `Authorization`은 릴리스 목록 조회(164행)·설치본 업로드(187행)에도 있고, `refreshToken`은
    //   바로 위 주석에도 있다. 그래서 파일 전체를 보는 잣대는 **logout에서 그 둘을 지워도 초록**이었다
    //   (돌연변이 2종으로 재현: body 줄 삭제·headers의 Authorization 삭제 → 4항목 전부 통과).
    //   즉 이번에 고친 바로 그 결함이 되돌아와도 못 잡는 감시였다.
    //   → **logout을 부르는 fetch 한 덩어리만** 떼어 본다. `JSON.stringify({ … }),`는 `});`가 아니므로
    //     첫 `});`가 그 fetch의 끝이다.
    const 끝 = src.indexOf("});", 부름);
    expect(끝, "logout fetch가 어디서 끝나는지 못 찾았다 — 잣대가 헛돈다(코드 꼴이 바뀌었으면 여기부터 고친다)")
      .toBeGreaterThan(부름);
    const 로그아웃호출 = src.slice(부름, 끝);

    // ⚠ 서버(server/src/auth/auth.ts:495)는 **본문의 refreshToken으로** 세션을 지운다.
    //   Authorization 헤더만 보내면 200 OK가 오는데 세션은 그대로 산다 — 「고쳤다」가 거짓이 되는 자리다.
    expect(로그아웃호출, "logout 본문에 refreshToken이 없다 — 서버는 헤더만으로 세션을 못 지운다(200 OK인데 안 풀림)")
      .toMatch(/body:[\s\S]*refreshToken/);
    expect(로그아웃호출, "로그인 응답의 refreshToken을 안 챙긴다 — 반납할 표가 없다")
      .toMatch(/login\.refreshToken/);
    expect(로그아웃호출, "logout에 Authorization 헤더가 없다 — authMiddleware가 401로 막는다")
      .toMatch(/Authorization/);
  });

  it("반납은 finally에 있다 — 게시가 실패해도 세션은 돌려준다", () => {
    const src = fs.readFileSync(게시경로, "utf8");
    const 자리 = src.indexOf("finally");
    expect(자리, "finally가 없다 — 게시가 중간에 죽으면 세션이 그대로 남는다").toBeGreaterThan(-1);

    // ⚠ 「logout 리터럴이 finally 뒤에 있나」로 보면 안 된다 — 반납 함수를 try **앞**에 정의하고
    //   finally에서 부르는 것이 정석인데(관문 publish-gate-ui.mjs 반납보장과 같은 꼴), 그 구조에서는
    //   순서가 뒤집혀 **좋은 코드가 빨개진다.** 그래서 finally가 **부르는 그 함수**를 따라가 본다.
    const 뒷부분 = src.slice(자리);
    const m = 뒷부분.match(/await\s+([A-Za-z0-9_가-힣$]+)\s*\(/);
    expect(m, "finally에서 아무것도 부르지 않는다 — 껍데기 finally다").toBeTruthy();
    const 이름 = m![1];
    const 정의 = src.indexOf(`const ${이름} =`);
    expect(정의, `finally가 부르는 ${이름}의 정의를 못 찾았다 — 감시가 헛돈다`).toBeGreaterThan(-1);
    expect(
      src.slice(정의, 정의 + 1500),
      `finally가 부르는 ${이름}이 로그아웃을 안 한다 — 성공 경로에서만 반납하면 게시가 죽는 날엔 유령이 남는다`,
    ).toContain("/api/auth/logout");
  });
});

// ── 클라 판 번호 감시(2026-09-06) ───────────────────────────────────────────
//
// ■ 무엇이 어긋나 있었나 (실측)
//   client/package.json = 5.91.0 인데 client/package-lock.json = **5.62.0**.
//   29판이 밀려 있었다. lock의 version은 npm이 `npm install` 때만 따라 쓰므로, 판을 올릴 때
//   package.json만 고치는 우리 관례에서는 **영원히 안 맞는다.**
// ■ 왜 문제인가
//   lock은 「이 판이 무엇으로 만들어졌나」를 적어 두는 자리다. 설치본을 받은 사람이 5.91.0의
//   의존성을 재현하려고 lock을 보면 5.62.0이라 적혀 있어 **어느 쪽을 믿을지 알 수 없다**
//   (「같은 것을 여러 곳에 적으면 어긋난다」의 표본).
//   ⚠ 처음엔 여기에 「공급망 점검·SBOM이 이 파일을 읽는다」고 적었는데 **거짓이었다**
//     (2026-09-06 검토관 적발, 실측: `grep -rn package-lock server/src` → 0건. SBOM 엔진 3종은
//     npm lock을 파싱하지 않는다). 실제 소비자는 **server**/package-lock 쪽뿐이다
//     — client/scripts/build-server-dist.mjs:40(복사) · tools/deploy-prod.ps1:53(변경 감지).
//     없는 소비자를 지어 두면 다음 사람이 그 말을 믿고 판단한다. 이유는 위 한 줄로 충분하다.
// ■ 판을 올릴 때 무엇을 하나 — .claude/commands/GIJOAS게시.md 1단계에 **두 자리 함께**라고 적어 뒀다.
//   ⚠ 이 시험은 tools/deploy-prod.ps1:58의 `npm test`(서버 배포 관문)이기도 하다. 여기가 빨가면
//     **무관한 서버 배포가 막힌다** — 게시 절차를 지키면 안 나지만, 났다면 원인은 딱 이것 하나다.
describe("★ 클라 판 번호 — package.json과 package-lock.json이 같다", () => {
  it("두 곳의 version이 어긋나지 않는다", () => {
    const 클라 = path.join(서버루트, "..", "client");
    const pkg = JSON.parse(fs.readFileSync(path.join(클라, "package.json"), "utf8")) as { version: string };
    const lockPath = path.join(클라, "package-lock.json");
    expect(fs.existsSync(lockPath), `package-lock.json이 없다(${lockPath}) — 사본에 안 실렸으면 시험이 헛돈다`).toBe(true);
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { version: string; packages: Record<string, { version?: string }> };

    expect(lock.version, `package-lock.json의 version이 낡았다(lock=${lock.version} · package.json=${pkg.version}) — 두 자리(루트 version · packages[""].version)를 손으로 맞춘다`)
      .toBe(pkg.version);
    // ⚠ lock에는 판 번호가 **두 자리** 있다. 하나만 고치면 npm이 다음 install에서 되돌린다.
    expect(lock.packages[""]?.version, `package-lock.json packages[""].version이 낡았다(${lock.packages[""]?.version}) — 루트만 고치면 반쪽이다`)
      .toBe(pkg.version);
  });
});
