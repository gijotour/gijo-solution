// 환영 페이지 문구를 안전하게 다시 쓴다.
// 셸/파이썬 인라인으로 NSIS 줄바꿈 토큰($\r$\n)을 넣으려다 이스케이프가 두 번 풀려
// 문구 줄이 통째로 깨진 적이 있다(2026-07-26) — 스크립트 파일로 두면 그 함정이 없다.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(here, "installer.nsh");

const NL = "$\\r$\\n"; // NSIS가 줄바꿈으로 읽는 토큰
// 한 줄이 길면 NSIS가 임의로 접어 글이 깨져 보인다(실측) — 짧게 끊고 사이를 띄운다.
const LINES = [
  "사내에서만 도는 AI 보안관제 플랫폼입니다.",
  "",
  "   ·  취약점 · 로그 · 리포트를 한곳에서 분석",
  "",
  "   ·  로컬 LLM — 자료가 외부로 나가지 않습니다",
  "",
  "   ·  AI-BOM · 레드팀으로 AI 자산까지 보호",
  "",
  "설치 후 사내 GIJO 서버 주소로 로그인하면",
  "바로 쓸 수 있습니다.",
  "",
  "계속하려면 [다음]을 누르세요.",
];

const raw = fs.readFileSync(p);
const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
const text = raw.toString("utf8").replace(/^﻿/, "");
const lines = text.split(/\r?\n/);

const i = lines.findIndex((l) => l.includes("MUI_WELCOMEPAGE_TEXT"));
if (i < 0) throw new Error("MUI_WELCOMEPAGE_TEXT 줄을 찾지 못했습니다");
// 깨져서 여러 줄로 흩어졌을 수 있다 — 다음 !define/!insertmacro 전까지 걷어낸다.
let end = i;
while (end + 1 < lines.length && !/^\s*(!|;)/.test(lines[end + 1])) end++;

lines.splice(end - i + 1 ? i : i, end - i + 1, `  !define MUI_WELCOMEPAGE_TEXT "${LINES.join(NL)}"`);

const out = Buffer.from(lines.join("\r\n"), "utf8");
fs.writeFileSync(p, hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), out]) : out);

const check = fs.readFileSync(p, "utf8").split(/\r?\n/).find((l) => l.includes("MUI_WELCOMEPAGE_TEXT"));
const tokens = (check.match(/\$\\r\$\\n/g) || []).length;
console.log(`[welcome-text] 줄 길이 ${check.length} · 줄바꿈 토큰 ${tokens}개 ${tokens === LINES.length - 1 ? "✓" : "❌"}`);
