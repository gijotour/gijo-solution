// pixel-office.js — 시안 공용 픽셀 사무실 렌더러 (목업 전용, 의존성 없음)
// GIJO AS 에이전트 6명을 작은 픽셀 캐릭터로 그린다. 상태: working(타이핑)/watching(주시)/idle(배회).
// 실구현 시 /api/agents 상태 + WebSocket 협업 피드로 구동한다는 전제를 시각화한다.
(function () {
  const AGENTS = [
    { id: "orch",    name: "Orchestrator", color: "#5fa1ff", state: "working",  desk: 0 },
    { id: "scan",    name: "Scan",         color: "#1eb980", state: "working",  desk: 1 },
    { id: "analyze", name: "Analyze",      color: "#8b7cf0", state: "watching", desk: 2 },
    { id: "report",  name: "Report",       color: "#f0a020", state: "idle",     desk: 3 },
    { id: "ti",      name: "TI",           color: "#e2483d", state: "watching", desk: 4 },
    { id: "gijo",    name: "GIJO",         color: "#7dd3c0", state: "working",  desk: 5 },
  ];
  const BUBBLES = [
    ["scan", "신규 스캔 12건 자산 반영"],
    ["ti", "KEV 2건 매칭 — 영향 자산 3대"],
    ["orch", "하드닝 리포트 → Report에 위임"],
    ["analyze", "CVE-2026-1234 우선순위 P1"],
    ["report", "주간 보고서 초안 작성 중"],
    ["gijo", "U-102 항목 사내 지침 부연"],
  ];

  // 사무실 타일맵: 20x11 타일(타일 8px). S=슈퍼샘플 배율 — 픽셀아트는 ×S 정수 확대로
  // 또렷하게 유지하면서, 말풍선 텍스트는 실해상도로 작고 선명하게 그린다.
  function createOffice(canvas, opts) {
    const o = Object.assign({ showBubbles: true }, opts);
    const ctx = canvas.getContext("2d");
    const COLS = 20, ROWS = 11, S = 3;
    const W = COLS * 8, H = ROWS * 8;
    canvas.width = W * S; canvas.height = H * S;
    canvas.style.imageRendering = "pixelated";

    // 책상 위치(타일): 좌열 3, 우열 3
    const DESKS = [
      { x: 3, y: 2 }, { x: 8, y: 2 }, { x: 13, y: 2 },
      { x: 3, y: 6 }, { x: 8, y: 6 }, { x: 13, y: 6 },
    ];
    const COFFEE = { x: 17.5, y: 8.5 };
    const agents = AGENTS.map((a) => ({
      ...a,
      x: (DESKS[a.desk].x + 1) * 8, y: DESKS[a.desk].y * 8 + 22, // 책상 앞줄 — 모니터가 가려지지 않게
      tx: 0, ty: 0, wanderT: 0, frame: 0,
    }));
    let bubbleIdx = 0, bubbleT = 0, t = 0;

    function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x * S), Math.round(y * S), w * S, h * S); }

    function drawRoom() {
      // 바닥 체커
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
        px(c * 8, r * 8, 8, 8, (r + c) % 2 ? "#1a2338" : "#171f33");
      // 벽
      px(0, 0, W, 10, "#0e1526"); px(0, 10, W, 2, "#2a3552");
      // 창문
      for (let i = 0; i < 4; i++) px(14 + i * 44, 2, 20, 7, "#22345c");
      // 회의 테이블(중앙 하단)
      px(72, 70, 28, 12, "#3a2f22"); px(74, 68, 24, 4, "#4a3c2c");
      // 화분
      px(2, 74, 8, 10, "#2c5a3a"); px(4, 82, 4, 4, "#5a3c28");
      px(W - 12, 14, 8, 10, "#2c5a3a"); px(W - 10, 22, 4, 4, "#5a3c28");
      // 커피머신
      px(COFFEE.x * 8, COFFEE.y * 8 - 6, 10, 12, "#3a4258");
      px(COFFEE.x * 8 + 2, COFFEE.y * 8 - 4, 6, 3, "#e2483d");
      // 책상들
      DESKS.forEach((d, i) => {
        const a = agents[i];
        px(d.x * 8, d.y * 8 + 6, 22, 9, "#4a3c2c");        // 상판
        px(d.x * 8 + 1, d.y * 8 + 15, 3, 4, "#3a2f22");    // 다리
        px(d.x * 8 + 18, d.y * 8 + 15, 3, 4, "#3a2f22");
        // 모니터 — 상태별 발광
        const glow = a.state === "working" ? (Math.floor(t / 20) % 2 ? "#1eb980" : "#17a06e")
                   : a.state === "watching" ? "#f0a020" : "#2a3552";
        px(d.x * 8 + 7, d.y * 8 - 1, 9, 7, "#0a0e1a");
        px(d.x * 8 + 8, d.y * 8, 7, 5, glow);
        px(d.x * 8 + 10, d.y * 8 + 6, 3, 2, "#3a4258");
      });
    }

    function drawAgent(a) {
      const bob = a.state === "working" ? (Math.floor(t / 12) % 2) : 0;
      const wx = a.x, wy = a.y + (a.state === "idle" ? Math.sin(t / 30 + a.desk) * 1.5 : 0);
      // 몸(역할색)·머리·타이핑 팔
      px(wx, wy - 6 + bob, 6, 6, a.color);
      px(wx + 1, wy - 11 + bob, 4, 5, "#e8c39e");
      px(wx, wy - 13 + bob, 6, 3, a.desk % 2 ? "#3a2f22" : "#22263a"); // 머리카락
      if (a.state === "working") px(wx - 2 + (bob ? 1 : 0), wy - 3, 2, 2, "#e8c39e");
      // 상태 점
      const dot = a.state === "working" ? "#1eb980" : a.state === "watching" ? "#f0a020" : "#5f6785";
      px(wx + 2, wy - 16, 2, 2, dot);
    }

    function drawBubble() {
      if (!o.showBubbles) return;
      const [id, msg] = BUBBLES[bubbleIdx];
      const a = agents.find((x) => x.id === id);
      if (!a || bubbleT > 160) return;
      // 말풍선은 실해상도(×S 캔버스 좌표)로 그려 텍스트를 작고 또렷하게.
      ctx.font = `${3.4 * S}px 'Malgun Gothic',sans-serif`;
      const tw = ctx.measureText(msg).width;
      const w = Math.min(tw + 4 * S, (W - 8) * S);
      const bx = Math.max(2 * S, Math.min(a.x * S - w / 2, (W - 2) * S - w));
      const by = (a.y - 26) * S;
      ctx.fillStyle = "#e7eaf3";
      ctx.fillRect(bx, by, w, 6 * S);
      ctx.fillRect(a.x * S, by + 6 * S, 2 * S, 2 * S); // 꼬리
      ctx.fillStyle = "#0a0e1a";
      ctx.fillText(msg, bx + 2 * S, by + 4.4 * S);
    }

    function step() {
      t++;
      bubbleT++;
      if (bubbleT > 220) { bubbleT = 0; bubbleIdx = (bubbleIdx + 1) % BUBBLES.length; }
      // idle 배회: 커피머신 ↔ 자리
      agents.forEach((a) => {
        if (a.state !== "idle") return;
        a.wanderT++;
        const goal = Math.floor(a.wanderT / 300) % 2 ? COFFEE : { x: DESKS[a.desk].x + 1, y: DESKS[a.desk].y + 2 };
        const gx = goal.x * 8, gy = goal.y * 8;
        a.x += Math.sign(gx - a.x) * 0.3; a.y += Math.sign(gy - a.y) * 0.3;
      });
      ctx.clearRect(0, 0, W * S, H * S);
      drawRoom();
      agents.slice().sort((p, q) => p.y - q.y).forEach(drawAgent);
      drawBubble();
      requestAnimationFrame(step);
    }
    step();
    return { agents: AGENTS };
  }
  window.createOffice = createOffice;
  window.GIJO_AGENTS = AGENTS;
})();
