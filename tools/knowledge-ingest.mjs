#!/usr/bin/env node
// 지식베이스 보강 — 인터넷 리서치 문서(거버넌스·취약점 표준)를 운영 서버에 실인입.
//  ① knowledge/*.md → /api/memory/ingest-file (bge-m3 임베딩 실경로)
//  ② 표준 관계 트리플 → /api/ontology/triples (source로 멱등 관리)
// 실행(WSL 안): QA_USER=... QA_PASS=... node tools/knowledge-ingest.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.QA_BASE || "http://localhost:4000";
const SOURCE = "internet-research-2026-07"; // 온톨로지 멱등 키

const login = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.QA_USER, password: process.env.QA_PASS, force: true }),
}).then((r) => r.json());
if (!login.accessToken) { console.error("로그인 실패", login); process.exit(1); }
const H = { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` };
const api = (p, body) => fetch(BASE + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });

// ① RAG 인입 — 같은 파일명이 이미 있으면 지우고 다시 넣는다(멱등).
const docs = ["GIJO_지식_보안거버넌스_표준.md", "GIJO_지식_취약점_식별체계.md"];
const existing = await api("/api/memory/documents").then((r) => r.json());
for (const name of docs) {
  const dup = (Array.isArray(existing) ? existing : existing.documents ?? []).find((d) => (d.documentId || d.id || "").includes(name) || d.filename === name);
  if (dup) {
    await api("/api/memory/document/delete", { documentId: dup.documentId || dup.id });
    console.log(`↺ 기존 문서 교체: ${name}`);
  }
  const content = fs.readFileSync(path.join(ROOT, "knowledge", name)).toString("base64");
  const r = await api("/api/memory/ingest-file", { filename: name, content, scope: "global" }).then((r) => r.json());
  console.log(`📚 인입 ${name}:`, JSON.stringify(r).slice(0, 200));
}

// ② 온톨로지 트리플 — 기존 같은 source 트리플 제거 후 재삽입(멱등).
const all = await api("/api/ontology/triples").then((r) => r.json());
const stale = (Array.isArray(all) ? all : []).filter((t) => t.source === SOURCE);
for (const t of stale) await fetch(`${BASE}/api/ontology/triple/${t.id}`, { method: "DELETE", headers: H });
if (stale.length) console.log(`↺ 기존 ${SOURCE} 트리플 ${stale.length}건 제거`);

const T = (subject, predicate, object) => ({ subject, predicate, object, scope: "global", source: SOURCE });
const triples = [
  // 식별자 5형제
  T("CVE", "정의", "공개된 소프트웨어 취약점 하나하나에 붙는 고유 식별자"),
  T("CVE", "관리기관", "MITRE"),
  T("CVE", "표기형식", "CVE-연도-일련번호 (예: CVE-2021-44228)"),
  T("CVE", "상세정보제공", "NVD(미국 국립취약점데이터베이스, NIST 운영)"),
  T("CWE", "정의", "취약점의 근본 원인이 되는 소프트웨어 약점 유형 분류"),
  T("CWE", "관리기관", "MITRE"),
  T("CWE", "대표예시", "CWE-79 크로스사이트 스크립팅, CWE-89 SQL 인젝션"),
  T("CVE", "근본원인분류", "CWE"),
  T("CCE", "정의", "시스템 보안 설정(구성) 이슈의 고유 식별자"),
  T("CCE", "구분점", "코드 결함(CVE)이 아니라 '비밀번호 최소 길이' 같은 설정 실수를 다룬다"),
  T("CCE", "매핑대상", "CIS 벤치마크·NIST 설정 가이드·DISA STIG"),
  T("CCE", "국내활용", "KISA 주요정보통신기반시설 기술적 취약점 분석·평가 가이드의 항목 코드"),
  T("CCE", "제품연계", "GIJO AS 하드닝 점검(kisa·kisa_pc·kisa_net 표준)"),
  T("CPE", "정의", "취약점이 해당하는 제품·플랫폼의 식별자"),
  T("CAPEC", "정의", "약점을 악용하는 공격 패턴의 카탈로그"),
  T("CAPEC", "연계", "CWE 약점을 표적으로 삼고 MITRE ATT&CK 전술로 이어진다"),
  // 우선순위 지표
  T("CVSS", "정의", "취약점의 본질적 심각도를 0~10으로 점수화하는 표준"),
  T("CVSS", "최신버전", "4.0 (2024년 확정)"),
  T("CVSS", "한계", "심각도 지표일 뿐 실제 악용 가능성은 반영하지 못한다"),
  T("EPSS", "정의", "향후 30일 내 악용될 확률을 기계학습으로 예측하는 점수(0~100%)"),
  T("EPSS", "운영기관", "FIRST"),
  T("EPSS", "최신버전", "v4 (2025년 3월)"),
  T("KEV", "정의", "실제 악용 증거가 확인된 취약점만 올리는 목록"),
  T("KEV", "발행기관", "CISA(미국 사이버보안·인프라보안청)"),
  T("KEV", "조치원칙", "실제 공격에 쓰이는 중이므로 무조건 최우선 조치"),
  T("SSVC", "정의", "의사결정 나무로 조치 등급(Act/Attend/Track)을 정하는 방식"),
  T("취약점 우선순위", "권장순서", "① KEV 등재 → ② Critical+EPSS 상위 → ③ CVSS·VPR 점수순"),
  // 거버넌스
  T("정보보안 거버넌스", "정의", "경영진이 보안 방향을 정하고 책임을 나누고 감독하는 체계(실행 담당인 관리와 구분)"),
  T("정보보안 거버넌스", "핵심요소", "위험 성향·역할과 책임·정책과 감독·공급망 위험 관리"),
  T("NIST CSF 2.0", "발표시기", "2024년 2월"),
  T("NIST CSF 2.0", "기능구성", "거버넌스·식별·보호·탐지·대응·복구 6개 기능"),
  T("NIST CSF 2.0", "신설기능", "GOVERN(거버넌스) — 나머지 5개 기능의 구현을 지휘"),
  T("ISMS-P", "정의", "한국의 정보보호 및 개인정보보호 관리체계 인증 제도"),
  T("ISMS-P", "관리기관", "KISA(한국인터넷진흥원)"),
  T("ISMS-P", "인증기준", "3개 영역 총 102개 통제항목(관리체계 16·보호대책 64·개인정보 22)"),
  T("ISO/IEC 27001", "정의", "정보보호경영시스템(ISMS)의 국제 인증 표준(2022년 개정, 93개 통제항목)"),
  T("ISO/IEC 27014", "정의", "정보보안 거버넌스만 따로 다루는 국제 표준"),
];
const inserted = await api("/api/ontology/triples", { triples }).then((r) => r.json());
console.log(`🕸 온톨로지 트리플 ${Array.isArray(inserted) ? inserted.length : "?"}건 삽입`);
const stats = await api("/api/ontology/stats").then((r) => r.json());
console.log(`🕸 전체 트리플: ${stats.count}건`);
