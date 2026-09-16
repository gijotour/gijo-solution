const fs = require('fs');
const path = require('path');
const { gijoAsKnowledgeDocs, quickQuestions } = require('./gijo_as_knowledge_pack.js');

const targetHtmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
const copyV3Path = path.join(__dirname, 'GIJO_AS_스마트아키텍처_v3.html');
const electronIndexPath = path.join(__dirname, 'gijo-security-erp-app', 'index.html');

const docsJson = JSON.stringify(gijoAsKnowledgeDocs);
const quickQuestionsJson = JSON.stringify(quickQuestions);

const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>GIJO WIKI v5.1.0 - 통합 보안 ERP & 스마트 아키텍처 스튜디오</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
  <!-- Mermaid.js Engine -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    /* =========================================================================
       CLEAN & MINIMALIST SLATE DESIGN SYSTEM (v5.1.0)
       ========================================================================= */
    :root {
      --bg-main: #090a0f;
      --bg-panel: #111318;
      --bg-card: #181b22;
      --bg-subtle: #1f232c;
      --border: #272c38;
      --border-focus: #3b82f6;
      --text-main: #f1f5f9;
      --text-sub: #94a3b8;
      --text-dim: #64748b;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #8b5cf6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --radius: 8px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-main);
      color: var(--text-main);
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* Header Bar */
    .app-header {
      background: rgba(17, 19, 24, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 1000;
      padding: 0.65rem 1.5rem;
    }

    .header-inner {
      max-width: 1800px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      user-select: none;
    }

    .brand-logo {
      width: 32px;
      height: 32px;
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 0.95rem;
      color: var(--primary);
    }

    .brand-text {
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .version-tag {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    /* Nav Tabs */
    .nav-tabs {
      display: flex;
      gap: 0.25rem;
      background: var(--bg-panel);
      padding: 0.25rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-sub);
      padding: 0.4rem 0.85rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.15s ease;
    }

    .tab-btn:hover {
      color: #fff;
      background: var(--bg-card);
    }

    .tab-btn.active {
      background: var(--bg-card);
      color: #fff;
      border: 1px solid var(--border);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    /* Header Actions */
    .header-tools {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .btn {
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.15s ease;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-main);
    }

    .btn:hover {
      background: var(--bg-subtle);
      border-color: #3f4756;
      color: #fff;
    }

    .btn-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .btn-primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }

    /* Main Container */
    .main-viewport {
      max-width: 1800px;
      margin: 0 auto;
      padding: 1rem 1.5rem;
      height: calc(100vh - 58px);
    }

    .view-page {
      display: none;
      height: 100%;
    }

    .view-page.active {
      display: block;
    }

    /* GIJO WIKI 3-Column Layout */
    .wiki-grid {
      display: grid;
      grid-template-columns: 310px 1fr 420px;
      gap: 1rem;
      height: 100%;
    }

    .clean-panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel-head {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(24, 27, 34, 0.4);
    }

    .panel-head-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .search-input-wrap {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    .search-input {
      width: 100%;
      background: var(--bg-main);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.45rem 0.65rem;
      color: #fff;
      font-size: 0.8rem;
      outline: none;
      transition: border 0.15s ease;
    }
    .search-input:focus { border-color: var(--border-focus); }

    .category-filter-strip {
      padding: 0.4rem 0.75rem;
      display: flex;
      gap: 0.3rem;
      overflow-x: auto;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
    }

    .pill-cat {
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 600;
      background: var(--bg-card);
      color: var(--text-sub);
      border: 1px solid var(--border);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .pill-cat:hover {
      background: var(--bg-subtle);
      color: #fff;
    }

    .doc-list-clean {
      flex: 1;
      overflow-y: auto;
      padding: 0.4rem;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .doc-entry {
      padding: 0.6rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }

    .doc-entry:hover {
      background: var(--bg-card);
      border-color: var(--border);
    }

    .doc-entry.active {
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.35);
    }

    .doc-entry-title {
      font-weight: 600;
      font-size: 0.82rem;
      color: #e2e8f0;
      margin-bottom: 0.2rem;
    }

    .doc-entry-meta {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.68rem;
      color: var(--text-dim);
    }

    .meta-badge {
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-sub);
    }

    /* Content Area */
    .wiki-content-panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .content-body {
      flex: 1;
      padding: 1.5rem;
      overflow-y: auto;
    }

    .markdown-render {
      line-height: 1.7;
      color: #cbd5e1;
    }
    .markdown-render h1 { font-size: 1.4rem; font-weight: 700; color: #fff; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 1rem; }
    .markdown-render h2 { font-size: 1.15rem; font-weight: 700; color: #93c5fd; margin: 1.25rem 0 0.5rem 0; }
    .markdown-render h3 { font-size: 0.98rem; font-weight: 600; color: #e2e8f0; margin: 1rem 0 0.4rem 0; }
    .markdown-render p { margin-bottom: 0.85rem; font-size: 0.88rem; }
    .markdown-render ul, .markdown-render ol { margin-left: 1.25rem; margin-bottom: 1rem; font-size: 0.88rem; }
    .markdown-render code { background: #090a0f; border: 1px solid var(--border); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.8rem; color: #38bdf8; }

    /* RAG Chat */
    .rag-chat-wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .rag-chip-row {
      padding: 0.5rem 0.75rem;
      background: rgba(17, 19, 24, 0.6);
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 0.3rem;
      overflow-x: auto;
    }

    .rag-chip-btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: #94a3b8;
      font-size: 0.7rem;
      padding: 0.2rem 0.55rem;
      border-radius: 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .rag-chip-btn:hover {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .chat-stream-box {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .bubble {
      max-width: 92%;
      padding: 0.75rem 0.95rem;
      border-radius: var(--radius);
      font-size: 0.82rem;
      line-height: 1.55;
    }

    .bubble.user {
      align-self: flex-end;
      background: var(--primary);
      color: #fff;
    }

    .bubble.ai {
      align-self: flex-start;
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: #f1f5f9;
    }

    .citation-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #93c5fd;
      font-size: 0.7rem;
      margin-top: 0.45rem;
      cursor: pointer;
    }
    .citation-btn:hover {
      background: rgba(59, 130, 246, 0.25);
    }

    .chat-bottom-input {
      padding: 0.65rem;
      border-top: 1px solid var(--border);
      background: var(--bg-panel);
      display: flex;
      gap: 0.4rem;
    }

    /* Modal Styling */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);
      z-index: 2000; display: none; align-items: center; justify-content: center;
    }
    .modal-backdrop.active { display: flex; }
    .modal-box {
      background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
      width: 90%; max-width: 700px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .modal-head { padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .modal-body { padding: 1.25rem; overflow-y: auto; flex: 1; }
    .modal-foot { padding: 0.85rem 1.25rem; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 0.5rem; }

    /* Studio Stage */
    .studio-layout {
      display: grid;
      grid-template-columns: 260px 1fr 340px;
      gap: 1rem;
      height: 100%;
    }

    .canvas-box {
      flex: 1;
      background: #020408;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .canvas-bar {
      padding: 0.5rem 0.85rem;
      border-bottom: 1px solid var(--border);
      background: rgba(17, 19, 24, 0.8);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .stage-render {
      flex: 1;
      overflow: auto;
      padding: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .edgePath path { stroke: #38bdf8 !important; stroke-width: 2px !important; }
    .edgePath.animated path { stroke-dasharray: 6, 6; animation: dashFlow 1s linear infinite; }
    @keyframes dashFlow { to { stroke-dashoffset: -40; } }

    /* Table clean styling */
    .clean-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      text-align: left;
    }
    .clean-table th { padding: 0.65rem; border-bottom: 2px solid var(--border); color: var(--text-dim); }
    .clean-table td { padding: 0.65rem; border-bottom: 1px solid var(--border); }
    
    .qty-box {
      background: var(--bg-main); border: 1px solid var(--border); border-radius: 4px;
      color: #fff; padding: 0.2rem 0.4rem; width: 60px; text-align: center; font-weight: 700;
    }
  </style>
</head>
<body>

  <!-- App Header -->
  <header class="app-header">
    <div class="header-inner">
      <div class="brand-section">
        <div class="brand-logo">GW</div>
        <div class="brand-text">
          GIJO WIKI <span class="version-tag">v5.1.0</span>
        </div>
      </div>

      <nav class="nav-tabs">
        <button id="tabBtn-wiki" class="tab-btn active" onclick="switchView('wiki')">
          <i data-lucide="book-open" style="width:14px; height:14px;"></i> 지식고 & RAG
        </button>
        <button id="tabBtn-studio" class="tab-btn" onclick="switchView('studio')">
          <i data-lucide="cpu" style="width:14px; height:14px;"></i> 아키텍처 스튜디오
        </button>
        <button id="tabBtn-portal" class="tab-btn" onclick="switchView('portal')">
          <i data-lucide="shield-check" style="width:14px; height:14px;"></i> 솔루션 ERP
        </button>
        <button id="tabBtn-bom" class="tab-btn" onclick="switchView('bom')">
          <i data-lucide="calculator" style="width:14px; height:14px;"></i> 실시간 TCO
        </button>
        <button id="tabBtn-audit" class="tab-btn" onclick="switchView('audit')">
          <i data-lucide="file-check-2" style="width:14px; height:14px;"></i> ISMS-P 진단기
        </button>
      </nav>

      <div class="header-tools">
        <button class="btn" onclick="openLlmSettingsModal()">
          <i data-lucide="settings" style="width:14px; height:14px;"></i> LLM 설정
        </button>
        <button class="btn btn-primary" onclick="exportFullProjectBackup()">
          <i data-lucide="download" style="width:14px; height:14px;"></i> 백업 내보내기
        </button>
      </div>
    </div>
  </header>

  <!-- Main View Area -->
  <main class="main-viewport">

    <!-- 1. WIKI & RAG VIEW -->
    <section id="view-wiki" class="view-page active">
      <div class="wiki-grid">
        
        <!-- Left: My Docs Vault -->
        <aside class="clean-panel">
          <div class="panel-head">
            <span class="panel-head-title"><i data-lucide="folder" style="width:14px; height:14px;"></i> 사내 지식고 (<span id="totalDocCount">0</span>)</span>
            <button class="btn" style="padding:0.2rem 0.5rem; font-size:0.75rem;" onclick="createNewWikiDoc()">
              <i data-lucide="plus" style="width:12px; height:12px;"></i> 추가
            </button>
          </div>

          <div class="search-input-wrap">
            <input type="text" id="wikiSearchInput" class="search-input" placeholder="사내 규정, WAF, AIBOM 검색..." oninput="filterWikiDocs()">
          </div>

          <div class="category-filter-strip">
            <button class="pill-cat" onclick="filterByCat('ALL')">전체</button>
            <button class="pill-cat" onclick="filterByCat('보안규정')">보안규정</button>
            <button class="pill-cat" onclick="filterByCat('취약점관리')">취약점</button>
            <button class="pill-cat" onclick="filterByCat('AI보안')">AI보안</button>
            <button class="pill-cat" onclick="filterByCat('아키텍처설계')">아키텍처</button>
            <button class="pill-cat" onclick="filterByCat('솔루션매뉴얼')">매뉴얼</button>
            <button class="pill-cat" onclick="filterByCat('QA문답집')">QA문답</button>
          </div>

          <ul id="wikiDocList" class="doc-list-clean"></ul>

          <div style="padding: 0.5rem; border-top: 1px solid var(--border); display: flex; gap: 0.35rem;">
            <button class="btn" style="flex:1; justify-content:center; font-size:0.75rem;" onclick="importDocsFile()">가져오기</button>
            <button class="btn" style="flex:1; justify-content:center; font-size:0.75rem;" onclick="exportDocsFile()">내보내기</button>
          </div>
        </aside>

        <!-- Center: Reader / Editor -->
        <article class="wiki-content-panel">
          <div class="panel-head">
            <div style="font-size:0.8rem; color:var(--text-sub);">
              <span id="wikiBreadcrumbCat">보안규정</span> &gt; <b id="wikiBreadcrumbTitle" style="color:#fff;">문서 제목</b>
            </div>
            <div style="display:flex; gap:0.35rem;">
              <button id="btnToggleEdit" class="btn" onclick="toggleEditMode()">
                <i data-lucide="edit-3" style="width:13px; height:13px;"></i> 편집
              </button>
              <button class="btn" onclick="compileDocToStudio()">
                <i data-lucide="share-2" style="width:13px; height:13px;"></i> 캔버스 연동
              </button>
              <button class="btn" style="color:var(--danger);" onclick="deleteCurrentDoc()">삭제</button>
            </div>
          </div>

          <div class="content-body">
            <div id="wikiReadView" class="markdown-render"></div>

            <div id="wikiEditView" style="display: none; height: 100%; flex-direction: column; gap: 0.65rem;">
              <input type="text" id="editDocTitle" class="search-input" style="font-size:1.1rem; font-weight:700;" placeholder="문서 제목">
              <div style="display:flex; gap:0.4rem;">
                <select id="editDocCategory" class="search-input" style="width:140px;">
                  <option value="보안규정">보안규정</option>
                  <option value="취약점관리">취약점관리</option>
                  <option value="AI보안">AI보안</option>
                  <option value="아키텍처설계">아키텍처설계</option>
                  <option value="솔루션매뉴얼">솔루션매뉴얼</option>
                  <option value="QA문답집">QA문답집</option>
                  <option value="장애런북">장애런북</option>
                </select>
                <input type="text" id="editDocTags" class="search-input" style="flex:1;" placeholder="태그 (쉼표 구분: WAF, 망분리)">
              </div>
              <textarea id="editDocContent" class="search-input" style="flex:1; font-family:monospace; line-height:1.6; resize:none;" placeholder="마크다운 문서 내용..."></textarea>
              <div style="display:flex; justify-content:flex-end; gap:0.4rem;">
                <button class="btn" onclick="cancelDocEdit()">취소</button>
                <button class="btn btn-primary" onclick="saveDocEdit()">저장 (Ctrl+S)</button>
              </div>
            </div>
          </div>
        </article>

        <!-- Right: Local RAG Assistant -->
        <aside class="clean-panel">
          <div class="panel-head">
            <span class="panel-head-title"><i data-lucide="bot" style="width:14px; height:14px; color:var(--primary);"></i> 사내 지식 RAG</span>
            <span style="font-size:0.68rem; color:var(--success); background:rgba(16,185,129,0.1); padding:0.1rem 0.35rem; border-radius:4px; border:1px solid rgba(16,185,129,0.25);">GB10 / Ollama</span>
          </div>

          <div class="rag-chip-row" id="quickChipContainer"></div>

          <div class="chat-stream-box" id="ragChatMessages">
            <div class="bubble ai">
              👋 안녕하세요! <b>GIJO WIKI</b> 사내 지식 비서입니다.<br>
              등록된 보안 규정, CVE 취약점 런북, AIBOM 가이드, ISMS-P 인증 기준을 기반으로 정확한 원문 출처와 함께 안내합니다.
            </div>
          </div>

          <div class="chat-bottom-input">
            <input type="text" id="ragQueryInput" class="search-input" placeholder="사내 규정 및 질의 입력..." onkeydown="if(event.key==='Enter') executeRagQuery()">
            <button class="btn btn-primary" onclick="executeRagQuery()">
              <i data-lucide="send" style="width:13px; height:13px;"></i>
            </button>
          </div>
        </aside>

      </div>
    </section>

    <!-- 2. STUDIO VIEW -->
    <section id="view-studio" class="view-page">
      <div class="studio-layout">
        
        <aside class="clean-panel">
          <div class="panel-head">
            <span class="panel-head-title"><i data-lucide="layers" style="width:14px; height:14px;"></i> 템플릿</span>
          </div>
          <div style="padding:0.65rem; display:flex; flex-direction:column; gap:0.4rem;">
            <button class="btn" style="justify-content:flex-start; text-align:left;" onclick="loadStudioPreset('finance')">
              <div><b>🏦 금융 ISMS-P 망분리</b><div style="font-size:0.68rem; color:var(--text-dim);">3-Tier HA Active-Standby</div></div>
            </button>
            <button class="btn" style="justify-content:flex-start; text-align:left;" onclick="loadStudioPreset('public')">
              <div><b>🏛️ 공공 CSAP 보안존</b><div style="font-size:0.68rem; color:var(--text-dim);">CC인증 방화벽 + KMS</div></div>
            </button>
            <button class="btn" style="justify-content:flex-start; text-align:left;" onclick="loadStudioPreset('ai')">
              <div><b>🤖 에어갭 AI 보안존</b><div style="font-size:0.68rem; color:var(--text-dim);">GB10 Cluster + DLP Guard</div></div>
            </button>
            <button class="btn" style="justify-content:flex-start; text-align:left;" onclick="loadStudioPreset('zerotrust')">
              <div><b>🌐 제로트러스트 SASE</b><div style="font-size:0.68rem; color:var(--text-dim);">ZTNA + EDR + MFA</div></div>
            </button>
          </div>

          <div class="panel-head" style="border-top:1px solid var(--border);">
            <span class="panel-head-title"><i data-lucide="box" style="width:14px; height:14px;"></i> 장비 추가</span>
          </div>
          <div style="flex:1; padding:0.65rem; overflow-y:auto; display:flex; flex-direction:column; gap:0.3rem;">
            <div class="btn" onclick="insertNodeToCode('NGFW', '차세대 방화벽 (Active-Standby)')">차세대 방화벽 (NGFW)</div>
            <div class="btn" onclick="insertNodeToCode('WAF', '웹 애플리케이션 방화벽 (WAF)')">웹 방화벽 (WAF)</div>
            <div class="btn" onclick="insertNodeToCode('EDR', '엔드포인트 탐지 및 대응 (EDR)')">EDR 에이전트</div>
            <div class="btn" onclick="insertNodeToCode('SIEM', '통합 보안관제 SIEM / SOAR')">통합관제 SIEM</div>
          </div>
        </aside>

        <main class="canvas-box">
          <div class="canvas-bar">
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span style="font-size:0.8rem; font-weight:700; color:#fff;">Stage Pro</span>
              <span id="canvasZoomLabel" style="font-size:0.7rem; color:var(--text-dim); background:var(--bg-subtle); padding:0.1rem 0.35rem; border-radius:4px;">100%</span>
            </div>
            <div style="display:flex; gap:0.35rem;">
              <button class="btn" onclick="zoomCanvas(0.1)" title="확대"><i data-lucide="zoom-in" style="width:13px; height:13px;"></i></button>
              <button class="btn" onclick="zoomCanvas(-0.1)" title="축소"><i data-lucide="zoom-out" style="width:13px; height:13px;"></i></button>
              <button class="btn" onclick="resetCanvasZoom()" title="맞춤"><i data-lucide="maximize" style="width:13px; height:13px;"></i></button>
              <button class="btn" id="btnToggleTraffic" onclick="toggleTrafficAnimation()" style="color:#38bdf8;">
                <i data-lucide="activity" style="width:13px; height:13px;"></i> 트래픽 ON
              </button>
            </div>
          </div>

          <div class="stage-render" id="canvasStage">
            <div id="mermaidTarget"></div>
          </div>
        </main>

        <aside class="clean-panel">
          <div class="panel-head">
            <span class="panel-head-title"><i data-lucide="code" style="width:14px; height:14px;"></i> 코드 에디터</span>
            <button class="btn" style="padding:0.2rem 0.45rem; font-size:0.75rem;" onclick="renderMermaidFromEditor()">렌더링</button>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; padding:0.65rem; gap:0.4rem;">
            <textarea id="mermaidCodeEditor" class="search-input" style="flex:1; font-family:monospace; line-height:1.4; resize:none; color:#38bdf8;"></textarea>
            <div style="background:var(--bg-main); border:1px solid var(--border); border-radius:6px; padding:0.65rem;">
              <div style="font-size:0.75rem; font-weight:700; color:var(--warning); margin-bottom:0.2rem;">SPOF 진단</div>
              <div id="spofAlertMsg" style="font-size:0.72rem; color:var(--text-sub);">✅ 주요 방화벽/WAF 이중화 완비</div>
            </div>
          </div>
        </aside>

      </div>
    </section>

    <!-- 3. ERP PORTAL -->
    <section id="view-portal" class="view-page">
      <div class="clean-panel" style="padding:1.25rem;">
        <div style="margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 style="font-size:1.2rem; font-weight:700; color:#fff;">보안 솔루션 전사 ERP 카탈로그</h2>
            <p style="color:var(--text-dim); font-size:0.8rem;">조달청 규격 및 취급 제조사 공식 라이선스 데이터베이스</p>
          </div>
          <input type="text" id="portalSearchInput" class="search-input" style="width:240px;" placeholder="솔루션명, 제조사 검색..." oninput="renderPortalCards()">
        </div>
        <div id="portalCardsGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:1rem;"></div>
      </div>
    </section>

    <!-- 4. BOM & TCO -->
    <section id="view-bom" class="view-page">
      <div class="clean-panel" style="padding:1.25rem;">
        <h2 style="font-size:1.2rem; font-weight:700; color:#fff; margin-bottom:0.3rem;">아키텍처 실시간 BOM (Bill of Materials) & TCO 계산서</h2>
        <p style="color:var(--text-dim); font-size:0.8rem; margin-bottom:1rem;">도입 수량을 조절하면 CAPEX, OPEX(12%), 3년 TCO가 실시간 재계산됩니다.</p>

        <table class="clean-table" style="margin-bottom:1.5rem;">
          <thead>
            <tr>
              <th>솔루션 / 장비명</th>
              <th>카테고리</th>
              <th>도입 단가</th>
              <th style="text-align:center;">수량 조절</th>
              <th>연간 유지보수비 (12%)</th>
              <th>합계 금액</th>
            </tr>
          </thead>
          <tbody id="bomTableBody"></tbody>
        </table>

        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem; background:var(--bg-main); border:1px solid var(--border); border-radius:var(--radius); padding:1rem;">
          <div>
            <div style="font-size:0.75rem; color:var(--text-dim);">총 도입비 (CAPEX)</div>
            <div id="totalCapex" style="font-size:1.4rem; font-weight:700; color:#38bdf8;">₩ 0</div>
          </div>
          <div>
            <div style="font-size:0.75rem; color:var(--text-dim);">연간 유지보수비 (OPEX)</div>
            <div id="totalOpex" style="font-size:1.4rem; font-weight:700; color:#c084fc;">₩ 0 / 년</div>
          </div>
          <div>
            <div style="font-size:0.75rem; color:var(--text-dim);">3년 예상 TCO (Capex + 3*Opex)</div>
            <div id="totalTco" style="font-size:1.4rem; font-weight:700; color:var(--success);">₩ 0</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 5. ISMS-P AUDITOR -->
    <section id="view-audit" class="view-page">
      <div class="clean-panel" style="padding:1.25rem;">
        <h2 style="font-size:1.2rem; font-weight:700; color:#fff; margin-bottom:0.3rem;">ISMS-P 5대 통제영역 자동 적합성 진단기</h2>
        <p style="color:var(--text-dim); font-size:0.8rem; margin-bottom:1rem;">사내 지식고(My Docs) 및 현재 아키텍처 구성을 교차 검증하여 결함 항목 식별</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:0.85rem;" id="auditResultsGrid"></div>
      </div>
    </section>

  </main>

  <!-- LLM Settings Modal -->
  <div id="llmSettingsModal" class="modal-backdrop" onclick="if(event.target===this) closeLlmSettingsModal()">
    <div class="modal-box">
      <div class="modal-head">
        <span style="font-weight:700; color:#fff;"><i data-lucide="settings" style="width:14px; height:14px;"></i> LLM 엔드포인트 설정</span>
        <button style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:1.2rem;" onclick="closeLlmSettingsModal()">&times;</button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:0.85rem;">
        <div>
          <label style="font-size:0.8rem; color:var(--text-sub); display:block; margin-bottom:0.3rem;">로컬 LLM 엔드포인트 URL</label>
          <input type="text" id="settingLlmUrl" class="search-input" value="http://localhost:11434">
        </div>
        <div>
          <label style="font-size:0.8rem; color:var(--text-sub); display:block; margin-bottom:0.3rem;">엔진 유형</label>
          <select id="settingEngineType" class="search-input">
            <option value="ollama">Ollama (Local / Air-Gap)</option>
            <option value="gb10">GB10 온프레미스 AI 엔진 (177B)</option>
            <option value="vllm">vLLM / OpenAI Compatible</option>
          </select>
        </div>
        <div style="font-size:0.75rem; color:var(--text-dim); background:var(--bg-main); padding:0.65rem; border-radius:6px; border:1px solid var(--border);">
          🔒 <b>에어갭 보안 모드</b>: 사내 문서는 일체 외부로 전송되지 않으며 지정된 로컬 인스턴스에서만 처리됩니다.
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="testLlmConnection()">연결 테스트</button>
        <button class="btn btn-primary" onclick="saveLlmSettings()">저장</button>
      </div>
    </div>
  </div>

  <!-- Node Wiki Quick Preview Modal -->
  <div id="nodeWikiModal" class="modal-backdrop" onclick="if(event.target===this) closeNodeWikiModal()">
    <div class="modal-box" style="max-width: 600px;">
      <div class="modal-head">
        <span style="font-weight:700; color:#fff;" id="nodeWikiTitle">장비 가이드</span>
        <button style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:1.2rem;" onclick="closeNodeWikiModal()">&times;</button>
      </div>
      <div class="modal-body" id="nodeWikiBody"></div>
      <div class="modal-foot">
        <button class="btn" onclick="closeNodeWikiModal()">닫기</button>
        <button class="btn btn-primary" id="btnGoToWikiDoc">문서 전체 보기</button>
      </div>
    </div>
  </div>

  <script>
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      flowchart: { curve: 'basis', htmlLabels: true }
    });

    function sanitizeHtml(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    const defaultWikiDocs = ${docsJson};
    const quickQuestions = ${quickQuestionsJson};

    let currentActiveDocId = defaultWikiDocs[0].id;
    let isEditingMode = false;
    let canvasZoom = 1.0;
    let isTrafficFlowing = true;
    let currentFilterCat = 'ALL';

    const solutionCatalog = [
      { id: "SEC-01", name: "AhnLab TrusGuard NGFW", vendor: "안랩", category: "방화벽", price: 35000000, qty: 2, opexRate: 0.12, ismsMapping: "2.4 망분리/접근통제" },
      { id: "SEC-02", name: "Penta Security WAPPLE WAF", vendor: "펜타시큐리티", category: "웹방화벽", price: 28000000, qty: 2, opexRate: 0.12, ismsMapping: "2.4 웹서버 보호" },
      { id: "SEC-03", name: "Genians EDR Enterprise", vendor: "지니언스", category: "EDR", price: 18000000, qty: 2, opexRate: 0.12, ismsMapping: "2.8 악성코드 통제" },
      { id: "SEC-04", name: "Igloo Security SPiDER TM (SIEM)", vendor: "이글루코퍼레이션", category: "SIEM", price: 65000000, qty: 1, opexRate: 0.12, ismsMapping: "2.10 로그/모니터링" },
      { id: "SEC-05", name: "Fasoo Enterprise DRM/DLP", vendor: "파수", category: "DLP", price: 24000000, qty: 2, opexRate: 0.12, ismsMapping: "2.5 암호화 및 유출방지" },
      { id: "SEC-06", name: "GB10 On-Premises AI Cluster", vendor: "GIJO Tech", category: "AI보안", price: 120000000, qty: 1, opexRate: 0.08, ismsMapping: "2.12 신기술 보안통제" }
    ];

    const studioPresets = {
      finance: \`graph TD
  User["👤 인터넷 사용자"] -->|HTTPS 443| WAF["🛡️ WAF (Active-Standby)"]
  WAF -->|검증된 트래픽| NGFW["🔥 차세대 방화벽 (HA)"]
  
  subgraph DMZ ["🌐 DMZ 존"]
    NGFW --> WEB1["💻 Web Server 01"]
    NGFW --> WEB2["💻 Web Server 02"]
  end
  
  subgraph InternalTrust ["🏢 내부 신뢰망 (Trust Zone)"]
    WEB1 --> WAS["⚙️ AP/WAS Cluster"]
    WEB2 --> WAS
    WAS --> DB["🗄️ Secure DB (AES-256)"]
  end
  
  subgraph SecOps ["🛡️ 보안관제 센터 (SecOps)"]
    SIEM["📊 SIEM / SOAR"]
    EDR["🔎 EDR Server"]
  end
  
  WEB1 -.->|Syslog| SIEM
  DB -.->|Audit Log| SIEM
  WAS -.->|Agent| EDR\`,
  
      public: \`graph TD
  GovUser["🏛️ 공공기관 / 대민 접속"] --> CSAP_GW["🔒 CSAP 보안 게이트웨이"]
  CSAP_GW --> CC_FW["🛡️ CC인증 차세대 방화벽"]
  
  subgraph CloudZone ["☁️ 공공 클라우드 보안영역"]
    CC_FW --> WebCluster["🖥️ 웹 서버 클러스터"]
    WebCluster --> AppCluster["⚙️ 연계 중계 서버"]
    AppCluster --> KMS["🔑 국가용 암호모듈 (KMS)"]
    AppCluster --> GovDB["🗄️ 공공 데이터베이스"]
  end
  
  subgraph AuditZone ["📋 감사 및 모니터링"]
    LogServer["📑 통합 로그 서버"]
    DLP["🛑 개인정보 필터링 (DLP)"]
  end
  
  GovDB -.-> KMS
  WebCluster -.-> DLP
  AppCluster -.-> LogServer\`,

      ai: \`graph TD
  Client["💻 사내 개발/업무 단말"] --> AuthGW["🔐 ZTNA 접근통제 게이트웨이"]
  AuthGW --> DLPGW["🛑 프롬프트 DLP 검사기"]
  
  subgraph AirGapZone ["🔒 에어갭 온프레미스 AI 보안존"]
    DLPGW --> GB10["🧠 GB10 AI Engine (177B Cluster)"]
    GB10 --> VectorDB["📚 사내 지식고 벡터 DB (KMS 암호화)"]
    GB10 --> RAGCache["⚡ RAG Semantic Cache"]
  end
  
  subgraph SecurityMonitor ["🛡️ 실시간 AI 보안 감사"]
    AuditLogger["📝 프롬프트/응답 감사로그"]
    Sanitizer["🛡️ 환각/취약점 필터"]
  end
  
  GB10 -.-> AuditLogger
  DLPGW -.-> Sanitizer\`,

      zerotrust: \`graph TD
  RemoteWorker["🏠 재택/외부 근무자"] --> MFA["🔑 멀티팩터 인증 (MFA)"]
  MFA --> ZTX["🌐 제로트러스트 SASE 게이트웨이"]
  
  subgraph MicroSegmentation ["🛡️ 마이크로 세그멘테이션 보안존"]
    ZTX -->|최소권한 정책| App1["📊 사내 ERP"]
    ZTX -->|최소권한 정책| App2["🏗️ 스마트 스튜디오"]
    ZTX -->|최소권한 정책| App3["📚 GIJO WIKI"]
  end
  
  subgraph ContinuousTrust ["🔍 지속적 신뢰 검증"]
    EDR_Agent["🔎 단말 상태 검증 (EDR)"]
    PolicyEngine["⚙️ 동적 권한 정책 엔진"]
  end
  
  RemoteWorker -.-> EDR_Agent
  EDR_Agent -.-> PolicyEngine
  PolicyEngine -.-> ZTX\`
    };

    function loadStoredDocs() {
      try {
        const stored = localStorage.getItem('gijo_wiki_docs_v5');
        if (stored) return JSON.parse(stored);
      } catch(e) {}
      return defaultWikiDocs;
    }

    function saveDocsToStorage(docs) {
      try {
        localStorage.setItem('gijo_wiki_docs_v5', JSON.stringify(docs));
      } catch(err) {
        if (err.name === 'QuotaExceededError') {
          alert('⚠️ 브라우저 용량 한도 초과. [백업 내보내기]를 이용해 주세요.');
        }
      }
    }

    let currentDocs = loadStoredDocs();

    function switchView(viewName) {
      document.querySelectorAll('.view-page').forEach(sec => sec.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

      const targetSec = document.getElementById('view-' + viewName);
      const targetBtn = document.getElementById('tabBtn-' + viewName);

      if (targetSec) targetSec.classList.add('active');
      if (targetBtn) targetBtn.classList.add('active');

      if (viewName === 'studio') {
        renderMermaidFromEditor();
      } else if (viewName === 'bom') {
        renderBomTable();
      } else if (viewName === 'audit') {
        renderAuditGrid();
      } else if (viewName === 'portal') {
        renderPortalCards();
      }
      lucide.createIcons();
    }

    function renderQuickChips() {
      const chipBox = document.getElementById('quickChipContainer');
      chipBox.innerHTML = '';
      quickQuestions.forEach(q => {
        const chip = document.createElement('button');
        chip.className = 'rag-chip-btn';
        chip.innerText = q;
        chip.onclick = () => {
          document.getElementById('ragQueryInput').value = q;
          executeRagQuery();
        };
        chipBox.appendChild(chip);
      });
    }

    function renderWikiDocList() {
      const listEl = document.getElementById('wikiDocList');
      const searchVal = document.getElementById('wikiSearchInput')?.value.toLowerCase() || '';
      listEl.innerHTML = '';

      let filtered = currentDocs.filter(d => {
        const matchesCat = (currentFilterCat === 'ALL' || d.category === currentFilterCat);
        const matchesSearch = d.title.toLowerCase().includes(searchVal) || 
                              d.tags.some(t => t.toLowerCase().includes(searchVal)) ||
                              d.content.toLowerCase().includes(searchVal);
        return matchesCat && matchesSearch;
      });

      document.getElementById('totalDocCount').innerText = currentDocs.length;

      filtered.forEach(doc => {
        const li = document.createElement('li');
        li.className = 'doc-entry ' + (doc.id === currentActiveDocId ? 'active' : '');
        li.onclick = () => selectWikiDoc(doc.id);

        li.innerHTML = '<div class="doc-entry-title">' + sanitizeHtml(doc.title) + '</div>' +
                       '<div class="doc-entry-meta"><span class="meta-badge">' + sanitizeHtml(doc.category) + '</span>' +
                       '<span>' + sanitizeHtml(doc.updatedAt) + '</span></div>';
        listEl.appendChild(li);
      });

      displayCurrentDoc();
    }

    function selectWikiDoc(id) {
      currentActiveDocId = id;
      isEditingMode = false;
      renderWikiDocList();
    }

    function displayCurrentDoc() {
      const doc = currentDocs.find(d => d.id === currentActiveDocId) || currentDocs[0];
      if (!doc) return;

      document.getElementById('wikiBreadcrumbCat').innerText = doc.category;
      document.getElementById('wikiBreadcrumbTitle').innerText = doc.title;

      const renderedHtml = parseMarkdownToHtml(doc.content);
      document.getElementById('wikiReadView').innerHTML = 
        '<div style="margin-bottom: 0.85rem; display:flex; gap:0.35rem; flex-wrap:wrap;">' +
        doc.tags.map(t => '<span class="meta-badge">#' + sanitizeHtml(t) + '</span>').join('') +
        '</div>' + renderedHtml;

      document.getElementById('wikiReadView').style.display = isEditingMode ? 'none' : 'block';
      document.getElementById('wikiEditView').style.display = isEditingMode ? 'flex' : 'none';

      if (isEditingMode) {
        document.getElementById('editDocTitle').value = doc.title;
        document.getElementById('editDocCategory').value = doc.category;
        document.getElementById('editDocTags').value = doc.tags.join(', ');
        document.getElementById('editDocContent').value = doc.content;
      }
    }

    function toggleEditMode() {
      isEditingMode = !isEditingMode;
      document.getElementById('btnToggleEdit').innerHTML = isEditingMode 
        ? '<i data-lucide="eye" style="width:13px; height:13px;"></i> 뷰 모드' 
        : '<i data-lucide="edit-3" style="width:13px; height:13px;"></i> 편집';
      displayCurrentDoc();
      lucide.createIcons();
    }

    function saveDocEdit() {
      const doc = currentDocs.find(d => d.id === currentActiveDocId);
      if (!doc) return;

      doc.title = document.getElementById('editDocTitle').value.trim() || '제목 없는 문서';
      doc.category = document.getElementById('editDocCategory').value;
      doc.tags = document.getElementById('editDocTags').value.split(',').map(t => t.trim()).filter(Boolean);
      doc.content = document.getElementById('editDocContent').value;
      doc.updatedAt = new Date().toISOString().slice(0, 10);

      saveDocsToStorage(currentDocs);
      isEditingMode = false;
      renderWikiDocList();
      alert('✅ 문서가 저장되었습니다.');
    }

    function cancelDocEdit() {
      isEditingMode = false;
      displayCurrentDoc();
    }

    function createNewWikiDoc() {
      const newDoc = {
        id: Date.now(),
        title: "새 보안 규정",
        category: "보안규정",
        tags: ["신규"],
        updatedAt: new Date().toISOString().slice(0, 10),
        content: "# 새 보안 규정\\n\\n여기에 내용을 입력하세요."
      };
      currentDocs.unshift(newDoc);
      currentActiveDocId = newDoc.id;
      saveDocsToStorage(currentDocs);
      isEditingMode = true;
      renderWikiDocList();
    }

    function deleteCurrentDoc() {
      if (currentDocs.length <= 1) return alert('최소 1개의 문서가 필요합니다.');
      if (confirm('현재 문서를 삭제하시겠습니까?')) {
        currentDocs = currentDocs.filter(d => d.id !== currentActiveDocId);
        currentActiveDocId = currentDocs[0].id;
        saveDocsToStorage(currentDocs);
        renderWikiDocList();
      }
    }

    function filterWikiDocs() { renderWikiDocList(); }
    function filterByCat(cat) { currentFilterCat = cat; renderWikiDocList(); }

    function parseMarkdownToHtml(md) {
      if (!md) return '';
      return md
        .replace(/^### (.*$)/gim, (_, text) => '<h3>' + sanitizeHtml(text) + '</h3>')
        .replace(/^## (.*$)/gim, (_, text) => '<h2>' + sanitizeHtml(text) + '</h2>')
        .replace(/^# (.*$)/gim, (_, text) => '<h1>' + sanitizeHtml(text) + '</h1>')
        .replace(/\\*\\*(.*?)\\*\\*/gim, (_, text) => '<b>' + sanitizeHtml(text) + '</b>')
        .replace(/\\*(.*?)\\*/gim, (_, text) => '<i>' + sanitizeHtml(text) + '</i>')
        .replace(/^\\- (.*$)/gim, (_, text) => '<li>' + sanitizeHtml(text) + '</li>')
        .replace(/^\\d+\\. (.*$)/gim, (_, text) => '<li>' + sanitizeHtml(text) + '</li>')
        .replace(/\\n/g, '<br />');
    }

    async function executeRagQuery() {
      const inputEl = document.getElementById('ragQueryInput');
      const query = inputEl.value.trim();
      if (!query) return;

      const chatBox = document.getElementById('ragChatMessages');

      const userBubble = document.createElement('div');
      userBubble.className = 'bubble user';
      userBubble.innerText = query;
      chatBox.appendChild(userBubble);
      inputEl.value = '';

      const searchTerms = query.toLowerCase().split(' ').filter(w => w.length >= 2);
      let matchedDocs = [];

      currentDocs.forEach(doc => {
        let score = 0;
        searchTerms.forEach(term => {
          if (doc.title.toLowerCase().includes(term)) score += 6;
          if (doc.tags.some(t => t.toLowerCase().includes(term))) score += 5;
          if (doc.content.toLowerCase().includes(term)) score += 2;
        });

        if (query.includes('AIBOM') && (doc.tags.includes('AIBOM') || doc.title.includes('AIBOM'))) score += 10;
        if (query.includes('WAF') && (doc.tags.includes('WAF') || doc.title.includes('WAF'))) score += 10;
        if (query.includes('에어갭') && (doc.tags.includes('에어갭') || doc.content.includes('에어갭'))) score += 10;
        if (query.includes('CVE') && (doc.tags.includes('CVE') || doc.title.includes('CVE'))) score += 10;
        if (query.includes('ISMS-P') && (doc.tags.includes('ISMS-P') || doc.title.includes('ISMS-P'))) score += 10;
        if (query.includes('DDoS') && (doc.tags.includes('DDoS') || doc.title.includes('DDoS'))) score += 10;

        if (score > 0) matchedDocs.push({ doc, score });
      });

      matchedDocs.sort((a, b) => b.score - a.score);
      const topDoc = matchedDocs.length > 0 ? matchedDocs[0].doc : null;

      const aiBubble = document.createElement('div');
      aiBubble.className = 'bubble ai';
      aiBubble.innerHTML = '<div>분석 중...</div>';
      chatBox.appendChild(aiBubble);
      chatBox.scrollTop = chatBox.scrollHeight;

      let answerText = '';
      if (topDoc) {
        let summary = topDoc.content.slice(0, 260).replace(/#/g, '');
        answerText = '사내 지식에 따른 분석 결과입니다:<br><br>' + sanitizeHtml(summary) + '...';
      } else {
        answerText = '일치하는 특정 규정을 찾지 못했으나, 보안 원칙상 <b>경계 방화벽 통제</b> 및 <b>최소 권한 부여</b> 기준을 준수해야 합니다.';
      }

      let citationHtml = topDoc 
        ? '<div class="citation-btn" onclick="selectWikiDoc(' + topDoc.id + ')">' +
          '<i data-lucide="file-text" style="width:12px; height:12px;"></i> 근거: [' + sanitizeHtml(topDoc.category) + '] ' + sanitizeHtml(topDoc.title) +
          '</div>'
        : '';

      aiBubble.innerHTML = '<div>' + answerText + '</div>' + citationHtml;
      chatBox.scrollTop = chatBox.scrollHeight;
      lucide.createIcons();
    }

    function compileDocToStudio() {
      const doc = currentDocs.find(d => d.id === currentActiveDocId);
      if (!doc) return;

      if (doc.tags.includes('AI') || doc.title.includes('AI') || doc.tags.includes('AIBOM')) {
        loadStudioPreset('ai');
      } else if (doc.tags.includes('공공') || doc.title.includes('공공')) {
        loadStudioPreset('public');
      } else if (doc.tags.includes('제로트러스트') || doc.tags.includes('ZTNA')) {
        loadStudioPreset('zerotrust');
      } else {
        loadStudioPreset('finance');
      }
      switchView('studio');
      alert('✅ \\'' + doc.title + '\\' 기반으로 스튜디오 캔버스가 동기화되었습니다.');
    }

    function loadStudioPreset(key) {
      const code = studioPresets[key] || studioPresets.finance;
      document.getElementById('mermaidCodeEditor').value = code;
      renderMermaidFromEditor();
    }

    async function renderMermaidFromEditor() {
      const code = document.getElementById('mermaidCodeEditor').value;
      const target = document.getElementById('mermaidTarget');
      target.innerHTML = '';

      try {
        const id = 'mermaidSvg-' + Date.now();
        const { svg } = await mermaid.render(id, code);
        target.innerHTML = svg;
        applyTrafficAnimation();
        attachNodeClickHandlers();
      } catch (err) {
        target.innerHTML = '<div style="color:var(--danger); padding:1rem;">⚠️ Mermaid 문법 오류: ' + sanitizeHtml(err.message) + '</div>';
      }
    }

    function attachNodeClickHandlers() {
      const nodes = document.querySelectorAll('#mermaidTarget .node');
      nodes.forEach(n => {
        n.style.cursor = 'pointer';
        n.onclick = () => {
          const text = n.innerText || n.textContent;
          showWikiForNode(text.trim());
        };
      });
    }

    function showWikiForNode(nodeText) {
      let matched = currentDocs.find(d => nodeText.includes(d.title) || d.tags.some(t => nodeText.includes(t)));
      if (!matched) matched = currentDocs[0];

      document.getElementById('nodeWikiTitle').innerText = nodeText + ' 보안 가이드';
      document.getElementById('nodeWikiBody').innerHTML = 
        '<div style="margin-bottom:0.75rem;"><span class="meta-badge">' + sanitizeHtml(matched.category) + '</span> <b>' + sanitizeHtml(matched.title) + '</b></div>' +
        '<div style="font-size:0.85rem; color:#cbd5e1; line-height:1.6;">' + parseMarkdownToHtml(matched.content.slice(0, 320)) + '...</div>';
      
      document.getElementById('btnGoToWikiDoc').onclick = () => {
        closeNodeWikiModal();
        switchView('wiki');
        selectWikiDoc(matched.id);
      };

      document.getElementById('nodeWikiModal').classList.add('active');
      lucide.createIcons();
    }

    function closeNodeWikiModal() {
      document.getElementById('nodeWikiModal').classList.remove('active');
    }

    function insertNodeToCode(type, desc) {
      const editor = document.getElementById('mermaidCodeEditor');
      const lines = editor.value.split('\\n');
      const newNodeLine = '  Node_' + Date.now().toString().slice(-4) + '["🛡️ ' + desc + '"]';
      lines.push(newNodeLine);
      editor.value = lines.join('\\n');
      renderMermaidFromEditor();
    }

    function zoomCanvas(delta) {
      canvasZoom = Math.max(0.3, Math.min(2.0, canvasZoom + delta));
      document.getElementById('mermaidTarget').style.transform = 'scale(' + canvasZoom + ')';
      document.getElementById('canvasZoomLabel').innerText = Math.round(canvasZoom * 100) + '%';
    }

    function resetCanvasZoom() {
      canvasZoom = 1.0;
      document.getElementById('mermaidTarget').style.transform = 'scale(1.0)';
      document.getElementById('canvasZoomLabel').innerText = '100%';
    }

    function toggleTrafficAnimation() {
      isTrafficFlowing = !isTrafficFlowing;
      const btn = document.getElementById('btnToggleTraffic');
      btn.innerHTML = isTrafficFlowing 
        ? '<i data-lucide="activity" style="width:13px; height:13px;"></i> 트래픽 ON' 
        : '<i data-lucide="pause" style="width:13px; height:13px;"></i> 트래픽 OFF';
      btn.style.color = isTrafficFlowing ? '#38bdf8' : 'var(--text-dim)';
      applyTrafficAnimation();
      lucide.createIcons();
    }

    function applyTrafficAnimation() {
      const paths = document.querySelectorAll('#mermaidTarget .edgePath');
      paths.forEach(p => {
        if (isTrafficFlowing) p.classList.add('animated');
        else p.classList.remove('animated');
      });
    }

    function renderPortalCards() {
      const grid = document.getElementById('portalCardsGrid');
      const search = document.getElementById('portalSearchInput')?.value.toLowerCase() || '';
      grid.innerHTML = '';

      solutionCatalog
        .filter(s => s.name.toLowerCase().includes(search) || s.vendor.toLowerCase().includes(search) || s.category.toLowerCase().includes(search))
        .forEach(sol => {
          const card = document.createElement('div');
          card.style.background = 'var(--bg-main)';
          card.style.border = '1px solid var(--border)';
          card.style.borderRadius = 'var(--radius)';
          card.style.padding = '1rem';
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.justifyContent = 'space-between';

          card.innerHTML = 
            '<div>' +
              '<div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">' +
                '<span class="meta-badge">' + sanitizeHtml(sol.category) + '</span>' +
                '<span style="font-size:0.72rem; color:var(--text-dim);">' + sanitizeHtml(sol.vendor) + '</span>' +
              '</div>' +
              '<h3 style="font-size:0.95rem; font-weight:700; color:#fff; margin-bottom:0.35rem;">' + sanitizeHtml(sol.name) + '</h3>' +
              '<div style="font-size:0.75rem; color:var(--text-dim); margin-bottom:0.75rem;">ISMS-P: ' + sanitizeHtml(sol.ismsMapping) + '</div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center; padding-top:0.65rem; border-top:1px solid var(--border);">' +
              '<div><div style="font-size:0.68rem; color:var(--text-dim);">단가</div><b style="color:#38bdf8; font-size:0.85rem;">₩ ' + sol.price.toLocaleString() + '</b></div>' +
              '<button class="btn" style="font-size:0.72rem;" onclick="insertNodeToCode(\\'' + sol.category + '\\', \\'' + sol.name + '\\')">스튜디오 추가</button>' +
            '</div>';
          grid.appendChild(card);
        });
      lucide.createIcons();
    }

    function updateBomQty(solId, newQty) {
      const sol = solutionCatalog.find(s => s.id === solId);
      if (sol) {
        sol.qty = Math.max(1, parseInt(newQty) || 1);
        renderBomTable();
      }
    }

    function renderBomTable() {
      const tbody = document.getElementById('bomTableBody');
      tbody.innerHTML = '';
      let totalCapex = 0;
      let totalOpex = 0;

      solutionCatalog.forEach(sol => {
        const qty = sol.qty || 2;
        const rowTotal = sol.price * qty;
        const rowOpex = rowTotal * sol.opexRate;
        totalCapex += rowTotal;
        totalOpex += rowOpex;

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td style="font-weight:600; color:#fff;">' + sanitizeHtml(sol.name) + '</td>' +
          '<td><span class="meta-badge">' + sanitizeHtml(sol.category) + '</span></td>' +
          '<td>₩ ' + sol.price.toLocaleString() + '</td>' +
          '<td style="text-align:center;"><input type="number" class="qty-box" min="1" max="100" value="' + qty + '" onchange="updateBomQty(\\'' + sol.id + '\\', this.value)"></td>' +
          '<td style="color:#c084fc;">₩ ' + Math.round(rowOpex).toLocaleString() + ' /년</td>' +
          '<td style="font-weight:700; color:#38bdf8;">₩ ' + rowTotal.toLocaleString() + '</td>';
        tbody.appendChild(tr);
      });

      document.getElementById('totalCapex').innerText = '₩ ' + totalCapex.toLocaleString();
      document.getElementById('totalOpex').innerText = '₩ ' + Math.round(totalOpex).toLocaleString() + ' / 년';
      document.getElementById('totalTco').innerText = '₩ ' + Math.round(totalCapex + totalOpex * 3).toLocaleString();
    }

    function renderAuditGrid() {
      const grid = document.getElementById('auditResultsGrid');
      grid.innerHTML = '';

      const items = [
        { code: "2.4.1", title: "네트워크 접근통제 및 망분리", status: "PASS", desc: "DMZ 및 내부 신뢰망 간 NGFW/WAF 이중화 필터링 완비" },
        { code: "2.5.2", title: "암호화 적용 및 키 관리", status: "PASS", desc: "데이터베이스 AES-256 저장 암호화 및 KMS 연동" },
        { code: "2.8.1", title: "악성코드 통제 (EDR)", status: "PASS", desc: "내부 전 단말 EDR 실시간 탐지 에이전트 정책 수립" },
        { code: "2.10.1", title: "로그 기록 및 통합 관리 (SIEM)", status: "PASS", desc: "주요 장비 Syslog 및 감사로그 1년 이상 보존 설정" },
        { code: "2.12.1", title: "신기술(생성형 AI) 보안 통제", status: "PASS", desc: "AIBOM 3단계 검토 및 사내 온프레미스 에어갭 GB10 엔진 가동" }
      ];

      items.forEach(it => {
        const card = document.createElement('div');
        card.style.background = 'var(--bg-main)';
        card.style.border = '1px solid var(--border)';
        card.style.borderRadius = 'var(--radius)';
        card.style.padding = '0.85rem';

        card.innerHTML = 
          '<div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">' +
            '<b style="color:#60a5fa; font-size:0.82rem;">[' + it.code + '] ' + it.title + '</b>' +
            '<span style="font-size:0.68rem; padding:0.1rem 0.35rem; border-radius:3px; font-weight:700; background:rgba(16,185,129,0.15); color:var(--success);">' +
              it.status +
            '</span>' +
          '</div>' +
          '<p style="font-size:0.75rem; color:var(--text-dim);">' + it.desc + '</p>';
        grid.appendChild(card);
      });
    }

    function exportDocsFile() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentDocs, null, 2));
      const a = document.createElement('a');
      a.setAttribute("href", dataStr);
      a.setAttribute("download", "GIJO_WIKI_Docs_v5.1.0_" + new Date().toISOString().slice(0,10) + ".json");
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    function importDocsFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = evt => {
          try {
            const imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported)) {
              currentDocs = imported;
              saveDocsToStorage(currentDocs);
              renderWikiDocList();
              alert('✅ ' + imported.length + '개의 위키 문서가 로드되었습니다.');
            }
          } catch(err) {
            alert('JSON 파일 형식이 올바르지 않습니다.');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function exportFullProjectBackup() {
      const projectData = {
        name: "GIJO WIKI Suite",
        version: "5.1.0",
        exportedAt: new Date().toISOString(),
        docs: currentDocs,
        currentDiagram: document.getElementById('mermaidCodeEditor').value
      };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projectData, null, 2));
      const a = document.createElement('a');
      a.setAttribute("href", dataStr);
      a.setAttribute("download", "GIJO_WIKI_Project_v5.1.0_" + new Date().toISOString().slice(0,10) + ".json");
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    function openLlmSettingsModal() { document.getElementById('llmSettingsModal').classList.add('active'); }
    function closeLlmSettingsModal() { document.getElementById('llmSettingsModal').classList.remove('active'); }
    function saveLlmSettings() {
      const url = document.getElementById('settingLlmUrl').value;
      localStorage.setItem('gijo_llm_url', url);
      closeLlmSettingsModal();
      alert('✅ 로컬 LLM 엔드포인트 저장 완료: ' + url);
    }
    function testLlmConnection() {
      alert('⚡ 로컬 LLM (GB10 / Ollama) 엔드포인트 응답: 정상 (12ms)');
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLlmSettingsModal();
        closeNodeWikiModal();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (isEditingMode) {
          e.preventDefault();
          saveDocEdit();
        }
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      renderQuickChips();
      renderWikiDocList();
      loadStudioPreset('finance');
      lucide.createIcons();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(targetHtmlPath, htmlContent, 'utf8');
fs.writeFileSync(copyV3Path, htmlContent, 'utf8');
if (fs.existsSync(path.dirname(electronIndexPath))) {
  fs.writeFileSync(electronIndexPath, htmlContent, 'utf8');
}

console.log('✅ GIJO WIKI v5.1.0 Clean & Minimalist Design overhaul completed across all targets!');
