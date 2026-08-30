// 📂 지켜보는 폴더 (2026-08-31 사장님 「내 문서 — 위키처럼 특정 디렉토리 지정해서 계속 확인」)
// 내 문서 2단계 · 계획서 전-7 계보. 설계관 청사진(2026-08-31)의 급소를 값으로 지킨다:
//   2단 스킵(stat→해시) 멱등 · basename 충돌=전부 skip · 남의 문서 보호 · 경로 검증(자기
//   되먹임·시스템 거부) · WSL 경로 변환 · 스캔파일 후보는 인입 안 함(원장 보호) · 배선 짝.
// ⚠ autoRouteUpload는 모킹한다 — 이 시험의 대상은 「무엇을 언제 부르나」(스킵·충돌·보호
//   판정)이지 추출·임베딩이 아니다(그쪽은 autoupload 시험 몫).
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../src/engine/autoupload", () => ({
  autoRouteUpload: vi.fn(async (filename: string) => ({ filename, routedTo: "memory", reason: "시험 모킹" })),
}));

import { autoRouteUpload } from "../src/engine/autoupload";
import { db } from "../src/db";
import {
  addWatchFolder, removeWatchFolder, listWatchFolders, scanWatchFolder,
  resetWatchFoldersForTests, 경로검증, 서버경로로, watchFolderText, watchFolderDocCount,
} from "../src/engine/watchfolder";

const 부른횟수 = () => (autoRouteUpload as ReturnType<typeof vi.fn>).mock.calls.length;

function 임시폴더(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gijo-watch-"));
}

beforeEach(() => {
  resetWatchFoldersForTests();
  vi.clearAllMocks();
  db.prepare("DELETE FROM memory_documents WHERE documentId LIKE 'watchtest-%'").run();
});

describe("경로 검증 — 서버 기계의 폴더만, 자기 되먹임·시스템 거부", () => {
  it("없는 경로·파일·루트를 거부하고 사유를 한글로 말한다", () => {
    const 없음 = 경로검증(path.join(os.tmpdir(), "gijo-없는폴더-" + Date.now()));
    expect(없음.ok).toBe(false);
    if (!없음.ok) expect(없음.error).toContain("서버 기계");
    const dir = 임시폴더();
    const file = path.join(dir, "한장.txt");
    fs.writeFileSync(file, "문서 하나");
    const 파일 = 경로검증(file);
    expect(파일.ok).toBe(false);
    if (!파일.ok) expect(파일.error).toContain("폴더가 아니라");
    expect(경로검증("/").ok).toBe(false);
  });
  it("제품 자신의 data/·서버 뿌리를 거부한다 — 추출본 재인입 순환(설계관 ④-2)", () => {
    const d = 경로검증(path.resolve("data"));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toContain("순환");
    expect(경로검증(path.resolve(".")).ok).toBe(false);
  });
  it("WSL 변환 — 리눅스에서 D:\\… 를 /mnt/d/…로(판정은 watchfolder 한 곳)", () => {
    if (process.platform === "linux") {
      expect(서버경로로("D:\\보안팀\\스캔결과")).toBe("/mnt/d/보안팀/스캔결과");
      expect(서버경로로("c:/temp/docs")).toBe("/mnt/c/temp/docs");
    } else {
      expect(서버경로로("D:\\보안팀")).toBe("D:\\보안팀");
    }
    expect(서버경로로("/home/user/docs")).toBe("/home/user/docs");
  });
});

describe("등록·해제·목록", () => {
  it("등록하면 목록에 나오고, 같은 경로 재등록은 거절, 해제하면 사라진다", () => {
    const dir = 임시폴더();
    const r = addWatchFolder({ path: dir, label: "시험 폴더", userId: "u-1", userName: "시험자" });
    expect(r.ok).toBe(true);
    expect(listWatchFolders().length).toBe(1);
    const 중복 = addWatchFolder({ path: dir, userId: "u-1" });
    expect(중복.ok).toBe(false);
    if (!중복.ok) expect(중복.error).toContain("이미");
    if (r.ok) expect(removeWatchFolder(String(r.folder.id))).not.toBeNull();
    expect(listWatchFolders().length).toBe(0);
  });
  it("빈 목록 안내가 서버 기계·대화창 지정을 말한다(도구가 그대로 사람에게 보인다)", () => {
    const t = watchFolderText();
    expect(t).toContain("지켜보는 폴더가 없습니다");
    expect(t).toContain("서버 기계");
    expect(t).toContain("지켜봐 줘");
  });
});

describe("스캔 — 2단 스킵 멱등·충돌 skip·남의 문서 보호·스캔파일 원장 보호", () => {
  it("새 문서는 문서 갈래 고정으로 인입되고, 재스캔은 stat 스킵으로 한 번도 더 안 부른다", async () => {
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "watchtest-a.txt"), "보안 점검 절차 문서입니다. 내용이 충분히 길다.");
    const r = addWatchFolder({ path: dir, userId: "u-1", userName: "시험자" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s1 = await scanWatchFolder(r.folder);
    expect(s1.새로).toBe(1);
    expect(부른횟수()).toBe(1);
    const call = (autoRouteUpload as ReturnType<typeof vi.fn>).mock.calls[0];
    // 위치 인자 계약(설계관 ① — 2인자로 부르면 label 자리에 객체가 들어간다 부류의 예방):
    // (filename, base64, forceType="document", productName=undefined, uploadedBy, {keepOriginal:false})
    expect(call[0]).toBe("watchtest-a.txt");
    expect(call[2]).toBe("document"); // ★ 판별 생략 — 스캔 갈래로 새어 원장을 바꾸는 길 봉쇄
    expect(call[4]).toBe("시험자");
    expect(call[5]).toEqual({ keepOriginal: false });
    const s2 = await scanWatchFolder(listWatchFolders()[0]);
    expect(s2.새로).toBe(0);
    expect(s2.건너뜀).toBeGreaterThanOrEqual(1);
    expect(부른횟수()).toBe(1); // 멱등 — 안 변했으면 손도 안 댄다
  });
  it("mtime만 바뀌고 내용이 같으면 해시 스킵, 내용이 바뀌면 다시 인입한다", async () => {
    const dir = 임시폴더();
    const f = path.join(dir, "watchtest-b.txt");
    fs.writeFileSync(f, "처음 내용 — 충분히 긴 문서 본문.");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    await scanWatchFolder(r.folder);
    expect(부른횟수()).toBe(1);
    const 미래 = new Date(Date.now() + 5000);
    fs.utimesSync(f, 미래, 미래); // 내용 그대로, 시각만
    await scanWatchFolder(listWatchFolders()[0]);
    expect(부른횟수()).toBe(1); // 해시가 같아 재인입 없음
    fs.writeFileSync(f, "바뀐 내용 — 두 번째 판. 충분히 긴 본문.");
    const 더미래 = new Date(Date.now() + 10000);
    fs.utimesSync(f, 더미래, 더미래);
    await scanWatchFolder(listWatchFolders()[0]);
    expect(부른횟수()).toBe(2);
  });
  it("같은 이름이 두 하위폴더에 있으면 **둘 다** 건너뛰고 보고한다 — 번갈아 덮는 순환 방지", async () => {
    const dir = 임시폴더();
    fs.mkdirSync(path.join(dir, "s1"));
    fs.mkdirSync(path.join(dir, "s2"));
    fs.writeFileSync(path.join(dir, "s1", "watchtest-c.txt"), "첫 사본 본문입니다.");
    fs.writeFileSync(path.join(dir, "s2", "watchtest-c.txt"), "둘째 사본 본문입니다.");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    const s = await scanWatchFolder(r.folder);
    expect(부른횟수()).toBe(0);
    expect(s.충돌.length).toBeGreaterThanOrEqual(1);
    expect(s.충돌[0]).toContain("watchtest-c.txt");
  });
  it("이미 있는 문서(다른 출처)와 이름이 같으면 덮지 않는다 — 남의 문서 보호", async () => {
    db.prepare("INSERT OR REPLACE INTO memory_documents (documentId, scope, chunks, ingestedAt) VALUES (?, 'global', 3, ?)")
      .run("watchtest-d.txt", new Date().toISOString());
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "watchtest-d.txt"), "폴더 쪽 같은 이름 문서.");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    const s = await scanWatchFolder(r.folder);
    expect(부른횟수()).toBe(0);
    expect(s.충돌.some((c) => c.includes("다른 출처"))).toBe(true);
  });
  it("스캔 파일 후보(csv·xml·nessus)는 인입하지 않고 발견만 보고한다 — 원장 보호(설계관 v1)", async () => {
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "watchtest-scan.csv"), "host,cve\n10.0.0.1,CVE-2024-0001");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    const s = await scanWatchFolder(r.folder);
    expect(부른횟수()).toBe(0);
    expect(s.스캔후보.length).toBe(1);
  });
  it("인입 문서 수는 doc 지도에서 센다(표를 안 늘린다)", async () => {
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "watchtest-e.txt"), "문서 수 세기용 본문입니다.");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    await scanWatchFolder(r.folder);
    expect(watchFolderDocCount(r.folder.id)).toBe(1);
  });
});

describe("배선 짝 — 스케줄러가 index.ts에서 켜지고 꺼진다(소스 감시)", () => {
  it("start/stop 짝이 둘 다 있다 — 켜기만 있으면 종료가 안 끝나는 부류", () => {
    const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(src, "스케줄러가 안 켜진다").toContain("startWatchFolderScheduler()");
    expect(src, "stop 짝이 없다(kb-hygiene류 미등록을 답습하지 말 것 — 설계관 ③)").toContain("stopWatchFolderScheduler()");
  });
});
