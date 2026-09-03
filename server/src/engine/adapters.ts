// engine/adapters.ts — 전문가 LoRA 어댑터 등록부 (AI팀 재설계 1단계, 2026-08-08)
//
// "베이스 1 + 어댑터 N" 체제의 대장. 학습 파이프라인이 구운 GGUF LoRA 어댑터를 여기 등록하고,
// **평가 게이트를 통과해 채택(adopted)된 것만** 서빙(localengine 스폰)에 얹는다 — 어댑터 1호가
// 반복 루프·설정 키 날조로 불채택된 실측(2026-08-08)이 이 관문의 이유다. 등록≠채택.
//
// LoRA는 베이스 모델에 종속된다(다른 베이스에 못 붙임) — baseModelId가 그 계약이고,
// 서빙 쪽은 "지금 올리는 모델과 baseModelId가 같은 채택 어댑터"만 골라 적재한다.

import type { Express } from "express";
import * as fs from "fs";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { db, migrate } from "../db";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

migrate(
  "lora-adapters-2026-08-08",
  `CREATE TABLE IF NOT EXISTS lora_adapters (
     id TEXT PRIMARY KEY,
     topic TEXT,
     baseModelId TEXT NOT NULL,
     file TEXT NOT NULL,
     adopted INTEGER NOT NULL DEFAULT 0,
     note TEXT,
     createdAt INTEGER NOT NULL,
     -- 채택 근거(2026-09-02): 평가 게이트 결과 JSON. model_adoptions의 gate와 같은 설계다
     -- (잣대를 둘로 두지 않는다). 강행 채택이면 사유가 여기 함께 남는다.
     gate TEXT
   )`
);

// 이미 만들어진 DB에도 칸을 붙인다(있으면 무시) — 새로 만든 표에는 위 CREATE가 이미 넣는다.
try { db.exec("ALTER TABLE lora_adapters ADD COLUMN gate TEXT"); } catch { /* 이미 있으면 무시 */ }

export interface LoraAdapter {
  id: string;
  topic: string | null; // 주제 딱지(learnloop.ts TOPICS — 취약점·장비운영·사내규정·위협대응·일반) — 전문 분야
  baseModelId: string; // 이 어댑터가 붙는 서빙 모델 id (LoRA 베이스 종속 계약)
  file: string; // GGUF LoRA 파일 경로
  adopted: boolean; // 게이트 통과 채택 여부 — 채택된 것만 서빙에 적재
  note: string | null; // 사람이 적는 한 줄(요약·강행 사유)
  /**
   * 채택 근거 — 평가 게이트 결과 JSON(2026-09-02). `model_adoptions.gate`와 같은 설계다.
   * ⚠ 이것이 없으면 **채택이 거절된다**(강행 사유를 적지 않는 한). 예전에는 note에
   *   「게이트 통과 후 채택하세요」라고 **적어 두기만** 했고 아무도 확인하지 않았다.
   */
  gate: string | null;
  createdAt: number;
}

const insertStmt = db.prepare(
  "INSERT INTO lora_adapters (id, topic, baseModelId, file, adopted, note, createdAt) VALUES (@id, @topic, @baseModelId, @file, 0, @note, @createdAt)"
);
const listStmt = db.prepare("SELECT * FROM lora_adapters ORDER BY createdAt DESC");
const getStmt = db.prepare("SELECT * FROM lora_adapters WHERE id = ?");
const adoptedForStmt = db.prepare(
  "SELECT * FROM lora_adapters WHERE adopted = 1 AND baseModelId = ? ORDER BY createdAt ASC"
);
const adoptStmt = db.prepare("UPDATE lora_adapters SET adopted = ?, note = ? WHERE id = ?");
// 채택 근거를 따로 쓴다 — 채택 여부(adoptStmt)와 나눠 둬야 「근거만 갱신」도 된다.
const gateStmt = db.prepare("UPDATE lora_adapters SET gate = ? WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM lora_adapters WHERE id = ?");

interface Row {
  id: string;
  topic: string | null;
  baseModelId: string;
  file: string;
  adopted: number;
  note: string | null;
  createdAt: number;
}

const fromRow = (r: Row): LoraAdapter => ({
  id: r.id,
  topic: r.topic,
  baseModelId: r.baseModelId,
  file: r.file,
  adopted: r.adopted === 1,
  note: r.note,
  gate: (r as { gate?: string | null }).gate ?? null,
  createdAt: r.createdAt,
});

const ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export function registerAdapter(args: {
  id: string;
  topic?: string | null;
  baseModelId: string;
  file: string;
  note?: string | null;
}): LoraAdapter {
  if (!ID_RE.test(args.id)) throw new Error("어댑터 id는 영문 소문자/숫자/하이픈 64자 이내여야 합니다");
  if (!args.baseModelId?.trim()) throw new Error("베이스 모델 id가 비었습니다 — LoRA는 베이스 종속이라 필수입니다");
  if (!fs.existsSync(args.file)) throw new Error(`어댑터 파일이 없습니다: ${args.file}`);
  if (getStmt.get(args.id)) throw new Error(`이미 등록된 어댑터입니다: ${args.id}`);
  insertStmt.run({
    id: args.id,
    topic: args.topic ?? null,
    baseModelId: args.baseModelId.trim(),
    file: args.file,
    note: args.note ?? null,
    createdAt: Date.now(),
  });
  return fromRow(getStmt.get(args.id) as Row);
}

// ── 어댑터 반입(2026-08-09, 후-3 연장 — 사용자 지시 "학습이 잘된 LoRA 등을 넣어서") ──────
//
// 다른 사이트·이전 구축에서 검증된 GGUF LoRA를 등록부에 들여온다. **반입도 등록일 뿐이다** —
// 채택은 여전히 평가 게이트+근거 필수, 총괄 장착 금지도 그대로. 밖에서 온 파일일수록
// 관문을 세게 지킨다: GGUF 매직 검사·sha256 기록·출처 기록, 실행 없이 등록만.
import * as path from "path";
import * as crypto from "crypto";

const LORA_DIR = process.env.GIJO_LORA_DIR ?? path.join("data", "lora");

export function importAdapterFromFile(args: {
  /** 반입할 파일 — data/lora 안 파일명 또는 절대 경로 */
  file: string;
  baseModelId: string;
  topic?: string | null;
  note?: string | null;
  actor?: string | null;
}): LoraAdapter {
  const 이름 = (args.file ?? "").trim();
  if (!이름) throw new Error("반입할 어댑터 파일명이 비었습니다");
  if (!/\.gguf$/i.test(이름)) throw new Error("어댑터는 GGUF 파일(.gguf)만 반입할 수 있습니다");
  // 경로 주입 방어 — 파일명만 왔으면 반입함(data/lora)에서 찾고, 경로면 그대로 확인.
  const 후보 = path.isAbsolute(이름) || 이름.includes(path.sep) || 이름.includes("/")
    ? 이름
    : path.join(LORA_DIR, path.basename(이름));
  if (!fs.existsSync(후보)) {
    throw new Error(
      `반입할 파일을 찾지 못했습니다: ${path.basename(이름)} — 먼저 파일을 서버의 ${LORA_DIR} 폴더에 넣어 주세요.`
    );
  }
  // GGUF 매직 — 아무 파일이나 어댑터로 등록되는 것을 막는다(첫 4바이트 "GGUF").
  const fd = fs.openSync(후보, "r");
  const head = Buffer.alloc(4);
  try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (head.toString("ascii") !== "GGUF") {
    throw new Error(`GGUF 형식이 아닙니다: ${path.basename(후보)} — LoRA 어댑터 파일이 맞는지 확인하세요.`);
  }
  const sha = crypto.createHash("sha256").update(fs.readFileSync(후보)).digest("hex");

  // 반입함 밖의 파일은 산출처(data/lora)로 복사해 둔다 — 원본이 치워져도 서빙이 안 깨진다.
  let 최종경로 = 후보;
  if (path.resolve(path.dirname(후보)) !== path.resolve(LORA_DIR)) {
    fs.mkdirSync(LORA_DIR, { recursive: true });
    최종경로 = path.join(LORA_DIR, path.basename(후보));
    fs.copyFileSync(후보, 최종경로);
  }

  const slug = path.basename(후보, path.extname(후보)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "adapter";
  const id = getStmt.get(slug) ? `${slug}-${sha.slice(0, 8)}` : slug;
  const adapter = registerAdapter({
    id,
    topic: args.topic ?? null,
    baseModelId: args.baseModelId,
    file: 최종경로,
    note: `반입(미채택) — 출처 ${후보} · sha256 ${sha.slice(0, 12)}…${args.note ? ` · ${args.note}` : ""}`,
  });
  recordAudit({
    kind: "config", actor: args.actor ?? null,
    action: `전문가 어댑터 반입: ${id}`,
    target: args.baseModelId,
    detail: `sha256 ${sha.slice(0, 12)} · ${path.basename(후보)} — 등록만(채택은 게이트+근거 필수)`,
    result: "ok",
  });
  return adapter;
}

export function listAdapters(): LoraAdapter[] {
  return (listStmt.all() as Row[]).map(fromRow);
}

export function getAdapter(id: string): LoraAdapter | null {
  const r = getStmt.get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

// 서빙이 부른다 — 지금 올리는 모델(baseModelId 일치)의 **채택** 어댑터만.
// 파일이 사라진 어댑터는 조용히 빼되 경고를 남긴다(스폰 인자에 죽은 경로가 들어가면 모델 전체가 안 뜬다).
export function adoptedAdaptersFor(baseModelId: string): LoraAdapter[] {
  return (adoptedForStmt.all(baseModelId) as Row[]).map(fromRow).filter((a) => {
    if (fs.existsSync(a.file)) return true;
    console.warn(`[adapters] 채택 어댑터 파일이 없어 건너뜁니다: ${a.id} (${a.file})`);
    return false;
  });
}

// 채택/해제 — 채택에는 근거(note)를 강제한다: "게이트 통과"라는 말만으로는 부족하고
// 어느 회차·점수로 통과했는지 남겨야 나중에 "왜 이 어댑터가 실서비스에 있나"를 답할 수 있다.
/**
 * 전문가(어댑터) 채택/해제 — **채택에는 근거가 필요하다**(2026-09-02, 승인 시안 내회사전문가 ③).
 *
 * 왜: 예전에는 note에 「평가 게이트 통과 후 채택하세요」라고 **적어 두기만** 하고, 채택 창구는
 *   그 결과를 **요구하지 않았다.** 관리자가 아무 근거 없이 채택할 수 있었고, 검증 안 된 전문가가
 *   그대로 실서비스 대화에 실린다. 규칙은 있는데 지키는 것이 사람 몫이었다.
 *
 * ⚠ 새 잣대를 만들지 않았다 — 모델 교체에는 이미 같은 장치가 있다(`model_adoptions.gate`,
 *   `tools/evalgate/adopt.mjs`가 리포트를 실어 보낸다). 어댑터에 그 잣대를 그대로 옮겼다.
 *
 * ⚠ **강행을 막지는 않는다.** 게이트를 못 돌리는 상황이 실제로 있고(급한 되돌림 등), 길을 아예
 *   막으면 사람들이 다른 우회로를 만든다. 대신 **사유를 20자 이상 적게** 하고 그것을 근거로 남긴다
 *   — 학습 개시선 미달 강행(learnloop)과 같은 결이다. 남는 것이 없는 강행은 없다.
 */
export function setAdapterAdopted(
  id: string,
  adopted: boolean,
  note?: string | null,
  gate?: unknown,
): LoraAdapter {
  const cur = getStmt.get(id) as Row | undefined;
  if (!cur) throw new Error(`등록되지 않은 어댑터입니다: ${id}`);

  let gateJson: string | null = (cur as { gate?: string | null }).gate ?? null;
  if (adopted) {
    if (!note?.trim()) throw new Error("채택에는 근거(게이트 결과 요약)가 필요합니다");
    // 게이트 리포트의 판정. evalgate가 내는 값은 「통과」·「채택 보류」·「기준선 없음」 셋이고
    // (tools/evalgate/run.mjs), adopt.mjs는 리포트를 못 읽었을 때 「통과(리포트 없음)」을 쓴다.
    // ⚠ 처음엔 startsWith("통과")로 썼다가 gb10 1차 선별이 잡았다 — 그러면 「통과하지 못함」 같은
    //   값도 통과로 읽힌다. **정확히 「통과」이거나 「통과(…)」 꼴만** 통과로 본다.
    // ⚠ 정직하게: 이 값은 **관리자가 보내는 것**이라 위조를 막지는 못한다. 이 장치가 보장하는 것은
    //   「아무 생각 없이 눌러서 채택되지는 않는다」와 **무엇을 근거로 채택했는지가 남는다**이다
    //   (감사 기록에도 남는다). 위조까지 막으려면 서버가 게이트를 직접 돌려야 하고, 그건 별개 작업이다.
    const 판정 = (gate as { verdict?: string } | undefined)?.verdict;
    const 통과 = 판정 === "통과" || (typeof 판정 === "string" && 판정.startsWith("통과("));
    if (!통과) {
      // 게이트가 없거나 통과가 아니면 **강행 사유**를 요구한다 — 짧은 한 마디는 근거가 아니다.
      const 사유 = note.trim();
      if (사유.length < 20) {
        throw new Error(
          판정
            ? `평가 게이트 판정이 「${판정}」입니다. 그래도 채택하려면 강행 사유를 20자 이상 적어 주세요.`
            : "평가 게이트 결과가 없습니다. 게이트를 먼저 돌리거나, 강행 사유를 20자 이상 적어 주세요.",
        );
      }
    }
    // 근거는 **판정과 함께** 남긴다 — 나중에 「왜 채택했나」를 이 한 줄로 되짚을 수 있어야 한다.
    gateJson = JSON.stringify({
      verdict: 판정 ?? "(게이트 없음)",
      강행: !통과,
      at: Date.now(),
      report: gate ?? null,
    });
  }

  adoptStmt.run(adopted ? 1 : 0, note?.trim() ?? cur.note, id);
  gateStmt.run(gateJson, id);
  return fromRow(getStmt.get(id) as Row);
}

export function deleteAdapter(id: string): void {
  deleteStmt.run(id);
}

export function registerAdapterRoutes(app: Express): void {
  app.get("/api/adapters", authMiddleware, (_req, res) => {
    res.json({ adapters: listAdapters() });
  });

  app.post("/api/adapters/:id/adopt", authMiddleware, adminMiddleware, (req, res) => {
    // gate = 평가 게이트 리포트(JSON). 없으면 강행 사유(note 20자 이상)를 요구한다 — 위 함수 주석 참고.
    const { adopted, note, gate } = req.body ?? {};
    try {
      const updated = setAdapterAdopted(req.params.id, adopted !== false, note, gate);
      recordAudit({
        kind: "config",
        actor: (req as { user?: GijoUser }).user?.displayName ?? "(알 수 없음)",
        action: updated.adopted ? "전문가 어댑터 채택" : "전문가 어댑터 채택 해제",
        target: updated.id,
        detail: updated.note ?? "",
        result: "ok",
      });
      // 채택/해제는 다음 모델 로드부터 적용된다 — 이미 떠 있는 llama-server의 인자는 못 바꾼다.
      res.json({ ...updated, 적용시점: "다음 모델 로드부터 (채팅 모델 재기동 필요)" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete("/api/adapters/:id", authMiddleware, adminMiddleware, (req, res) => {
    const cur = getAdapter(req.params.id);
    if (!cur) {
      res.status(404).json({ error: "등록되지 않은 어댑터입니다" });
      return;
    }
    deleteAdapter(req.params.id);
    recordAudit({
      kind: "config",
      actor: (req as { user?: GijoUser }).user?.displayName ?? "(알 수 없음)",
      action: "전문가 어댑터 등록 삭제",
      target: cur.id,
      detail: cur.file,
      result: "ok",
    });
    res.json({ ok: true });
  });
}
