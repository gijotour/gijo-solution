// tools/vpn-access-check.mjs — WireGuard VPN 대역(기본 10.8.0.0/24 전체)에서 온 로그인·활성
// 세션만 걸러 찍는다. 셸 중첩 따옴표 문제를 피하려 로그인·조회·필터를 한 Node 프로세스로 묶었다
// (bash→wsl→bash→node 4중 이스케이프는 실측으로 깨지기 쉬움을 확인함, 2026-07-22).
// 상태(마지막으로 본 감사로그 시각)는 파일에 저장해 반복 호출 간 중복 알림을 막는다.
// 실행: node tools/vpn-access-check.mjs   (신규 항목 있을 때만 JSON 출력, 없으면 무출력)

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { account } from "../../tools/qa-account.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.GIJO_BASE ?? "http://localhost:4000";
const { user: USER, pass: PASS } = account("VPN 접속 점검");
const STATE_PATH = process.env.GIJO_VPN_CHECK_STATE ?? path.join(__dirname, "..", "data", "vpn-access-check-state.json");
// 사용자 요청(2026-07-22): 10.8.0.2~10 좁은 범위 → 10.8.0.x 전체(서브넷 전 대역)로 확대.
const RANGE_LOW = Number(process.env.GIJO_VPN_RANGE_LOW ?? 0);
const RANGE_HIGH = Number(process.env.GIJO_VPN_RANGE_HIGH ?? 255);

function inRange(ip) {
  const m = String(ip || "").match(/^(?:::ffff:)?10\.8\.0\.(\d+)$/);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= RANGE_LOW && n <= RANGE_HIGH;
}

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS, force: true }),
  }).then((r) => r.json());
  const token = loginRes.accessToken;
  if (!token) { console.error("로그인 실패"); process.exit(1); }
  const headers = { Authorization: `Bearer ${token}` };

  const audit = await fetch(`${BASE}/api/audit?kind=auth&limit=100`, { headers }).then((r) => r.json());
  const sessions = await fetch(`${BASE}/api/auth/sessions`, { headers }).then((r) => r.json());

  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : { lastAt: 0 };
  const newEntries = (audit.entries || []).filter((e) => inRange(e.target) && e.at > state.lastAt);
  const activeVpn = (Array.isArray(sessions) ? sessions : []).filter((s) => inRange(s.ip));

  const maxAt = newEntries.reduce((m, e) => Math.max(m, e.at), state.lastAt);
  writeFileSync(STATE_PATH, JSON.stringify({ lastAt: maxAt }));

  if (newEntries.length > 0 || (activeVpn.length > 0 && !state.everSeenActive)) {
    if (activeVpn.length > 0) writeFileSync(STATE_PATH, JSON.stringify({ lastAt: maxAt, everSeenActive: true }));
    console.log(JSON.stringify({ newEntries, activeVpn }, null, 2));
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
