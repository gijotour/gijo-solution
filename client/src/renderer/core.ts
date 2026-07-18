// renderer/core.ts — 렌더러 공통 로직
// 각 페이지 HTML에 <script src="../core.js"></script>로 포함해 사용한다.
// window.gijo.* 는 preload.ts가 노출한 안전한 API 래퍼(내부적으로 서버 REST 호출).
// [CS 구조 변경] 대시보드 진입 시 window.gijoRealtime.connect()로 WebSocket을 열어
// collaboration:event / finetune:progress 실시간 이벤트를 수신한다.

declare global {
  interface Window {
    gijo: {
      setServerUrl: (url: string) => void;
      getServerUrl: () => string;
      checkServerHealth: () => Promise<unknown>;
      login: (username: string, password: string) => Promise<unknown>;
      logout: () => Promise<void>;
      me: () => Promise<unknown>;
      isAuthenticated: () => boolean;
      navigateTo: (page: string) => Promise<void>;
      listAgents: () => Promise<unknown[]>;
      sendInstruction: (text: string) => Promise<unknown>;
      approveAgentTool: (tool: string, args: Record<string, string>, instruction?: string) => Promise<{ output: string; undoId?: string }>;
      undoAgentTool: (id?: string) => Promise<{ ok: boolean; message: string }>;
      onCollaborationEvent: (cb: (evt: unknown) => void) => void;
      listTasks: () => Promise<unknown[]>;
      addTask: (text: string) => Promise<unknown>;
      completeTask: (id: string) => Promise<unknown>;
      chat: (agentId: string, message: string) => Promise<unknown>;
    };
    gijoRealtime: {
      connect: () => void;
    };
  }
}

function wireSidebarNavigation(): void {
  document.querySelectorAll<HTMLElement>(".nav-item[data-page]").forEach((el) => {
    el.addEventListener("click", () => {
      const page = el.dataset.page;
      if (page) window.gijo.navigateTo(page);
    });
  });
}

function wireChatBar(): void {
  const input = document.querySelector<HTMLInputElement>(".chatbar input");
  if (!input) return;
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      await window.gijo.sendInstruction(input.value.trim());
      input.value = "";
    }
  });
}

function wireLogoutButton(): void {
  document.querySelectorAll<HTMLElement>("[data-action='logout']").forEach((el) => {
    el.addEventListener("click", async () => {
      await window.gijo.logout();
      await window.gijo.navigateTo("login.html");
    });
  });
}

function wireCollaborationFeed(): void {
  const feed = document.querySelector<HTMLElement>("[data-collab-feed]");
  window.gijo.onCollaborationEvent((evt) => {
    if (!feed) return;
    const row = document.createElement("div");
    row.className = "collab-row";
    row.textContent = typeof evt === "string" ? evt : JSON.stringify(evt);
    feed.prepend(row);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  window.gijoRealtime.connect();
  wireSidebarNavigation();
  wireChatBar();
  wireLogoutButton();
  wireCollaborationFeed();
  // TODO: 페이지별로 필요한 초기 데이터 로드(listAgents/listTasks 등)를
  // 각 page.html 하단에 추가 스크립트로 연결
});

export {};
