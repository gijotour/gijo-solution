// railroster.js — 프로 레일 AI 팀 로스터(승인 시안 mockups/AI팀_가시화, 2026-08-20).
//
// 사장님 목적: 「고객에게 우리 상황을 잘 보여주고, 선택을 잘해서 사용하게」 — AI 팀이
// 실재하고 일하는 중임을 레일에서 상시로 보인다. 구성 = 팀원 6(등록부 실구성) +
// 기반 부품 4(bge 임베딩·RAG 검색·가드레일·LoRA — 사장님 지정 기본 포함).
//
// ⚠ 가짜 연출 없음(office.html 약속 계승): 깜박임은 전부 서버 실신호다 —
//   · 팀원 = llm:event kind:"chat"(start↔done, agent 표시 이름) + /api/agents 상태 폴링 보정
//   · 임베딩 = kind:"embed"(done 펄스 — start가 없는 신호라 「방금 돌았음」 플래시가 정직)
//   · RAG = kind:"search"(hybridSearch 실측 신설) · 가드 = kind:"guard"(입구 검사 실측 신설)
//   · LoRA = learnloop:progress(학습 중일 때만 — 채택 어댑터 0은 「준비 중」이 사실)
//   · start 후 30초 내 done이 없으면 소등(신호 유실 대비 — 죽은 작업이 살아 보이지 않게)
// 클릭은 전부 「화면 열기」뿐 — 지시는 대화창에서만(원칙).
(function () {
  "use strict";
  function boot() {
    if (!document.body.classList.contains("pro-shell")) return; // 프로 전용 — 표준은 사이드바가 있다
    var rail = document.getElementById("gijoRail");
    if (!rail || rail.querySelector(".rr-item")) return; // 재진입 가드 — 실존 요소 기준(검토관 L1: 없는 id는 가드가 아니다)
    var g = window.gijo;
    if (!g || !g.listAgents) return;

    // 팀원 아이콘 — planA-2-hero 시각 언어(이모지 아닌 기호문자). id 순서 = 등록부 순서.
    var 팀 = [
      { id: "orchestrator", 기호: "🧭" }, { id: "scan", 기호: "◣" }, { id: "analysis", 기호: "◎" },
      { id: "report", 기호: "▣" }, { id: "ti", 기호: "🛰" }, { id: "normaltic", 기호: "📚" },
    ];
    var 부품 = [
      { id: "embed", 기호: "E", title: "임베딩 엔진(bge-m3) — 문서·질문을 숫자로", page: "aihub.html?panel=knowledge", label: "지식" },
      { id: "search", 기호: "R", title: "RAG 검색 — 사내 지식에서 근거 찾기", page: "aihub.html?panel=knowledge", label: "지식" },
      { id: "guard", 기호: "G", title: "가드레일 — 들어오는 지시 입구 검사", page: "aihub.html?panel=safety", label: "안전장치" } /* redteam.html은 aihub로 흡수(TAB_REDIRECT) — 도착지로 직접(검토관 L8) */,
      { id: "lora", 기호: "L", title: "LoRA 전문가 어댑터", page: "aihub.html?panel=team", label: "AI 팀" },
    ];

    var 홈 = document.getElementById("railHome");
    function 만들기(afterEl, items, idPrefix, 팀인가) {
      var div = document.createElement("div");
      div.className = "rr-div";
      afterEl.insertAdjacentElement("afterend", div);
      var prev = div;
      items.forEach(function (it) {
        var b = document.createElement("button");
        b.className = "rr-item";
        b.id = idPrefix + it.id;
        b.textContent = it.기호;
        b.title = it.title || "";
        b.addEventListener("click", function () {
          var pg = 팀인가 ? "aihub.html?panel=team" : it.page;
          var lb = 팀인가 ? "AI 팀" : it.label;
          if (window.gijoOpenScreen) window.gijoOpenScreen(pg, lb);
          else if (window.gijo && window.gijo.openTabInShell) window.gijo.openTabInShell(pg, lb);
        });
        prev.insertAdjacentElement("afterend", b);
        prev = b;
      });
      return prev;
    }
    var 팀끝 = 만들기(홈 || rail.lastElementChild, 팀, "rr-", true);
    만들기(팀끝, 부품, "rr-", false);

    var 이름표 = {}; // 표시 이름(커스텀 가능) → 에이전트 id — llm:event.agent 매칭용
    function 상태반영(list) {
      (list || []).forEach(function (a) {
        이름표[a.name || a.defaultName] = a.id;
        var el = document.getElementById("rr-" + a.id);
        if (!el) return;
        // 표시는 아이콘, 약자·이름은 툴팁(2026-08-20 새벽 사장님 정정 — 「아이콘으로 표시하자, 이름은 그대로 두고」)
        el.title = (a.abbr ? "[" + a.abbr + "] " : "") + (a.name || a.defaultName) + " — " + (a.role || "");
        // working 애니메이션은 llm:event가 켠 것을 폴링이 끄지 않게, 폴링은 watching/기본만 손댄다
        if (!el.classList.contains("working")) el.classList.toggle("watching", a.status === "watching");
        if (a.status === "working") el.classList.add("working");
        if (a.status === "idle") el.classList.remove("working");
      });
    }
    g.listAgents().then(상태반영).catch(function () { /* 서버 미접속 — 아이콘만 */ });
    setInterval(function () { g.listAgents().then(상태반영).catch(function () { }); }, 20000); // office 관례(20초)

    // 어댑터 채택 수 — LoRA 툴팁에 사실 그대로(등록 N · 채택 N — 채택 0이면 「준비 중」)
    if (g.getTeamComposition) g.getTeamComposition().then(function (c) {
      var el = document.getElementById("rr-lora");
      if (!el || !c || !c.adapters) return;
      el.title = "LoRA 전문가 어댑터 — 등록 " + (c.adapters.registered || 0) + " · 채택 " + (c.adapters.adopted || 0) +
        ((c.adapters.adopted || 0) === 0 ? " (준비 중)" : "");
    }).catch(function () { });

    var 소등타이머 = {}; // 팀원 working 타임아웃(신호 유실 대비)
    function 켬(id, ms) {
      var el = document.getElementById("rr-" + id);
      if (!el) return;
      el.classList.add("working");
      clearTimeout(소등타이머[id]);
      소등타이머[id] = setTimeout(function () { el.classList.remove("working"); }, ms || 30000);
    }
    function 끔(id) {
      var el = document.getElementById("rr-" + id);
      if (el) el.classList.remove("working");
      clearTimeout(소등타이머[id]);
    }
    function 플래시(id, cls) {
      var el = document.getElementById("rr-" + id);
      if (!el) return;
      el.classList.remove("flash-search", "flash-guard-ok", "flash-guard-warn", "flash-guard-block");
      void el.offsetWidth; // 애니메이션 재시작 강제
      el.classList.add(cls);
      setTimeout(function () { el.classList.remove(cls); }, 950);
    }

    if (g.onLlmActivity) g.onLlmActivity(function (e) {
      if (!e || !e.kind) return;
      if (e.kind === "chat") {
        var id = 이름표[e.agent] || null;
        if (!id) return;
        if (e.phase === "start") 켬(id);
        else 끔(id);
        return;
      }
      if (e.phase !== "done") return; // 부품 신호는 done 펄스만(설계 — start 없는 신호)
      if (e.kind === "embed") 플래시("embed", "flash-search");
      else if (e.kind === "search") 플래시("search", "flash-search");
      else if (e.kind === "guard") {
        var d = String(e.detail || "");
        플래시("guard", d.indexOf("차단") === 0 ? "flash-guard-block" : d.indexOf("허용") === 0 ? "flash-guard-warn" : "flash-guard-ok");
      }
    });
    if (g.onLearnloopProgress) g.onLearnloopProgress(function (run) {
      var el = document.getElementById("rr-lora");
      if (!el) return;
      var 학습중 = run && run.stage && run.stage !== "done" && run.stage !== "error";
      el.classList.toggle("training", !!학습중);
      if (run && run.stage) el.title = "LoRA — " + (학습중 ? "학습 진행 중(" + run.stage + ")" : run.stage === "error" ? "최근 학습 실패" : "최근 학습 완료: " + (run.topic || "")); // error를 완료로 말하지 않는다(검토관 L3)
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
