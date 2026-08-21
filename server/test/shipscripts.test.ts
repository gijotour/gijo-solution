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
import { describe, it, expect } from "vitest";

const 서버루트 = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
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
