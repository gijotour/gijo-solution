// rag-seed/ingest.mjs — security-references/ 의 모든 .md를 운영 서버 RAG에 인입한다.
// 자격증명은 환경변수로만(리포에 하드코딩 금지):
//   GIJO_SERVER_URL(기본 http://localhost:4000) · GIJO_ADMIN_USER · GIJO_ADMIN_PASSWORD [· GIJO_FORCE_LOGIN=1]
// ingestText가 documentId(=파일명) 기준 upsert라 재실행해도 중복 없이 최신으로 갱신된다.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.GIJO_SERVER_URL || "http://localhost:4000").replace(/\/+$/, "");
const user = process.env.GIJO_ADMIN_USER;
const password = process.env.GIJO_ADMIN_PASSWORD;
const force = process.env.GIJO_FORCE_LOGIN === "1";
if (!user || !password) {
  console.error("GIJO_ADMIN_USER / GIJO_ADMIN_PASSWORD 환경변수가 필요합니다.");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "security-references");
const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md") && f !== "README.md");

const login = await (await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: user, password, ...(force ? { force: true } : {}) }),
})).json();
if (!login.accessToken) {
  console.error("로그인 실패:", JSON.stringify(login));
  if (login.error === "already_logged_in") console.error("→ GIJO_FORCE_LOGIN=1 로 강제 전환하세요(그 세션은 끊깁니다).");
  process.exit(1);
}

let ok = 0;
for (const fn of files) {
  const text = await fs.readFile(path.join(dir, fn), "utf8");
  const content = Buffer.from(text, "utf8").toString("base64");
  try {
    const r = await fetch(base + "/api/memory/ingest-file", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + login.accessToken },
      body: JSON.stringify({ filename: fn, content, scope: "global" }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json();
    if (r.ok) { ok++; console.log(`✓ ${fn} — chunks=${j.chunks} class=${j.docClass || ""}`); }
    else console.log(`✗ ${fn} — ${j.error || r.status}`);
  } catch (e) {
    console.log(`✗ ${fn} — ${e.name || e.message}`);
  }
}
console.log(`\n완료: ${ok}/${files.length} 인입`);
