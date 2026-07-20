// pixel-office-v2.js — "이쁘게" 시안용 고품질 픽셀 렌더러 (목업 전용).
// v1 대비: 캐릭터 외곽선·음영·눈, 책상 소품(키보드·머그·서류), 바닥 테마(원목/네온그리드/딥카펫),
// 러그, 그림자, 모니터 발광 헤일로, 벽 장식(시계·포스터·네온사인), 창밖 하늘, 커피 김.
// createOffice2(canvas, THEMES.cozy|neon|deep)
(function () {
  const AGENTS = [
    { name: "Orchestrator", shirt: "#5fa1ff", hair: "#2b2f45", state: "working" },
    { name: "Scan",         shirt: "#1eb980", hair: "#4a3020", state: "working" },
    { name: "Analyze",      shirt: "#8b7cf0", hair: "#1e2230", state: "watching" },
    { name: "Report",       shirt: "#f0a020", hair: "#4a3020", state: "idle" },
    { name: "TI",           shirt: "#e2483d", hair: "#2b2f45", state: "watching" },
    { name: "GIJO",         shirt: "#7dd3c0", hair: "#1e2230", state: "working" },
  ];
  const VISITORS = [ { n: "jyh", c: "#e2b0ff" }, { n: "test1", c: "#ffd28a" } ];
  const BUBBLES = [["Scan", "신규 스캔 12건 자산 반영"], ["TI", "KEV 2건 매칭 — 자산 3대"], ["Orchestrator", "리포트 → Report 위임"]];

  const THEMES = {
    cozy: {
      name: "cozy", wallTop: "#2a2320", wallBottom: "#3a2f28", base: "#241d18",
      floorA: "#5a4632", floorB: "#514029", plank: "rgba(0,0,0,.18)", grid: null,
      rug: ["#1eb980", "#17a06e"], deskTop: "#7a5a3a", deskFace: "#5f4530", deskEdge: "#8f6c48",
      skyTop: "#7fb2e8", skyBottom: "#cfe3f5", sun: "#ffe9a8", sign: null,
      accent: "#f0a020", shaft: "rgba(255,236,180,.05)",
    },
    neon: {
      name: "neon", wallTop: "#0a0f1e", wallBottom: "#101a30", base: "#060a14",
      floorA: "#101828", floorB: "#0c1220", plank: null, grid: "rgba(64,220,255,.10)",
      rug: ["#12335a", "#0e2846"], deskTop: "#2a3a55", deskFace: "#1d2a40", deskEdge: "#3b5378",
      skyTop: "#0b1030", skyBottom: "#25164a", sun: "#cfd8ff", sign: "GIJO SOC",
      accent: "#40dcff", shaft: "rgba(64,220,255,.045)",
    },
    deep: {
      name: "deep", wallTop: "#0e1526", wallBottom: "#16203a", base: "#0a1120",
      floorA: "#1c2440", floorB: "#171e35", plank: null, grid: "rgba(255,255,255,.03)",
      rug: ["#31406e", "#283457"], deskTop: "#5a4632", deskFace: "#463626", deskEdge: "#6d563e",
      skyTop: "#1c2c55", skyBottom: "#3a2c66", sun: "#ffe9a8", sign: null,
      accent: "#5fa1ff", shaft: "rgba(160,190,255,.05)",
    },
  };

  function createOffice2(canvas, theme) {
    const T = theme;
    const ctx = canvas.getContext("2d");
    const S = 3, COLS = 22, ROWS = 12, W = COLS * 8, H = ROWS * 8;
    canvas.width = W * S; canvas.height = H * S;
    canvas.style.imageRendering = "pixelated";
    const WALL_H = 14;
    const DESKS = [ { x: 3, y: 2 }, { x: 9, y: 2 }, { x: 15, y: 2 }, { x: 3, y: 6.6 }, { x: 9, y: 6.6 }, { x: 15, y: 6.6 } ];
    const TABLE = { x: 78, y: 74 };
    const DOOR = { x: W - 8, y: 46 };
    const COFFEE = { x: W - 20, y: 90 };
    let t = 0, bi = 0, bt = 0;
    const steam = [];

    function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x * S), Math.round(y * S), Math.round(w * S), Math.round(h * S)); }

    function drawRoom() {
      // 바닥
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) px(c * 8, r * 8, 8, 8, (r + c) % 2 ? T.floorA : T.floorB);
      if (T.plank) for (let r = 2; r < ROWS; r++) px(0, r * 8, W, 0.5, T.plank);           // 원목 이음새
      if (T.grid) for (let c = 0; c < COLS; c++) px(c * 8, WALL_H, 0.5, H - WALL_H, T.grid); // 네온 그리드
      // 벽 + 걸레받이
      px(0, 0, W, WALL_H - 2, T.wallTop); px(0, WALL_H - 2, W, 2, T.base);
      // 창문 3개 — 하늘 그라데이션 + 해/달 + 빛기둥
      for (let i = 0; i < 3; i++) {
        const wx = 16 + i * 52;
        px(wx - 1, 1, 26, 10, T.base);
        px(wx, 2, 24, 5, T.skyTop); px(wx, 7, 24, 3, T.skyBottom);
        px(wx + 18, 3, 3, 3, T.sun);
        px(wx + 11, 2, 1, 8, T.base); // 창살
        ctx.fillStyle = T.shaft; ctx.fillRect((wx - 2) * S, 11 * S, 28 * S, 30 * S); // 빛기둥
      }
      // 벽 장식: 시계 + 방패 로고(보안팀) / 네온사인
      px(118, 3, 7, 7, "#e7eaf3"); px(120, 4, 1, 3, "#333"); px(121, 6, 2, 1, "#333"); px(118, 3, 7, 1, T.base);
      px(4, 3, 8, 8, T.base); px(5, 4, 6, 5, T.accent); px(7, 5, 2, 4, "#fff");
      if (T.sign) { ctx.font = `bold ${4 * S}px monospace`; ctx.fillStyle = T.accent; ctx.shadowColor = T.accent; ctx.shadowBlur = 6; ctx.fillText(T.sign, 138 * S, 8 * S); ctx.shadowBlur = 0; }
      // 러그(회의 존)
      px(TABLE.x - 12, TABLE.y - 12, 52, 24, T.rug[0]); px(TABLE.x - 10, TABLE.y - 10, 48, 20, T.rug[1]);
      // 회의 테이블(음영 3톤)
      px(TABLE.x, TABLE.y - 2, 28, 4, T.deskEdge); px(TABLE.x, TABLE.y + 2, 28, 8, T.deskTop); px(TABLE.x, TABLE.y + 10, 28, 3, T.deskFace);
      px(TABLE.x + 4, TABLE.y + 3, 5, 3, "#e7eaf3"); px(TABLE.x + 18, TABLE.y + 4, 5, 3, "#cfd8ff"); // 서류
      // 화분 2 + 책장
      plant(4, 86); plant(W - 10, 20);
      px(W - 26, 16, 14, 16, T.deskFace); for (let i = 0; i < 3; i++) { px(W - 25, 18 + i * 5, 12, 3, ["#e2483d", "#5fa1ff", "#f0a020"][i]); }
      // 커피 코너
      px(COFFEE.x - 2, COFFEE.y - 12, 14, 16, T.deskFace); px(COFFEE.x, COFFEE.y - 10, 10, 12, "#3a4258");
      px(COFFEE.x + 2, COFFEE.y - 8, 6, 3, "#e2483d"); px(COFFEE.x + 3, COFFEE.y - 2, 3, 2, "#e7eaf3");
      // 출입문(프레임+명패)
      px(DOOR.x - 1, DOOR.y - 1, 9, 18, T.deskEdge); px(DOOR.x, DOOR.y, 8, 16, T.deskFace); px(DOOR.x + 1, DOOR.y + 7, 1, 2, "#f0a020");
      // 책상들
      DESKS.forEach((d, i) => {
        const a = AGENTS[i];
        const dx = d.x * 8, dy = d.y * 8;
        ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fillRect(dx * S, (dy + 15) * S, 24 * S, 3 * S); // 그림자
        px(dx, dy + 6, 24, 2, T.deskEdge); px(dx, dy + 8, 24, 6, T.deskTop); px(dx, dy + 14, 24, 2, T.deskFace);
        px(dx + 1, dy + 16, 3, 4, T.deskFace); px(dx + 20, dy + 16, 3, 4, T.deskFace);
        px(dx + 8, dy + 11, 7, 2, "#141a2b"); // 키보드
        px(dx + 18, dy + 9, 3, 3, "#e2483d"); // 머그
        px(dx + 2, dy + 9, 4, 2, "#e7eaf3");  // 서류
        // 모니터 + 발광 헤일로
        const on = a.state !== "idle";
        const glow = a.state === "working" ? "#2ee6a0" : a.state === "watching" ? "#f0a020" : "#232c44";
        if (on) { ctx.fillStyle = a.state === "working" ? "rgba(46,230,160,.10)" : "rgba(240,160,32,.10)"; ctx.fillRect((dx + 5) * S, (dy - 4) * S, 14 * S, 12 * S); }
        px(dx + 7, dy - 2, 10, 8, "#05070d");
        px(dx + 8, dy - 1, 8, 6, glow);
        if (on && Math.floor(t / 30) % 3 === 0) px(dx + 9, dy, 4, 1, "rgba(255,255,255,.5)"); // 스캔라인
        px(dx + 11, dy + 6, 2, 2, "#39445f");
      });
    }
    function plant(x, y) { px(x + 1, y - 8, 6, 8, "#2c7a4a"); px(x, y - 5, 3, 4, "#2c5a3a"); px(x + 5, y - 6, 3, 4, "#2c5a3a"); px(x + 1, y, 6, 5, "#a06a3c"); px(x + 1, y, 6, 1, "#c08a52"); }

    function drawChar(x, y, shirt, hair, opts) {
      const o = opts || {};
      const bob = o.typing ? Math.floor(t / 12) % 2 : 0;
      // 외곽선
      px(x - 1, y - 15 + bob, 8, 15, "rgba(5,8,14,.55)");
      // 다리·신발
      px(x + 1, y - 2, 2, 2, "#26304a"); px(x + 4, y - 2, 2, 2, "#26304a");
      // 몸(셔츠 2톤)
      px(x, y - 8 + bob, 7, 6, shirt); px(x + 5, y - 8 + bob, 2, 6, "rgba(0,0,0,.25)");
      // 팔
      px(x - 1, y - 7 + bob, 1, 4, shirt); px(x + 7, y - 7 + bob, 1, 4, shirt);
      if (o.typing) px(x - 1 + (bob ? 1 : 0), y - 4, 2, 2, "#e8c39e");
      // 머리(피부+눈+머리카락)
      px(x + 1, y - 13 + bob, 5, 5, "#e8c39e");
      px(x + 2, y - 11 + bob, 1, 1, "#1c1f2b"); px(x + 4, y - 11 + bob, 1, 1, "#1c1f2b");
      px(x, y - 15 + bob, 7, 3, hair); px(x, y - 13 + bob, 1, 2, hair); px(x + 6, y - 13 + bob, 1, 2, hair);
      // 상태 점
      if (o.dot) px(x + 3, y - 18, 2, 2, o.dot);
      if (o.tag) { ctx.font = `${3 * S}px 'Malgun Gothic'`; ctx.fillStyle = o.tagColor || "rgba(231,234,243,.8)"; const tw = ctx.measureText(o.tag).width; ctx.fillText(o.tag, (x + 3.5) * S - tw / 2, (y + 5) * S); }
    }

    function step() {
      t++; bt++;
      if (bt > 240) { bt = 0; bi = (bi + 1) % BUBBLES.length; }
      if (t % 24 === 0) steam.push({ x: COFFEE.x + 3 + Math.random() * 3, y: COFFEE.y - 12, life: 80 });
      steam.forEach((s) => { s.y -= 0.2; s.x += Math.sin(t / 9 + s.life) * 0.1; s.life--; });
      for (let i = steam.length - 1; i >= 0; i--) if (steam[i].life <= 0) steam.splice(i, 1);

      ctx.clearRect(0, 0, W * S, H * S);
      drawRoom();
      // 에이전트
      AGENTS.forEach((a, i) => {
        const d = DESKS[i];
        const dot = a.state === "working" ? "#2ee6a0" : a.state === "watching" ? "#f0a020" : "#5f6785";
        drawChar(d.x * 8 + 8, d.y * 8 + 26, a.shirt, a.hair, { typing: a.state === "working", dot, tag: a.name });
      });
      // 방문자(회의 테이블)
      VISITORS.forEach((v, i) => drawChar(TABLE.x + 2 + i * 14, TABLE.y + 22, v.c, "#4a3020", { tag: v.n, tagColor: "#ffe9a8" }));
      // 커피 김
      steam.forEach((s) => { ctx.fillStyle = `rgba(220,228,245,${s.life / 110})`; ctx.fillRect(Math.round(s.x * S), Math.round(s.y * S), S, S); });
      // 말풍선
      const [who, msg] = BUBBLES[bi];
      const ai = AGENTS.findIndex((a) => a.name === who);
      if (ai >= 0 && bt < 170) {
        const d = DESKS[ai]; const axp = d.x * 8 + 11, ayp = d.y * 8 - 6;
        ctx.font = `${3.4 * S}px 'Malgun Gothic'`;
        const tw = ctx.measureText(msg).width, w = tw + 4 * S;
        const bx = Math.max(2 * S, Math.min(axp * S - w / 2, (W - 2) * S - w));
        ctx.fillStyle = "#f4f6fb";
        ctx.fillRect(bx, (ayp - 7) * S, w, 6 * S);
        ctx.fillRect(axp * S, (ayp - 1) * S, 2 * S, 2 * S);
        ctx.fillStyle = "#0a0e1a"; ctx.fillText(msg, bx + 2 * S, (ayp - 2.6) * S);
      }
      requestAnimationFrame(step);
    }
    step();
  }
  window.createOffice2 = createOffice2;
  window.OFFICE_THEMES = THEMES;
})();
