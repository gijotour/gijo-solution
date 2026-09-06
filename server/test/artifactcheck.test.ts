// 게시 전 **빌드 산출물 대조**(client/scripts/lib/artifactcheck.mjs)의 짝 시험.
// (계획서 **전-4 정직한 구현** · 2026-09-07)
//
// ■ 왜 (2026-09-06 실사고)
//   `npm run dist`가 중간에 죽었는데 release/에 **273KB짜리 exe**가 남아 있었고, 그것을 완성본으로
//   오판했다. 게시 스크립트는 「파일이 있다」만 봤다 — 이 저장소가 반복해 밟은 「있다 ≠ 된다」다.
// ■ 왜 시험이 픽스처인가
//   진짜 게시는 직렬 자원(운영 4000·계정 1세션)이고 설치본이 260MB라 시험에서 돌릴 수 없다.
//   그래서 검사 함수를 순수 함수로 떼어 두고(artifactcheck.mjs), **임시 폴더의 작은 파일**로
//   ① 정상 ② 크기 불일치 ③ sha512 불일치 ④ blockmap 없음 네 갈래를 전부 재현한다.
// ■ 안 재는 것(정직 표시)
//   blockmap의 **조각별 checksum**은 검사 함수 자체가 대조하지 않는다 — 알고리즘을 실측으로
//   재현하지 못했다(artifactcheck.mjs 머리말). 모르는 채 대조하면 멀쩡한 빌드를 빨갛게 만든다.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
// @ts-expect-error — 게시 스크립트는 순수 .mjs다(클라 쪽 도구라 타입 선언을 두지 않는다).
import { 산출물검사, 게시노트정리, blockmap읽기, latestYml에서찾기 } from "../../client/scripts/lib/artifactcheck.mjs";

let 방: string;
const 바이트 = Buffer.from("GIJO AS 설치본 흉내 — 이 내용이 곧 크기다.".repeat(40), "utf8");

/** 조각 크기 합이 `합`이 되는 blockmap을 만든다(내용은 electron-builder와 같은 gzip JSON). */
function blockmap쓰기(경로: string, 합: number, 조각 = 4) {
  const sizes: number[] = [];
  let 남음 = 합;
  for (let i = 0; i < 조각 - 1; i++) { const n = Math.floor(합 / 조각); sizes.push(n); 남음 -= n; }
  sizes.push(남음);
  const json = { version: 2, files: [{ name: "file", offset: 0, checksums: sizes.map(() => "x"), sizes }] };
  fs.writeFileSync(경로, zlib.gzipSync(Buffer.from(JSON.stringify(json), "utf8")));
}

function 설치본만들기(이름: string, buf = 바이트) {
  const p = path.join(방, 이름);
  fs.writeFileSync(p, buf);
  return p;
}

beforeAll(() => { 방 = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-artifact-")); });
afterAll(() => { try { fs.rmSync(방, { recursive: true, force: true }); } catch { /* 지워지면 그만 */ } });

describe("빌드 산출물 대조 — 「쓰다 만 설치본」을 완성본으로 올리지 않는다 (전-4)", () => {
  it("★ ⓐ 정상 — blockmap 조각 합이 실제 크기와 같으면 통과한다", () => {
    const exe = 설치본만들기("정상 Setup 1.0.0.exe");
    blockmap쓰기(exe + ".blockmap", 바이트.length);
    const r = 산출물검사(exe);
    expect(r.문제, "멀쩡한 산출물을 빨갛게 만든다: " + JSON.stringify(r.문제)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.잰것.크기).toBe(바이트.length);
    expect(r.잰것.blockmap.합).toBe(바이트.length);
    // latest.yml이 없는 것은 우리 win/pro 빌드의 **정상**이다 — 그 사실을 잰 것에 남긴다.
    expect(r.잰것.latestYml).toEqual({ 있음: false });
  });

  it("★ ⓑ 크기 불일치 — 쓰다 만 exe는 **빨개진다**(2026-09-06 273KB 사고의 자리)", () => {
    const exe = 설치본만들기("반쪽 Setup 1.0.0.exe", 바이트.subarray(0, 273));
    blockmap쓰기(exe + ".blockmap", 바이트.length); // blockmap은 「다 만든 것」을 적어 뒀다
    const r = 산출물검사(exe);
    expect(r.ok, "273바이트짜리를 완성본으로 통과시켰다").toBe(false);
    expect(r.문제.join("\n")).toMatch(/크기가 blockmap이 적어 둔 값과 다릅니다/);
    expect(r.문제.join("\n"), "사람이 무엇을 할지 알 수 있어야 한다").toContain("npm run dist");
  });

  it("★ ⓒ sha512 불일치 — latest.yml이 적어 둔 값과 파일이 다르면 빨개진다", () => {
    const exe = 설치본만들기("어긋난 Setup 1.0.0.exe");
    blockmap쓰기(exe + ".blockmap", 바이트.length);
    const 남의sha = crypto.createHash("sha512").update("다른 내용").digest("base64");
    fs.writeFileSync(path.join(방, "latest.yml"),
      `version: 1.0.0\nfiles:\n  - url: 어긋난 Setup 1.0.0.exe\n    sha512: ${남의sha}\n    size: ${바이트.length}\n`, "utf8");
    const r = 산출물검사(exe);
    expect(r.ok, "매니페스트와 다른 파일을 올리려 한다").toBe(false);
    expect(r.문제.join("\n")).toMatch(/sha512와 실제 설치본이 다릅니다/);
    fs.rmSync(path.join(방, "latest.yml"));
  });

  it("ⓒ′ latest.yml이 **맞으면** 통과한다 — 대조가 헛빨강을 만들지 않는다", () => {
    const exe = 설치본만들기("맞는 Setup 1.0.0.exe");
    blockmap쓰기(exe + ".blockmap", 바이트.length);
    const 내sha = crypto.createHash("sha512").update(바이트).digest("base64");
    fs.writeFileSync(path.join(방, "latest.yml"),
      `version: 1.0.0\nfiles:\n  - url: 맞는 Setup 1.0.0.exe\n    sha512: ${내sha}\n    size: ${바이트.length}\npath: 맞는 Setup 1.0.0.exe\nsha512: ${내sha}\n`, "utf8");
    const r = 산출물검사(exe);
    expect(r.문제).toEqual([]);
    expect(r.잰것.latestYml.있음).toBe(true);
    fs.rmSync(path.join(방, "latest.yml"));
  });

  it("★ ⓓ blockmap 없음 — 빌드가 끝까지 안 갔다는 뜻이라 빨개진다", () => {
    const exe = 설치본만들기("맵없는 Setup 1.0.0.exe");
    const r = 산출물검사(exe);
    expect(r.ok).toBe(false);
    expect(r.문제.join("\n")).toContain(".blockmap이 없습니다");
    expect(r.문제.join("\n"), "왜 그것이 증거인지 말해야 한다").toContain("다 만든 뒤에");
  });

  it("ⓔ blockmap이 깨졌으면 「없음」과 갈라 말한다 — 원인이 다르면 할 일도 다르다", () => {
    const exe = 설치본만들기("깨진맵 Setup 1.0.0.exe");
    fs.writeFileSync(exe + ".blockmap", Buffer.from("이건 gzip이 아니다", "utf8"));
    const r = 산출물검사(exe);
    expect(r.ok).toBe(false);
    expect(r.문제.join("\n")).toContain("성하지 않습니다");
    expect(blockmap읽기(exe + ".blockmap").ok).toBe(false);
  });

  it("ⓕ 0바이트·없는 파일도 각각의 말로 멈춘다", () => {
    const 빈 = 설치본만들기("빈 Setup 1.0.0.exe", Buffer.alloc(0));
    expect(산출물검사(빈).문제.join("\n")).toContain("0바이트");
    expect(산출물검사(path.join(방, "없는 Setup.exe")).문제.join("\n")).toContain("설치본이 없습니다");
  });

  it("ⓖ latest.yml에 **다른 판**만 적혀 있으면 남은 매니페스트라고 말한다", () => {
    const exe = 설치본만들기("혼자 Setup 2.0.0.exe");
    blockmap쓰기(exe + ".blockmap", 바이트.length);
    fs.writeFileSync(path.join(방, "latest.yml"),
      "version: 1.0.0\nfiles:\n  - url: 남의 Setup 1.0.0.exe\n    sha512: zzz\n    size: 1\n", "utf8");
    const r = 산출물검사(exe);
    expect(r.ok).toBe(false);
    expect(r.문제.join("\n")).toContain("다른 판의 매니페스트가 남아 있습니다");
    fs.rmSync(path.join(방, "latest.yml"));
  });

  it("ⓗ latest.yml 읽기 — 따옴표와 공백 있는 이름을 그대로 찾는다", () => {
    const 글 = "version: 5.91.1\nfiles:\n  - url: 'GIJO AS Setup 5.91.1.exe'\n    sha512: AAA==\n    size: 12345\n";
    expect(latestYml에서찾기(글, "GIJO AS Setup 5.91.1.exe")).toEqual({ sha512: "AAA==", size: 12345 });
    expect(latestYml에서찾기(글, "GIJO AS Setup 5.90.0.exe")).toBeNull();
  });
});

describe("게시 노트 — 판 번호를 두 번 말하지 않는다 (2026-09-07)", () => {
  // ⚠ 화면은 version과 notes를 **나란히** 그린다(settings.html:394·398 업데이트 판 ·
  //   2435-2436 「게시된 배포판」 표의 `버전 | 메모` 두 칸). 노트가 판 번호로 시작하면 두 번 찍힌다.
  it("★ 자기 판 번호 접두는 뗀다 — 구분자(— · - · :)까지 함께", () => {
    expect(게시노트정리("5.91.1 — 감독 ✂ 사유 토글", "5.91.1")).toEqual({ notes: "감독 ✂ 사유 토글", 다듬음: true });
    expect(게시노트정리("v5.91.1 - 수정", "5.91.1").notes).toBe("수정");
    expect(게시노트정리("5.91.1: 수정", "5.91.1").notes).toBe("수정");
    expect(게시노트정리("5.91.1 수정", "5.91.1").notes).toBe("수정");
  });

  it("★ **남의 판 번호는 안 뗀다** — 「5.90.0 되돌림」은 정보다", () => {
    expect(게시노트정리("5.90.0 되돌림", "5.91.1")).toEqual({ notes: "5.90.0 되돌림", 다듬음: false });
  });

  it("★ 경계 — 5.91.10은 5.91.1이 아니다(숫자·점이 이어지면 다른 번호)", () => {
    expect(게시노트정리("5.91.10 기능", "5.91.1").다듬음).toBe(false);
  });

  it("노트가 판 번호 하나뿐이면 그대로 둔다 — 떼면 빈 메모가 된다", () => {
    expect(게시노트정리("5.91.1", "5.91.1")).toEqual({ notes: "5.91.1", 다듬음: false });
    expect(게시노트정리("", "5.91.1").다듬음).toBe(false);
  });

  it("게시 스크립트가 이 두 함수를 **실제로 부른다**(소스 감시)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../client/scripts/publish-release.mjs"), "utf8");
    expect(src, "산출물 대조를 안 부른다").toMatch(/산출물검사\(installerPath\)/);
    expect(src, "대조가 실패해도 그냥 올린다").toMatch(/if \(!산출물\.ok\)[\s\S]{0,120}throw new Error/);
    expect(src, "노트 정리를 안 부른다").toMatch(/게시노트정리\(notes원본, version\)/);
    // 로그인 **앞에서** 멈춰야 --force 세션을 잡을 일이 없다.
    expect(src.indexOf("산출물검사(installerPath)"), "산출물 대조가 로그인 뒤에 있다 — 헛되이 남의 세션을 밀어낸다")
      .toBeLessThan(src.indexOf("/api/auth/login"));
  });
});
