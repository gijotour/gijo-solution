// engine/activityaudit.ts — 담당자가 화면에서 한 "바꾸는 행위"를 전 메뉴에서 자동으로 남긴다.
//
// 왜 미들웨어인가(2026-07-26 사용자 지시 "전 메뉴 이용에 대한 감사 적용"):
// 라우트마다 손으로 recordAudit를 붙이는 방식은 반드시 빠진다 — 실제로 보안제품 화면 전체(등록·수정·
// 삭제)에 감사가 하나도 없었고, 그래서 담당자가 제품을 지웠을 때 누가 언제 지웠는지 알 수 없었다.
// 매뉴얼만 지식베이스에 고아로 남았다. 한 곳에서 걸면 앞으로 새로 만드는 라우트도 자동으로 덮인다.
//
// 무엇을 남기나: 상태를 바꾸는 요청(POST/PUT/PATCH/DELETE)만. 조회(GET)는 남기지 않는다 —
// 화면 하나 여는 데 수십 건이 쌓이면 정작 중요한 기록이 묻힌다.
//
// 무엇을 남기지 않나: 비밀번호가 실리는 인증 경로, 폴링성 잡음, 그리고 라우트가 이미 자기 손으로
// 더 자세히 남기는 것(그건 kind=write로 따로 남으므로 여기서는 kind=config로 구분해 둔다).

import type { Express, Request, Response, NextFunction } from "express";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";

// 비밀번호·토큰이 오가거나, 사람의 행위로 보기 어려운 경로.
const SKIP_RE =
  /^\/api\/(auth|health|screen-tips|long-answers\/[^/]+\/ack|collaboration|llm\/activity|memory\/query)\b/;

// 경로 → 사람이 읽는 메뉴 이름. 없으면 경로 첫 마디를 그대로 쓴다.
const MENU: Record<string, string> = {
  assets: "자산", "security-products": "보안제품", vulnscan: "취약점", approvals: "조치·승인",
  report: "리포트", "work-sessions": "작업 내역", memory: "AI 기억·학습", ontology: "온톨로지",
  hardening: "하드닝 점검", "analysis-hub": "보안 분석", cti: "위협 인텔리전스", threat: "위협 인텔리전스",
  users: "계정 관리", settings: "설정", law: "법령 조회", tasks: "작업", learnloop: "학습 루프",
  dispatch: "지시", terminal: "CLI 터미널", redteam: "레드팀", sbom: "AI-BOM", compliance: "컴플라이언스",
  backup: "백업", siem: "SIEM 연동", "client": "클라이언트 배포", kpi: "보안 KPI",
};

const VERB: Record<string, string> = { POST: "추가·실행", PUT: "수정", PATCH: "수정", DELETE: "삭제" };

/**
 * 경로 끝마디가 이것이면 **무슨 일이었는지**를 행위 이름에 싣는다.
 *
 * 왜 필요한가(2026-08-09 실측): 비밀번호를 바꾸고 감사 기록을 찾았더니
 *   `계정 관리 추가·실행 · target: umrnt7chkjh2peq/password`
 * 였다. **계정을 새로 만든 것과 글자 그대로 같은 문구**다. 구분은 target 끝의
 * `/password` 뿐이라, 「누가 언제 비밀번호를 바꿨나」를 뽑으려면 사람이 경로를 읽어야 한다.
 * 보안 제품의 감사 기록이 그러면 안 된다 — 감사 대응은 대개 남이, 급할 때 본다.
 *
 * ⚠ 넓게 추론하지 않는다(끝마디가 영문이면 다 싣는 식). 감사 기록은 **틀린 이름이
 *   붙는 것이 안 붙는 것보다 나쁘다.** 확실한 것만 표에 적고, 나머지는 지금처럼 둔다.
 */
const 세부행위: Record<string, string> = {
  password: "비밀번호 변경",
  "mfa/reset": "2차 인증 해제",
  role: "권한 변경",
  disable: "계정 잠금",
  enable: "계정 잠금 해제",
};

/** target(경로 나머지)에서 세부 행위 이름을 찾는다. 없으면 null. */
export function 세부행위이름(target: string): string | null {
  if (!target || target === "-") return null;
  const 조각 = target.split("/").filter(Boolean);
  const 끝둘 = 조각.slice(-2).join("/");
  const 끝 = 조각[조각.length - 1] ?? "";
  return 세부행위[끝둘] ?? 세부행위[끝] ?? null;
}

/** 경로에서 메뉴 이름과 대상을 뽑는다. /api/assets/vuln:web01/scan → ["자산", "vuln:web01"] */
export function describePath(path: string): { menu: string; target: string } {
  const parts = path.replace(/^\/api\//, "").split("?")[0].split("/").filter(Boolean);
  const head = parts[0] ?? "";
  const menu = MENU[head] ?? head;
  // 두 번째 마디가 id처럼 보이면 대상으로, 아니면 하위 기능 이름으로 본다.
  const rest = parts.slice(1).join("/");
  return { menu, target: rest || "-" };
}

export function registerActivityAudit(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!/^(POST|PUT|PATCH|DELETE)$/.test(req.method)) return next();
    if (!req.path.startsWith("/api/")) return next();
    if (SKIP_RE.test(req.path)) return next();

    // 응답이 끝난 뒤에 남긴다 — 실패한 요청까지 "했다"고 기록하면 감사 기록이 거짓이 된다.
    res.on("finish", () => {
      const ok = res.statusCode < 400;
      const { menu, target } = describePath(req.path);
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      if (!actor) return; // 로그인 안 된 요청(거부됨)은 인증 로그가 따로 남는다
      recordAudit({
        kind: "config", // 라우트가 자기 손으로 남기는 상세 기록(kind=write)과 구분한다
        // 무슨 일이었는지가 확실하면 그 이름을 쓴다 — 「계정 관리 추가·실행」으로 뭉뚱그리면
        // 감사 때 비밀번호 변경과 계정 생성이 구분되지 않는다(실측으로 확인한 문제다).
        action: `${menu} ${세부행위이름(target) ?? VERB[req.method] ?? req.method}`,
        target,
        detail: `${req.method} ${req.path}`,
        actor,
        result: ok ? "ok" : "error",
      });
    });
    next();
  });
}
