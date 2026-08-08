// engine/logguide.ts — 보안 로그 파일 분석: 파일 대장 + 행동강령 대응 절차 (2026-08-09 신설)
//
// 사용자 지시("보안 로그 파일 분석 — 행동강령 대응 후작업 가이드"). 「추가 기능 > 보안 로그
// 파일 분석」 화면의 서버 몫이다. 계획서상 1차 목표(3소스 분석)의 연장 — 새 파서를 만들지
// 않고, 이미 대화창 ＋로 들어와 정규화된 보안로그 이벤트(analysishub, source="log")를
// **파일 단위로 묶어** 보여주고, 이벤트 유형별 대응 절차를 결정적으로 붙인다.
//
// ⚠ 절차는 **규칙(코드)**이다 — LLM에 묻지 않는다. 담당자가 이 절차를 그대로 따라 하므로
//   지어냄이 섞이면 안 된다(내 업무 화면 workguide와 같은 원칙). 근거는 표준(KISA 침해사고
//   대응 안내)과 사내 행동강령 문서를 가리키되, 사내 문서 인용이 필요하면 대화창에 물어
//   근거와 함께 받도록 안내한다 — 여기서 문서 내용을 지어 넣지 않는다.
import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { listAnalysisEvents, type AnalysisEvent } from "./analysishub";

export interface LogFileSummary {
  /** 파일(라벨) 이름 — 이벤트의 ref가 이것이다 */
  ref: string;
  events: number;
  p0: number;
  p1: number;
  /** 아직 열린 것(완료·무시 제외) */
  open: number;
  latestAt: number;
}

/** 올린 로그 파일 대장 — source="log" 이벤트를 ref(파일/라벨)로 묶는다. */
export function logFileSummaries(): LogFileSummary[] {
  const byRef = new Map<string, LogFileSummary>();
  for (const e of listAnalysisEvents()) {
    if (e.source !== "log") continue;
    const s = byRef.get(e.ref) ?? { ref: e.ref, events: 0, p0: 0, p1: 0, open: 0, latestAt: 0 };
    s.events++;
    if (e.priority === "P0") s.p0++;
    if (e.priority === "P1") s.p1++;
    if (!(e.status === "done" || e.status === "ignored")) s.open++;
    s.latestAt = Math.max(s.latestAt, e.at);
    byRef.set(e.ref, s);
  }
  return [...byRef.values()].sort((a, b) => b.latestAt - a.latestAt);
}

export type LogEventKind = "브루트포스" | "포트스캔" | "차단폭주" | "웹공격";

export interface ResponseGuide {
  kind: LogEventKind;
  title: string;
  /** 근거 — 무엇에 기반한 절차인지. 사내 문서를 지어 인용하지 않는다. */
  basis: string;
  steps: string[];
  /** [후속 작업으로 담기]가 만들 할 일 문구 */
  followup: string;
}

/** 이벤트 유형 판별 — 제목·신호로 결정적으로. 모르면 null(지어내지 않는다). */
export function classifyLogEvent(e: Pick<AnalysisEvent, "title" | "signals">): LogEventKind | null {
  const t = e.title ?? "";
  const sig = e.signals ?? [];
  if (t.includes("브루트포스") || sig.includes("브루트포스")) return "브루트포스";
  if (t.includes("포트 스캔") || sig.includes("포트스캔")) return "포트스캔";
  if (t.includes("차단 폭주")) return "차단폭주";
  if (t.includes("웹 공격") || sig.includes("웹공격")) return "웹공격";
  return null;
}

// 절차 원문 — KISA 침해사고 대응 안내서의 공통 절차(식별→차단→점검→감시)를 유형별로 구체화.
// 사내 행동강령(대응 수칙)이 반입돼 있으면 대화창이 그 문서를 근거로 보완한다.
const GUIDES: Record<LogEventKind, Omit<ResponseGuide, "kind">> = {
  브루트포스: {
    title: "인증 브루트포스 대응",
    basis: "KISA 침해사고 대응 절차(식별→차단→점검→감시) 기반 · 사내 행동강령이 반입돼 있으면 대화창에서 「브루트포스 대응 수칙 알려줘」로 근거와 함께 확인",
    steps: [
      "출발지 IP가 방화벽에서 이미 차단됐는지 확인합니다",
      "공격 대상 계정의 잠금·비밀번호 상태를 확인합니다(성공한 로그인이 있는지 반드시)",
      "방화벽 정책에 출발지 IP 임시 차단을 등록합니다(결재판 경유)",
      "24시간 동일 대역 재시도 여부를 감시 목록에 올립니다",
    ],
    followup: "브루트포스 대응 — 출발지 차단·계정 점검·재발 감시",
  },
  포트스캔: {
    title: "포트 스캔 대응",
    basis: "KISA 침해사고 대응 절차 기반 · 사내 행동강령은 대화창에서 근거와 함께 확인",
    steps: [
      "스캔된 대상 자산의 열린 포트 목록을 확인합니다(불필요한 서비스가 열려 있는지)",
      "출발지 IP의 평판·내부 여부를 확인합니다(내부면 자산 오동작·점검 활동일 수 있습니다)",
      "불필요하게 열린 포트는 방화벽·호스트에서 닫습니다",
      "같은 출발지의 후속 접근 시도를 일주일간 감시합니다",
    ],
    followup: "포트 스캔 대응 — 열린 포트 정리·출발지 확인",
  },
  차단폭주: {
    title: "방화벽 차단 폭주 대응",
    basis: "KISA 침해사고 대응 절차 기반 · 사내 행동강령은 대화창에서 근거와 함께 확인",
    steps: [
      "차단 폭주가 특정 정책·특정 출발지에 몰려 있는지 확인합니다",
      "정상 업무 트래픽 오차단인지 확인합니다(내부 시스템 연동 변경이 흔한 원인)",
      "공격이면 상위 대역 차단·회선 보호(DDoS 대응)를 검토합니다",
      "차단 추이를 하루 단위로 확인해 진정 여부를 기록합니다",
    ],
    followup: "차단 폭주 대응 — 원인 구분(공격/오차단)·추이 기록",
  },
  웹공격: {
    title: "웹 공격 시그니처 대응",
    basis: "KISA 침해사고 대응 절차 기반 · 사내 행동강령은 대화창에서 근거와 함께 확인",
    steps: [
      "공격 대상 웹 서버·경로가 실제로 존재하는지 확인합니다(없는 경로 스캔이면 위험 낮음)",
      "웹 서버 접근 로그에서 같은 출발지의 성공 응답(200)이 있는지 확인합니다",
      "취약한 경로면 WAF 규칙·웹 서버 설정으로 차단합니다",
      "해당 서버를 취약점 스캔 대상에 올려 재점검합니다",
    ],
    followup: "웹 공격 대응 — 성공 여부 확인·차단·재점검",
  },
};

/** 이벤트의 대응 절차 — 유형을 모르면 null을 준다(빈 절차를 지어내지 않는다). */
export function responseGuideFor(e: Pick<AnalysisEvent, "title" | "signals">): ResponseGuide | null {
  const kind = classifyLogEvent(e);
  if (!kind) return null;
  return { kind, ...GUIDES[kind] };
}

export function registerLogGuideRoutes(app: Express): void {
  app.get("/api/loganalysis/files", authMiddleware, (_req, res) => {
    res.json({ files: logFileSummaries() });
  });
  app.get("/api/loganalysis/guide/:eventId", authMiddleware, (req, res) => {
    const e = listAnalysisEvents().find((x) => x.id === req.params.eventId);
    if (!e) {
      res.status(404).json({ error: "이벤트를 찾지 못했습니다" });
      return;
    }
    const guide = responseGuideFor(e);
    if (!guide) {
      // 모르는 유형은 정직하게 — 일반 절차를 지어 붙이지 않고 대화창으로 안내한다.
      res.json({ guide: null, message: "이 유형의 정형 절차는 아직 없습니다 — 대화창에 「이 이벤트 어떻게 대응해?」로 물으면 사내 자료를 근거로 안내합니다." });
      return;
    }
    res.json({ guide });
  });
}
