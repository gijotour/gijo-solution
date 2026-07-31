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
      // 표 — 다음 줄이 구분선이면 표로 본다
      if (/\|/.test(L) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var cells = function (row) {
          return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); });
        };
        var head = cells(L);
        i += 2;
        var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
        out.push(
          "<table><thead><tr>" + head.map(function (h) { return "<th>" + inline(h) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") +
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

  window.gijoMd = { render: renderMd, inline: inline, esc: esc };
})();
