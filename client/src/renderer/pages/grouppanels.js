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
//
//       ★ **열 규약 — 판마다 새로 설계하지 않는다**(2026-08-20 사장님 「통합 관제 취약점
//         조치승인 형태로 새로 만들지말고 변경해서 보여주면 안도?」). 먼저 만든 세 판이
//         이미 같은 골격이었고, 그것을 전 판의 규약으로 못박는다:
//
//           1열 **무엇**   (필수·가변폭 1fr) — 그 줄이 가리키는 것의 이름. 없으면 그 줄을 못 고른다.
//           2열 **어디/누구**(선택·110px)   — 자산·담당·주제·올린 이처럼 소속을 말하는 값.
//           3열 **등급/상태**(선택·74~84px) — 심각도·상태·결과. **반드시 한글 사전을 거친다.**
//           4열 **언제**    (선택·44~56px)  — 날짜·시각. 오른쪽 정렬.
//
//         · 열은 **3~4개**. 더 넣지 않는다 — 폭 210px 타일 안에서 훑는 목록이라 5열부터는
//           1열이 잘려 「무엇인지 모르는 줄」이 된다.
//         · 판마다 **이름표(cols)는 달라도 자리는 같다** — 담당자가 어느 판을 열어도 왼쪽부터
//           「무엇 · 어디 · 어떤 상태 · 언제」로 읽는다. 자리를 바꾸면 판마다 읽는 법을 새로
//           배워야 한다(그것이 「새로 만든다」는 뜻이고, 사장님이 안 된다고 한 것이다).
//         · 그 판에 없는 자리는 **비운다**(열 자체를 뺀다) — 억지로 채우면 의미 없는 칸이 는다.
//         · 목록이 원리상 성립하지 않는 판(통계만 주는 API 등)은 rows()를 **아예 안 단다** —
//           빈 표를 그리는 것보다 단추가 없는 편이 정직하다.
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
  // 목록 4열(언제)용 짧은 날짜 — mydocs.html 날짜()와 같은 꼴(MM-DD, 다른 해면 YY-MM-DD).
  var 날 = function (t) {
    if (!t) return "-";
    var d = new Date(t);
    if (isNaN(d)) return "-";
    var mmdd = String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return d.getFullYear() === new Date().getFullYear() ? mmdd : String(d.getFullYear() % 100).padStart(2, "0") + "-" + mmdd;
  };

  // 스캔 오류는 취약점이 아니다(서버 isRealVulnerability와 같은 잣대) — 세는 자리마다 지킨다.
  // ⚠ 서버 목록과 **같아야** 한다 — `scan_not_supported`가 빠져 있어 서버(handlers.ts:198)와
  //   취약점 수가 갈렸다(2026-08-20 설계관 적발). info는 severity 쪽 잣대라 함께 둔다.
  var SCAN_NOISE = { scan_error: true, scan_not_supported: true, info: true };
  var 진짜취약점 = function (f) { return !SCAN_NOISE[f.finding_type] && !SCAN_NOISE[f.severity]; };

  // ── 한글 표기 사전 — 하위 목록(rows)이 담당자에게 보이는 말로 적기 위한 것.
  //    ⚠ 영문 코드값을 그대로 내보내면 같은 카드 안에서 「매우 심각」과 「critical」이 나란히
  //    선다(검토관 중7 — 2026-08-03 「영문 심각도가 담당자 화면 여덟 곳」 사고 계열).
  //    출처는 각 실화면의 사전과 같은 말을 쓴다: analysis.html:228 · approvals.html:259.
  var SEV_KO = { critical: "매우 심각", high: "높음", medium: "보통", low: "낮음" };
  var EV_ST_KO = { open: "열림", ack: "확인", inprogress: "처리중", done: "완료", ignored: "무시" };
  var AP_ST_KO = { pending: "미검토", in_progress: "진행중", verifying: "검증 대기", approved: "완료", rejected: "반려", accepted: "위험수용" };
  var 말 = function (사전, v, 없을때) {
    var k = String(v == null ? "" : v);
    return Object.prototype.hasOwnProperty.call(사전, k) ? 사전[k] : (k || 없을때 || "-");
  };

  // 「미배정」 판정은 **한 곳에서만** 한다(병렬 검토 중2 — 판 배지·하위 목록·실화면이 서로
  // 다른 수를 가리키고 있었다). 원천은 서버 approvals.ts:253이고, 실화면 approvals.html:462도
  // 같은 식이다: 완료·반려·**위험수용**은 담당자를 안 붙이는 것이 정상이라 세지 않는다.
  var 미배정인가 = function (x) {
    return !x.assignee && x.status !== "approved" && x.status !== "rejected" && x.status !== "accepted";
  };

  var 그룹 = {
    // ① 발견·수집
    discover: [
      // ⚠ 「📊 보안 태세」 판을 **뺐다**(사장님 승인 2026-08-19, 승인 시안 mockups/자산_0단계 권고).
      //   ①발견·수집은 「무엇이 있고 무엇이 들어왔나」를 보는 자리다. 종합 점수·컴플라이언스는
      //   **결과를 요약하는 숫자**라 ⑤보고의 몫이고, 실제로 그 허브에 같은 화면이 이미 있다
      //   (reporting: kpi→kpi.html). 두 자리에 같은 것을 두면 「어디서 보는 게 맞나」를 매번 고민한다.
      // ⚠ **화면이 사라진 것이 아니다** — `kpi.html`은 ⑤보고에서 그대로 열린다.
      //   ⓪ 자산에서 「🖥 자산」을 뺀 것과 같은 정리다(자산은 ⓪로, 지표는 ⑤로).
      // rows: 열린 이벤트만 + **요약이 세는 P0~P2만**(검토관 중4 — 요약은 P0/P1/P2 세 조각인데
      //   목록에 P3까지 내리면 「위는 3인데 아래는 40줄」이 된다. approvals.ts:423의 그 사고와
      //   같은 모양이다). 상태는 한글로(analysis.html:228과 같은 사전).
      // scenario: 판 ↔ 업무 시나리오(서버 scenarios.ts SCENARIOS) 대응 — 📖 칩이 「시나리오: <이름>」을
      // 대화창에 넣는다(2026-08-21 ⓐ안). ⚠ 이름은 등록부와 **글자까지 같아야** 라우팅이 성립한다 —
      // scenariochips.test.ts가 대조해 막는다. 대응이 정직하지 않은 판(억지 연결)에는 안 단다.
      { id: "analysis", title: "🚨 통합 관제", page: "analysis.html", scenario: "아침 브리핑",
        rows: function () {
          return window.gijo.analysisEvents().then(function (d) {
            var 순위 = { P0: 0, P1: 1, P2: 2 };
            var ev = ((d && d.events) || []).filter(function (e) {
              return !(e.status === "done" || e.status === "ignored") && 순위[e.priority] != null;
            });
            ev.sort(function (a, b) { return 순위[a.priority] - 순위[b.priority]; });
            return {
              cols: ["이벤트", "우선", "상태"],
              grid: "1fr 54px 74px",
              rows: ev.map(function (e) {
                return [String(e.title || e.summary || e.id || "-"), String(e.priority || "-"), 말(EV_ST_KO, e.status, "열림")];
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
      // rows: CtiFinding은 id·detectedAt·type·target·source·severity **6개가 전부**(cti.ts:25-32).
      //   ⚠ 심각도 사전은 **CTI 전용**이다 — SEV_KO(매우 심각/높음/보통)를 재사용하면 요약
      //   조각(긴급·주의·정보)과 한 카드 안에서 두 말이 된다(2026-08-20 설계관 경고).
      //   ⚠ 샘플(데모)은 **빼지 않는다** — load도 세는 데서 안 뺀다. 출처 열로 드러낸다.
      { id: "threat", title: "🌐 위협 인텔", page: "threat.html", agents: ["위협"], scenario: "위협 정보 확인",
        rows: function () {
          var CTI_KO = { critical: "긴급", warning: "주의", info: "정보" };
          return window.gijo.listCtiFindings().then(function (fs) {
            return {
              // 열 규약: 1열 무엇 · 2열 어디/누구 · 3열 등급/상태 — 처음엔 2·3열이 뒤바뀌어
              // 넓은 폭(96px)이 3열에 가면서 1열이 눌렸다(2026-08-20 병렬 검토 중).
              cols: ["대상", "출처", "심각도"],
              grid: "1fr 96px 58px",
              // 서버가 이미 최신순으로 준다(cti.ts:158 ORDER BY detectedAt DESC) — 다시 정렬하지 않는다.
              rows: (fs || []).map(function (f) {
                return [String(f.target || "-"), String(f.source || "-"), 말(CTI_KO, f.severity)];
              }),
            };
          });
        },
        load: function () {
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
      { id: "vuln", title: "🔍 취약점", page: "vulnscan.html", agents: ["우선"], pick: "vuln", scenario: "신규 스캔 결과 처리",
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
              // 심각도는 한글로 — 요약 조각이 「매우 심각/높음/보통」인데 목록만 영문이면
              // 같은 카드 안에서 두 말이 병존한다(검토관 중7).
              rows: out.map(function (x) {
                return [String(x.f.finding_type || x.f.id || "-"), String(x.자산 || "-"),
                  말(SEV_KO, x.f.severity), x.f.kev ? "KEV" : "-"];
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
      // rows: 실화면 sbom.html:681·684·674와 같은 필드·같은 문구.
      //   ⚠ 「AI 자산」 열은 넣지 않는다 — 판정이 방금 고쳐졌고(isAiAsset 잣대), 열을 늘리면
      //   4열이 되어 첫 열이 좁아진다. AI 수는 요약 줄에 이미 있다.
      { id: "sbom", title: "📦 AI-BOM · 구성", page: "sbom.html",
        rows: function () {
          return window.gijo.listAssets().then(function (assets) {
            var list = (assets || []).slice();
            // 미생성 먼저 — 이 판의 유일한 주황 신호이고, 200행 상한에서 볼 값어치가 큰 쪽이다.
            list.sort(function (a, b) { return (a.sbomGeneratedAt ? 1 : 0) - (b.sbomGeneratedAt ? 1 : 0); });
            return {
              cols: ["자산", "부품", "구성 명세"],
              grid: "1fr 52px 68px",
              rows: list.map(function (a) {
                return [String(a.name || a.hostname || a.id || "-"),
                  String((a.components || []).length), a.sbomGeneratedAt ? "생성됨" : "미생성"];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listAssets().then(function (assets) {
          assets = assets || [];
          var 있음 = assets.filter(function (a) { return a.sbomGeneratedAt; }).length;
          // ⚠ `llm-service`·`ml-model`은 **저장소에 존재하지 않는 값**이라 이 줄이 항상 0이었다
          //   (2026-08-20 설계관 적발). 원천은 서버 assets.ts:100-106 isAiAsset — 자산 종류가
          //   「LLM 서비스·분류 모델·이상탐지 모델」이거나 AI-BOM에 모델 참조가 채워진 것.
          var AI종류 = { "LLM 서비스": 1, "분류 모델": 1, "이상탐지 모델": 1 };
          var ai = assets.filter(function (a) {
            if (AI종류[a.assetType]) return true;
            var m = a.aibom && a.aibom.model;
            return !!(m && (String(m.modelRef || "").trim() || String(m.foundationModel || "").trim()));
          }).length;
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
      { id: "approvals", title: "✅ 조치·승인", page: "approvals.html", scenario: "조치 마감(시작→검증→확정)",
        rows: function () {
          return window.gijo.listApprovals().then(function (r) {
            var rows = (r && r.reviews) || r || [];
            return {
              cols: ["조치 항목", "자산", "담당", "상태"],
              grid: "1fr 110px 84px 74px",
              // ⚠ 필드는 **FindingReview 원천 그대로**다(security-ops.ts:373 — title·summary·id는
              //   아예 없다. 처음엔 그것들을 읽어 첫 열이 전부 「-」였다: 검토관 상1, 이 저장소
              //   필드명 오인 5번째). 실화면 approvals.html:468도 finding.finding_type + assetName을 쓴다.
              // 빈 담당은 「미배정」으로 적는다 — "-"로 두면 「담당이 있는데 못 읽었다」와 구분이 안 된다.
              // 담당 칸도 배지와 **같은 판정**을 쓴다 — 완료·반려·위험수용 건까지 「미배정」이라
              // 적으면 위 배지(미배정 N)와 아래 목록이 다른 말을 한다(병렬 검토 중2).
              rows: rows.map(function (x) {
                var f = x.finding || {};
                return [String(f.finding_type || x.findingKey || "-"), String(x.assetName || x.assetId || "-"),
                  미배정인가(x) ? "미배정" : (x.assignee || "-"), 말(AP_ST_KO, x.status)];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listApprovals().then(function (r) {
          var rows = (r && r.reviews) || r || [];
          var 셈 = function (s) { return rows.filter(function (x) { return x.status === s; }).length; };
          // 위험수용(accepted)이 빠져 있어 실화면·서버와 수가 어긋났다(병렬 검토 중2) — 헬퍼로 통일.
          var 미배정 = rows.filter(미배정인가).length;
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
      // ⚠ **필드명 오인 6번째 수리(2026-08-20 설계관 적발)** — 이 판은 `m.dueAt`과
      //   `status === "done"`을 읽고 있었는데 MaintenanceItem에는 **둘 다 없다**
      //   (security-ops.ts:7-27 — 실재는 scheduleDate와 scheduled|reported|approved|rejected).
      //   그래서 「기한 초과」와 「완료」가 **영원히 0**이었다. 실화면(maintenance.html:208)과
      //   서버가 쓰는 같은 잣대로 맞춘다: 기한 지남 = 예정일이 오늘 전 && 아직 승인 안 됨.
      { id: "maintenance", title: "🛠 정기 점검", page: "maintenance.html",
        // rows: 요약과 같은 API. 상태 사전은 실화면 maintenance.html:212와 동일(재번역 금지).
        rows: function () {
          return window.gijo.listMaintenance().then(function (list) {
            var MS = { scheduled: "예정", reported: "검토 대기", approved: "승인됨", rejected: "반려됨" };
            return {
              cols: ["점검", "제품", "상태", "예정일"],
              grid: "1fr 96px 66px 66px",
              rows: (list || []).map(function (m) {
                return [String(m.title || "-"), String(m.productName || m.assetName || "-"),
                  말(MS, m.status), String(m.scheduleDate || "-")];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listMaintenance().then(function (r) {
          var list = (r && r.items) || r || [];
          // ⚠ **로컬 날짜**로 잡는다(2026-08-20 병렬 검토). toISOString은 UTC라 한국에서는
          //   오전 9시 전까지 「어제」로 계산돼, 서버(util/date.ts todayLocal)와 하루가 어긋난다.
          var d = new Date();
          var 오늘 = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
          var 지연인가 = function (m) { return String(m.scheduleDate || "") !== "" && String(m.scheduleDate) < 오늘 && m.status !== "approved"; };
          var 기한초과 = list.filter(지연인가).length;
          var 완료 = list.filter(function (m) { return m.status === "approved"; }).length;
          // ⚠ 「예정」은 서버 카드와 **같은 잣대**(datacard.ts:520 status==="scheduled")를 쓴다.
          //   전체−완료−지연으로 빼면 반려(rejected)·검토대기(reported) 중 기한 전인 것까지
          //   「예정·진행」에 들어가 대화창 카드와 숫자가 갈린다(2026-08-20 병렬 검토).
          var 예정 = list.filter(function (m) { return m.status === "scheduled" && !지연인가(m); }).length;
          return {
            badge: 기한초과 ? { text: "기한 초과 " + n(기한초과), color: R } : null,
            rows: [
              ["예정·진행", n(예정)],
              ["기한 초과", n(기한초과), 기한초과 ? R : ""],
              ["완료", n(완료)],
            ],
            foot: "점검 항목 " + n(list.length) + "건",
          };
        });
      } },
      { id: "terminal", title: "⌨ 명령창", page: "terminal.html",
        // rows: 요약 1행이 「최근 24시간」이라 목록도 24h로 맞춘다(위는 3인데 아래는 200줄이
        // 되는 중4 부류 — 설계관 ①-B). 결과 한글은 실화면 audit와 같은 사전.
        rows: function () {
          return window.gijo.listAudit("cli", 200).then(function (r) {
            var RES = { ok: "완료", blocked: "차단", error: "실패", pending: "대기" }; // audit.html:189와 글자까지 동일(검토관 중4)
            var 컷 = Date.now() - 24 * 3600 * 1000;
            var list = ((r && r.entries) || r || []).filter(function (e) { return (e.at || 0) >= 컷; });
            return {
              cols: ["명령", "누가", "결과", "시각"],
              grid: "1fr 76px 56px 44px",
              rows: list.map(function (e) {
                var d = new Date(e.at || 0);
                return [String(e.action || "-"), String(e.actor || "-"), 말(RES, e.result),
                  String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")];
              }),
            };
          });
        },
        load: function () {
        // 명령창은 "지금 몇 건"이 아니라 **최근에 무엇을 했나**가 요약이다(감사 기록 기준).
        // ⚠ 차단은 kind가 **"block"**으로 남는다(audit.ts:15) — 여기서 "cli"만 불러 놓고
        //   그 안에서 차단을 세고 있어 **영원히 0**이었다(2026-08-20 설계관 적발).
        //   ⚠⚠ **응답 배열을 세지 않는다**(2026-08-20 병렬 검토 상1). 처음엔 block을 따로
        //   불러 `blocks.length`를 셌는데, 그 호출은 LIMIT 200이라 차단이 200건을 넘는 순간
        //   **영원히 200**으로 굳는다 — 「항상 0」이 「항상 200」이 될 뿐 여전히 거짓이고,
        //   0은 의심이라도 사지만 200은 실측값처럼 읽혀 보고서에 실린다. 저장소 자체 실측이
        //   「하루 QA·점검만으로 차단 138건」(audit.ts:97)이고 보관은 3년이라 이틀이면 넘는다.
        //   정답은 **같은 응답 안에 이미 있다**: /api/audit는 kind 필터와 무관하게
        //   summary{total, byKind}(audit.ts:82-88, GROUP BY 전수)를 함께 준다. 호출도 하나로 준다.
        return window.gijo.listAudit("cli", 200).then(function (r) {
          var list = (r && r.entries) || [];
          var s = r && r.summary;
          var byKind = (s && s.byKind) || {};
          var 하루 = Date.now() - 86400000;
          var 최근 = list.filter(function (e) { return (e.at || e.createdAt || 0) >= 하루; }).length;
          var 차단 = s ? (byKind.block || 0) : null;          // 못 구하면 0이 아니라 "-"
          var 보관 = s && s.total != null ? s.total : null;
          return {
            rows: [
              // 상한(200)에 닿았으면 「+」로 상한임을 밝힌다 — 잘린 수를 정확한 수인 척하지 않는다
              // (같은 파일 작업 기록 판이 이미 지키는 규칙: "상한을 총계처럼 말하면 거짓이다").
              ["최근 24시간 실행", list.length >= 200 ? n(최근) + "+" : n(최근)],
              // ⚠ 라벨을 **사실대로** 적는다(2026-08-20 병렬 검토 상3). kind:"block"은 CLI 차단만이
              //   아니라 가드레일·에어갭·게이트웨이·업로드 정화 등 **9개 하위체계**가 함께 쓴다
              //   (server/src/engine 전수: airgap·gateway·guardrail·knowledgebundle·memory·
              //   pasteddata·ragsanitize·remotellm·report). 그걸 「차단된 위험 명령」이라 부르면
              //   명령창에서 그만큼 막힌 것처럼 읽혀 거짓이 된다 — 세는 값은 그대로 두고 이름을 맞춘다.
              ["안전장치가 막은 것(전체)", 차단 == null ? "-" : n(차단), 차단 ? A : ""],
              ["기록 보관", 보관 == null ? "-" : n(보관)],
            ],
            foot: "허용 목록 밖 명령은 실행 전에 막습니다",
          };
        });
      } },
    ],

    // ④ 검증 — 데이터가 없어도 **같은 모양**으로(2026-08-09 사용자 지시: 0이면 0으로 그린다)
    verify: [
      // agents: scan(해석) — ROLE_CATEGORY.scan=["취약점","장비운영"](hybridsearch.ts:234) 근거.
      //   장비 점검 자료를 먼저 보는 역할이라 이 판의 주인이 맞다(검토관 하17 — 근거가 있는데
      //   빠뜨렸던 자리. 근거 없는 판에 다는 것만큼이나 있는 근거를 빠뜨리는 것도 들쭉날쭉이다).
      { id: "hardening", title: "🛡 보안설정 점검", page: "hardening.html", agents: ["해석"], scenario: "검증 현황 점검",
        // rows: **targets에 있는 장비만** — runs만 잡으면 지워진 장비의 점수가 남는다
        // (설계관 ③-3-2, 서버 datacard.ts:53-62의 「등록 장비 0 · 준수율 48%」 실사고 처방).
        rows: function () {
          return Promise.all([
            window.gijo.hardeningTargets.list(),   // ⚠ .catch로 []를 주면 실패가 「목록이 없습니다」로
            window.gijo.hardeningRuns(undefined, 300), // 둔갑한다(검토관 상1) — reject는 목록펴기가 정직하게 그린다
          ]).then(function (r) {
            var targets = (r[0] && r[0].targets) || r[0] || [];
            var runs = (r[1] && r[1].runs) || r[1] || [];
            var 최근 = {};
            runs.forEach(function (x) { if (!최근[x.targetId] || x.at > 최근[x.targetId].at) 최근[x.targetId] = x; });
            return {
              cols: ["장비", "기준", "준수율", "점검"],
              grid: "1fr 66px 66px 44px",
              rows: targets.map(function (t) {
                var run = 최근[t.id];
                return [String(t.label || t.id || "-"), String(t.standard || "-").toUpperCase(),
                  run && run.rate != null ? run.rate + "%" : "미점검", run ? 날(run.at) : "-"];
              }),
            };
          });
        },
        load: function () {
        // ⚠ 실패를 삼켜 []로 바꾸면 화면은 그려지지만 **0이 사실인 척**한다. 못 본 것은
        //   못 봤다고 남긴다(확인못함) — 현황판이 그 표식을 보고 「값이 바뀌었다」로 오판하지
        //   않고 기준선도 안 덮는다(병렬 검토 중1: 서버 재시작만으로 거짓 「바뀜 4」가 떴다).
        var 못함 = [];
        return Promise.all([
          window.gijo.hardeningTargets.list().catch(function () { 못함.push("장비 목록"); return []; }),
          window.gijo.hardeningSchedules.list().catch(function () { 못함.push("점검 일정"); return []; }),
          window.gijo.hardeningRuns(undefined, 300).catch(function () { 못함.push("점검 이력"); return []; }),
        ]).then(function (r) {
          // 응답은 껍데기에 담겨 온다({targets}/{schedules}/{runs}) — 배열로 벗겨 쓴다.
          var targets = (r[0] && r[0].targets) || r[0] || [], schedules = (r[1] && r[1].schedules) || r[1] || [], runs = (r[2] && r[2].runs) || r[2] || [];
          // ⚠ enabled는 0|1 숫자라 `!== false`는 **끈 것까지 전부 활성**으로 셌다
          //   (2026-08-20 설계관 적발). 실화면(hardening.html:175)과 같이 truthy로 본다.
          var 활성 = schedules.filter(function (s) { return !!s.enabled; }).length;
          // 준수율 = 대상별 **가장 최근** 결과만(옛 결과까지 더하면 고친 것이 계속 세어진다).
          var 최근 = {};
          runs.forEach(function (x) { if (!최근[x.targetId] || x.at > 최근[x.targetId].at) 최근[x.targetId] = x; }); // rows와 같은 산식(at 최대 — 서버 정렬에 기대지 않는다, 검토관 하11)
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
            확인못함: 못함.length ? 못함 : undefined,
          };
        });
      } },
    ],

    // ⑤ 보고
    reporting: [
      // agents: report(보고) — ROLE_CATEGORY.report=["사내규정"](보고 서식·규정, hybridsearch.ts:237) 근거.
      { id: "report", title: "📄 리포트", page: "report.html", agents: ["보고"], scenario: "경영 보고 준비",
        // rows: title은 원천에 **없다**(reports-admin.ts:186 — 이미 한 번 밟은 자리). 1열은
        // 유형 한글(report.html:286 TYPE_LABEL)·2열은 대상 한글(:505 — 영문 그대로 금지).
        rows: function () {
          return window.gijo.listReportHistory().then(function (list) {
            var TL = { weekly: "정기 · 주간", quarterly: "정기 · 분기", ondemand: "온디맨드", answer: "AI 작성 자료", ingest: "파일 처리 내역", session: "작업 세션" }; // report.html TYPE_LABEL과 글자까지 동일(검토관 상2 — incident는 없는 키·answer·ingest 누락 / 2026-08-21 설계관 덤 — session도 없어 영문이 그대로 나갔다)
            var AU = { internal: "내부용", official: "보고용" };
            return {
              cols: ["유형", "구분", "생성"], // 「대상」은 실화면에서 자산 이름의 자리(검토관 하9) — audience는 구분
              grid: "1fr 84px 56px",
              rows: (list || []).map(function (r) {
                return [말(TL, r.type), 말(AU, r.audience), 날(r.createdAt)];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listReportHistory().then(function (r) {
          var list = (r && r.reports) || r || [];
          var 주 = Date.now() - 7 * 86400000;
          // ⚠ `x.qa`는 **ReportHistoryEntry에 없는 필드**다(report.ts:764-777) — 사이드카에만
          //   있고 목록 응답에는 안 실린다. 즉 `!x.qa`는 항상 참인 **죽은 필터**였고,
          //   「QA 리포트는 뺐다」는 거짓 전제를 하나 더 두는 셈이었다(2026-08-20 설계관 적발).
          //   지금은 전부 세는 것이 사실이므로 필터를 걷고 그대로 센다.
          // ⚠ 다만 목록에는 **사람이 만든 보고서**가 아닌 것도 섞인다(2026-08-20 병렬 검토):
          //   answer-*(긴 답이 자동으로 넘어간 리포트)·ingest-*(파일 반입 진행내역). 「이번 주
          //   작성」에 그것들이 들어가면 실제보다 부풀려 읽힌다 — 종류로 갈라 꼬리에 밝힌다.
          var 자동종류 = { answer: true, ingest: true };
          var 사람이만든 = list.filter(function (x) { return !자동종류[String(x.type || "")]; });
          var 자동 = list.length - 사람이만든.length;
          var 이번주 = 사람이만든.filter(function (x) { return (x.createdAt || 0) >= 주; }).length;
          // 「마지막 보고」도 사람이 만든 것 기준 — 자동 생성물이 끼면 보고를 안 했는데도
          // 「어제 보고함」으로 읽힌다.
          var 최근 = 사람이만든[0];
          var 지난날 = 최근 ? Math.floor((Date.now() - 최근.createdAt) / 86400000) : null;
          // ⚠ 조회 상한(listReportHistory limit=100)에 걸리면 목록이 잘린 것이다 — 그때
          //   「보관 중 87」이라 쓰면 거짓이 된다(잘리고 남은 것만 센 수). +를 붙여 밝힌다(2026-08-21 설계관 덤).
          var 잘림 = list.length >= 100;
          return {
            rows: [
              ["이번 주 작성", n(이번주)],
              ["마지막 보고 후", 지난날 == null ? "-" : 지난날 + "일"],
              ["보관 중", n(사람이만든.length) + (잘림 ? "+" : "")],
            ],
            foot: 자동 ? "정기·수시 보고서가 여기 쌓입니다 · 자동 생성물 " + n(자동) + "건은 따로 셉니다"
              : "정기·수시 보고서가 여기 쌓입니다",
          };
        });
      } },
      // kpi도 「경영 보고 준비」 — 시나리오 첫걸음이 「보안 KPI 현황 알려줘」라 두 판이 같은 업무의 입구다.
      { id: "kpi", title: "📈 보안 KPI", page: "kpi.html", scenario: "경영 보고 준비", load: function () {
        return window.gijo.getSecurityKpi().then(function (k) {
          var c = (k || {}).current || {};
          // ⚠ 서버가 주는 값은 **good|fair|poor**다(kpi.ts:67·217). warn|bad는 없는 값이라
          //   fair·poor일 때 배지가 **빈 글자에 빨강**으로 나갔다(2026-08-20 설계관 적발).
          //   색도 등급을 따른다 — 양호까지 빨갛게 두면 위험 신호가 흔해져 안 보인다.
          var BAND = { good: "양호", fair: "보통", poor: "취약" };
          var BAND_COLOR = { good: T, fair: A, poor: R };
          return {
            // ⚠ 배지는 **알려야 할 때만** 단다(2026-08-20 병렬 검토). band는 언제나 셋 중
            //   하나라 그대로 두면 「양호」 배지가 상시 붙는데, 배지는 눈길을 끄는 자리라
            //   좋은 소식까지 달면 진짜 경고가 묻힌다(같은 파일의 「0인 경고는 죽여서 그린다」와
            //   같은 정신). 양호는 아래 줄에 이미 있고, 배지는 보통·취약일 때만.
            badge: c.posture && BAND[c.posture.band] && c.posture.band !== "good"
              ? { text: BAND[c.posture.band], color: BAND_COLOR[c.posture.band] || A } : null,
            rows: [
              ["종합 점수", c.posture ? c.posture.score + "/100" : "-"],
              // 라벨은 실화면 kpi.html:280 「열린 취약점」과 동일 — 「미조치」라 쓰면 ③ 조치의
              // 검토대장 숫자와 같은 것으로 읽힌다(잣대가 다르다: 이건 호스트 스캔 기준, 2026-08-21).
              ["열린 취약점", c.vulnerabilities ? n(c.vulnerabilities.active) : "-", R],
              ["기한 지난 조치", c.remediation && c.remediation.overdue != null ? n(c.remediation.overdue) : "-", A],
            ],
            foot: "지표는 서버가 한 곳에서 셉니다",
          };
        });
      } },
      { id: "compliance", title: "📋 컴플라이언스", page: "compliance.html", scenario: "법령·행동 대조",
        // rows: 상태 한글은 실화면 compliance.html:177과 동일 — 요약 조각 라벨도 아래에서
        // 같은 사전으로 통일했다(같은 카드 안에서 「이행/미이행」과 「대응완료/미대응」이
        // 병존하던 두 말 — 설계관 ①-B 적발).
        rows: function () {
          return window.gijo.listCompliance().then(function (list) {
            var CS = { covered: "대응완료", partial: "부분", open: "미대응", na: "해당없음" };
            return {
              cols: ["항목", "분류", "상태", "갱신"],
              grid: "1fr 96px 66px 44px",
              rows: (list || []).map(function (c) {
                return [String(c.name || "-"), String(c.categoryLabel || "-"), 말(CS, c.status), 날(c.updatedAt)];
              }),
            };
          });
        },
        load: function () {
        return window.gijo.listCompliance().then(function (r) {
          var list = (r && r.items) || r || [];
          var 셈 = function (s) { return list.filter(function (x) { return x.status === s; }).length; };
          return {
            // 상태 값은 서버 정의 그대로(covered/partial/open/na) — 화면과 같은 말을 쓴다.
            segments: [
              { key: "covered", label: "대응완료", value: 셈("covered"), color: T }, // 라벨은 실화면 compliance.html:177과 통일(설계관 ①-B — 같은 카드 안 두 말 금지)
              { key: "partial", label: "부분", value: 셈("partial"), color: A },
              { key: "open", label: "미대응", value: 셈("open"), color: R },
            ],
            foot: "항목 " + n(list.length) + "개",
          };
        });
      } },
    ],

    // AI — 내 보안 AI의 구성·지식·학습·안전장치(2026-08-09 사용자 지시 "고객 가이드 화면으로").
    // 숫자는 각 화면과 같은 API. 데이터가 없어도 판 모양은 같다(0은 0으로).
    aiops: [
      { id: "team", title: "🤖 AI 팀", page: "agent.html", scenario: "AI 운영 점검",
        // rows: 상태 한글은 실화면 agent.html:287 STATUS_LABEL과 동일. 시각 필드가 없어
        // 4열은 두지 않는다(없는 값을 지어내지 않는다 — 열 규약 「없는 칸은 비운다」).
        rows: function () {
          return window.gijo.listAgents().then(function (agents) {
            var AS = { idle: "대기중", working: "작업중", watching: "모니터링" };
            return {
              cols: ["팀원", "약자", "상태"],
              grid: "1fr 66px 76px",
              rows: (agents || []).map(function (a) {
                return [String(a.name || a.id || "-"), String(a.abbr || "-"), 말(AS, a.status)];
              }),
            };
          });
        },
        load: function () {
        var 못함 = [];   // 못 본 것은 못 봤다고 남긴다(병렬 검토 중1 — 0을 사실인 척하지 않는다)
        return Promise.all([
          window.gijo.listAgents().catch(function () { 못함.push("팀원 목록"); return []; }),
          window.gijo.listAdapters().catch(function () { 못함.push("어댑터 목록"); return { adapters: [] }; }),
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
            확인못함: 못함.length ? 못함 : undefined,
          };
        });
      } },
      // agents: analysis(우선) — 역할 문장이 「AI 지식·모델 관리」다(agents.ts:69).
      { id: "knowledge", title: "📚 지식", page: "memory.html", agents: ["우선"],
        // rows: 제목 필드가 원천에 없다 — documentId가 곧 이름(실화면 memory.html:703 동일).
        // 등급 한글은 memory.html:664 GRADE_LABEL과 동일.
        // ⚠ 내 개인 문서(personal: 접두)는 뺀다(설계관 ③-3-1 — 서버는 남의 것만 거르고 내
        //   것은 포함해, 신설 「내 문서」 판과 같은 문서가 두 판에 세어진다). 실화면
        //   mydocs.html 회사문서만()과 같은 잣대 — load(요약)도 같은 필터를 쓴다.
        rows: function () {
          return window.gijo.listMemoryDocuments().then(function (docs) {
            var GL = { O: "공개", S: "민감", C: "기밀" };
            var ds = (docs || []).filter(function (x) { return String(x.documentId).indexOf("personal:") !== 0; });
            return {
              cols: ["문서", "영역", "등급", "반입"],
              grid: "1fr 84px 56px 44px",
              rows: ds.map(function (x) {
                return [String(x.documentId || "-"), String(x.category || "일반"), 말(GL, x.grade, "미지정"), 날(x.ingestedAt)];
              }),
            };
          });
        },
        load: function () {
        var 못함 = [];   // 못 본 것은 못 봤다고 남긴다(병렬 검토 중1)
        return Promise.all([
          window.gijo.listMemoryDocuments().catch(function () { 못함.push("문서 목록"); return []; }),
          window.gijo.ontologyStats().catch(function () { 못함.push("온톨로지 통계"); return null; }),
        ]).then(function (r) {
          // rows와 같은 모집단 — 내 개인 문서(personal:) 제외(검토관 중5: 목록만 거르고
          // 요약을 안 거르면 같은 판에서 요약과 줄 수가 어긋나고, 내 문서 판과의 이중
          // 계수가 요약에 그대로 남는다). 이 필터로 요약 수가 줄며 한 번 「바뀜」이 서는
          // 것은 기준선 재설정으로 정상이다.
          var docs = (r[0] || []).filter(function (d) { return String(d.documentId).indexOf("personal:") !== 0; });
          var 오늘 = new Date().toISOString().slice(0, 10);
          var 오늘반입 = docs.filter(function (d) { return String(d.ingestedAt || "").slice(0, 10) === 오늘; }).length;
          return {
            rows: [
              ["올린 문서", docs.length.toLocaleString()],
              ["표준 관계망(온톨로지)", r[1] && r[1].count != null ? r[1].count.toLocaleString() : "-"],
              ["오늘 반입", String(오늘반입)],
            ],
            foot: "새 문서는 대화창 ＋로 올립니다",
            확인못함: 못함.length ? 못함 : undefined,
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
        var 못함 = [];   // 못 본 것은 못 봤다고 남긴다(병렬 검토 중1)
        return Promise.all([
          window.gijo.guardrailStatus().catch(function () { 못함.push("가드레일 상태"); return null; }),
          window.gijo.lastRedTeam().catch(function () { 못함.push("모의 공격 결과"); return null; }),
          window.gijo.listAgents ? window.gijo.listAgents().catch(function () { 못함.push("팀원 목록"); return null; }) : null,
          window.gijo.aiteamSupervision ? window.gijo.aiteamSupervision(1).catch(function () { 못함.push("감독 일지"); return null; }) : null,
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
            확인못함: 못함.length ? 못함 : undefined,
            foot: "쓰기 지시는 항상 결재판을 거칩니다",
          };
        });
      } },
    ],

    // 기록 — 작업 기록(감사)과 시스템 로그(2026-08-09 설정 그룹 정리, 사용자 승인).
    records: [
      // rows: 실화면(audit.html:166·176)과 **같은 한글 사전**. 오늘 것만 — 요약의 잣대 그대로.
      { id: "audit", title: "🗒 작업 기록", page: "audit.html",
        rows: function () {
          var KIND_KO = { cli: "CLI", approval: "승인", write: "쓰기", block: "차단", privacy: "개인정보", auth: "로그인", config: "설정" };
          var RES_KO = { ok: "완료", blocked: "차단", error: "실패", pending: "대기" };
          return window.gijo.listAudit(undefined, 500).then(function (r) {
            var 항목 = (r && r.entries) || r || [];
            var 오늘0시 = new Date(); 오늘0시.setHours(0, 0, 0, 0);
            var 오늘 = 항목.filter(function (e) { return (e.at || 0) >= 오늘0시.getTime(); });
            return {
              cols: ["한 일", "종류", "결과"],
              grid: "1fr 64px 56px",
              rows: 오늘.map(function (e) {
                return [String(e.action || e.detail || "-"), 말(KIND_KO, e.kind), 말(RES_KO, e.result)];
              }),
            };
          });
        },
        load: function () {
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
      // rows: ⚠ listLogs()는 **오래된 것이 먼저** 온다(logs.ts push 순서) — 그대로 넘기면
      //   앞 200건 상한에 걸려 **가장 오래된 200줄**만 보인다(2026-08-20 설계관 경고). 뒤집는다.
      //   레벨 한글은 이 판의 요약 라벨(오류·경고·정보)이 유일한 선례라 그 말을 쓴다.
      // 침해 의심 초동 — 시나리오 걸음(로그 이상 징후·처리 실패 내역)이 이 판의 자리다.
      { id: "syslog", title: "⚙ 시스템 로그", page: "syslog.html", scenario: "침해 의심 초동",
        rows: function () {
          var LV_KO = { error: "오류", warn: "경고", log: "정보", info: "정보" };
          return window.gijo.listLogs().then(function (list) {
            var 오늘0시 = new Date(); 오늘0시.setHours(0, 0, 0, 0);
            var 오늘 = (list || []).filter(function (e) { return (e.timestamp || 0) >= 오늘0시.getTime(); });
            오늘.reverse();   // 최신이 위로
            return {
              cols: ["내용", "수준"],
              grid: "1fr 56px",
              rows: 오늘.map(function (e) { return [String(e.message || "-"), 말(LV_KO, e.level)]; }),
            };
          });
        },
        load: function () {
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

    // ══ 현황판 마무리 — 판 없던 화면 4곳 신설(2026-08-21, 사장님 승인 묶음 1번·승인 시안
    //    panels-overview §9 「코드는 있는데 카드가 없으면 만든다」). 이 세 그룹 키를 읽는
    //    허브 화면은 없다 — 현황판(전체 보기·대화 홈)에만 나온다(의도).
    // ⚠ 필드는 전부 설계관 대조표(2026-08-21) 그대로 — 응답에 없는 필드를 지어내지 않는다.
    assets0: [
      // 🗺 자산 — **①발견·수집에서 뺐던 「🖥 자산」 판의 부활이 아니다.** 그 판정(자산은
      //   판이 아니라 ⓪ 범위 축, 2026-08-18 승인)은 그대로이고, 이것은 **⓪ 자산 축 자체의
      //   판**이다(assetscope.test가 지키는 옛 id·제목 조합과 다르게 id:"asset"·🗺).
      // ⚠ 「미조치」 잣대는 취약점 판과 **같은 ㉡**(진짜취약점·미해결 — assetHub vuln.open이
      //   같은 식)이다 — 같은 현황판에 같은 이름의 다른 수가 두 개 뜨면 안 된다(설계관 ③-1).
      { id: "asset", title: "🗺 자산", page: "assets.html", pick: "asset", scenario: "자산 정리(결손 채우기)",
        rows: function () {
          return window.gijo.assetHub().then(function (d) {
            var rs = (d && d.rows) || [];
            // riskBand 실제 값은 critical|high|medium|ok (assethub.ts:45 — bad·warn은 없는 값)
            var BAND = { critical: "고위험", high: "고위험", medium: "주의", ok: "정상" }; // 선택 카드(assets.html:235)와 같은 3단계 — 같은 값 두 말 금지(검토관 하10)
            var 순위 = { critical: 0, high: 1, medium: 2, ok: 3 };
            rs = rs.slice().sort(function (a, b) { return (순위[a.riskBand] == null ? 9 : 순위[a.riskBand]) - (순위[b.riskBand] == null ? 9 : 순위[b.riskBand]); });
            return {
              cols: ["자산", "담당", "위험", "미조치"],
              grid: "1fr 86px 76px 52px",
              rows: rs.map(function (a) {
                var 미 = a.vuln ? (a.vuln.open || 0) : 0;
                return [String(a.displayName || a.name || a.id), String(a.owner && a.owner !== "-" ? a.owner : "-"),
                  말(BAND, a.riskBand), 미 ? String(미) : "-"];
              }),
            };
          });
        },
        load: function () {
          return window.gijo.assetHub().then(function (d) {
            var s = (d && d.summary) || {};
            // 담당 미지정 — 서버 잣대(owner !== "-", datacard.ts:161)와 같은 식. null이 아니라
            // "-"로 저장된다 — 클라에서 !owner로 다시 짜면 반드시 밟는 자리(설계관 ③-2).
            var 미지정 = ((d && d.rows) || []).filter(function (a) { return !a.owner || a.owner === "-"; }).length;
            return {
              badge: 미지정 ? { text: "담당 미지정 " + 미지정, color: A } : null,
              rows: [
                ["등록 자산", n(s.totalAssets || 0)],
                ["고위험", n((s.vuln && (s.vuln.critical || 0) + (s.vuln.high || 0)) || 0), (s.vuln && (s.vuln.critical || s.vuln.high)) ? R : ""],
                ["미조치 취약점", n((s.vuln && s.vuln.open) || 0)],
              ],
              foot: "AI " + n(s.aiAssets || 0) + " · IT " + n(s.itAssets || 0),
            };
          });
        } },
    ],
    registry: [
      // 🧰 보안제품 — status·lastCheck는 원천에 **없다**(security-ops.ts:65-77). 3열은
      //   「매뉴얼 있음/없음」(products.html 매뉴얼 잣대 docs.some(kind==="manual")와 동일 — 줄번호는 개편으로 유동)으로 적는다 — 없는 값을 지어내지
      //   않는다. 「종류」 수는 datacard 잣대(제품이 있는 카테고리 수)와 통일(설계관 ③-2).
      { id: "products", title: "🧰 보안제품", page: "products.html",
        rows: function () {
          return window.gijo.listSecurityProductsGrouped().then(function (gs) {
            var out = [];
            (gs || []).forEach(function (g) {
              (g.products || []).forEach(function (p) {
                var 매뉴얼 = (p.docs || []).some(function (dc) { return dc.kind === "manual"; });
                out.push([String(p.name || "-"), String(g.label || g.category || "-") /* 원천은 label(검토관 상3 — categoryLabel은 없는 필드) */,
                  매뉴얼 ? "매뉴얼 있음" : "매뉴얼 없음", 날(p.createdAt)]);
              });
            });
            return { cols: ["제품", "종류", "문서", "등록"], grid: "1fr 96px 84px 44px", rows: out };
          });
        },
        load: function () {
          return window.gijo.listSecurityProductsGrouped().then(function (gs) {
            gs = gs || [];
            var 전체 = 0, 매뉴얼없음 = 0, 종류 = 0;
            gs.forEach(function (g) {
              var ps = g.products || [];
              if (ps.length) 종류++;
              전체 += ps.length;
              ps.forEach(function (p) { if (!(p.docs || []).some(function (dc) { return dc.kind === "manual"; })) 매뉴얼없음++; });
            });
            return {
              badge: 매뉴얼없음 ? { text: "매뉴얼 없음 " + 매뉴얼없음, color: A } : null,
              rows: [["등록 제품", n(전체)], ["종류", n(종류)], ["매뉴얼 없음", n(매뉴얼없음), 매뉴얼없음 ? A : ""]],
              foot: "장애 때 근거가 되는 등록부입니다",
            };
          });
        } },
    ],
    personal: [
      // 📓 내 문서 — 서버가 **로그인한 본인 것만** 준다(personaldocs.ts:119 격리) — 남의
      //   개인 문서 수가 공용 화면에 보일 일은 원리상 없다(설계관 확인).
      { id: "mydocs", title: "📓 내 문서", page: "mydocs.html",
        rows: function () {
          return window.gijo.personalDocsList().then(function (d) {
            var ds = (d && d.documents) || [];
            return {
              cols: ["제목", "AI", "공유", "수정"],
              grid: "1fr 64px 64px 44px",
              rows: ds.map(function (x) {
                return [String(x.title || "-"), x.ragOptIn ? "AI 포함" : "-", x.shared ? "공유" : "개인", 날(x.updatedAt)];
              }),
            };
          });
        },
        load: function () {
          return window.gijo.personalDocsList().then(function (d) {
            var ds = (d && d.documents) || [];
            var ai = ds.filter(function (x) { return x.ragOptIn; }).length;
            var 공유 = ds.filter(function (x) { return x.shared; }).length;
            return {
              rows: [["내 문서", n(ds.length)], ["AI 포함", n(ai)], ["공유", n(공유)]],
              foot: "내 질문에만 근거로 나옵니다(격리)",
            };
          });
        } },
      // 🗂 작업 내역 — 반드시 축 API(origin:user)로 — 옛 통로(listWorkSessions)는 QA·시스템
      //   세션이 섞여 화면·카드와 수가 갈린다(worksessions.ts:713, 설계관 ①-A). 조회 상한이
      //   서버 SESSION_KEEP=100이라 100건이 꽉 차면 「100+」로 정직하게 말한다(③-2).
      { id: "sessions", title: "🗂 작업 내역", page: "sessions.html", scenario: "인수인계 점검",
        rows: function () {
          return window.gijo.listWorkSessionsWithAxes({ origin: "user" }).then(function (d) {
            var ST = { active: "진행중", done: "완료", ignored: "무시" };
            var items = ((d && d.items) || []).filter(function (s) { return !s.qa; });
            return {
              // 「누가」 열은 뺐다(검토관 중6 — doneBy는 완료 경위(user|auto)지 사람이 아니고,
              // origin:user로 걸러서 원리상 정보 0). 없는 자리는 비운다(열 규약).
              cols: ["제목", "상태", "갱신"],
              grid: "1fr 56px 44px",
              rows: items.map(function (s) {
                return [String(s.title || "-"), 말(ST, s.status || "active"), 날(s.updatedAt || s.createdAt)];
              }),
            };
          });
        },
        load: function () {
          return window.gijo.listWorkSessionsWithAxes({ origin: "user" }).then(function (d) {
            var items = ((d && d.items) || []).filter(function (s) { return !s.qa; });
            var 진행 = items.filter(function (s) { return (s.status || "active") === "active"; }).length;
            var 오늘0시 = new Date(); 오늘0시.setHours(0, 0, 0, 0);
            var 오늘 = items.filter(function (s) { return new Date(s.updatedAt || s.createdAt) >= 오늘0시; }).length;
            return {
              rows: [
                // 「최근」이라 적는다(검토관 중7) — 서버가 최근 100건을 먼저 자른 뒤 거르므로
                // 이 수는 전체가 아니라 최근 창이다. 전부인 척하는 100+ 가드는 원리상 안 걸렸다.
                ["최근 세션", n(items.length)],
                ["진행중", n(진행)],
                ["오늘 갱신", n(오늘)],
              ],
              foot: "AI와 한 일이 세션으로 남습니다",
            };
          });
        } },
    ],
  };

  window.gijoGroupPanels = 그룹;
})();
