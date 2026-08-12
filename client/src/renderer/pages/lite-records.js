// lite-records.js — 라이트 「작업 내역」 화면 (메뉴 2).
//
// ■ 부르는 것 — **preload 다리만 쓴다**(생 fetch 금지, 아래 `다리()` 주석 참고):
//   window.gijo.listTasks() · addTask(text) · completeTask(id) · toggleTask(id,false)
//   window.gijo.listWorkSessions()
//   ⚠ 응답 모양은 실제로 재서 맞췄다(2026-08-12) — 넘겨짚으면 빈칸이 난다:
//     tasks:    id · priority · text · done · createdAt
//     sessions: id · title · status · doneBy · createdBy · createdAt · updatedAt ·
//               turnCount · lastPreview · lastRole
//
// ■ ⚠ **0건일 때 「없다」고 하지 않는다.** 라이트 첫 실행이 정확히 0건이고 고객이 처음
//   보는 화면이 여기다. 「없습니다」는 「이 제품엔 그 기능이 없구나」로 읽힌다 —
//   win이 2026-08-12에 본 제품 7자리를 같은 이유로 고쳤다. 라이트는 처음부터 그렇게 쓴다.

(function () {
  "use strict";

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ⚠ **생 fetch를 쓰지 않는다.** 화면은 API를 preload 다리(window.gijo)로 부른다 —
  //   토큰·갱신·오류 처리가 거기 한 곳에 있다. 화면마다 fetch를 쓰면 토큰을 만지는 자리가
  //   화면 수만큼 생긴다. (2026-08-12: 처음에 fetch로 짰다가 인증이 안 붙는 걸 확인하고 고쳤다.)
  function 다리() {
    var g = window.gijo;
    if (!g || !g.listTasks || !g.listWorkSessions) return null;
    return g;
  }

  function 날짜(ms) {
    if (!ms) return "";
    var d = new Date(Number(ms));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // ── 내 할 일 ────────────────────────────────────────────────────────
  async function 할일그리기() {
    var box = document.getElementById("taskBox");
    var cnt = document.getElementById("taskCount");
    var list;
    var g = 다리();
    if (!g) { box.innerHTML = 다리없음(); return; }
    try { list = await g.listTasks(); }
    catch (e) { box.innerHTML = '<div class="err">할 일을 못 읽었습니다 — ' + esc(e.message) + "</div>"; return; }
    if (!Array.isArray(list)) list = [];

    cnt.textContent = list.length ? list.filter(function (t) { return !t.done; }).length + " / " + list.length : "";

    if (!list.length) {
      // ⚠ 「할 일이 없습니다」로 쓰지 않는다 — 안 넣은 것과 없는 것은 다르다.
      box.innerHTML =
        '<div class="empty"><b>아직 담은 할 일이 없습니다.</b><br>' +
        "위 칸에 적으면 여기 쌓입니다. 대화창에서 「할 일 담기: …」라고 말해도 됩니다.</div>";
      return;
    }

    var ul = document.createElement("ul");
    list.slice().sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.createdAt - a.createdAt; })
      .forEach(function (t) {
        var li = document.createElement("li");
        if (t.done) li.className = "done";
        li.innerHTML =
          '<span class="p">' + esc(t.priority || "") + "</span>" +
          '<span class="t" title="' + esc(t.text) + '">' + esc(t.text) + "</span>";
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t.done ? "다시 열기" : "완료";
        b.addEventListener("click", function () { 바꾸기(t); });
        li.appendChild(b);
        ul.appendChild(li);
      });
    box.innerHTML = "";
    box.appendChild(ul);
  }

  async function 바꾸기(t) {
    // 완료는 completeTask, 되돌리기는 toggleTask(id, false) — 서버가 그렇게 갈라 뒀다.
    var g = 다리(); if (!g) return;
    try { t.done ? await g.toggleTask(t.id, false) : await g.completeTask(t.id); }
    catch (e) { alert("바꾸지 못했습니다: " + e.message); return; }
    await 할일그리기();
  }

  async function 담기() {
    var input = document.getElementById("taskInput");
    var btn = document.getElementById("taskAdd");
    var text = String(input.value || "").trim();
    if (!text) return;
    btn.disabled = true;
    var g = 다리();
    try { if (g) await g.addTask(text); input.value = ""; }
    catch (e) { alert("담지 못했습니다: " + e.message); }
    finally { btn.disabled = false; }
    await 할일그리기();
    input.focus();
  }

  // ── 작업 내역 ───────────────────────────────────────────────────────
  async function 내역그리기() {
    var box = document.getElementById("sessBox");
    var cnt = document.getElementById("sessCount");
    var list;
    var g = 다리();
    if (!g) { box.innerHTML = 다리없음(); return; }
    try { list = await g.listWorkSessions(); }
    catch (e) { box.innerHTML = '<div class="err">작업 내역을 못 읽었습니다 — ' + esc(e.message) + "</div>"; return; }
    if (!Array.isArray(list)) list = [];

    cnt.textContent = list.length ? list.length + "건" : "";

    if (!list.length) {
      box.innerHTML =
        '<div class="empty"><b>아직 쌓인 작업 내역이 없습니다.</b><br>' +
        "대화창에서 무언가를 물으면 그 대화가 여기 한 건으로 남습니다.</div>";
      return;
    }

    // 최근 것부터 30건 — 1인용이라 그 이상은 스크롤만 길어진다.
    var 보일것 = list.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 30);
    box.innerHTML = 보일것.map(function (s) {
      var 상태 = s.status === "done" ? "done" : "active";
      return (
        '<div class="sess">' +
          '<div class="h">' +
            '<b title="' + esc(s.title) + '">' + esc(s.title) + "</b>" +
            '<span class="st ' + 상태 + '">' + (상태 === "done" ? "완료" : "진행중") + "</span>" +
            '<span class="m">' + esc(날짜(s.updatedAt || s.createdAt)) + " · " + esc(s.turnCount || 0) + "턴</span>" +
          "</div>" +
          (s.lastPreview ? '<div class="pv">' + esc(s.lastPreview) + "</div>" : "") +
        "</div>"
      );
    }).join("");
    if (list.length > 보일것.length) {
      box.insertAdjacentHTML("beforeend",
        '<div class="empty" style="padding-top:10px">최근 ' + 보일것.length + "건만 보입니다(전체 " + list.length + "건).</div>");
    }
  }

  // 다리가 없으면(브라우저로 파일만 연 경우) 조용히 빈칸을 두지 않는다 — 왜 비었는지 적는다.
  function 다리없음() {
    return '<div class="err">앱 밖에서 열려 있어 데이터를 못 읽습니다 — GIJO AS 앱에서 열어 주세요.</div>';
  }

  function 시작() {
    document.getElementById("taskAdd").addEventListener("click", 담기);
    document.getElementById("taskInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); 담기(); }
    });
    할일그리기();
    내역그리기();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 시작);
  else 시작();
})();
