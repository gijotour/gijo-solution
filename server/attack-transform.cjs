// MITRE ATT&CK Enterprise(STIX) → 온톨로지 트리플. 취약점 악용 생애주기 전술로 필터링(top-level만).
// 재생성: node attack-transform.cjs (STIX 자동 다운로드). 산출물: src/engine/attack-ontology-data.ts (오프라인 번들).
const fs = require("fs");
const STIX_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json";
const TMP = "data/attack-stix-tmp.json";
// 취약점 관리와 직접 관련된 전술(초기침투~영향). 방대한 정찰·방어우회·발견 등은 제외.
const KEEP_TACTICS = new Set(["initial-access", "execution", "persistence", "privilege-escalation", "credential-access", "lateral-movement", "impact"]);

async function ensure() {
  if (fs.existsSync(TMP)) return JSON.parse(fs.readFileSync(TMP, "utf-8"));
  const r = await fetch(STIX_URL, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error("STIX " + r.status);
  const j = await r.json(); fs.mkdirSync("data", { recursive: true }); fs.writeFileSync(TMP, JSON.stringify(j)); return j;
}
const attackId = (o) => (o.external_references || []).find((r) => r.source_name === "mitre-attack")?.external_id || "";
const firstSentence = (d) => { const s = (d || "").replace(/\s+/g, " ").trim(); const m = s.match(/^(.{20,120}?[.。])\s/); return (m ? m[1] : s.slice(0, 110)).trim(); };
const active = (o) => !o.revoked && !o.x_mitre_deprecated;

(async () => {
  const j = await ensure();
  const objs = j.objects;
  const tacticByShort = {}, techById = {}, mitById = {};
  for (const o of objs) {
    if (o.type === "x-mitre-tactic" && active(o)) tacticByShort[o.x_mitre_shortname] = o.name;
  }
  for (const o of objs) {
    if (o.type === "attack-pattern" && active(o) && !o.x_mitre_is_subtechnique) {
      const phases = (o.kill_chain_phases || []).filter((p) => KEEP_TACTICS.has(p.phase_name));
      if (phases.length === 0) continue;
      techById[o.id] = { subject: `${attackId(o)} ${o.name}`, desc: o.description, phases };
    }
    if (o.type === "course-of-action" && active(o)) mitById[o.id] = { subject: `${attackId(o)} ${o.name}` };
  }
  const triples = [];
  const push = (s, p, ob) => { if (s && p && ob) triples.push({ subject: s, predicate: p, object: ob }); };
  for (const t of Object.values(techById)) {
    push(t.subject, "유형", "공격 기법(MITRE ATT&CK Enterprise)");
    for (const ph of t.phases) { const tn = tacticByShort[ph.phase_name]; if (tn) push(t.subject, "전술", tn); }
    const d = firstSentence(t.desc); if (d) push(t.subject, "설명", d);
  }
  const usedMit = new Set();
  for (const o of objs) {
    if (o.type !== "relationship" || o.relationship_type !== "mitigates") continue;
    const mt = mitById[o.source_ref], tc = techById[o.target_ref];
    if (mt && tc) { push(tc.subject, "완화통제", mt.subject); usedMit.add(mt.subject); }
  }
  for (const name of Object.values(tacticByShort)) push(name, "유형", "공격 전술(MITRE ATT&CK)");
  for (const m of usedMit) push(m, "유형", "완화통제(MITRE ATT&CK)");

  const seen = new Set(), uniq = [];
  for (const t of triples) { const k = `${t.subject}|${t.predicate}|${t.object}`; if (!seen.has(k)) { seen.add(k); uniq.push(t); } }
  const header = "// AUTO-GENERATED — MITRE ATT&CK Enterprise(STIX) → 온톨로지 트리플(취약점 악용 전술 필터). 손으로 편집 금지.\n// 출처: mitre-attack/attack-stix-data enterprise-attack.json. 재생성: node server/attack-transform.cjs.\n";
  fs.writeFileSync("src/engine/attack-ontology-data.ts", header + `export const ATTACK_ONTOLOGY: { subject: string; predicate: string; object: string }[] = ${JSON.stringify(uniq)};\n`, "utf-8");
  const byPred = {}; for (const t of uniq) byPred[t.predicate] = (byPred[t.predicate] || 0) + 1;
  console.log("기법:", Object.keys(techById).length, "| 트리플:", uniq.length, "| 술어별:", JSON.stringify(byPred), "| 크기:", (fs.statSync("src/engine/attack-ontology-data.ts").size / 1024).toFixed(0) + "KB");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
