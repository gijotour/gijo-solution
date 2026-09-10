// gijomd.js — 마크다운을 화면에 그리는 **공용** 렌더러.
//
// ■ 왜 공용인가 (2026-07-31)
//   문서함이 쓰던 것을 대화창(지휘소)도 쓰게 되면서 두 벌이 될 뻔했다. 두 벌로 두면
//   한쪽만 고쳐져 "문서함에선 표가 나오는데 대화창에선 안 나온다"가 된다 —
//   오늘만 "같은 것이 여러 군데" 문제를 세 번 겪었다. **자료도 코드도 한 곳이다.**
//
// ■ 왜 대화창에 필요했나 (사용자 지적)
//   대화창은 답을 **글자 그대로만** 그렸다. 그래서 모델이 보낸 `**자원 상태**`가
//   별표째로 보였다("지금 너하고 하는 대화처럼" 보이게 해 달라는 요청의 실체가 이것이다).
//   표·굵은 글씨·목록이 그려져야 숫자와 이름이 눈에 들어온다 — 그래픽이 아니라 **데이터**다.
//
// ⚠ 반드시 esc()를 먼저 걸고 그 위에 서식을 얹는다. 순서가 바뀌면 남이 보낸 글이
//   그대로 화면에서 실행된다(문서·대화 둘 다 밖에서 온 글을 그린다).
(function () {
  "use strict";
  if (window.gijoMd) return;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── 표 규격 — server/src/engine/tabletext.ts의 **사본**이다 (2026-09-10, 갈래 C) ──────
  //
  // ■ 왜 사본을 두는가
  //   서버는 「무엇이 표인가」를 engine/tabletext.ts 한 곳으로 모았는데(갈래 U), 사람이 실제로
  //   보는 이 화면만 제 나름대로 읽고 있었다 — 구분선을 헐겁게 보고, 셀을 `split("|")`로 갈라
  //   **칸 안 이스케이프 `\|`를 몰랐고**(칸이 하나 더 생기고 역슬래시가 남는다), 행마다 칸 수가
  //   달라도 안 맞췄다. 내보내기(inspectionHtml/Docx)가 고친 바로 그 증상이 화면에만 남아 있었다.
  //   이 파일은 preload 없이 도는 **순수 브라우저 스크립트**라 서버 TS를 import할 길이 원리상
  //   없다(화면은 소스를 그대로 싣는다 — 번들러가 없다). 그래서 사본이 불가피하다.
  //
  // ■ 사본을 두는 대신 지키는 계약
  //   ⚠ **원본은 저쪽이다.** 고칠 일이 생기면 언제나 tabletext.ts를 먼저 고치고 여기로 옮겨 적는다.
  //   ⚠ 어긋나면 빨개진다 — server/test/gijomdtable.test.ts가 이 파일을 가짜 window로 **실제로
  //     실행해서** 같은 입력을 양쪽에 먹이고 같은 답인지 잰다(소스 훑기가 아니라 돌려 보고 잰다).
  //     그래서 아래 세 함수를 window.gijoMd.표규격으로 내놓는다 — **시험이 꺼내 보는 창구**이고
  //     화면 코드는 여기 안에서만 쓴다.

  /** tabletext.ts의 `구분선`의 사본 — |---|---| · |:---|---:| · |-|-| 꼴.
   *  ⚠ 대시 2개 이상은 공백을 둘러도 구분선이지만, **대시 하나는 꽉 붙은 것만** 구분선이다.
   *    `| - | - |`은 「해당 없음」을 적은 **본문 행**이라 구분선이 아니다 — 여기서 삼키면
   *    서버가 살려 낸 그 행을 화면이 도로 먹는다. 두 갈래는 언제나 함께 고친다. */
  function 구분선(l) { return /^\s*\|(?:(?:\s*:?-{2,}:?\s*|:?-:?)\|)+\s*$/.test(l); }

  /** tabletext.ts의 `칸가르기`의 사본 — 양끝 파이프를 벗기고 칸 안 이스케이프(`\|`)를 되돌린다.
   *  ⚠ 안 풀면 칸이 하나 더 생기고 역슬래시가 화면에 남는다. 추출기 칸글()이 실제로 내는 꼴이다. */
  function 칸가르기(l) {
    var t = String(l).trim().replace(/^\|/, "").replace(/\|$/, "");
    return t.split(/(?<!\\)\|/).map(function (c) { return c.replace(/\\\|/g, "|").trim(); });
  }

  /** tabletext.ts의 `표_최대열`의 사본 — 자리 채우기가 폭주하는 것을 막는 **하나뿐인** 상한. */
  var 표_최대열 = 512;

  /** tabletext.ts의 `표행맞추기`의 사본 — 한 표의 모든 행을 같은 열 수로. 폭은 가장 넓은 행.
   *  ⚠ **넘치는 칸을 자르지 않는다** — GFM은 버리지만 우리 제품에서 그 글은 고객이 쓴 점검
   *    결과다. 표가 한 칸 넓어지는 것보다 글이 사라지는 것이 나쁘다. */
  function 표행맞추기(행들) {
    var 폭 = Math.min(행들.reduce(function (a, r) { return Math.max(a, r.length); }, 0), 표_최대열);
    return 행들.map(function (r) {
      var out = [];
      for (var i = 0; i < 폭; i++) out.push(r[i] === undefined ? "" : r[i]);
      return out;
    });
  }

  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      // 이미지 — 링크보다 **먼저** 처리해야 한다(![]()가 []()에 먼저 잡히면 그림이 사라진다).
      // 실측(2026-07-31): 미리보기에 붙여넣은 캡처가 안 보였다 — 파일에는 들어 있는데 화면에만
      // 없어서, "저장될 모습 그대로"라는 미리보기의 약속이 깨졌다.
      // ⚠ data: 와 http(s): 만 허용한다. javascript: 같은 것이 src로 들어가면 안 된다.
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_m, alt, src) {
        return /^(data:image\/|https?:)/i.test(src) ? '<img src="' + src + '" alt="' + alt + '">' : "";
      })
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, txt, href) {
        return /^https?:/i.test(href) ? '<a href="' + href + '" target="_blank" rel="noreferrer">' + txt + "</a>" : txt;
      });
  }

  function renderMd(src) {
    var lines = String(src || "").split(/\r?\n/);
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var L = lines[i];

      // 코드 블록
      if (/^```/.test(L)) {
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      // 표 — 다음 줄이 구분선이면 표로 본다. 잣대는 위 「표 규격」(tabletext.ts 사본) 한 곳.
      if (/\|/.test(L) && i + 1 < lines.length && 구분선(lines[i + 1])) {
        var 행들 = [칸가르기(L)];
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { 행들.push(칸가르기(lines[i])); i++; }
        // 폭은 **다 모은 뒤** 한 번에 맞춘다 — 행마다 그리면 뒤에 나온 넓은 행이 앞 행을 못 늘려
        // 칸 수가 갈린 표가 나간다(내보내기가 같은 자리에서 겪은 증상이다).
        var 맞춘 = 표행맞추기(행들);
        var 머리 = 맞춘[0] || [];
        out.push(
          "<table><thead><tr>" + 머리.map(function (h) { return "<th>" + inline(h) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          맞춘.slice(1).map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") +
          "</tbody></table>"
        );
        continue;
      }
      // 제목
      var h = L.match(/^(#{1,4})\s+(.*)$/);
      if (h) { var lv = Math.min(h[1].length, 3); out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"); i++; continue; }
      // 구분선
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(L)) { out.push("<hr>"); i++; continue; }
      // 인용
      if (/^\s*>/.test(L)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + q.map(inline).join("<br>") + "</blockquote>");
        continue;
      }
      // 목록
      if (/^\s*([-*·]|\d+\.)\s+/.test(L)) {
        var ordered = /^\s*\d+\./.test(L);
        var items = [];
        while (i < lines.length && /^\s*([-*·]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*·]|\d+\.)\s+/, ""));
          i++;
        }
        var tag = ordered ? "ol" : "ul";
        out.push("<" + tag + ">" + items.map(function (t) { return "<li>" + inline(t) + "</li>"; }).join("") + "</" + tag + ">");
        continue;
      }
      // 빈 줄
      if (!L.trim()) { i++; continue; }
      // 문단 — 이어지는 줄을 묶는다
      var para = [L];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*·]|\d+\.)\s|\s*(-{3,}|\*{3,}))/.test(lines[i]) && !/\|/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push("<p>" + para.map(inline).join(" ") + "</p>");
    }
    return out.join("\n");
  }

  // 표규격 — server/test/gijomdtable.test.ts가 tabletext.ts 원본과 **동치인지** 재려고 꺼내 보는
  //   창구다. 화면 코드는 이 창구로 부르지 않는다(위 renderMd가 클로저 안에서 직접 쓴다).
  window.gijoMd = {
    render: renderMd, inline: inline, esc: esc,
    표규격: { 구분선: 구분선, 칸가르기: 칸가르기, 표행맞추기: 표행맞추기, 표_최대열: 표_최대열 },
  };
})();
