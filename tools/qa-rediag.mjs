// QA 실패 3건 재진단 + C1 매칭 의심 확인 + QA 잔여물 정리
const b64 = (s) => Buffer.from(s, "utf-8").toString("base64");
const base = "http://localhost:4000";
const login = await fetch(base + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "jyh", password: "changeme" }),
}).then((r) => r.json());
const H = { Authorization: "Bearer " + login.accessToken, "Content-Type": "application/json" };
const P = (u, body) => fetch(base + u, { method: "POST", headers: H, body: JSON.stringify(body) });
const G = (u) => fetch(base + u, { headers: H });

// 잔여 QA 제품 정리 먼저(매칭 재검에 영향 없게)
let grouped = await G("/api/security-products/grouped").then((r) => r.json());
for (const g of grouped) for (const p of g.products) if (p.name.startsWith("QA_")) {
  await fetch(base + "/api/security-products/" + p.id, { method: "DELETE", headers: H });
  console.log("잔여 QA 제품 정리:", p.name);
}

let r = await P("/api/memory/ingest-file", { filename: "QA_보안점검_보고서.md", content: b64("# QA 보고서\n분기 점검 결과 요약") });
let j = await r.json();
console.log("B1 .md 재검:", r.status, "chunks=" + j.chunks, "분류=" + (j.docClass || j.error));

r = await P("/api/memory/ingest-file", { filename: "QA_점검로그.log", content: b64("2026-07-17 방화벽 로그 3건") });
j = await r.json();
console.log("B2 .log 재검:", r.status, "chunks=" + (j.chunks ?? "-"), "분류/오류=" + (j.docClass || (j.error || "").slice(0, 60)));

r = await P("/api/security-products/import-doc", { filename: "QA_알수없는장비_매뉴얼.txt", content: b64("알 수 없는 장비 설명서") });
j = await r.json();
console.log("C2 재검:", r.status, "→", j.productName || j.error, "cat=" + j.category, "신규=" + j.createdProduct);
const c2id = j.productId;

r = await P("/api/security-products/import-doc", { filename: "QA_WAF-01_로그매뉴얼.txt" });
j = await r.json();
console.log("C1 매칭 재검:", r.status, "→", j.productName, "reason=" + j.reason, "kind=" + j.kind);
const c1prod = j.productId;
const c1new = j.createdProduct;

// 정리
if (c2id) await fetch(base + "/api/security-products/" + c2id, { method: "DELETE", headers: H });
if (c1new && c1prod) await fetch(base + "/api/security-products/" + c1prod, { method: "DELETE", headers: H });
grouped = await G("/api/security-products/grouped").then((r) => r.json());
for (const g of grouped) for (const p of g.products) for (const d of p.docs) if (d.title.startsWith("QA_")) {
  await fetch(base + "/api/security-products/docs/" + d.id, { method: "DELETE", headers: H });
}
for (const doc of ["QA_보안점검_보고서.md", "QA_점검로그.log", "QA_알수없는장비_매뉴얼.txt"]) {
  await P("/api/memory/document/delete", { documentId: doc, withFile: false });
}
console.log("정리 완료");
