// engine/teamview.ts — AI팀 구성 한눈에 보기 (계획서 전-7, 2026-08-09 추천안 승인
// "팀원 끄기는 무시 하고 추천안으로 끝까지 진행")
//
// 제품 이야기: **기반 두뇌는 고객이 고르고(BYOM), 전문성은 GIJO가 고정한다.**
// 외부 조사(2026-08-09) 근거 — Security Copilot도 기반 모델 한 층 + 전문성(플러그인·스킬) 층이고,
// 온프렘 단일 GPU의 표준은 베이스 1개 상주 + 어댑터 갈아끼움(S-LoRA 계열)이다. 팀원마다 서로
// 다른 대형 모델을 두는 것은 VRAM(24GB에 14B 하나가 ~16GB)·프롬프트 캐시·라우팅 결정성
// 실측 모두에 어긋나 채택하지 않았다(예외는 ☁ 외부 상담역 — GPU를 안 먹는다).
//
// 이 모듈은 **집계만** 한다 — 화면(설정 「AI팀 구성」·팀 사무실)이 여러 API를 돌며 조립하면
// 화면마다 다른 그림이 되므로, 팀의 모습은 여기 한 곳에서 계산한다.
// ⚠ 전부 실측값이다. 어댑터가 채택 전이면 「준비 중」이 정직한 표기다 — 1·2회전 모두 불채택이라
//   지금 팀에 실린 어댑터는 0개이고, 그것을 꾸며 보이면 팀 사무실의 "가짜 연출 없음" 약속이 깨진다.
import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { db } from "../db";
import { listAgents } from "./agents";
import { listAdapters } from "./adapters";
import { getLocalEngineStatus } from "./localengine";
import { countTriples } from "./ontology";
import { listAgentTools } from "./agenttools";
import { getCloudConfig } from "./cloudllm";
import { GLOBAL_SCOPE } from "./memory";

export interface TeamMemberView {
  id: string;
  name: string;        // 표시 이름(고객이 바꿀 수 있는 유일한 것)
  defaultName: string;
  role: string;        // 고정 역할 — 코드(AGENT_DEFS)가 단일 출처, 고객 수정 불가
  desc: string;
  status: "idle" | "working" | "watching";
  /** 채택되어 이 팀원에게 배정된 어댑터 id. 없으면 null — 화면은 「준비 중」으로 그린다. */
  adapterId: string | null;
  /** 팀원별 예외 모델 배정(고급). null이면 기반 두뇌를 따른다 — 이것이 기본이자 권장. */
  overrideModelId: string | null;
  /** 이 팀원 전용 지식 문서 수(scope=팀원 id 실측). 0이면 공용 지식만 쓴다. */
  dedicatedDocs: number;
}

export interface TeamComposition {
  /** 기반 두뇌 — 전 팀원이 공유하는 서빙 모델(고객이 BYOM으로 교체하는 자리). */
  base: { modelId: string | null; running: boolean };
  members: TeamMemberView[];
  /** 팀 공용 자산(전문성의 나머지 반) — 문서·온톨로지·도구 실측. */
  shared: { globalDocs: number; totalDocs: number; ontologyTriples: number; tools: number };
  /** 어댑터 등록부 요약 — 채택 n / 등록 n. 채택 0이면 화면은 전원 「준비 중」. */
  adapters: { registered: number; adopted: number };
  /** ☁ 외부 상담역 — 기본 꺼짐·명시적 요청에만·내부 자료 반출 게이트. 키 등 비밀은 안 싣는다. */
  cloud: { enabled: boolean; activeProvider: string | null };
}

// 문서 수는 SQLite 메타(memory_documents)가 원장이다 — LanceDB를 열지 않아 값싸다.
const docCountByScopeStmt = db.prepare("SELECT scope, COUNT(*) AS n FROM memory_documents GROUP BY scope");

export function getTeamComposition(): TeamComposition {
  const engine = getLocalEngineStatus();
  const byScope = new Map<string, number>();
  for (const r of docCountByScopeStmt.all() as { scope: string | null; n: number }[]) {
    byScope.set(r.scope ?? GLOBAL_SCOPE, r.n);
  }
  const totalDocs = [...byScope.values()].reduce((s, n) => s + n, 0);

  const adapters = listAdapters();
  const members: TeamMemberView[] = listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    defaultName: a.defaultName,
    role: a.role,
    desc: a.desc,
    status: a.status,
    adapterId: a.assignedAdapterId,
    overrideModelId: a.assignedModelId,
    dedicatedDocs: byScope.get(a.id) ?? 0,
  }));

  const cloud = getCloudConfig();
  return {
    base: { modelId: engine.modelId, running: engine.running },
    members,
    shared: {
      globalDocs: byScope.get(GLOBAL_SCOPE) ?? 0,
      totalDocs,
      ontologyTriples: countTriples(),
      tools: listAgentTools().length,
    },
    adapters: { registered: adapters.length, adopted: adapters.filter((x) => x.adopted).length },
    // ⚠ getCloudConfig()의 providers(키 설정 여부 포함)는 admin 화면 몫 — 여기엔 켜짐 여부와
    //   활성 provider만 싣는다. 팀 구성은 모든 로그인 사용자가 본다.
    cloud: { enabled: cloud.enabled, activeProvider: cloud.enabled ? cloud.activeProvider : null },
  };
}

export function registerTeamViewRoutes(app: Express): void {
  app.get("/api/team/composition", authMiddleware, (_req, res) => {
    res.json(getTeamComposition());
  });
}
