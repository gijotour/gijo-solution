// grouppanels.js — 그룹 허브의 판(한눈에) 정의 한 곳 (2026-08-09).
//
// 사이드바 5개 업무 그룹을 각각 "한눈에 띠 + 하단 무대" 한 화면으로 통합했다(사용자 지시).
// 판 정의를 화면마다 흩어 두면 그룹이 늘 때마다 같은 코드를 베끼게 되고, 숫자 기준이 서로
// 어긋난다 — **여기 한 곳**에 모아 두고 각 허브 화면은 그룹 이름만 넘긴다.
//
// 규칙
//   · 요약 숫자는 **그 메뉴 화면이 쓰는 것과 같은 API·같은 기준**으로 센다.
//   · 데이터가 없어도 **같은 모양**으로 그린다(0은 0으로 — 판이 사라지거나 모양이 달라지면
//     담당자는 "고장인가?"를 먼저 의심한다. 2026-08-09 사용자 지시).
//   · 못 구한 값은 "-"로 둔다 — 0으로 채우면 "없다"는 뜻이 되어 거짓이 된다.
//
// ── 선택 필드(2026-08-20 현황판 1단계 · 승인 시안 mockups/panels-overview §8) ──────────
//   기존 판 구조는 **그대로 두고** 아래 셋만 있으면 더 쓴다(없으면 그 기능을 아예 안 그린다 —
//   빈 껍데기를 그리면 「눌러도 아무 일 없는」 자리가 된다).
//     · rows()  : 하위 리스트(엑셀형). → { cols:[], grid:"1fr 90px", rows:[[셀…]] }
//                 ⚠ 요약과 **같은 API·같은 잣대**를 쓴다. 여기서 새로 세지 않는다.
//     · pick    : 🎯 고르기 kind("vuln"|"asset"…) — pick.html이 아는 kind만(5.49.0 통일 계약).
//     · agents  : 담당 AI 팀원 약자 — **근거가 있는 판만**. 근거는 server/src/engine/
//                 hybridsearch.ts ROLE_CATEGORY(역할↔업무영역)와 agents.ts AGENT_DEFS(약자)다.
//                 대응이 없는 판은 **안 적는다** — 지어내면 「AI가 그렇다더라」가 된다.
(function () {
  "use strict";
  var R = "var(--red,#e2483d)", A = "var(--amber,#f0a020)", B = "var(--blue,#3b82f6)",
      T = "var(--teal,#1eb980)", G = "#8a8478", O = "#e8823c";
  var 살아있는 = function (f) { return f.state !== "fixed"; };
  var n = function (v) { return (v == null ? 0 : v).toLocaleString(); };

  // 스캔 오류는 취약점이 아니다(서버 isRealVulnerability와 같은 잣대) — 세는 자리마다 지킨다.
  var SCAN_NOISE = { scan_error: true, info: true };
  var 진짜취약점 = function (f) { return !SCAN_NOISE[f.finding_type] && !SCAN_NOISE[f.severity]; };

  var 그룹 = {
    // ① 발견·수집
    discover: [
      // ⚠ 「📊 보안 태세」 판을 **뺐다**(사장님 승인 2026-08-19, 승인 시안 mockups/자산_0단계 권고).
      //   ①발견·수집은 「무엇이 있고 무엇이 들어왔나」를 보는 자리다. 종합 점수·컴플라이언스는
      //   **결과를 요약하는 숫자**라 ⑤보고의 몫이고, 실제로 그 허브에 같은 화면이 이미 있다
      //   (reporting: kpi→kpi.html). 두 자리에 같은 것을 두면 「어디서 보는 게 맞나」를 매번 고민한다.
      // ⚠ **화면이 사라진 것이 아니다** — `kpi.html`은 ⑤보고에서 그대로 열린다.
      //   ⓪ 자산에서 「🖥 자산」을 뺀 것과 같은 정리다(자산은 ⓪로, 지표는 ⑤로).
      // rows: 열린 이벤트만(요약의 열림 잣대 그대로 — 정리된 것을 목록에 섞으면 요약과 어긋난다).
      { id: "analysis", title: "🚨 통합 관제", page: "analysis.html",
        rows: function () {
          return window.gijo.analysisEvents().then(function (d) {
            var ev = ((d && d.events) || []).filter(function (e) { return !(e.status === "done" || e.status === "ignored"); });
            var 순위 = { P0: 0, P1: 1, P2: 2 };
            ev.sort(function (a, b) { return (순위[a.priority] == null ? 9 : 순위[a.priority]) - (순위[b.priority] == null ? 9 : 순위[b.priority]); });
            return {
              cols: ["이벤트", "우선", "상태"],
              grid: "1fr 54px 74px",
              rows: ev.map(function (e) {
                return [String(e.title || e.summary || e.id || "-"), String(e.priority || "-"), String(e.status || "열림")];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.analysisEvents().then(function (d) {
          var ev = (d && d.events) || [];
          var 열림 = function (e) { return !(e.status === "done" || e.status === "ignored"); };
          var 셈 = function (p) { return ev.filter(function (e) { return e.priority === p && 열림(e); }).length; };
          return {
            segments: [
              { key: "P0", label: "P0", value: 셈("P0"), color: R },
              { key: "P1", label: "P1", value: 셈("P1"), color: O },
              { key: "P2", label: "P2", value: 셈("P2"), color: A },
            ],
            foot: "정리됨 " + n(ev.length - ev.filter(열림).length) + "/" + n(ev.length),
          };
        });
      } },
      // agents: ti(위협) — ROLE_CATEGORY.ti=["위협대응"](hybridsearch.ts:236) 근거.
      { id: "threat", title: "🌐 위협 인텔", page: "threat.html", agents: ["위협"], load: function () {
        return window.gijo.listCtiFindings().then(function (fs) {
          fs = fs || [];
          var 셈 = function (k) { return fs.filter(function (f) { return f.severity === k; }).length; };
          // 샘플(데모) 시드를 실적과 갈라 적는다 — 첫 화면 판에서 「위협 5건」으로 읽히면 거짓이다(2026-08-19).
          var 샘플 = fs.filter(function (f) { return f.source === "샘플(데모)"; }).length;
          return {
            segments: [
              { key: "critical", label: "긴급", value: 셈("critical"), color: R },
              { key: "warning", label: "주의", value: 셈("warning"), color: A },
              { key: "info", label: "정보", value: 셈("info"), color: G },
            ],
            foot: 샘플 ? "실탐지 " + n(fs.length - 샘플) + "건 · 샘플 " + n(샘플) + "건" : "전체 " + n(fs.length) + "건",
          };
        });
      } },
      // ⚠ 「🖥 자산」 판을 **뺐다**(승인 시안 mockups/자산_0단계, 2026-08-18).
      //   자산은 ①발견·수집 **안의 한 판**이 아니라 그 앞의 **범위 축**(⓪ 자산)이 되었다.
      //   두 자리에 남겨 두면 담당자가 「어디서 고르는 게 맞나」를 매번 고민한다 —
      //   이 저장소가 「같은 일 하는 자리가 둘이면 조작 개념만 늘어난다」로 이미 정리한 것이다.
      //   자산 관리(등록·수정·CSV)는 inventory.html 그대로다 — ⓪ 화면의 「전체 관리 열기」로 간다.
      // ⚠ 「📊 보안 태세」(posture)는 **손대지 않았다.** 시안이 그것도 뺄지 물었지만
      //   사장님 확인이 필요한 자리라 남긴다 — 승인 없이 화면을 지우지 않는다.
    ],

    // ② 우선순위
    triage: [
      // agents: analysis(우선) — ROLE_CATEGORY.analysis=["취약점"](hybridsearch.ts:235) 근거.
      // pick: 5.49.0 pick.html이 아는 kind. rows: 요약과 **같은 API·같은 잣대**(살아있는·진짜취약점).
      { id: "vuln", title: "🔍 취약점", page: "vulnscan.html", agents: ["우선"], pick: "vuln",
        rows: function () {
          return window.gijo.listAssets().then(function (assets) {
            var out = [];
            var 순위 = { critical: 0, high: 1, medium: 2, low: 3 };
            (assets || []).forEach(function (a) {
              (a.findings || []).forEach(function (f) {
                if (!살아있는(f) || !진짜취약점(f)) return;
                out.push({ 자산: a.name || a.hostname || a.id, f: f });
              });
            });
            out.sort(function (x, y) {
              var d = (순위[x.f.severity] == null ? 9 : 순위[x.f.severity]) - (순위[y.f.severity] == null ? 9 : 순위[y.f.severity]);
              return d !== 0 ? d : (y.f.kev ? 1 : 0) - (x.f.kev ? 1 : 0);
            });
            return {
              cols: ["취약점", "자산", "심각도", "KEV"],
              grid: "1fr 130px 70px 46px",
              rows: out.map(function (x) {
                return [String(x.f.finding_type || x.f.id || "-"), String(x.자산 || "-"),
                  String(x.f.severity || "-"), x.f.kev ? "KEV" : "-"];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listAssets().then(function (assets) {
          assets = assets || [];
          var 셈 = { critical: 0, high: 0, medium: 0 }, kev = 0, 전체 = 0;
          assets.forEach(function (a) {
            (a.findings || []).forEach(function (f) {
              if (!살아있는(f) || !진짜취약점(f)) return;
              전체++;
              if (f.kev) kev++;
              if (셈[f.severity] != null) 셈[f.severity]++;
            });
          });
          return {
            badge: kev ? { text: "KEV " + kev, color: R } : null,
            segments: [
              { key: "critical", label: "매우 심각", value: 셈.critical, color: R },
              { key: "high", label: "높음", value: 셈.high, color: O },
              { key: "medium", label: "보통", value: 셈.medium, color: A },
            ],
            foot: "미조치 " + n(전체) + "건",
          };
        });
      } },
      { id: "sbom", title: "📦 AI-BOM · 구성", page: "sbom.html", load: function () {
        return window.gijo.listAssets().then(function (assets) {
          assets = assets || [];
          var 있음 = assets.filter(function (a) { return a.sbomGeneratedAt; }).length;
          var ai = assets.filter(function (a) { return a.assetType === "llm-service" || a.assetType === "ml-model"; }).length;
          return {
            rows: [
              ["구성 명세(SBOM) 있음", n(있음)],
              ["아직 없음", n(assets.length - 있음), A],
              ["AI 자산", n(ai)],
            ],
            foot: "전체 자산 " + n(assets.length),
          };
        });
      } },
    ],

    // ③ 조치
    fix: [
      { id: "approvals", title: "✅ 조치·승인", page: "approvals.html",
        rows: function () {
          return window.gijo.listApprovals().then(function (r) {
            var rows = (r && r.reviews) || r || [];
            return {
              cols: ["조치 항목", "담당", "상태"],
              grid: "1fr 90px 74px",
              // 요약의 미배정 잣대와 같은 말(빈 담당은 「미배정」으로 적는다 — "-"로 두면
              // 「담당이 있는데 못 읽었다」와 구분이 안 된다).
              rows: rows.map(function (x) {
                return [String(x.title || x.summary || x.id || "-"), String(x.assignee || "미배정"), String(x.status || "-")];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listApprovals().then(function (r) {
          var rows = (r && r.reviews) || r || [];
          var 셈 = function (s) { return rows.filter(function (x) { return x.status === s; }).length; };
          var 미배정 = rows.filter(function (x) { return !x.assignee && x.status !== "approved" && x.status !== "rejected"; }).length;
          return {
            badge: 미배정 ? { text: "미배정 " + n(미배정), color: A } : null,
            segments: [
              { key: "pending", label: "검토 대기", value: 셈("pending"), color: A },
              { key: "in_progress", label: "진행 중", value: 셈("in_progress"), color: B },
              { key: "approved", label: "완료", value: 셈("approved"), color: T },
            ],
            foot: "전체 " + n(rows.length) + "건",
          };
        });
      } },
      { id: "maintenance", title: "🛠 정기 점검", page: "maintenance.html", load: function () {
        return window.gijo.listMaintenance().then(function (r) {
          var list = (r && r.items) || r || [];
          var now = Date.now();
          var 기한초과 = list.filter(function (m) { return m.dueAt && m.dueAt < now && m.status !== "done"; }).length;
          var 예정 = list.filter(function (m) { return m.status !== "done"; }).length;
          return {
            badge: 기한초과 ? { text: "기한 초과 " + n(기한초과), color: R } : null,
            rows: [
              ["예정·진행", n(예정)],
              ["기한 초과", n(기한초과), 기한초과 ? R : ""],
              ["완료", n(list.length - 예정)],
            ],
            foot: "점검 항목 " + n(list.length) + "건",
          };
        });
      } },
      { id: "terminal", title: "⌨ 명령창", page: "terminal.html", load: function () {
        // 명령창은 "지금 몇 건"이 아니라 **최근에 무엇을 했나**가 요약이다(감사 기록 기준).
        return window.gijo.listAudit("cli", 200).then(function (r) {
          var list = (r && r.entries) || r || [];
          var 하루 = Date.now() - 86400000;
          var 최근 = list.filter(function (e) { return (e.at || e.createdAt || 0) >= 하루; }).length;
          var 차단 = list.filter(function (e) { return e.result === "blocked"; }).length;
          return {
            rows: [
              ["최근 24시간 실행", n(최근)],
              ["차단된 위험 명령", n(차단), 차단 ? A : ""],
              ["기록 보관", n(list.length)],
            ],
            foot: "허용 목록 밖 명령은 실행 전에 막습니다",
          };
        });
      } },
    ],

    // ④ 검증 — 데이터가 없어도 **같은 모양**으로(2026-08-09 사용자 지시: 0이면 0으로 그린다)
    verify: [
      { id: "hardening", title: "🛡 보안설정 점검", page: "hardening.html", load: function () {
        return Promise.all([
          window.gijo.hardeningTargets.list().catch(function () { return []; }),
          window.gijo.hardeningSchedules.list().catch(function () { return []; }),
          window.gijo.hardeningRuns(undefined, 300).catch(function () { return []; }),
        ]).then(function (r) {
          // 응답은 껍데기에 담겨 온다({targets}/{schedules}/{runs}) — 배열로 벗겨 쓴다.
          var targets = (r[0] && r[0].targets) || r[0] || [], schedules = (r[1] && r[1].schedules) || r[1] || [], runs = (r[2] && r[2].runs) || r[2] || [];
          var 활성 = schedules.filter(function (s) { return s.enabled !== false; }).length;
          // 준수율 = 대상별 **가장 최근** 결과만(옛 결과까지 더하면 고친 것이 계속 세어진다).
          var 최근 = {};
          runs.forEach(function (x) { if (!(x.targetId in 최근)) 최근[x.targetId] = x; });
          var vals = Object.values(최근);
          var 합 = vals.reduce(function (a, x) { return a + (x.pass || 0); }, 0);
          var 총 = vals.reduce(function (a, x) { return a + (x.pass || 0) + (x.fail || 0); }, 0);
          return {
            rows: [
              ["등록 장비", n(targets.length)],
              ["활성 스케줄", n(활성)],
              ["평균 준수율", 총 ? Math.round((합 / 총) * 100) + "%" : "-"],
            ],
            foot: vals.length ? "점검 이력 " + n(runs.length) + "회" : "아직 점검 이력이 없습니다",
          };
        });
      } },
    ],

    // ⑤ 보고
    reporting: [
      // agents: report(보고) — ROLE_CATEGORY.report=["사내규정"](보고 서식·규정, hybridsearch.ts:237) 근거.
      { id: "report", title: "📄 리포트", page: "report.html", agents: ["보고"], load: function () {
        return window.gijo.listReportHistory().then(function (r) {
          var list = (r && r.reports) || r || [];
          var 주 = Date.now() - 7 * 86400000;
          var 이번주 = list.filter(function (x) { return (x.createdAt || 0) >= 주 && !x.qa; }).length;
          var 최근 = list.filter(function (x) { return !x.qa; })[0];
          var 지난날 = 최근 ? Math.floor((Date.now() - 최근.createdAt) / 86400000) : null;
          return {
            rows: [
              ["이번 주 작성", n(이번주)],
              ["마지막 보고 후", 지난날 == null ? "-" : 지난날 + "일"],
              ["보관 중", n(list.length)],
            ],
            foot: "정기·수시 보고서가 여기 쌓입니다",
          };
        });
      } },
      { id: "kpi", title: "📈 보안 KPI", page: "kpi.html", load: function () {
        return window.gijo.getSecurityKpi().then(function (k) {
          var c = (k || {}).current || {};
          var BAND = { good: "양호", warn: "주의", bad: "미흡" };
          return {
            badge: c.posture ? { text: BAND[c.posture.band] || "", color: R } : null,
            rows: [
              ["종합 점수", c.posture ? c.posture.score + "/100" : "-"],
              ["미조치 취약점", c.vulnerabilities ? n(c.vulnerabilities.active) : "-", R],
              ["기한 지난 조치", c.remediation && c.remediation.overdue != null ? n(c.remediation.overdue) : "-", A],
            ],
            foot: "지표는 서버가 한 곳에서 셉니다",
          };
        });
      } },
      { id: "compliance", title: "📋 컴플라이언스", page: "compliance.html", load: function () {
        return window.gijo.listCompliance().then(function (r) {
          var list = (r && r.items) || r || [];
          var 셈 = function (s) { return list.filter(function (x) { return x.status === s; }).length; };
          return {
            // 상태 값은 서버 정의 그대로(covered/partial/open/na) — 화면과 같은 말을 쓴다.
            segments: [
              { key: "covered", label: "이행", value: 셈("covered"), color: T },
              { key: "partial", label: "부분", value: 셈("partial"), color: A },
              { key: "open", label: "미이행", value: 셈("open"), color: R },
            ],
            foot: "항목 " + n(list.length) + "개",
          };
        });
      } },
    ],

    // AI — 내 보안 AI의 구성·지식·학습·안전장치(2026-08-09 사용자 지시 "고객 가이드 화면으로").
    // 숫자는 각 화면과 같은 API. 데이터가 없어도 판 모양은 같다(0은 0으로).
    aiops: [
      { id: "team", title: "🤖 AI 팀", page: "agent.html", load: function () {
        return Promise.all([
          window.gijo.listAgents().catch(function () { return []; }),
          window.gijo.listAdapters().catch(function () { return { adapters: [] }; }),
        ]).then(function (r) {
          var agents = r[0] || [];
          var adapters = (r[1] && r[1].adapters) || [];
          // "베이스 모델" = 팀원들이 실제로 쓰는 모델. 개별 배정이 없으면 전역 모델을 따른다.
          var 모델들 = agents.map(function (a) { return a.assignedModelId; }).filter(Boolean);
          var 베이스 = 모델들.length ? 모델들[0] : "전역 모델";
          var 채택 = adapters.filter(function (a) { return a.adopted; }).length;
          var 후보 = adapters.length - 채택;
          return {
            rows: [
              ["베이스 모델", String(베이스).length > 14 ? String(베이스).slice(0, 14) + "…" : String(베이스)],
              ["팀원", agents.length + "명"],
              ["전문가 어댑터", 채택 + "채택 · " + 후보 + "후보"],
            ],
            foot: "모델 교체는 설정 > 서버·AI",
          };
        });
      } },
      // agents: analysis(우선) — 역할 문장이 「AI 지식·모델 관리」다(agents.ts:69).
      { id: "knowledge", title: "📚 지식", page: "memory.html", agents: ["우선"], load: function () {
        return Promise.all([
          window.gijo.listMemoryDocuments().catch(function () { return []; }),
          window.gijo.ontologyStats().catch(function () { return null; }),
        ]).then(function (r) {
          var docs = r[0] || [];
          var 오늘 = new Date().toISOString().slice(0, 10);
          var 오늘반입 = docs.filter(function (d) { return String(d.ingestedAt || "").slice(0, 10) === 오늘; }).length;
          return {
            rows: [
              ["올린 문서", docs.length.toLocaleString()],
              ["표준 관계망(온톨로지)", r[1] && r[1].count != null ? r[1].count.toLocaleString() : "-"],
              ["오늘 반입", String(오늘반입)],
            ],
            foot: "새 문서는 대화창 ＋로 올립니다",
          };
        });
      } },
      { id: "learning", title: "🎓 학습", page: "learnloop.html", load: function () {
        return window.gijo.listLearnloopTopics().then(function (r) {
          var 전체 = (r && r.주제) || [];
          var 짧은 = { "취약점": "취약점", "장비운영": "장비", "사내규정": "규정", "위협대응": "위협" };
          // 정의된 4주제만, 이 순서로 — "(미분류)" 뭉치가 판 한 자리를 먹으면 정작 주제가 밀린다(실측).
          var 순서 = ["취약점", "장비운영", "사내규정", "위협대응"];
          var 주제 = 순서.map(function (name) {
            return 전체.filter(function (t) { return t.topic === name; })[0] || { topic: name, approved: 0, 준비됨: false };
          });
          return {
            segments: 주제.map(function (t) {
              return { key: t.topic, label: (짧은[t.topic] || t.topic) + " " + t.approved, value: t.approved, color: t.준비됨 ? "var(--teal,#1eb980)" : "var(--blue,#3b82f6)" };
            }),
            foot: (r && r.목표승인건수 ? r.목표승인건수 : 300) + "이 차면 전문가 어댑터를 학습할 수 있습니다",
          };
        });
      } },
      // 팀 감독·안전(2026-08-20 사장님 「AI팀 메뉴에 안전장치 통합」 — 승인 시안
      // aiteam-guard-merge): 독립 메뉴였던 감독(supervision)을 이 판으로 흡수 — 무대 착지도
      // supervision.html(감독+안전 화면). 판 요약은 팀/감독/안전 세 줄.
      { id: "safety", title: "🛡 팀 감독·안전", page: "supervision.html", load: function () {
        // ⚠ 「쓰기 결재 대기」에 조치·승인 검토 대장을 갖다 쓰면 안 된다(2026-08-09 실측 4,830):
        //   그 대장은 스캔 발견 건 전체(스캔 오류 포함)라 결재판과 전혀 다른 숫자다.
        //   여기는 **정확히 셀 수 있는 것만** 싣는다 — 팀·감독 실측·가드레일·모의 공격.
        return Promise.all([
          window.gijo.guardrailStatus().catch(function () { return null; }),
          window.gijo.lastRedTeam().catch(function () { return null; }),
          window.gijo.listAgents ? window.gijo.listAgents().catch(function () { return null; }) : null,
          window.gijo.aiteamSupervision ? window.gijo.aiteamSupervision(1).catch(function () { return null; }) : null,
        ]).then(function (r) {
          var g = r[0], rt = r[1], ags = r[2], sup = r[3];
          var MODE = { off: "꺼짐", flag: "기록만", block: "차단" };
          // 실필드는 calls·errors다(llmactivity.ts — 검토관 상1: done/error는 존재하지 않아
          // 영원히 0이 뜬다. supervision.html과 같은 원천·같은 이름을 쓴다).
          var 호출 = 0, 오류 = 0;
          ((sup && sup.daily) || []).forEach(function (d) { if (d.kind === "chat") { 호출 += d.calls || 0; 오류 += d.errors || 0; } });
          return {
            rows: [ // 3줄 고정(판 카드 높이 계약 — 검토관 하1: 4줄이면 foot가 잘릴 수 있다)
              ["팀·감독(오늘)", ags ? ags.length + "명 · 호출 " + 호출 + " · 오류 " + 오류 : "-"],
              ["가드레일(기동 후)", g ? (MODE[g.mode] || g.mode) + " · 막음 " + (g.blockedCount || 0) : "-"],
              ["모의 공격 견고성", rt && rt.robustnessScore != null ? rt.robustnessScore + "/100" : "-"],
            ],
            foot: "쓰기 지시는 항상 결재판을 거칩니다",
          };
        });
      } },
    ],

    // 기록 — 작업 기록(감사)과 시스템 로그(2026-08-09 설정 그룹 정리, 사용자 승인).
    records: [
      { id: "audit", title: "🗒 작업 기록", page: "audit.html", load: function () {
        return window.gijo.listAudit(undefined, 500).then(function (r) {
          var 항목 = (r && r.entries) || r || [];
          var 오늘0시 = new Date(); 오늘0시.setHours(0, 0, 0, 0);
          var 오늘 = 항목.filter(function (e) { return (e.at || 0) >= 오늘0시.getTime(); });
          var 셈 = function (k) { return 오늘.filter(function (e) { return e.kind === k; }).length; };
          // ⚠ 조회 상한(500)에 닿았으면 "더 있다"고 말한다 — 상한을 총계처럼 말하면 거짓이다
          //   (실측: 전 메뉴 사용 기록이 요청마다 남아 하루 500건을 넘긴다).
          var 다받음 = 항목.length < 500;
          return {
            rows: [
              ["오늘 기록", 오늘.length.toLocaleString() + (다받음 ? "" : "+")],
              ["차단", String(셈("block")), 셈("block") ? "var(--red,#e2483d)" : ""],
              ["개인정보 가림", String(셈("privacy"))],
            ],
            foot: "쓰기·승인·CLI가 전부 남습니다",
          };
        });
      } },
      { id: "syslog", title: "⚙ 시스템 로그", page: "syslog.html", load: function () {
        return window.gijo.listLogs().then(function (list) {
          list = list || [];
          var 오늘0시 = new Date(); 오늘0시.setHours(0, 0, 0, 0);
          var 오늘 = list.filter(function (e) { return (e.timestamp || 0) >= 오늘0시.getTime(); });
          var 셈 = function (lv) { return 오늘.filter(function (e) { return e.level === lv; }).length; };
          return {
            badge: 셈("error") ? { text: "오류 " + 셈("error"), color: "var(--red,#e2483d)" } : null,
            rows: [
              ["오늘 오류", String(셈("error")), 셈("error") ? "var(--red,#e2483d)" : ""],
              ["경고", String(셈("warn")), 셈("warn") ? "var(--amber,#f0a020)" : ""],
              ["정보", 셈("log").toLocaleString()],
            ],
            foot: "서버·엔진의 동작 기록입니다",
          };
        });
      } },
    ],
  };

  window.gijoGroupPanels = 그룹;
})();
