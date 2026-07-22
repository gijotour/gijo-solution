// tools/opslog-watch.mjs — GIJO AS 자체 운영 로그(server.log) 상시 감시.
// 새로 쌓인 로그 구간만 결정적 패턴으로 훑어 findings 파일에 누적 저장한다(요청 시 즉답 가능하게).
// 실행 방식: systemd 타이머로 주기 실행(수 분 간격). 매 실행은 이전 처리 위치(offset)부터만 읽는다
// — logrotate로 파일이 회전되면 크기가 줄어든 걸 감지해 처음부터 다시 읽는다.
//
// 왜 이 방식인가: 실제 서비스에서 반복 관찰된 패턴(모델 hang·재기동 폭주, 임베딩 다운, 종료 지연,
// 예외 스택)은 사람이 로그를 스크롤하며 찾기보다 결정적 정규식으로 집계하는 편이 재현 가능하고 빠르다
// (analysishub.ts의 parseSecurityLog와 같은 철학 — "모든 로그를 마법처럼 이해"하지 않고 아는 패턴만).
//
// 실행: node tools/opslog-watch.mjs [로그경로]  (기본 ../server.log, GIJO_OPSLOG_PATH로 override)

import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.argv[2] || process.env.GIJO_OPSLOG_PATH || path.join(__dirname, "..", "..", "server.log");
const STATE_PATH = process.env.GIJO_OPSLOG_STATE ?? path.join(__dirname, "..", "data", "opslog-watch-state.json");
const FINDINGS_PATH = process.env.GIJO_OPSLOG_FINDINGS ?? path.join(__dirname, "..", "data", "opslog-findings.json");

// ── 패턴 정의: [id, 정규식, 제목, severity, 해결방안 힌트] ──────────────────────
// 이미 원인 규명·수정된 것도 재발 감시 목적으로 남긴다(회귀 조기 발견).
const PATTERNS = [
  {
    id: "chat-hang-restart",
    re: /채팅 모델 hang — 자동 재기동: (\S+)/,
    title: "채팅 모델 hang → 자동 재기동",
    severity: "high",
    remediation:
      "1회는 정상 자가치유(90초 무응답 2연속). 짧은 시간에 반복되면 GPU 경합/VRAM 부족을 의심 — nvidia-smi로 동시 로드 모델 수 확인, 불필요 모델 언로드 또는 healSettleUntil 진정 구간(기본 60s) 조정.",
  },
  {
    id: "embed-hang-restart",
    re: /임베딩 서버 hang — 자동 재기동/,
    title: "임베딩 서버 hang → 자동 재기동",
    severity: "high",
    remediation:
      "RAG 인입·기억 검색이 이 구간 동안 실패했을 수 있음. 반복되면 채팅 모델과 임베딩이 동시에 GPU를 다투는지(healSettleUntil 카스케이드 재발 여부) 확인.",
  },
  {
    id: "transient-stall-skipped",
    re: /일시 지연.*재기동 취소/,
    title: "일시 지연 감지 → 재기동 취소(자가회복)",
    severity: "low",
    remediation:
      "WSL2 GPU 계층의 일시 정지가 스스로 풀린 케이스 — 죽이기 전 재확인(CONFIRM_TIMEOUT_MS)에서 정상 응답해 불필요한 재기동을 막았다. 이 건수가 hang-restart보다 많으면, 과거 'hang'의 상당수가 자가회복 가능한 일시 지연이었다는 뜻(정상 동작). RAG·채팅 서비스 영향 없음.",
  },
  {
    id: "llama-boot-fail",
    re: /llama-server 기동 실패 \(model=(\S+)\)/,
    title: "llama-server 기동 실패",
    severity: "critical",
    remediation:
      "모델 파일 경로·GGUF 무결성·GPU 메모리 확인. 포트 충돌(고아 프로세스)이면 pkill -f llama-server 후 서비스 재시작.",
  },
  {
    id: "embed-boot-fail",
    re: /임베딩 서버 기동 실패/,
    title: "임베딩 서버 기동 실패",
    severity: "critical",
    remediation: "bge-m3 모델 파일 존재 확인, 포트 8081 점유 여부 확인 후 서비스 재시작.",
  },
  {
    id: "shutdown-timeout",
    re: /강제 종료합니다|서버가 닫히지 않아/,
    title: "종료 처리 시간 초과 → 강제 종료",
    severity: "medium",
    remediation:
      "KillMode=mixed(override.conf) 적용 여부 확인. 재발하면 SHUTDOWN_DEADLINE_MS를 늘리거나 종료 시점에 물려있는 요청(긴 리포트 생성 등) 확인.",
  },
  {
    id: "uncaught-error",
    re: /UnhandledPromiseRejection|uncaughtException|TypeError:|ReferenceError:/,
    title: "처리되지 않은 예외/타입 오류",
    severity: "high",
    remediation: "스택 트레이스로 발생 파일·라인 특정 후 원인 수정. 재현 가능하면 회귀 테스트 추가.",
  },
  {
    id: "auth-lockout",
    re: /로그인 실패.{0,10}(잠금|잠겼|lock)/i,
    title: "로그인 실패 임계 초과 → 계정 잠금",
    severity: "low",
    remediation: "정상 방어 동작. 특정 계정에서 반복되면 담당자 확인(비번 분실 vs 무차별 대입 시도).",
  },
];

function loadJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function main() {
  if (!existsSync(LOG_PATH)) {
    console.log(`[opslog-watch] 로그 파일 없음: ${LOG_PATH}`);
    return;
  }
  const size = statSync(LOG_PATH).size;
  const state = loadJson(STATE_PATH, { offset: 0 });
  // 회전(rotate)으로 파일이 작아졌으면 처음부터 다시 읽는다.
  const startAt = size < state.offset ? 0 : state.offset;

  const buf = readFileSync(LOG_PATH);
  const chunk = buf.subarray(startAt, size).toString("utf8");
  const lines = chunk.split(/\r?\n/).filter(Boolean);

  const findings = loadJson(FINDINGS_PATH, { generatedAt: 0, scannedLines: 0, items: {} });
  let newHits = 0;
  for (const line of lines) {
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      const key = p.id + (m[1] ? `:${m[1]}` : "");
      const cur = findings.items[key] ?? {
        id: p.id,
        title: p.title,
        severity: p.severity,
        remediation: p.remediation,
        count: 0,
        firstSeen: Date.now(),
        lastSeen: 0,
        sample: "",
      };
      cur.count++;
      cur.lastSeen = Date.now();
      cur.sample = line.slice(0, 300);
      findings.items[key] = cur;
      newHits++;
      break; // 한 줄은 첫 매치 패턴만
    }
  }
  findings.generatedAt = Date.now();
  findings.scannedLines = (findings.scannedLines || 0) + lines.length;
  saveJson(FINDINGS_PATH, findings);
  saveJson(STATE_PATH, { offset: size });

  console.log(`[opslog-watch] 신규 ${lines.length}줄 스캔, 매치 ${newHits}건, 누적 findings ${Object.keys(findings.items).length}종 → ${FINDINGS_PATH}`);
}

main();
