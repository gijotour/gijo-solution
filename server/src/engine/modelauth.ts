// engine/modelauth.ts — 모델 받기에 필요한 인증 정보(HuggingFace 토큰·프록시)를 서버에 보관한다.
//
// 왜 만들었나 (2026-07-28 사용자 요청, 설정 통합 시안 ①단계)
//   라이선스 동의가 필요한 모델(gated)을 받으려면 HuggingFace 토큰이 필요한데, 앱에 넣을 곳이
//   없었다. 담당자는 "hf auth login으로 토큰 로그인 후 다시 시도하세요"라는 오류 문구만 보고
//   **서버에 직접 들어가 명령을 쳐야** 했다. 사내망에서 프록시가 필요한 경우도 마찬가지였다.
//   이제 설정에 한 번 넣어 두면 서버가 받을 때 알아서 쓴다.
//
// 보관 원칙 — SMTP 비밀번호와 같은 방식을 그대로 따른다(방식이 갈리면 한쪽이 낡는다).
//   · 토큰은 암호화해서 DB에 둔다(encryptString). 평문으로 두지 않는다.
//   · 화면에는 **끝 4자만** 돌려준다. 전체를 다시 내보내지 않는다 — 어깨너머로 새 나간다.
//   · 프록시 주소는 비밀이 아니라 그대로 둔다(주소일 뿐이고, 담당자가 확인해야 고칠 수 있다).
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { encryptString, decryptString, getEncryptionKey } from "./cryptopack";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

migrate(
  "model-auth-2026-07-28",
  `CREATE TABLE IF NOT EXISTS model_auth (
     id TEXT PRIMARY KEY,
     encryptedToken TEXT,
     proxyUrl TEXT,
     tokenTail TEXT,
     updatedAt INTEGER NOT NULL,
     updatedBy TEXT
   )`
);

const CONFIG_ID = "default";

interface Row {
  id: string;
  encryptedToken: string | null;
  proxyUrl: string | null;
  tokenTail: string | null;
  updatedAt: number;
  updatedBy: string | null;
}

/** 화면에 주는 모양 — 토큰 자체는 절대 나가지 않는다. */
export interface ModelAuthPublic {
  hasToken: boolean;
  tokenTail: string | null; // 예: "3x9K" — 어느 토큰인지 알아보기만 할 정도
  proxyUrl: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

const getStmt = db.prepare("SELECT * FROM model_auth WHERE id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO model_auth (id, encryptedToken, proxyUrl, tokenTail, updatedAt, updatedBy)
  VALUES (@id, @encryptedToken, @proxyUrl, @tokenTail, @updatedAt, @updatedBy)
  ON CONFLICT(id) DO UPDATE SET
    encryptedToken = excluded.encryptedToken, proxyUrl = excluded.proxyUrl,
    tokenTail = excluded.tokenTail, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy
`);

function row(): Row | undefined {
  return getStmt.get(CONFIG_ID) as Row | undefined;
}

export function getModelAuth(): ModelAuthPublic {
  const r = row();
  return {
    hasToken: Boolean(r?.encryptedToken),
    tokenTail: r?.tokenTail ?? null,
    proxyUrl: r?.proxyUrl ?? "",
    updatedAt: r?.updatedAt ?? null,
    updatedBy: r?.updatedBy ?? null,
  };
}

/**
 * 실제 다운로드가 쓸 값. 서버 안에서만 부른다 — 라우트로 내보내지 않는다.
 * 복호화에 실패하면(키가 바뀐 경우 등) 토큰 없이 진행한다 — 받기 자체를 막지는 않는다.
 */
export function getModelAuthSecrets(): { token: string | null; proxyUrl: string | null } {
  const r = row();
  let token: string | null = null;
  if (r?.encryptedToken) {
    try {
      token = decryptString(r.encryptedToken, getEncryptionKey());
    } catch {
      console.warn("[modelauth] 토큰을 풀지 못했습니다 — 토큰 없이 진행합니다(다시 등록이 필요합니다)");
    }
  }
  return { token, proxyUrl: r?.proxyUrl?.trim() ? r.proxyUrl.trim() : null };
}

export interface SaveModelAuthInput {
  /** 새 토큰. 빈 문자열이면 지운다. undefined면 그대로 둔다(프록시만 바꿀 때). */
  token?: string;
  proxyUrl?: string;
}

export function saveModelAuth(input: SaveModelAuthInput, actor?: string): ModelAuthPublic {
  const cur = row();
  let encryptedToken = cur?.encryptedToken ?? null;
  let tokenTail = cur?.tokenTail ?? null;

  if (input.token !== undefined) {
    const t = input.token.trim();
    if (t === "") {
      encryptedToken = null;
      tokenTail = null;
    } else {
      encryptedToken = encryptString(t, getEncryptionKey());
      tokenTail = t.slice(-4);
    }
  }
  upsertStmt.run({
    id: CONFIG_ID,
    encryptedToken,
    proxyUrl: input.proxyUrl !== undefined ? input.proxyUrl.trim() : (cur?.proxyUrl ?? null),
    tokenTail,
    updatedAt: Date.now(),
    updatedBy: actor ?? null,
  });
  return getModelAuth();
}

/**
 * 실제로 HuggingFace에 닿는지 본다. 저장한 토큰·프록시를 그대로 써서 확인하므로
 * "저장은 됐는데 정작 받을 때 안 되는" 상황을 미리 잡는다.
 * ⚠ 여기서 토큰 값을 응답에 담지 않는다 — 상태만 말한다.
 */
export async function testModelAuth(): Promise<{ ok: boolean; message: string; whoami?: string }> {
  const { token, proxyUrl } = getModelAuthSecrets();
  const url = token ? "https://huggingface.co/api/whoami-v2" : "https://huggingface.co/api/models?limit=1";
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "토큰이 거부됐습니다 — 만료됐거나 권한이 없는 토큰입니다. 새로 발급해 등록하세요." };
    }
    if (!res.ok) {
      return { ok: false, message: `HuggingFace가 HTTP ${res.status}로 응답했습니다.` };
    }
    if (!token) {
      return { ok: true, message: "인터넷 연결은 정상입니다. 다만 토큰이 없어 gated 모델은 받을 수 없습니다." };
    }
    const j = (await res.json()) as { name?: string };
    return { ok: true, message: "토큰이 정상 동작합니다.", whoami: j.name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(msg)) {
      return {
        ok: false,
        message: proxyUrl
          ? "시간 안에 응답이 없습니다 — 프록시 주소가 맞는지 확인하세요."
          : "시간 안에 응답이 없습니다 — 사내망이라면 프록시 주소가 필요할 수 있습니다.",
      };
    }
    return { ok: false, message: `연결하지 못했습니다: ${msg}` };
  }
}

export function registerModelAuthRoutes(app: Express): void {
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.username ?? "unknown";

  // 조회는 admin만 — 어떤 토큰이 걸려 있는지는 운영 정보다(값 자체는 어차피 안 나간다).
  app.get("/api/model-auth", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(getModelAuth());
  });

  app.post("/api/model-auth", authMiddleware, adminMiddleware, (req, res) => {
    const { token, proxyUrl } = req.body as { token?: string; proxyUrl?: string };
    if (token === undefined && proxyUrl === undefined) {
      res.status(400).json({ error: "바꿀 값이 없습니다 (token 또는 proxyUrl)" });
      return;
    }
    const saved = saveModelAuth({ token, proxyUrl }, actorOf(req));
    // 무엇을 바꿨는지만 남긴다 — 값은 절대 기록하지 않는다.
    recordAudit({
      kind: "config",
      actor: actorOf(req),
      action: "모델 받기 인증 변경",
      target: [token !== undefined ? (token.trim() ? "토큰 등록" : "토큰 삭제") : null,
               proxyUrl !== undefined ? "프록시 주소" : null].filter(Boolean).join(" · "),
      result: "ok",
    });
    res.json(saved);
  });

  app.post("/api/model-auth/test", authMiddleware, adminMiddleware, asyncRoute(async (_req, res) => {
    res.json(await testModelAuth());
  }));
}
