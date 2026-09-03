// tools/ladder/ladderlib.mjs — 사다리 셸 스크립트가 쓰는 **판정 조각들**. 전부 순수 함수다.
//
// 왜 bash가 아니라 여기 있나: ①회차 이름표와 ②재료 허용 판정은 **틀리면 조용히 망하는** 종류다
//   (회차가 겹치면 앞 회차 결과가 덮여 사라지고, 허용이 헐거우면 고객 데이터가 학습에 샌다).
//   bash 안에 묻어 두면 시험을 못 붙인다 — 시험을 붙일 수 있는 자리로 꺼냈다.
// 부작용 없음: 이 파일을 import하는 것만으로는 아무 파일도 읽지 않는다(시험이 직접 부른다).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const 허용목록기본 = path.join(here, "allowed-sources.json");

// ── 회차 이름표 ─────────────────────────────────────────────────────────

/**
 * 다음 회차 이름표를 정한다. 예) ("취약점", ["취약점-01.json", "취약점-02.json"]) → "취약점-03"
 *
 * ⚠ 왜 필요한가: 증류 보고서 이름이 **시각 기반**(`distill-<주제>-<시각>.json`)이라 파일만 봐서는
 *   「이 주제를 이미 했나 · 몇 번째인가」를 못 가린다. 밤새 도는 사다리는 그 물음에 **파일로**
 *   답할 수 있어야 한다(사람이 로그를 뒤져 세면 그건 자동화가 아니다).
 * ⚠ 시각이 아니라 **번호**를 쓰는 이유: 시각은 다시 돌리면 달라져 「같은 회차를 두 번 돌렸나」를
 *   못 가린다. 번호는 디렉터리 상태만으로 결정적이다.
 */
export function 회차이름표(주제, 기존이름들 = []) {
  const 번호들 = 기존이름들.map((n) => 회차번호(n, 주제)).filter((n) => typeof n === "number");
  const 다음 = (번호들.length ? Math.max(...번호들) : 0) + 1;
  return `${주제}-${String(다음).padStart(2, "0")}`;
}

/** "취약점-03.json" → 3. 주제가 안 맞거나 꼴이 다르면 null(모른다 — 0으로 적지 않는다). */
export function 회차번호(파일명, 주제) {
  const 이름 = String(파일명 ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const 안전 = String(주제).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${안전}-(\\d+)(?:\\.[A-Za-z0-9]+)?$`).exec(이름);
  return m ? Number(m[1]) : null;
}

// ── 재료 허용 판정 ──────────────────────────────────────────────────────

/** allowed-sources.json을 읽는다(경로를 안 주면 이 폴더의 것). */
export function 허용목록읽기(경로 = 허용목록기본) {
  return JSON.parse(fs.readFileSync(경로, "utf8"));
}

/** docs-manifest.json의 files[]에서 경로만 뽑는다. 문자열이든 {file} 꼴이든 받는다(distill.mjs와 같은 규칙). */
export function 매니페스트파일들(매니페스트) {
  return (매니페스트?.files ?? [])
    .map((f) => (typeof f === "string" ? f : f?.file))
    .filter((p) => typeof p === "string" && p.length > 0);
}

/** 참조를 견줄 수 있는 꼴로 다듬는다: store: 접두사·#해시 꼬리·역슬래시를 없앤다. */
export function 참조정규화(참조) {
  let s = String(참조 ?? "").trim().replace(/\\/g, "/");
  if (s.startsWith("store:")) s = s.slice("store:".length);
  const h = s.lastIndexOf("#");
  if (h > 0) s = s.slice(0, h); // ref = <경로>#<sha12> — 꼬리는 본문 해시라 경로가 아니다
  return s;
}

/**
 * 이 참조를 학습 재료로 써도 되는가.
 *
 * @param 참조   "knowledge/보안용어.md" · "store:KISA_….md#2aed30e7f52b" · "~/bench/ladder/sources/nvd/CVE-….json"
 * @param 허용목록 allowed-sources.json 내용
 * @param 문맥   { 매니페스트파일들: string[] } — docs-manifest kind를 판정할 때 쓴다(파일은 부르는 쪽이 읽는다)
 * @returns { 허용:boolean, 규칙:string|null, 왜:string }
 */
export function 허용인가(참조, 허용목록, 문맥 = {}) {
  const s = 참조정규화(참조);
  if (!s) return { 허용: false, 규칙: null, 왜: "빈 참조" };

  // ⚠ 먼저 막는다 — 허용 폴더 안에서 밖으로 걸어 나가는 길(`sources/nvd/../../운영DB`)을 남기지 않는다.
  //   허용 규칙을 다 통과해도 이 검사가 앞이면 뚫리지 않는다.
  if (s.split("/").some((seg) => seg === "..")) return { 허용: false, 규칙: null, 왜: "경로에 '..'이 있다 — 허용 폴더 밖으로 나가는 길은 막는다" };

  const 조각 = s.split("/");
  const 이름 = 조각[조각.length - 1];
  const 매니페스트 = 문맥.매니페스트파일들 ?? [];

  for (const 규칙 of 허용목록?.허용 ?? []) {
    switch (규칙.kind) {
      case "docs-manifest": {
        // 매니페스트에 적힌 경로 그대로이거나, 그 파일 이름이면 허용(distill.mjs가 절대경로로 넘기기도 한다).
        const 맞음 = 매니페스트.some((p) => {
          const q = p.replace(/\\/g, "/");
          return s === q || s.endsWith("/" + q) || 이름 === (q.split("/").pop() ?? "");
        });
        if (맞음) return { 허용: true, 규칙: "docs-manifest", 왜: `docs-manifest files[]에 있는 문서(${이름})` };
        break;
      }
      case "이름앞머리":
        if (이름.startsWith(String(규칙.값))) return { 허용: true, 규칙: "이름앞머리", 왜: `우리가 쓴 문서(${규칙.값}…)` };
        break;
      case "폴더내확장자": {
        const 폴더 = String(규칙.값);
        const 확장 = String(규칙.확장자 ?? "");
        if (조각.includes(폴더) && 조각.indexOf(폴더) < 조각.length - 1 && 이름.endsWith(확장)) {
          return { 허용: true, 규칙: "폴더내확장자", 왜: `${폴더}/ 아래의 ${확장} 문서` };
        }
        break;
      }
      case "원천폴더": {
        const 이름들 = Array.isArray(규칙.값) ? 규칙.값.map(String) : [String(규칙.값)];
        const i = 조각.indexOf("sources");
        if (i >= 0 && i + 1 < 조각.length && 이름들.includes(조각[i + 1]) && i + 2 < 조각.length) {
          return { 허용: true, 규칙: "원천폴더", 왜: `공개 원천 sources/${조각[i + 1]}/ (RAG에는 넣지 않는다)` };
        }
        break;
      }
      case "재료폴더": {
        // 날것(sources/)을 .md로 구워 win으로 가져온 **학습 재료**. 접두를 못 박는 이유:
        //   server/data/ 는 운영 데이터가 사는 곳이라, 폴더 이름만 보고 열면 `server/data/kev`처럼
        //   아무 데나 만들어 통과시킬 수 있다. ladder/material 아래로만 문을 낸다.
        const 접두조각 = String(규칙.접두 ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
        const 이름들 = Array.isArray(규칙.값) ? 규칙.값.map(String) : [String(규칙.값)];
        if (!접두조각.length) break; // 접두 없는 재료폴더 규칙은 **열지 않는다**(오타로 문이 열리면 안 된다)
        // 절대경로로 넘어와도 잡히게, 접두 조각들이 **잇달아** 나오는 자리를 찾는다.
        let 시작 = -1;
        for (let i = 0; i + 접두조각.length <= 조각.length; i++) {
          if (접두조각.every((seg, k) => 조각[i + k] === seg)) { 시작 = i + 접두조각.length; break; }
        }
        if (시작 >= 0) {
          // 접두와 세트 폴더 사이에 회차 폴더(day1)가 끼어도 된다 — 날짜/회차는 나중에 늘어난다.
          const j = 조각.findIndex((seg, i) => i >= 시작 && 이름들.includes(seg));
          if (j >= 0 && j < 조각.length - 1) {
            return { 허용: true, 규칙: "재료폴더", 왜: `사다리 재료 ${조각[j]}/ (RAG에는 넣지 않는다)` };
          }
        }
        break;
      }
      default:
        // 모르는 kind는 **통과시키지 않는다** — 허용목록에 오타가 나면 조용히 열리는 것이 아니라 닫혀야 한다.
        break;
    }
  }
  return { 허용: false, 규칙: null, 왜: "허용목록의 어느 규칙에도 안 걸린다 — 재료가 아니다" };
}

/** 여러 참조를 한 번에 가른다 → { 허용:[], 거절:[{참조,왜}] } */
export function 재료가르기(참조들, 허용목록, 문맥 = {}) {
  const 허용 = [], 거절 = [];
  for (const r of 참조들 ?? []) {
    const v = 허용인가(r, 허용목록, 문맥);
    if (v.허용) 허용.push(r); else 거절.push({ 참조: r, 왜: v.왜 });
  }
  return { 허용, 거절 };
}

// ── 직접 실행 ───────────────────────────────────────────────────────────
// 셸 스크립트가 이 두 판정을 부른다. bash 안에 node -e 를 길게 박아 넣지 않으려고 창구를 여기 둔다
// (박아 두면 시험이 못 닿고, 따옴표 escape 하나에 밤새 도는 일이 죽는다).
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("ladder/ladderlib.mjs")) {
  const [명령, ...나머지] = process.argv.slice(2);
  const 쓰는법 = () => {
    console.error("쓰는 법:");
    console.error("  node tools/ladder/ladderlib.mjs label <주제> <디렉터리>   # 다음 회차 이름표를 찍는다");
    console.error("  node tools/ladder/ladderlib.mjs allow <참조> [참조…]      # 학습 재료로 써도 되는지 가른다");
    process.exit(2);
  };

  if (명령 === "label") {
    const [주제, 디렉터리] = 나머지;
    if (!주제 || !디렉터리) 쓰는법();
    const 있는것 = fs.existsSync(디렉터리) ? fs.readdirSync(디렉터리) : [];
    console.log(회차이름표(주제, 있는것));
    process.exit(0);
  }

  if (명령 === "allow") {
    if (!나머지.length) 쓰는법();
    const 목록 = 허용목록읽기();
    const 매니페스트경로 = path.resolve(here, "..", "..", "server", "docs-manifest.json");
    const files = fs.existsSync(매니페스트경로) ? 매니페스트파일들(JSON.parse(fs.readFileSync(매니페스트경로, "utf8"))) : [];
    let 나쁨 = 0;
    for (const r of 나머지) {
      const v = 허용인가(r, 목록, { 매니페스트파일들: files });
      if (!v.허용) 나쁨++;
      console.log(`${v.허용 ? "✅" : "❌"} ${r}  — ${v.왜}`);
    }
    process.exit(나쁨 ? 1 : 0);
  }

  쓰는법();
}
