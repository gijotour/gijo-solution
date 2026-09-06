// client/scripts/lib/artifactcheck.mjs
// **업로드 전에 빌드 산출물을 대조한다** — 「쓰다 만 설치본」을 완성본으로 오판하지 않으려고.
//
// ■ 왜 생겼나 (2026-09-06 실사고)
//   `npm run dist`가 중간에 죽었는데 `release/`에는 **273KB짜리 exe**가 남아 있었다. 게시 스크립트는
//   「파일이 있다」만 보고 그것을 올릴 준비를 했다. 파일 존재는 완성의 증거가 아니다 —
//   이 저장소가 반복해 밟은 「있다 ≠ 된다」다(백업 복원·requirements·npm allow-scripts와 같은 부류).
//
// ■ 무엇을 잣대로 삼나 — **electron-builder가 스스로 적어 둔 값**
//   ① `<설치본>.exe.blockmap` — 차등 업데이트용 조각 지도(gzip JSON). 설치본을 다 만든 **뒤에**
//      쓰이므로, 없다는 것은 곧 「빌드가 끝까지 안 갔다」는 뜻이다.
//   ② 그 blockmap 안의 조각 크기 **합** = 설치본의 실제 바이트 수여야 한다.
//      실측(2026-09-07 · GIJO AS Setup 5.91.1.exe): 조각 12,386개 · 합 259,551,569 = 파일 크기와 **정확히 일치**.
//      273KB짜리 반쪽 파일은 이 한 줄에서 걸린다(합은 260MB, 파일은 0.26MB).
//   ③ `latest.yml`(같은 폴더) — electron-builder의 배포 매니페스트. `size`·`sha512`가 적혀 있다.
//      ⚠ **정직 표시**: 이 저장소의 win/pro 빌드에는 latest.yml이 **없다**(2026-09-07 실측 —
//        `client/release/`에 .exe와 .blockmap뿐). electron-builder는 `publish` 설정이 있을 때만
//        이 파일을 쓰는데 우리는 서버가 배포처라 그 설정이 없다. 그래서 ③은 **있을 때만** 판정한다
//        — 지금은 실빌드에서 안 돌고, 짝 시험(server/test/artifactcheck.test.ts)이 픽스처로 판정한다.
//        없는 것을 있다고 우기지 않는다.
//
// ■ 안 재는 것 (거짓 안심을 만들지 않으려고 적는다)
//   blockmap의 **조각별 checksum**은 대조하지 않는다. 실측으로 재현이 안 됐다(2026-09-07:
//   sha256/sha512/sha1/md5/blake2를 18바이트 절단·base64로 맞춰 보고, 오프셋 0~300KB를 1바이트씩
//   밀며 훑어도 첫 조각 값 `2fjFvYu4NwqCJebiYTv0Jgsl`을 못 만들었다). 알고리즘을 모르는 채 대조하면
//   **멀쩡한 빌드를 빨갛게 만든다** — 그래서 안 한다. 내용 훼손은 ②(크기)와 ③(sha512)이 맡는다.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";

/**
 * `<설치본>.blockmap`을 읽어 조각 크기 합을 낸다.
 * @returns {{ok: boolean, 왜: string|null, 합: number, 조각수: number}}
 */
export function blockmap읽기(blockmap경로) {
  if (!fs.existsSync(blockmap경로)) {
    return { ok: false, 왜: "없음", 합: 0, 조각수: 0 };
  }
  let json;
  try {
    // electron-builder는 gzip으로 쓴다. 혹시 다른 판이 raw deflate를 쓰면 그것도 받아 준다.
    let 글;
    const raw = fs.readFileSync(blockmap경로);
    try { 글 = zlib.gunzipSync(raw).toString("utf8"); }
    catch { 글 = zlib.inflateSync(raw).toString("utf8"); }
    json = JSON.parse(글);
  } catch (e) {
    return { ok: false, 왜: `읽지 못함(${e.message})`, 합: 0, 조각수: 0 };
  }
  const files = Array.isArray(json?.files) ? json.files : null;
  if (!files || !files.length) {
    return { ok: false, 왜: "files 목록이 없음", 합: 0, 조각수: 0 };
  }
  let 합 = 0, 조각수 = 0;
  for (const f of files) {
    if (!Array.isArray(f?.sizes)) return { ok: false, 왜: "조각 크기(sizes) 목록이 없음", 합: 0, 조각수: 0 };
    for (const n of f.sizes) {
      const v = Number(n);
      if (!Number.isFinite(v) || v < 0) return { ok: false, 왜: "조각 크기에 숫자가 아닌 값이 있음", 합: 0, 조각수: 0 };
      합 += v; 조각수 += 1;
    }
  }
  return { ok: true, 왜: null, 합, 조각수 };
}

/**
 * latest.yml에서 **이 설치본에 해당하는 줄만** 뽑는다.
 * ⚠ 일반 YAML 파서를 넣지 않는다 — 게시 스크립트에 의존성을 더하면 설치본·에어갭 배포까지 따라온다.
 *   electron-builder가 쓰는 꼴은 고정돼 있으니 그 꼴만 읽는다:
 *     files:
 *       - url: GIJO AS Setup 5.91.1.exe
 *         sha512: <base64>
 *         size: 259551569
 *     path: GIJO AS Setup 5.91.1.exe
 *     sha512: <base64>
 * @returns {{sha512: string|null, size: number|null}|null}  못 찾으면 null
 */
export function latestYml에서찾기(글, 설치본이름) {
  const 줄들 = String(글 ?? "").split(/\r?\n/);
  // ① files: 목록의 항목 — url이 이 파일인 덩어리에서 sha512·size를 모은다.
  let 안 = false, sha512 = null, size = null;
  for (const 줄 of 줄들) {
    const url = /^\s*-?\s*url:\s*(.+?)\s*$/.exec(줄);
    if (url) { 안 = 이름같나(벗기기(url[1]), 설치본이름); continue; }
    if (!안) continue;
    const s = /^\s*sha512:\s*(.+?)\s*$/.exec(줄);
    if (s) { sha512 = 벗기기(s[1]); continue; }
    const z = /^\s*size:\s*(\d+)\s*$/.exec(줄);
    if (z) { size = Number(z[1]); continue; }
  }
  if (sha512 || size != null) return { sha512, size };

  // ② files:가 없는 옛 꼴 — 최상위 path:/sha512:를 본다(size는 이 꼴에 없을 수 있다).
  const 최상위경로 = 줄들.find((l) => /^path:\s*/.test(l));
  if (최상위경로 && 이름같나(벗기기(최상위경로.replace(/^path:\s*/, "")), 설치본이름)) {
    const s = 줄들.find((l) => /^sha512:\s*/.test(l));
    const z = 줄들.find((l) => /^size:\s*/.test(l));
    return {
      sha512: s ? 벗기기(s.replace(/^sha512:\s*/, "")) : null,
      size: z ? Number(z.replace(/^size:\s*/, "").trim()) : null,
    };
  }
  return null;
}

/**
 * 매니페스트에 적힌 이름과 디스크의 파일 이름이 **같은 물건**인가.
 *
 * ⚠ 왜 글자 그대로만 비교하면 안 되나 (2026-09-07 검토관 적발 · 실독으로 확인)
 *   electron-builder는 publish provider가 github이면 매니페스트의 `url`·`path`를
 *   **safeArtifactName**으로 갈아끼운다(app-builder-lib/out/publish/updateInfoBuilder.js:100-107).
 *   그 이름은 「GitHub이 허용하는 글자만 남긴 것」이고, 공백만 문제일 때는 공백을 `-`로 바꾼다:
 *     platformPackager.js:566  isSafeGithubName = /^[0-9A-Za-z._-]+$/
 *     platformPackager.js:577  suggestedName.replace(/ /g, "-")
 *   그래서 디스크의 「GIJO AS Setup 5.91.1.exe」가 매니페스트에는
 *   「GIJO-AS-Setup-5.91.1.exe」로 적힌다 — **같은 물건인데 글자가 다르다.**
 *   글자만 대조하면 멀쩡한 빌드를 「다른 판의 매니페스트」로 몰아 **게시를 막는다**.
 *   검사기가 제품을 막는 것은 검사기가 없는 것보다 나쁘다(사람이 검사를 통째로 꺼 버린다).
 * ⚠ 그렇다고 아무 이름이나 같다고 하지 않는다 — 공백↔`-` 한 갈래만 같게 본다.
 *   판 번호가 다르면 여전히 남남이다.
 * ⚠ 안 되는 갈래(정직 표시): 공백 말고 다른 글자까지 걸리면 electron-builder는
 *   `${name}-${version}-${arch}.${ext}` 꼴을 **새로 지어낸다**(computeSafeArtifactNameIfNeeded의
 *   마지막 줄). 그 이름은 여기서 되살릴 수 없다 — 그때는 못 찾은 것으로 두고, 아래 ③이
 *   「매니페스트에 적힌 이름들」을 함께 보여 사람이 판단하게 한다.
 */
function 이름같나(적힌이름, 설치본이름) {
  const a = String(적힌이름 ?? ""), b = String(설치본이름 ?? "");
  if (a === b) return true;
  const 안전 = (s) => (/^[0-9A-Za-z._-]+$/.test(s) ? s : s.replace(/ /g, "-"));
  return a === 안전(b);
}

/** 매니페스트가 **실제로 무슨 이름을 적어 두었나** — 못 찾았을 때 사람에게 보여 준다. */
function 적힌이름들(글) {
  const 목록 = [];
  for (const 줄 of String(글 ?? "").split(/\r?\n/)) {
    const m = /^\s*-?\s*(?:url|path):\s*(.+?)\s*$/.exec(줄);
    if (!m) continue;
    const v = 벗기기(m[1]);
    if (v && !목록.includes(v)) 목록.push(v);
  }
  return 목록;
}

/** YAML의 따옴표를 벗긴다(electron-builder는 공백 있는 이름을 따옴표로 감싼다). */
function 벗기기(s) {
  const t = String(s ?? "").trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

/**
 * 게시 노트에서 **자기 판 번호 접두**를 뗀다.
 *
 * ⚠ 왜: `.claude/commands/GIJOAS게시.md`가 `--notes "<버전 - 변경 요약>"`이라 안내해 노트가
 *   「5.91.1 — …」로 시작한다. 그런데 서버는 version을 **따로** 준다. 설정 화면의
 *   「게시된 배포판」 표는 `버전 | 메모` 두 칸을 나란히 그리므로(settings.html:2435-2436)
 *   화면에 「5.91.1  5.91.1 — …」로 **판 번호가 두 번** 나온다. 업데이트 판도 마찬가지로
 *   `버전 5.91.1` 아래에 「5.91.1 — …」가 또 뜬다(settings.html:394·398).
 * ⚠ 화면이 아니라 **스크립트**를 고친다 — 화면 변경은 게시 범위(시안 → 승인)라, 지금 고칠 수 있는
 *   자리는 「같은 말을 두 번 보내지 않는 것」뿐이다. 원천에서 한 번만 말하게 한다.
 * ⚠ **다른 판 번호는 안 뗀다** — 「5.90.0 되돌림」처럼 남의 번호는 정보다.
 *   그리고 노트가 판 번호 하나뿐이면 그대로 둔다(떼면 빈 메모가 된다).
 * @returns {{notes: string, 다듬음: boolean}}
 */
export function 게시노트정리(notes, version) {
  const 원본 = String(notes ?? "");
  const v = String(version ?? "").trim();
  if (!원본.trim() || !v) return { notes: 원본, 다듬음: false };
  const 이스케이프 = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 판 번호 뒤에 숫자·점이 이어지면 **다른 번호**다(5.91.1 ≠ 5.91.10) — 경계를 본다.
  const re = new RegExp("^\\s*v?" + 이스케이프 + "(?![0-9.])\\s*[—–\\-:·]?\\s*");
  const 남은 = 원본.replace(re, "");
  if (남은 === 원본) return { notes: 원본, 다듬음: false };
  if (!남은.trim()) return { notes: 원본, 다듬음: false }; // 번호만 있던 노트 — 떼면 빈칸이 된다
  return { notes: 남은, 다듬음: true };
}

/**
 * **빌드 산출물 대조** — 올려도 되는 물건인지 본다. 아무것도 고치지 않는다(읽기만).
 * @param {string} 설치본경로
 * @param {{버퍼?: Buffer, latestYml?: string}} [opt]
 *   버퍼 — 이미 읽어 둔 설치본 바이트(260MB를 두 번 안 읽으려고). 없으면 크기는 statSync로만 잰다.
 *   latestYml — 매니페스트 경로를 직접 줄 때(기본은 설치본과 같은 폴더의 latest.yml).
 * @returns {{ok: boolean, 문제: string[], 잰것: Record<string, unknown>}}
 */
export function 산출물검사(설치본경로, opt = {}) {
  const 문제 = [];
  const 잰것 = { 설치본: 설치본경로 };

  if (!fs.existsSync(설치본경로)) {
    문제.push(`설치본이 없습니다: ${설치본경로}`);
    return { ok: false, 문제, 잰것 };
  }
  const 크기 = opt.버퍼 ? opt.버퍼.length : fs.statSync(설치본경로).size;
  잰것.크기 = 크기;
  if (크기 === 0) {
    문제.push("설치본이 0바이트입니다 — 빌드가 끝까지 가지 않았습니다.");
    return { ok: false, 문제, 잰것 };
  }

  // ── ① .blockmap 존재 ────────────────────────────────────────────────────────
  const blockmap경로 = 설치본경로 + ".blockmap";
  const bm = blockmap읽기(blockmap경로);
  잰것.blockmap = bm.ok ? { 합: bm.합, 조각수: bm.조각수 } : { 왜: bm.왜 };
  if (!bm.ok) {
    문제.push(
      `설치본 옆에 .blockmap이 ${bm.왜 === "없음" ? "없습니다" : "성하지 않습니다(" + bm.왜 + ")"} — ` +
      `${path.basename(blockmap경로)}.\n` +
      `  electron-builder는 설치본을 **다 만든 뒤에** 이 파일을 씁니다. 없다는 것은 빌드가 끝까지 안 갔다는 뜻입니다.\n` +
      `  → client에서 npm run dist를 다시 돌리고, 로그 끝까지 오류가 없는지 보세요.`,
    );
  } else if (bm.합 !== 크기) {
    // ── ② 조각 크기 합 = 실제 크기 ────────────────────────────────────────────
    문제.push(
      `설치본 크기가 blockmap이 적어 둔 값과 다릅니다 — 쓰다 만 파일입니다.\n` +
      `  blockmap: ${bm.합.toLocaleString()}바이트(조각 ${bm.조각수.toLocaleString()}개)\n` +
      `  실제 파일: ${크기.toLocaleString()}바이트 (차이 ${(크기 - bm.합).toLocaleString()})\n` +
      `  → npm run dist를 다시 돌리세요. 이대로 올리면 받은 사람의 설치가 깨집니다.`,
    );
  }

  // ── ③ latest.yml(있을 때만) ────────────────────────────────────────────────
  const 폴더 = path.dirname(설치본경로);
  const 이름 = path.basename(설치본경로);
  const yml경로 = opt.latestYml ?? path.join(폴더, "latest.yml");
  if (fs.existsSync(yml경로)) {
    const ymlGlobal = fs.readFileSync(yml경로, "utf8");
    const 적힌것 = latestYml에서찾기(ymlGlobal, 이름);
    if (!적힌것) {
      const 이름들 = 적힌이름들(ymlGlobal);
      잰것.latestYml = { 있음: true, 이설치본: "안 적혀 있음", 적힌이름들: 이름들 };
      // ⚠ 「다른 판이다」라고 **단정하지 않는다** — 이름 꼴이 달라서일 수도 있다(safeArtifactName).
      //   단정하면 사람이 멀쩡한 빌드를 지우러 간다. 무엇이 적혀 있는지 보여 주고 판단하게 한다.
      문제.push(
        `latest.yml에 이 설치본(${이름})이 안 적혀 있습니다.\n` +
        `  매니페스트에 적힌 이름: ${이름들.length ? 이름들.join(" · ") : "(없음)"}\n` +
        `  판 번호가 다르면 지난 판의 매니페스트가 남은 것입니다 — ${yml경로}를 지우고 npm run dist를 다시 돌리세요.\n` +
        `  판 번호는 같은데 이름 꼴만 다르면(공백↔-) artifactcheck.mjs의 이름같나()를 넓혀야 합니다.`,
      );
    } else {
      잰것.latestYml = { 있음: true, size: 적힌것.size, sha512앞: (적힌것.sha512 ?? "").slice(0, 12) };
      if (적힌것.size != null && 적힌것.size !== 크기) {
        문제.push(
          `latest.yml의 size와 실제 설치본 크기가 다릅니다.\n` +
          `  latest.yml: ${적힌것.size.toLocaleString()}바이트 / 실제: ${크기.toLocaleString()}바이트`,
        );
      }
      if (적힌것.sha512) {
        const 실제sha512 = crypto.createHash("sha512")
          .update(opt.버퍼 ?? fs.readFileSync(설치본경로)).digest("base64");
        잰것.실제sha512앞 = 실제sha512.slice(0, 12);
        if (실제sha512 !== 적힌것.sha512) {
          문제.push(
            `latest.yml의 sha512와 실제 설치본이 다릅니다 — 매니페스트를 쓴 뒤에 파일이 바뀌었습니다.\n` +
            `  latest.yml: ${적힌것.sha512.slice(0, 16)}…\n` +
            `  실제 파일  : ${실제sha512.slice(0, 16)}…`,
          );
        }
      }
    }
  } else {
    // 정직 표시 — 이 갈래는 win/pro 빌드에서 **늘** 여기로 온다(publish 설정이 없어 파일 자체가 없다).
    잰것.latestYml = { 있음: false };
  }

  return { ok: 문제.length === 0, 문제, 잰것 };
}
