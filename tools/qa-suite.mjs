// tools/qa-suite.mjs — 전 업로드 경로·핵심 워크플로우 QA (실서버 대상, 산출물 자동 정리)
const b64 = (s) => Buffer.from(s, "utf-8").toString("base64");
const results = [];
const rec = (id, name, expected, actual, pass, note) => {
  results.push({ id, name, expected, actual, pass, note: note || "" });
  console.log(pass ? "✓" : "✗", id, name, "—", actual, note ? "[" + note + "]" : "");
};

const base = "http://localhost:4000";
const login = await fetch(base + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "jyh", password: "changeme" }),
}).then((r) => r.json());
const H = { Authorization: "Bearer " + login.accessToken, "Content-Type": "application/json" };
const P = (u, body, hdr) => fetch(base + u, { method: "POST", headers: hdr || H, body: JSON.stringify(body) });
const G = (u, hdr) => fetch(base + u, { headers: hdr || H });

console.log("━━ A. 취약점 스캔 업로드 ━━");
let r = await P("/api/vulnscan/import", { content: "Host,Name,Risk,CVE\n10.99.99.1,QA Test Vuln,High,CVE-2024-0001\n10.99.99.1,QA Low Vuln,Low,", format: "csv", source: "qa" });
let j = await r.json();
rec("A1", "CSV 정상 업로드", "호스트1·finding2", r.status + " hosts=" + j.hosts + " findings=" + j.findings, r.status === 200 && j.hosts === 1 && j.findings === 2);

r = await P("/api/vulnscan/import", { content: JSON.stringify([{ host: "10.99.99.2", name: "QA JSON Vuln", risk: "Medium", cve: "CVE-2024-0002" }]), format: "json", source: "qa" });
j = await r.json();
rec("A2", "JSON 정상 업로드", "호스트1·finding1", r.status + " hosts=" + j.hosts + " findings=" + j.findings, r.status === 200 && j.hosts === 1 && j.findings === 1);

const nessus = `<NessusClientData_v2><Report><ReportHost name="10.99.99.3"><HostProperties><tag name="operating-system">Linux Kernel 5.4 on Ubuntu 20.04</tag></HostProperties><ReportItem pluginID="99001" pluginName="QA Nessus Vuln" severity="3" port="443" protocol="tcp"><risk_factor>High</risk_factor><cve>CVE-2024-0003</cve><description>qa</description></ReportItem></ReportHost></Report></NessusClientData_v2>`;
r = await P("/api/vulnscan/import", { content: nessus, format: "nessus", source: "qa" });
j = await r.json();
const nessusAsset = await G("/api/assets/vuln:10.99.99.3").then((x) => x.json()).catch(() => null);
const osComp = nessusAsset && nessusAsset.components && nessusAsset.components.length > 0;
rec("A3", ".nessus XML 업로드(OS 메타)", "호스트1·finding1+OS구성요소", r.status + " hosts=" + j.hosts + " findings=" + j.findings + " OS구성요소=" + (osComp ? "있음" : "없음"), r.status === 200 && j.hosts === 1 && j.findings >= 1 && osComp);

r = await P("/api/vulnscan/import", { content: "garbage garbage no commas just text", format: "csv", source: "qa" });
j = await r.json();
rec("A4", "깨진 CSV", "오류 또는 0건 안내", r.status + " hosts=" + (j.hosts ?? "-") + " err=" + (j.error || "없음"), r.status === 200 || r.status === 400, r.status === 200 && j.hosts === 0 ? "조용히 0건 — 사용자 경고 미제공(개선 후보)" : "");

r = await P("/api/vulnscan/import", { content: "", format: "csv", source: "qa" });
j = await r.json();
rec("A5", "빈 파일", "400 또는 0건", r.status + " " + (j.error || "hosts=" + j.hosts), r.status === 400 || j.hosts === 0, r.status !== 400 ? "400 대신 " + r.status + "(조용한 0건)" : "");

r = await P("/api/vulnscan/import", { content: "x", format: "xml", source: "qa" });
rec("A6", "format 오타(xml)", "400", String(r.status), r.status === 400);

r = await P("/api/vulnscan/import", { content: "x", format: "csv" }, { "Content-Type": "application/json" });
rec("A7", "토큰 없이 업로드", "401", String(r.status), r.status === 401);

console.log("━━ B. 문서·분석(장기기억) 업로드 ━━");
r = await P("/api/memory/ingest-file", { filename: "QA_보안점검_보고서.md", content: b64("# QA 보고서\n분기 보안 점검 결과 요약. 취약점 3건 조치 완료.") });
j = await r.json();
rec("B1", ".md 업로드+분류", "200·분류=보고서", r.status + " chunks=" + j.chunks + " 분류=" + (j.docClass || "-"), r.status === 200 && j.docClass === "보고서");

r = await P("/api/memory/ingest-file", { filename: "QA_한글問題없음_점검로그.log", content: b64("2026-07-17 방화벽 정책 위반 로그 3건 기록됨") });
j = await r.json();
rec("B2", "한글 파일명 .log", "200 수집", r.status + " chunks=" + j.chunks + " 분류=" + (j.docClass || "-"), r.status === 200 && j.chunks >= 1);

r = await P("/api/memory/ingest-file", { filename: "QA_empty.txt", content: b64("") });
j = await r.json();
rec("B3", "빈 문서", "400 추출 실패 안내", r.status + " " + (j.error || "").slice(0, 40), r.status === 400);

r = await P("/api/memory/ingest-file", { filename: "QA_malware.exe", content: Buffer.from([0x4d, 0x5a, 0x90, 0, 1, 2, 3]).toString("base64") });
j = await r.json();
rec("B4", "지원 외 바이너리 .exe", "400 거부", r.status + " " + (j.error || "chunks=" + j.chunks).slice(0, 50), r.status === 400, r.status === 200 ? "exe가 수집됨 — 확장자 화이트리스트 없음(개선 후보)" : "");

console.log("━━ C. 보안제품 매뉴얼 ━━");
r = await P("/api/security-products/import-doc", { filename: "QA_WAF-01_로그매뉴얼.txt" });
j = await r.json();
rec("C1", "내용 없이 파일명만", "200 제품연결(RAG 없음)", r.status + " → " + (j.productName || "-") + " kind=" + j.kind, r.status === 200 && j.kind === "logManual");

r = await P("/api/security-products/import-doc", { filename: "QA_알수없는장비_매뉴얼.txt", content: b64("알 수 없는 장비 설명서") });
j = await r.json();
const qaProdId = j.productId;
rec("C2", "매칭 불가 → 신규 등록", "기타 카테고리 자동 등록", r.status + " → " + (j.productName || "-") + " cat=" + j.category + " 신규=" + j.createdProduct, r.status === 200 && j.createdProduct === true);

console.log("━━ D. 자산·SBOM ━━");
r = await P("/api/assets/import", { content: JSON.stringify([{ id: "qa-asset-01", name: "QA자산", path: "models/qa.gguf", assetType: "파인튜닝 모델" }]), format: "json", source: "qa" });
j = await r.json();
rec("D1", "자산 JSON 임포트", "imported 1", r.status + " imported=" + (j.imported ?? "-"), r.status === 200 && j.imported === 1);

r = await P("/api/sbom/ai-secbot-01/generate", {});
rec("D2", "SBOM 생성", "200", String(r.status), r.status === 200);

r = await P("/api/sbom/ai-secbot-01/aibom-export", {});
j = await r.json();
rec("D3", "AI-BOM 내보내기(회귀)", "200 CycloneDX", r.status + " " + (j.filename || ""), r.status === 200 && !!j.json);

console.log("━━ E. 보안 엣지 ━━");
r = await G("/api/report/file/..%2F..%2Fpackage.json");
const body1 = await r.text();
rec("E1", "리포트 파일 경로조작", "차단", r.status + "", r.status !== 200 || !body1.includes("dependencies"));

r = await P("/api/assets/no-such-asset/scan", {});
rec("E2", "없는 자산 단건 스캔", "404", String(r.status), r.status === 404);

r = await P("/api/memory/document/delete", { documentId: "없는문서.txt", withFile: true });
j = await r.json();
rec("E3", "없는 문서 삭제", "안전 처리(0건)", r.status + " deleted=" + (j.deletedChunks ?? "-"), r.status === 200 && j.deletedChunks === 0);

console.log("━━ 정리(QA 산출물 삭제) ━━");
for (const id of ["vuln:10.99.99.1", "vuln:10.99.99.2", "vuln:10.99.99.3", "qa-asset-01"]) {
  const d = await fetch(base + "/api/assets/" + encodeURIComponent(id), { method: "DELETE", headers: H });
  console.log("자산 삭제", id, d.status);
}
for (const doc of ["QA_보안점검_보고서.md", "QA_한글問題없음_점검로그.log", "QA_알수없는장비_매뉴얼.txt", "QA_malware.exe"]) {
  await P("/api/memory/document/delete", { documentId: doc, withFile: false });
}
if (qaProdId) {
  const d = await fetch(base + "/api/security-products/" + qaProdId, { method: "DELETE", headers: H });
  console.log("QA 제품 삭제", d.status);
}
const grouped = await G("/api/security-products/grouped").then((x) => x.json());
for (const g of grouped) for (const p of g.products) for (const dd of p.docs) {
  if (dd.title.startsWith("QA_")) {
    await fetch(base + "/api/security-products/docs/" + dd.id, { method: "DELETE", headers: H });
    console.log("QA 문서 제거:", dd.title);
  }
}

console.log("");
const pass = results.filter((x) => x.pass).length;
console.log("━━ 결과: " + pass + "/" + results.length + " 통과 ━━");
results.filter((x) => !x.pass || x.note).forEach((x) => console.log(x.pass ? "△" : "✗", x.id, x.name, "—", x.note || x.actual));
import("fs").then((fs) => fs.writeFileSync("qa-results.json", JSON.stringify(results, null, 2)));
