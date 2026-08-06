// 해자 슬라이스 0+1 — [2026-08-06 · 계획서 후-6 「해자 강화」, 설계문서 GIJO_AS_해자_축적자산_설계.md]
//
// 지키는 계약:
//   슬라이스 0 ① 세션 아카이브가 백업 짝 폴더로 담긴다(재해복구 소실 결함 수정)
//              ② chat_logs 캡 정리분은 지우기 **전에** JSONL로 내려가고, 못 내리면 안 지운다
//   슬라이스 1 ① 판정은 이력으로 쌓인다(qa 행은 표시·집계 제외) ② 같은 사안 재질문에 지난 판정
//              병기·뒤집힘 ⚠ ③ 캐싱·자동 재사용은 없다(병기일 뿐, 판정은 매번 새로)
//              ④ 「규정 대조 이력 보여줘」는 결정적으로 라우팅된다
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { db } from "../src/db";
import { pruneChatLogs } from "../src/engine/learnloop";
import { listActionCheckHistory, normalizeActionQuestion } from "../src/engine/actioncheck";
import { forcedToolFor } from "../src/engine/agentloop";
import { runActionCheckHistory } from "../src/engine/agenttools/handlers";

const tmpArchive = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-moat-"));
process.env.GIJO_SESSION_ARCHIVE_DIR = tmpArchive;

const insertLog = db.prepare(
  "INSERT INTO chat_logs (id, agentId, question, answer, createdAt, usedInDataset, rating) VALUES (?, 'qa', ?, 'a', ?, 1, 0)"
);
const insertHist = db.prepare(
  `INSERT INTO action_check_history (askedAt, question, normQuestion, verdict, basisRefs, verdictText, qa)
   VALUES (?, ?, ?, ?, ?, '소견', ?)`
);

beforeEach(() => {
  db.prepare("DELETE FROM chat_logs WHERE agentId = 'qa'").run();
  db.prepare("DELETE FROM action_check_history").run();
  for (const f of fs.readdirSync(tmpArchive)) fs.rmSync(path.join(tmpArchive, f), { force: true });
});

describe("해자 슬라이스 0 — 지우기 전에 내린다", () => {
  it("★ 캡 정리분이 chatlogs-*.jsonl 로 내려간 뒤에 지워진다", () => {
    const base = Date.now() - 10_000;
    for (let i = 0; i < 5; i++) insertLog.run(`qa-moat-${i}`, `질문${i}`, base + i);
    const 전체 = (db.prepare("SELECT COUNT(*) n FROM chat_logs").get() as { n: number }).n;
    const removed = pruneChatLogs(전체 - 3); // 3건 초과분 정리
    expect(removed).toBe(3);
    const files = fs.readdirSync(tmpArchive).filter((f) => f.startsWith("chatlogs-"));
    expect(files, "정리분이 아카이브 파일로 안 내려갔다 — 영구 소실 결함 재발").toHaveLength(1);
    const lines = fs.readFileSync(path.join(tmpArchive, files[0]), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).question).toBe("질문0"); // 오래된 순
  });

  it("백업이 세션 아카이브 짝 폴더를 만든다 — 소스에서 계약 확인", () => {
    // performBackup 실행은 VACUUM INTO(전체 DB 복사)라 무겁다 — 여기서는 코드 계약을 감시:
    // 아카이브 복사·반환 필드·보관정리 짝 삭제가 전부 있어야 한다.
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "backup.ts"), "utf8");
    expect(src).toContain("sessionArchiveDir()");
    expect(src).toContain(".session-archive");
    expect(src).toContain("archiveIncluded");
    expect((src.match(/\.session-archive/g) ?? []).length, "보관정리에서 짝 폴더를 안 지우면 디스크가 는다").toBeGreaterThanOrEqual(2);
  });
});

describe("해자 슬라이스 1 — 판정 이력", () => {
  it("정규화는 공백·문장부호만 지운다 — 다른 질문을 같다고 하지 않는다", () => {
    expect(normalizeActionQuestion("접속기록을 6개월만 보관해도 돼?")).toBe(normalizeActionQuestion("접속기록을 6개월만  보관해도 돼"));
    expect(normalizeActionQuestion("접속기록을 6개월만 보관해도 돼?")).not.toBe(normalizeActionQuestion("접속기록을 3개월만 보관해도 돼?"));
  });

  it("★ qa 행은 조회에서 제외된다 — 게이트가 이력을 오염시키지 않는다", () => {
    insertHist.run("2026-08-06T00:00:00Z", "사람 질문", "사람질문", "allow", "규정.md", 0);
    insertHist.run("2026-08-06T00:00:01Z", "게이트 질문", "게이트질문", "deny", "규정.md", 1);
    const rows = listActionCheckHistory();
    expect(rows).toHaveLength(1);
    expect(rows[0].question).toBe("사람 질문");
  });

  it("조회 도구 — 뒤집힘 ⚠ 표시와 × 집계, 빈 이력은 정직하게", async () => {
    expect(await runActionCheckHistory()).toContain("아직 없습니다");
    insertHist.run("2026-07-30T00:00:00Z", "보관 줄여도 돼?", "보관줄여도돼", "allow", "규정.md", 0);
    insertHist.run("2026-08-06T00:00:00Z", "보관 줄여도 돼?", "보관줄여도돼", "deny", "규정.md", 0);
    const out = await runActionCheckHistory();
    expect(out).toContain("⚠판정 바뀐 이력 있음");
    expect(out).toContain("× 금지 1건");
  });

  it("★ 라우팅 — 이력 물음은 못 박히고, 새 판정 요청은 안 삼킨다", () => {
    expect(forcedToolFor("규정 대조 이력 보여줘")?.tool).toBe("action_check_history");
    expect(forcedToolFor("판정 기록 알려줘")?.tool).toBe("action_check_history");
    expect(forcedToolFor("접속기록 보관 줄여도 돼?")?.tool).not.toBe("action_check_history");
  });
});
