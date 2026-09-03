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

// ⚠ 모킹은 **원천 계약을 그대로** 흉내 낸다 — 처음엔 {routedTo:"memory"}만 돌려줬는데,
//   실제 autoRouteUpload는 인입에 실패해도 routedTo:"memory"를 주고 ingested:false를 함께
//   싣는다. 그 차이를 모킹이 지워 「실패를 성공으로 기록」 결함을 시험이 원리상 못 봤다
//   (2026-08-31 검토관 [높음]). 이제 성공은 ingested:true, 실패 갈래는 아래 시험이 직접 준다.
vi.mock("../src/engine/autoupload", () => ({
  autoRouteUpload: vi.fn(async (filename: string) => ({
    filename, routedTo: "memory", reason: "시험 모킹",
    savedOriginal: false, mdSaved: true, ingested: true,
  })),
}));
// 라우팅 시험용 — 강제 경로면 LLM 호출 자체가 없어야 한다(forced-write-approval 관례).
const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
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
    // ⚠ 사전조건: data/가 **실재해야** 순환 판정까지 간다(2026-09-03 gb10 깨끗한 사본 실측).
    //   경로검증은 realpath부터 밟으므로 폴더가 없으면 「경로를 못 찾음」에서 끝나고, 이 시험은
    //   「순환」이 아닌 다른 사유를 받아 실패한다 — 개발 트리에는 data/가 늘 있어서 여태 안 보였다.
    //   제품 코드(watchfolder.ts)는 손대지 않는다. 존재 판정보다 순환 판정을 먼저 하는 것은
    //   사람에게 보이는 사유 문구가 바뀌는 **제품 계약**이라 따로 결정할 일이다.
    fs.mkdirSync(path.resolve("data"), { recursive: true });
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
  it("★ 인입이 실패하면(ingested:false) 기록하지 않고 다음 확인에 다시 시도한다 — 실패를 성공으로 적지 않는다", async () => {
    // 2026-08-31 검토관 [높음]: routedTo만 보면 임베딩 미기동·추출 실패가 「새로 1」이 되고
    // stat·hash가 박혀 **파일이 바뀌기 전까지 영영 재시도가 없다**(머리 주석의 계약 위반).
    const 모킹 = autoRouteUpload as ReturnType<typeof vi.fn>;
    모킹.mockResolvedValueOnce({ filename: "watchtest-f.txt", routedTo: "memory", reason: "검색수집 보류(임베딩 미기동)", savedOriginal: false, mdSaved: true, ingested: false });
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "watchtest-f.txt"), "임베딩이 죽은 동안 들어온 문서입니다.");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    const s1 = await scanWatchFolder(r.folder);
    expect(s1.새로, "실패를 성공으로 셌다").toBe(0);
    expect(s1.오류.some((e) => e.includes("보류")), "왜 안 들어왔는지 말하지 않는다").toBe(true);
    // 다음 틱: 파일이 안 바뀌어도 **다시 시도**해야 한다(stat·hash를 안 썼으므로).
    const 전 = 부른횟수();
    const s2 = await scanWatchFolder(listWatchFolders()[0]);
    expect(부른횟수(), "재시도하지 않았다 — 실패가 성공처럼 기록됐다").toBe(전 + 1);
    expect(s2.새로, "이번엔 성공해야 한다(모킹 기본값=ingested:true)").toBe(1);
  });
  it("★ 감시 폴더가 제품 폴더(data·서버 뿌리)를 **품고 있어도** 거부한다 — 추출본 .md 증식 루프", () => {
    // 하위만 막던 것이 [높음]으로 잡혔다(조상 방향은 통과 → 걷기가 깊이 4에서 extracted에 닿음).
    const 조상 = path.resolve(".", "..");
    const r = 경로검증(조상);
    expect(r.ok, "제품 폴더를 품은 상위 폴더가 통과했다 — .md.md 증식 루프가 열린다").toBe(false);
    if (!r.ok) expect(r.error).toContain("순환");
  });
  it("★ 「personal:」로 시작하는 파일명은 반입하지 않는다 — 개인 문서 네임스페이스 오염", async () => {
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "personal:유령메모.txt"), "개인 문서 자리를 차지하는 이름입니다.");
    const r = addWatchFolder({ path: dir, userId: "u-1" });
    if (!r.ok) throw new Error("등록 실패");
    const 전 = 부른횟수();
    const s = await scanWatchFolder(r.folder);
    expect(부른횟수(), "예약 접두 파일을 인입했다 — 아무에게도 안 보이는 유령 문서가 된다").toBe(전);
    expect(s.오류.some((e) => e.includes("personal:")), "왜 건너뛰었는지 말하지 않는다").toBe(true);
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

describe("라우팅 — 「지정은 대화창에서」 약속을 결정적으로(dispatch 수준·설계관 ②)", () => {
  // ⚠ forcedToolFor 단위만 재면 앞 층이 안 보여 「시험은 통과하는데 안 닿는다」(routes.ts §51
  //   실사고) — 그래서 runAgentLoop(dispatch 수준)으로 잰다. 강제 경로면 LLM 호출이 0이어야 한다.
  it("경로에 침해·로그 낱말이 들어도 폴더 등록 결재판으로 간다(admin 쓰기) — 초동절차가 안 가로챈다", async () => {
    mockChat.mockReset();
    const { runAgentLoop, resetContextForTests } = await import("../src/engine/agentloop");
    resetContextForTests();
    // admin 범위 — 이 도구는 admin 전용이라 role 없이는 강제 분기가 **설계대로** 비켜간다
    // (「admin 전용 도구가 강제 분기로 새면 안 된다」 — forcedToolFor 규약).
    const r = await runAgentLoop("내 문서에서 D:\\보안팀\\침해사고_로그 폴더를 계속 지켜봐 줘", "", { role: "admin" });
    expect(r, "루프가 아무것도 안 돌려줬다 — LLM으로 샌다").not.toBeNull();
    expect(r!.approval?.tool, "결재판이 안 뜬다(쓰기·admin)").toBe("watch_folder_add");
    const 경로칸 = r!.approval!.fields.find((f) => f.key === "path");
    expect(경로칸?.value ?? "", "autoFill이 지시문의 경로를 못 뽑았다(빈 결재판)").toContain("침해사고_로그");
    expect(mockChat, "LLM을 불렀다 — 강제 경로가 안 먹었다").not.toHaveBeenCalled();
  });
  it("「지켜보는 폴더 뭐 있어?」는 결재판 없이 결정적 목록으로 답한다", async () => {
    mockChat.mockReset();
    const { runAgentLoop, resetContextForTests } = await import("../src/engine/agentloop");
    resetContextForTests();
    const r = await runAgentLoop("지켜보는 폴더 뭐 있어?");
    expect(r).not.toBeNull();
    expect(r!.approval, "조회가 결재판으로 샜다").toBeUndefined();
    expect(r!.output).toContain("지켜보는 폴더");
    expect(mockChat).not.toHaveBeenCalled();
  });
  it("「방화벽 로그 감시해줘」(관제 문장)는 폴더 도구를 안 삼킨다 — 홑낱말 가로채기 금지", async () => {
    mockChat.mockReset();
    const { runAgentLoop, resetContextForTests } = await import("../src/engine/agentloop");
    resetContextForTests();
    mockChat.mockResolvedValue(""); // 모델 선택으로 떨어지는 것이 정답 — LLM 목은 무해값(형식 불가→채팅 폴백)
    const r = await runAgentLoop("방화벽 로그 감시해줘", "", { role: "admin" });
    if (r?.approval) expect(r.approval.tool, "관제 지시가 폴더 등록 결재판으로 샜다").not.toContain("watch_folder");
    if (r?.output) expect(r.output).not.toContain("지켜보는 폴더로 등록");
  });
});

describe("배선 짝 — 스케줄러가 index.ts에서 켜지고 꺼진다(소스 감시)", () => {
  it("start/stop 짝이 둘 다 있다 — 켜기만 있으면 종료가 안 끝나는 부류", () => {
    const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(src, "스케줄러가 안 켜진다").toContain("startWatchFolderScheduler()");
    expect(src, "stop 짝이 없다(kb-hygiene류 미등록을 답습하지 말 것 — 설계관 ③)").toContain("stopWatchFolderScheduler()");
  });
});

describe("라이브 검증이 잡은 것(2026-08-31) — 안내가 약속한 말이 실제로 통한다", () => {
  it("해제 결재판이 「1번」에서 번호를 뽑는다 — 안내가 그렇게 말한다", async () => {
    mockChat.mockReset();
    const { runAgentLoop, resetContextForTests } = await import("../src/engine/agentloop");
    resetContextForTests();
    const r = await runAgentLoop("지켜보는 폴더 1번 그만 지켜봐", "", { role: "admin" });
    expect(r!.approval?.tool).toBe("watch_folder_remove");
    expect(r!.approval!.fields.find((f) => f.key === "target")?.value, "「1번」에서 번호를 못 뽑아 빈 결재판이 뜬다").toBe("1");
    expect(r!.approval!.missing, "빠진 칸이 있다고 말한다 — 사람이 다시 채워야 한다").toEqual([]);
  });
  it("해제 답이 반입 문서 수를 사실대로 말한다 — 지운 뒤에 세면 늘 0이다", async () => {
    const dir = 임시폴더();
    fs.writeFileSync(path.join(dir, "watchtest-g.txt"), "해제 메시지 검증용 문서 본문입니다.");
    const a = addWatchFolder({ path: dir, userId: "u-1" });
    if (!a.ok) throw new Error("등록 실패");
    await scanWatchFolder(a.folder);
    expect(watchFolderDocCount(a.folder.id)).toBe(1);
    const r = removeWatchFolder(String(a.folder.id));
    expect(r?.docCount, "해제 결과가 문서 0건이라 말한다 — 실제로는 1건이 남아 있다").toBe(1);
  });
});
