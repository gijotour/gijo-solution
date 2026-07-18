// MITRE ATLAS(STIX) → 온톨로지 트리플 변환기. 산출물: src/engine/atlas-ontology-data.ts (오프라인 번들).
// 재생성: node atlas-transform.cjs  (STIX를 자동 다운로드해 변환. 인터넷 필요 — 산출물은 에어갭에서 사용).
const fs = require("fs");
const STIX_URL = "https://raw.githubusercontent.com/mitre-atlas/atlas-navigator-data/main/dist/stix-atlas.json";
const TMP = "data/atlas-stix-tmp.json";

async function ensureStix() {
  if (fs.existsSync(TMP)) return JSON.parse(fs.readFileSync(TMP, "utf-8"));
  console.log("STIX 다운로드:", STIX_URL);
  const r = await fetch(STIX_URL, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`STIX 다운로드 실패: ${r.status}`);
  const j = await r.json();
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(TMP, JSON.stringify(j));
  return j;
}

(async () => {
  const j = await ensureStix();
  const objs = j.objects;
  const atlasId = (o) => (o.external_references || []).find((r) => r.source_name === "mitre-atlas")?.external_id || "";
  const firstSentence = (d) => { const s = (d || "").replace(/\s+/g, " ").trim(); const m = s.match(/^(.{20,120}?[.。])\s/); return (m ? m[1] : s.slice(0, 110)).trim(); };

  const tacticByShort = {}, techById = {}, mitById = {};
  for (const o of objs) {
    if (o.type === "x-mitre-tactic") tacticByShort[o.x_mitre_shortname] = o.name;
    if (o.type === "attack-pattern") { const code = atlasId(o); techById[o.id] = { subject: `${code} ${o.name}`, desc: o.description, phases: o.kill_chain_phases || [] }; }
    if (o.type === "course-of-action") { const code = atlasId(o); mitById[o.id] = { subject: `${code} ${o.name}` }; }
  }
  const triples = [];
  const push = (s, p, ob) => { if (s && p && ob) triples.push({ subject: s, predicate: p, object: ob }); };
  for (const t of Object.values(techById)) {
    push(t.subject, "유형", "AI 적대적 기법(MITRE ATLAS)");
    for (const ph of t.phases) { const tn = tacticByShort[ph.phase_name]; if (tn) push(t.subject, "전술", tn); }
    const d = firstSentence(t.desc); if (d) push(t.subject, "설명", d);
  }
  for (const m of Object.values(mitById)) push(m.subject, "유형", "완화통제(MITRE ATLAS)");
  for (const name of Object.values(tacticByShort)) push(name, "유형", "AI 공격 전술(MITRE ATLAS)");
  for (const o of objs) {
    if (o.type !== "relationship") continue;
    if (o.relationship_type === "mitigates") { const mt = mitById[o.source_ref], tc = techById[o.target_ref]; if (mt && tc) push(tc.subject, "완화통제", mt.subject); }
    if (o.relationship_type === "subtechnique-of") { const sub = techById[o.source_ref], par = techById[o.target_ref]; if (sub && par) push(sub.subject, "상위기법", par.subject); }
  }
  const seen = new Set(), uniq = [];
  for (const t of triples) { const k = `${t.subject}|${t.predicate}|${t.object}`; if (!seen.has(k)) { seen.add(k); uniq.push(t); } }

  const header = "// AUTO-GENERATED — MITRE ATLAS(STIX) → 온톨로지 트리플. 손으로 편집하지 말 것.\n// 출처: mitre-atlas/atlas-navigator-data dist/stix-atlas.json (오프라인 번들, 에어갭 대응).\n// 재생성: node server/atlas-transform.cjs (STIX 자동 다운로드 후 변환).\n";
  fs.writeFileSync("src/engine/atlas-ontology-data.ts", header + `export const ATLAS_ONTOLOGY: { subject: string; predicate: string; object: string }[] = ${JSON.stringify(uniq)};\n`, "utf-8");
  const byPred = {}; for (const t of uniq) byPred[t.predicate] = (byPred[t.predicate] || 0) + 1;
  console.log("트리플:", uniq.length, "| 술어별:", JSON.stringify(byPred));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
