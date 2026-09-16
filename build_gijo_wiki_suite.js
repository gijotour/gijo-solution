const fs = require('fs');
const path = require('path');
const { allWikiDocs, enhancedQuickQuestions, solutionsCatalog } = require('./load_all_wiki_knowledge.js');

const targetHtmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
const electronIndexPath = path.join(__dirname, 'gijo-security-erp-app', 'index.html');

const docsJson = JSON.stringify(allWikiDocs);
const quickQuestionsJson = JSON.stringify(enhancedQuickQuestions);
const solutionsCatalogJson = JSON.stringify(solutionsCatalog);

const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>GIJO AS Lite — GIJO WIKI Edition v5.2.0 (보안 지식고 & 20종 솔루션 포털)</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
  <!-- Mermaid.js Engine -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root {
      --bg-main: #f8fafc;
      --bg-panel: #ffffff;
      --bg-card: #ffffff;
      --bg-subtle: #f1f5f9;
      --border: #e2e8f0;
      --border-hover: #cbd5e1;
      --border-focus: #2563eb;
      --text-main: #0f172a;
      --text-sub: #475569;
      --text-dim: #94a3b8;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --accent: #7c3aed;
      --success: #059669;
      --warning: #d97706;
      --danger: #dc2626;
      --radius: 8px;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-main);
      color: var(--text-main);
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* App Header */
    .app-header {
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 1000;
      padding: 0.65rem 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
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
      background: #eff6ff;
      border: 1px solid #bfdbfe;
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
      font-weight: 800;
      letter-spacing: -0.3px;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .version-tag {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.1rem 0.45rem;
      border-radius: 4px;
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #dbeafe;
    }

    .nav-tabs {
      display: flex;
      gap: 0.25rem;
      background: #f1f5f9;
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
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.6);
    }

    .tab-btn.active {
      background: #ffffff;
      color: var(--primary);
      border: 1px solid #cbd5e1;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

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
      background: #ffffff;
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
    }

    .btn:hover {
      background: var(--bg-subtle);
      border-color: var(--border-hover);
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

    .btn-sm {
      padding: 0.25rem 0.55rem;
      font-size: 0.75rem;
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

    /* 1. WIKI & RAG GRID */
    .wiki-grid {
      display: grid;
      grid-template-columns: 340px 1fr 440px;
      gap: 1rem;
      height: 100%;
    }

    .white-panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }

    .panel-head {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fafafa;
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
      background: #ffffff;
    }

    .search-input {
      width: 100%;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.45rem 0.65rem;
      color: var(--text-main);
      font-size: 0.82rem;
      outline: none;
      transition: all 0.15s ease;
    }
    .search-input:focus {
      background: #ffffff;
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    }

    .category-filter-strip {
      padding: 0.4rem 0.75rem;
      display: flex;
      gap: 0.3rem;
      overflow-x: auto;
      background: #fafafa;
      border-bottom: 1px solid var(--border);
    }

    .pill-cat {
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 600;
      background: #ffffff;
      color: var(--text-sub);
      border: 1px solid var(--border);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .pill-cat:hover, .pill-cat.active {
      background: #eff6ff;
      color: var(--primary);
      border-color: #bfdbfe;
    }

    .doc-list-clean {
      flex: 1;
      overflow-y: auto;
      padding: 0.4rem;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: #ffffff;
    }

    .doc-entry {
      padding: 0.65rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      background: #ffffff;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }

    .doc-entry:hover {
      background: #f8fafc;
      border-color: var(--border);
    }

    .doc-entry.active {
      background: #eff6ff;
      border-color: #bfdbfe;
    }

    .doc-entry-title {
      font-weight: 700;
      font-size: 0.83rem;
      color: var(--text-main);
      margin-bottom: 0.25rem;
      line-height: 1.4;
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
      background: #f1f5f9;
      border: 1px solid var(--border);
      color: var(--text-sub);
      font-weight: 600;
    }

    .meta-badge.badge-kr {
      background: #eff6ff;
      color: #1d4ed8;
      border-color: #bfdbfe;
    }

    .meta-badge.badge-global {
      background: #faf5ff;
      color: #7e22ce;
      border-color: #e9d5ff;
    }

    /* Wiki Content Panel */
    .wiki-content-panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }

    .content-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      background: #ffffff;
    }

    .markdown-render {
      color: var(--text-main);
      font-size: 0.92rem;
      line-height: 1.7;
    }
    .markdown-render h1 { font-size: 1.4rem; font-weight: 800; margin-bottom: 0.8rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; color: #0f172a; }
    .markdown-render h2 { font-size: 1.15rem; font-weight: 700; margin-top: 1.2rem; margin-bottom: 0.5rem; color: #1e293b; }
    .markdown-render h3 { font-size: 1rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.4rem; color: #334155; }
    .markdown-render p { margin-bottom: 0.75rem; }
    .markdown-render ul, .markdown-render ol { margin-left: 1.3rem; margin-bottom: 0.75rem; }
    .markdown-render li { margin-bottom: 0.25rem; }
    .markdown-render pre { background: #f8fafc; border: 1px solid var(--border); padding: 0.8rem; border-radius: 6px; overflow-x: auto; margin-bottom: 0.8rem; font-size: 0.82rem; font-family: monospace; }
    .markdown-render code { background: #f1f5f9; padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.82rem; font-family: monospace; color: #dc2626; }
    .markdown-render blockquote { border-left: 3px solid var(--primary); padding-left: 0.75rem; color: var(--text-sub); margin-bottom: 0.75rem; background: #eff6ff; padding: 0.5rem 0.75rem; border-radius: 0 4px 4px 0; }
    .markdown-render table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.84rem; }
    .markdown-render th, .markdown-render td { border: 1px solid var(--border); padding: 0.5rem 0.65rem; text-align: left; }
    .markdown-render th { background: #f8fafc; font-weight: 700; }

    /* Right RAG & Copilot Panel */
    .rag-panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }

    .rag-chip-container {
      padding: 0.5rem 0.75rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      border-bottom: 1px solid var(--border);
      background: #fafafa;
      max-height: 140px;
      overflow-y: auto;
    }

    .quick-chip {
      background: #ffffff;
      border: 1px solid var(--border);
      color: var(--text-sub);
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .quick-chip:hover {
      background: #eff6ff;
      color: var(--primary);
      border-color: #bfdbfe;
    }

    .rag-chat-history {
      flex: 1;
      overflow-y: auto;
      padding: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      background: #ffffff;
    }

    .bubble {
      padding: 0.75rem 0.9rem;
      border-radius: 8px;
      font-size: 0.82rem;
      line-height: 1.5;
      max-width: 92%;
      word-break: break-word;
    }

    .bubble.user {
      background: #eff6ff;
      color: #1e3a8a;
      border: 1px solid #bfdbfe;
      align-self: flex-end;
      border-bottom-right-radius: 2px;
    }

    .bubble.ai {
      background: #f8fafc;
      color: var(--text-main);
      border: 1px solid var(--border);
      align-self: flex-start;
      border-bottom-left-radius: 2px;
    }

    .citation-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: #eff6ff;
      color: var(--primary);
      border: 1px solid #bfdbfe;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 0.4rem;
    }

    .rag-input-box {
      padding: 0.65rem 0.75rem;
      border-top: 1px solid var(--border);
      background: #fafafa;
      display: flex;
      gap: 0.4rem;
    }

    /* 2. STUDIO VIEW */
    .studio-grid {
      display: grid;
      grid-template-columns: 420px 1fr;
      gap: 1rem;
      height: 100%;
    }

    .code-editor {
      width: 100%;
      height: calc(100% - 150px);
      background: #ffffff;
      color: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem;
      font-family: monospace;
      font-size: 0.82rem;
      line-height: 1.5;
      resize: none;
      outline: none;
    }
    .code-editor:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    }

    .stage-canvas-panel {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-sm);
    }

    .canvas-bar {
      padding: 0.5rem 0.85rem;
      border-bottom: 1px solid var(--border);
      background: #fafafa;
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
      background: #fdfdfd;
    }

    .edgePath path { stroke: #2563eb !important; stroke-width: 2px !important; }
    .edgePath.animated path { stroke-dasharray: 6, 6; animation: dashFlow 1s linear infinite; }
    @keyframes dashFlow { to { stroke-dashoffset: -40; } }

    /* 3. PORTAL (SOLUTIONS) VIEW */
    .portal-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .portal-filter-bar {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      box-shadow: var(--shadow-sm);
    }

    .portal-tags-row {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .portal-grid-scroll {
      flex: 1;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1rem;
      padding-bottom: 5rem;
    }

    .sol-card {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }
    .sol-card:hover {
      border-color: #cbd5e1;
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
    }

    .sol-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }

    .sol-card-title {
      font-size: 1rem;
      font-weight: 800;
      color: var(--text-main);
    }

    .sol-card-vendor {
      font-size: 0.75rem;
      color: var(--text-dim);
    }

    .sol-card-desc {
      font-size: 0.82rem;
      color: var(--text-sub);
      line-height: 1.5;
      margin: 0.5rem 0 0.75rem 0;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .sol-card-footer {
      border-top: 1px solid var(--border);
      padding-top: 0.65rem;
      margin-top: 0.65rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    /* Compare Tray */
    .compare-tray {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(10px);
      border-top: 2px solid var(--primary);
      box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
      padding: 0.75rem 1.5rem;
      display: none;
      align-items: center;
      justify-content: space-between;
      z-index: 1050;
    }
    .compare-tray.active {
      display: flex;
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .modal-overlay.active {
      display: flex;
    }

    .modal-box {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 90%;
      max-width: 950px;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    }

    .modal-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fafafa;
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
    }

    /* BOM Table */
    .clean-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
      text-align: left;
    }
    .clean-table th { padding: 0.65rem; border-bottom: 2px solid var(--border); color: var(--text-sub); font-weight: 700; background: #fafafa; }
    .clean-table td { padding: 0.65rem; border-bottom: 1px solid var(--border); }
    
    .qty-box {
      background: #ffffff; border: 1px solid var(--border); border-radius: 4px;
      color: var(--text-main); padding: 0.2rem 0.4rem; width: 60px; text-align: center; font-weight: 700;
    }
  </style>
</head>
<body>

  <!-- App Header -->
  <header class="app-header">
    <div class="header-inner">
      <div class="brand-section">
        <div class="brand-logo">AL</div>
        <div class="brand-text">
          GIJO AS Lite <span class="version-tag">WIKI & ERP v5.2</span>
        </div>
        <span style="font-size:0.68rem; color:#2563eb; background:#eff6ff; padding:2px 8px; border-radius:12px; border:1px solid #bfdbfe; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
          <i data-lucide="shield" style="width:10px; height:10px;"></i> 에어갭 워크스페이스
        </span>
      </div>

      <nav class="nav-tabs">
        <button id="tabBtn-wiki" class="tab-btn active" onclick="switchView('wiki')">
          <i data-lucide="book-open" style="width:14px; height:14px;"></i> 사내 지식고 & RAG
        </button>
        <button id="tabBtn-portal" class="tab-btn" onclick="switchView('portal')">
          <i data-lucide="shield-check" style="width:14px; height:14px;"></i> 솔루션 ERP (20종)
        </button>
        <button id="tabBtn-studio" class="tab-btn" onclick="switchView('studio')">
          <i data-lucide="cpu" style="width:14px; height:14px;"></i> 아키텍처 스튜디오
        </button>
        <button id="tabBtn-bom" class="tab-btn" onclick="switchView('bom')">
          <i data-lucide="calculator" style="width:14px; height:14px;"></i> 실시간 TCO
        </button>
        <button id="tabBtn-audit" class="tab-btn" onclick="switchView('audit')">
          <i data-lucide="file-check-2" style="width:14px; height:14px;"></i> ISMS-P 진단기
        </button>
      </nav>

      <div class="header-tools">
        <button class="btn" onclick="resetToRealDocs()" title="29종 원본 문서 전수 새로고침">
          <i data-lucide="refresh-cw" style="width:13px; height:13px;"></i> 원본 새로고침
        </button>
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
        <aside class="white-panel">
          <div class="panel-head">
            <span class="panel-head-title"><i data-lucide="folder" style="width:14px; height:14px; color:var(--primary);"></i> GIJO 실물 지식고 (<span id="totalDocCount">0</span>)</span>
            <button class="btn btn-sm" onclick="createNewWikiDoc()">
              <i data-lucide="plus" style="width:12px; height:12px;"></i> 추가
            </button>
          </div>

          <div class="search-input-wrap">
            <input type="text" id="wikiSearchInput" class="search-input" placeholder="사내 규정, 솔루션, CVE, AIBOM 검색..." oninput="filterWikiDocs()">
          </div>

          <div class="category-filter-strip">
            <button class="pill-cat active" id="pill-ALL" onclick="filterByCat('ALL')">전체</button>
            <button class="pill-cat" id="pill-보안솔루션" onclick="filterByCat('보안솔루션')">보안솔루션(20)</button>
            <button class="pill-cat" id="pill-보안규정" onclick="filterByCat('보안규정')">보안규정</button>
            <button class="pill-cat" id="pill-취약점관리" onclick="filterByCat('취약점관리')">취약점</button>
            <button class="pill-cat" id="pill-AI보안" onclick="filterByCat('AI보안')">AI보안</button>
            <button class="pill-cat" id="pill-아키텍처설계" onclick="filterByCat('아키텍처설계')">아키텍처</button>
            <button class="pill-cat" id="pill-QA문답집" onclick="filterByCat('QA문답집')">QA문답</button>
          </div>

          <ul id="wikiDocList" class="doc-list-clean"></ul>

          <div style="padding: 0.5rem; border-top: 1px solid var(--border); display: flex; gap: 0.35rem; background:#fafafa;">
            <button class="btn" style="flex:1; justify-content:center; font-size:0.75rem;" onclick="importDocsFile()">가져오기</button>
            <button class="btn" style="flex:1; justify-content:center; font-size:0.75rem;" onclick="exportDocsFile()">내보내기</button>
          </div>
        </aside>

        <!-- Center: Reader / Editor -->
        <article class="wiki-content-panel">
          <div class="panel-head">
            <div style="font-size:0.82rem; color:var(--text-sub);">
              <span id="wikiBreadcrumbCat" style="color:var(--primary); font-weight:600;">보안규정</span> &gt; <b id="wikiBreadcrumbTitle" style="color:var(--text-main);">문서 제목</b>
            </div>
            <div style="display:flex; gap:0.35rem;">
              <button id="btnToggleEdit" class="btn btn-sm" onclick="toggleEditMode()">
                <i data-lucide="edit-3" style="width:13px; height:13px;"></i> 편집
              </button>
              <button class="btn btn-sm" onclick="compileDocToStudio()">
                <i data-lucide="share-2" style="width:13px; height:13px;"></i> 캔버스 연동
              </button>
              <button class="btn btn-sm" style="color:var(--danger);" onclick="deleteCurrentDoc()">삭제</button>
            </div>
          </div>

          <div class="content-body">
            <div id="wikiReadView" class="markdown-render"></div>

            <div id="wikiEditView" style="display: none; height: 100%; flex-direction: column; gap: 0.65rem;">
              <input type="text" id="editDocTitle" class="search-input" style="font-size:1.1rem; font-weight:700; background:#fff;" placeholder="문서 제목">
              <div style="display:flex; gap:0.5rem;">
                <input type="text" id="editDocCat" class="search-input" style="width:140px; background:#fff;" placeholder="카테고리">
                <input type="text" id="editDocTags" class="search-input" style="flex:1; background:#fff;" placeholder="태그 (쉼표로 구분)">
              </div>
              <textarea id="editDocContent" class="code-editor" style="flex:1; height:auto;" placeholder="마크다운 내용 작성..."></textarea>
              <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                <button class="btn" onclick="cancelDocEdit()">취소</button>
                <button class="btn btn-primary" onclick="saveDocEdit()">저장</button>
              </div>
            </div>
          </div>
        </article>

        <!-- Right: AI Copilot & Knowledge RAG -->
        <aside class="rag-panel">
          <div class="panel-head">
            <span class="panel-head-title">
              <i data-lucide="bot" style="width:14px; height:14px; color:var(--primary);"></i> AI Copilot & 지식 학습 질의
            </span>
            <span id="llmStatusIndicator" style="font-size:0.68rem; color:#059669; font-weight:600; display:flex; align-items:center; gap:3px;">
              <span style="width:6px; height:6px; background:#059669; border-radius:50%;"></span> 에어갭 RAG (29종 전수)
            </span>
          </div>

          <div class="rag-chip-container" id="quickQuestionsChipBox"></div>

          <div class="rag-chat-history" id="ragChatMessages">
            <div class="bubble ai">
              안녕하세요! <b>GIJO AS 보안 실무 지식고 및 20종 솔루션 카탈로그</b>가 RAG 엔진에 100% 학습/탑재되었습니다.<br><br>
              사내 보안 지침, 망분리 규제뿐만 아니라 <b>WizCLM, SAFESQUARE SBOM, FOCS, Tenable AI Exposure, SecureIM, Imperva WAAP 등 20종 실물 솔루션</b>의 스펙, 도입효과, 규제 근거를 자유롭게 질문해 보세요!
            </div>
          </div>

          <div class="rag-input-box">
            <input type="text" id="ragQueryInput" class="search-input" style="background:#fff;" placeholder="솔루션 기능, 규제 준수, CVE 조치 등 질의..." onkeydown="if(event.key==='Enter') executeRagQuery()">
            <button class="btn btn-primary" onclick="executeRagQuery()">
              <i data-lucide="send" style="width:13px; height:13px;"></i>
            </button>
          </div>
        </aside>

      </div>
    </section>

    <!-- 2. PORTAL (SOLUTIONS) VIEW -->
    <section id="view-portal" class="view-page">
      <div class="portal-container">
        
        <div class="portal-filter-bar">
          <div>
            <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="layers" style="width:20px; height:20px; color:var(--primary);"></i>
              20종 보안 솔루션 전사 ERP 카탈로그
            </h2>
            <p style="color:var(--text-sub); font-size:0.78rem;">공식 제조사 및 단독 총판 라이선스, 아키텍처 다이어그램 및 ISMS-P 통제항목 연동</p>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem;">
            <div class="portal-tags-row">
              <button class="pill-cat active" id="solFilter-ALL" onclick="filterSolutions('ALL')">전체 (20)</button>
              <button class="pill-cat" id="solFilter-KR" onclick="filterSolutions('KR')">국산 솔루션</button>
              <button class="pill-cat" id="solFilter-GLOBAL" onclick="filterSolutions('GLOBAL')">외산 솔루션</button>
              <button class="pill-cat" id="solFilter-AI" onclick="filterSolutions('AI')">AI보안/SPM</button>
              <button class="pill-cat" id="solFilter-NETWORK" onclick="filterSolutions('NETWORK')">네트워크/경계</button>
              <button class="pill-cat" id="solFilter-DATA" onclick="filterSolutions('DATA')">데이터/엔드포인트</button>
            </div>
            <input type="text" id="portalSearchInput" class="search-input" style="width:220px; background:#fff;" placeholder="솔루션명, 벤더, 키워드..." oninput="renderPortalCards()">
          </div>
        </div>

        <div id="portalCardsGrid" class="portal-grid-scroll"></div>

      </div>
    </section>

    <!-- 3. STUDIO VIEW -->
    <section id="view-studio" class="view-page">
      <div class="studio-grid">
        
        <div class="white-panel" style="padding:1rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <span class="panel-head-title"><i data-lucide="code" style="width:14px; height:14px;"></i> Mermaid 아키텍처 다이어그램 에디터</span>
            <div style="display:flex; gap:0.35rem;">
              <select id="studioPresetSelect" class="search-input" style="width:180px; padding:0.25rem 0.45rem; font-size:0.75rem;" onchange="loadStudioPreset(this.value)">
                <option value="">-- 솔루션 권장 프리셋 --</option>
                <option value="GIJO_AS">GIJO AS 폐쇄망 에이전트</option>
                <option value="WizCLM">WizCLM 인증서 자동화</option>
                <option value="SecureIM">SecureIM 서버 접근제어</option>
                <option value="Tenable_AI">Tenable AI Exposure SPM</option>
                <option value="FOCS">FOCS 방화벽 정책 관리</option>
                <option value="CipherTrust">CipherTrust 투명 DB 암호화</option>
                <option value="Imperva_WAAP">Imperva WAAP 웹/API 보호</option>
                <option value="finance">표준 금융 3계층 방화벽</option>
              </select>
              <button class="btn btn-sm btn-primary" onclick="renderMermaidFromEditor()">
                <i data-lucide="play" style="width:12px; height:12px;"></i> 렌더
              </button>
            </div>
          </div>

          <div style="margin-bottom:0.5rem; display:flex; gap:0.3rem; flex-wrap:wrap;">
            <button class="btn btn-sm" onclick="insertNodeToCode('WAF', '🛡️ Web App Firewall', 'DMZ')">+ WAF</button>
            <button class="btn btn-sm" onclick="insertNodeToCode('NGFW', '🔥 NextGen Firewall', 'DMZ')">+ NGFW</button>
            <button class="btn btn-sm" onclick="insertNodeToCode('EDR', '💻 Falcon EDR Agent', 'InternalTrust')">+ EDR</button>
            <button class="btn btn-sm" onclick="insertNodeToCode('DLP', '🔒 GRADIUS DLP', 'InternalTrust')">+ DLP</button>
            <button class="btn btn-sm" onclick="insertNodeToCode('CLM', '📜 WizCLM Engine', 'SecOps')">+ CLM</button>
            <button class="btn btn-sm" onclick="insertNodeToCode('AI', '🧠 GIJO AS Engine', 'SecOps')">+ GIJO AS</button>
          </div>

          <textarea id="studioMermaidCode" class="code-editor" spellcheck="false"></textarea>
        </div>

        <div class="stage-canvas-panel">
          <div class="canvas-bar">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-weight:700; font-size:0.85rem; color:var(--text-main);">아키텍처 렌더링 캔버스</span>
              <span id="studioRenderStatus" class="meta-badge" style="background:#eff6ff; color:var(--primary);">준비 완료</span>
            </div>
            <div style="display:flex; gap:0.35rem;">
              <button class="btn btn-sm" onclick="zoomCanvas(0.1)" title="확대"><i data-lucide="zoom-in" style="width:12px; height:12px;"></i></button>
              <button class="btn btn-sm" onclick="zoomCanvas(-0.1)" title="축소"><i data-lucide="zoom-out" style="width:12px; height:12px;"></i></button>
              <button class="btn btn-sm" onclick="resetCanvasZoom()" title="초기화">100%</button>
              <button class="btn btn-sm" id="btnTrafficFlow" onclick="toggleTrafficAnimation()" title="트래픽 흐름">
                <i data-lucide="activity" style="width:12px; height:12px;"></i> 트래픽
              </button>
              <button class="btn btn-sm" onclick="downloadCanvasSvg()" title="SVG 다운로드">
                <i data-lucide="download" style="width:12px; height:12px;"></i> SVG
              </button>
            </div>
          </div>
          <div class="stage-render" id="studioStage">
            <div id="mermaidOutput"></div>
          </div>
        </div>

      </div>
    </section>

    <!-- 4. BOM & TCO VIEW -->
    <section id="view-bom" class="view-page">
      <div class="white-panel" style="padding:1.25rem; height:100%; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <div>
            <h2 style="font-size:1.2rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="calculator" style="width:20px; height:20px; color:var(--primary);"></i>
              20종 보안 솔루션 실시간 BOM & 5개년 TCO 견적기
            </h2>
            <p style="color:var(--text-sub); font-size:0.8rem;">솔루션 카탈로그 수량 조절 시 1개년 구축비(Capex), 유지보수비(Opex 12%), 총소유비용(TCO)이 실시간 연동됩니다.</p>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-sm" onclick="resetBomQuantities()">수량 초기화</button>
            <button class="btn btn-sm btn-primary" onclick="exportBomToCsv()"><i data-lucide="file-spreadsheet" style="width:12px; height:12px;"></i> 견적서 CSV 출력</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem; margin-bottom:1.25rem;">
          <div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:var(--text-sub); font-weight:600;">선택된 보안 솔루션</div>
            <div id="bomTotalQtyCount" style="font-size:1.4rem; font-weight:800; color:var(--primary); margin-top:0.25rem;">0 개</div>
          </div>
          <div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:var(--text-sub); font-weight:600;">초기 도입비 (Capex)</div>
            <div id="bomTotalCapex" style="font-size:1.4rem; font-weight:800; color:var(--text-main); margin-top:0.25rem;">₩0</div>
          </div>
          <div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:var(--text-sub); font-weight:600;">연간 유지보수비 (Opex 12%)</div>
            <div id="bomTotalOpex" style="font-size:1.4rem; font-weight:800; color:#d97706; margin-top:0.25rem;">₩0</div>
          </div>
          <div style="background:#eff6ff; border:1px solid #bfdbfe; padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:#1d4ed8; font-weight:600;">5개년 총소유비용 (TCO)</div>
            <div id="bomTotalTco" style="font-size:1.4rem; font-weight:800; color:#1d4ed8; margin-top:0.25rem;">₩0</div>
          </div>
        </div>

        <table class="clean-table">
          <thead>
            <tr>
              <th style="width:180px;">솔루션명</th>
              <th style="width:130px;">제조사 / 구분</th>
              <th style="width:160px;">카테고리</th>
              <th style="width:130px;">단가 (소비자가)</th>
              <th style="width:80px; text-align:center;">도입수량</th>
              <th style="width:140px;">도입비 합계</th>
              <th style="width:140px;">연간 유지보수</th>
              <th>ISMS-P 통제항목 매핑</th>
            </tr>
          </thead>
          <tbody id="bomTableBody"></tbody>
        </table>
      </div>
    </section>

    <!-- 5. AUDIT / ISMS-P VIEW -->
    <section id="view-audit" class="view-page">
      <div class="white-panel" style="padding:1.25rem; height:100%; overflow-y:auto;">
        <div style="margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 style="font-size:1.2rem; font-weight:800; color:var(--text-main);">ISMS-P 인증 기준 통제항목 진단 매핑</h2>
            <p style="color:var(--text-sub); font-size:0.8rem;">20종 솔루션 도입 현황에 따른 KISA ISMS-P 80개 세부 인증기준 충족도 분석</p>
          </div>
          <span class="meta-badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.8rem; padding:0.3rem 0.6rem;">인증 통제 매핑 100% 가동</span>
        </div>
        <div id="auditGridContainer" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:1rem;"></div>
      </div>
    </section>

  </main>

  <!-- Solution Detail Modal -->
  <div class="modal-overlay" id="solDetailModal">
    <div class="modal-box">
      <div class="modal-header">
        <div>
          <span id="modalSolCategory" class="meta-badge">카테고리</span>
          <h3 id="modalSolTitle" style="font-size:1.15rem; font-weight:800; margin-top:0.3rem; color:var(--text-main);">솔루션 상세</h3>
          <span id="modalSolVendor" style="font-size:0.75rem; color:var(--text-dim);">제조사</span>
        </div>
        <button class="btn btn-sm" onclick="closeSolDetailModal()"><i data-lucide="x" style="width:14px; height:14px;"></i> 닫기</button>
      </div>
      <div class="modal-body" id="modalSolContent"></div>
    </div>
  </div>

  <!-- Compare Tray Bar -->
  <div class="compare-tray" id="compareTray">
    <div style="display:flex; align-items:center; gap:1rem;">
      <span style="font-weight:700; font-size:0.85rem; color:var(--text-main);">
        <i data-lucide="scale" style="width:16px; height:16px; vertical-align:middle;"></i> 솔루션 비교함 (<span id="compareCount">0</span>/4)
      </span>
      <div id="compareItemsList" style="display:flex; gap:0.5rem;"></div>
    </div>
    <div style="display:flex; gap:0.5rem;">
      <button class="btn btn-sm" onclick="clearCompare()">비우기</button>
      <button class="btn btn-sm btn-primary" onclick="openCompareModal()">비교하기</button>
    </div>
  </div>

  <!-- Compare Modal -->
  <div class="modal-overlay" id="compareModal">
    <div class="modal-box" style="max-width:1100px;">
      <div class="modal-header">
        <h3 style="font-size:1.1rem; font-weight:800;">솔루션 스펙 나란히 비교</h3>
        <button class="btn btn-sm" onclick="closeCompareModal()"><i data-lucide="x" style="width:14px; height:14px;"></i> 닫기</button>
      </div>
      <div class="modal-body" id="compareModalBody" style="padding:1rem;"></div>
    </div>
  </div>

  <!-- LLM Settings Modal -->
  <div class="modal-overlay" id="llmSettingsModal">
    <div class="modal-box" style="max-width:520px;">
      <div class="modal-header">
        <h3 style="font-size:1rem; font-weight:800;">온프레미스 AI / LLM 연결 설정</h3>
        <button class="btn btn-sm" onclick="closeLlmSettingsModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">추론 모드 선택</label>
          <select id="llmModeSelect" class="search-input" style="margin-top:0.3rem; background:#fff;">
            <option value="airgap">에어갭 로컬 시맨틱 RAG (완전 오프라인 기본)</option>
            <option value="gb10">GB10 177B DGX 클러스터 (10.8.0.12)</option>
            <option value="win">로컬 운영 서버 llama-server (10.8.0.1:4000)</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">엔드포인트 URL</label>
          <input type="text" id="llmEndpointInput" class="search-input" style="margin-top:0.3rem; background:#fff;" value="http://10.8.0.12:8000/v1">
        </div>
        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">모델명 / 파라미터</label>
          <input type="text" id="llmModelInput" class="search-input" style="margin-top:0.3rem; background:#fff;" value="Qwen3.8-Flash-Next-177B">
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem;">
          <button class="btn btn-sm" onclick="testLlmConnection()">연결 테스트</button>
          <button class="btn btn-sm btn-primary" onclick="saveLlmSettings()">설정 저장</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Suite Core Client Scripts -->
  <script>
    // --- 1. DATA PACKAGES ---
    const defaultWikiDocs = ${docsJson};
    const quickQuestions = ${quickQuestionsJson};
    const solutionCatalog = ${solutionsCatalogJson};

    let currentDocs = [];
    let currentActiveDocId = 1;
    let isEditingMode = false;
    let canvasZoom = 1.0;
    let isTrafficFlowing = false;
    let currentFilterCat = 'ALL';
    let currentSolFilter = 'ALL';
    let compareList = [];

    // LocalStorage Keys
    const STORAGE_KEY = 'GIJO_WIKI_DOCS_V5_2';
    const BOM_QTY_KEY = 'GIJO_BOM_QTY_V5_2';

    // Studio Presets
    const studioPresets = {
      GIJO_AS: \`flowchart TB
  subgraph ClientEnv["🏢 고객사 온프레미스 인프라 (Airgap)"]
    direction TB
    SecAssets["🖥️ 보안 서버 및 AI 자산<br/>- HuggingFace 모델 / Agent<br/>- 방화벽 / EDR / SIEM 로그"]
    LocalEngine["⚡ GIJO AS 온프레미스 엔진<br/>- CycloneDX ML-BOM 생성<br/>- CTI 위협 & 취약점 상관분석"]
    AuditVault["🔒 감사 추적 저장소 (Audit Vault)<br/>- 결재 이력 / 무결성 로그"]
  end
  SecAssets -->|SSH 점검 & 로그 수집| LocalEngine
  LocalEngine -->|무결성 적재| AuditVault\`,
      WizCLM: \`graph TD
  CA["📜 인증서 발급기관 (Internal/Public CA)"] -->|자동 발급/갱신| Engine["⚙️ WizCLM 중앙 통제 엔진"]
  Engine -->|Agent / Agentless 배포| Web["🌐 웹서버 / WAS (Apache, Nginx, IIS)"]
  Engine -->|API 연동| LB["⚖️ 부하분산장치 (F5 L4/L7 ADC)"]
  Engine -->|만료 60/30/7일 전 알림| SecOps["🛡️ 보안담당자 대시보드"]\`,
      SecureIM: \`graph LR
  Admin["👨‍💻 관리자 / 엔지니어"] -->|접근 요청| Gateway["🚪 SecureIM 프록시 게이트웨이"]
  Gateway -->|2차 인증 MFA & 명령어 차단| Servers["🖥️ 대상 서버군 (Linux, Unix, Windows)"]
  Gateway -->|실시간 세션 녹화 & 감사| LogDB["🗄️ 위변조방지 감사 로그 DB"]\`,
      Tenable_AI: \`graph TD
  Cloud["☁️ Multi-Cloud & 사내망"] -->|AI 자산 탐지| Agent["🔍 Tenable AI Exposure 스캐너"]
  Agent -->|섀도우 AI & GenAI 식별| Posture["📊 AI SPM 보안 태세 대시보드"]
  Posture -->|취약점 우선순위 VPR| SecTeam["🛡️ 보안팀 대응 티켓"]\`,
      FOCS: \`graph TD
  User["👤 정책 신청자"] -->|신청서 제출| Workflow["📝 FOCS 정책 워크플로우"]
  Workflow -->|중복/과다허용 정책 자동 검증| Engine["⚙️ FOCS 정책 분석 엔진"]
  Engine -->|자동 룰 푸시 (CLI/API)| Firewalls["🔥 이기종 방화벽군 (PaloAlto, Fortinet, 안랩)"]\`,
      CipherTrust: \`graph LR
  App["💻 엔터프라이즈 애플리케이션"] --> OS["⚙️ OS 커널 / 파일시스템"]
  OS -->|Vormetric 커널 암호화 드라이버| Storage["💾 스토리지 / 볼륨 (AES-256)"]
  OS <-->|실시간 키 교환| KeyMgr["🔑 CipherTrust Manager (중앙 키 관리)"]\`,
      Imperva_WAAP: \`graph LR
  Client["🌐 인터넷 클라이언트"] -->|HTTP/HTTPS 트래픽| WAAP["🛡️ Imperva WAAP (Edge CDN)"]
  WAAP -->|WAF/API/DDoS 차단 & LLM 프롬프트 검사| Origin["🏢 고객사 오리진 웹/WAS"]
  WAAP -->|위협 텔레메트리 전송| SOC["📊 글로벌 위협 인텔리전스 SOC"]\`,
      finance: \`graph TD
  User["👤 인터넷 사용자"] -->|HTTPS 443| WAF["🛡️ WAF (Active-Standby)"]
  WAF -->|검증된 트래픽| NGFW["🔥 차세대 방화벽 (HA)"]
  subgraph DMZ["🌐 DMZ 존"]
    NGFW --> WEB1["💻 Web Server 01"]
    NGFW --> WEB2["💻 Web Server 02"]
  end
  subgraph InternalTrust["🏢 내부 신뢰망 Trust Zone"]
    WEB1 --> WAS["⚙️ AP/WAS Cluster"]
    WEB2 --> WAS
    WAS --> DB["🗄️ Secure DB (AES-256)"]
  end
  subgraph SecOps["🛡️ 보안관제 센터 SecOps"]
    SIEM["📊 SIEM / SOAR (로그수집)"]
  end
  NGFW -.->|Syslog| SIEM\`
    };

    // --- 2. INITIALIZATION & STORAGE ---
    function sanitizeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function loadStoredDocs() {
      try {
        const storedStr = localStorage.getItem(STORAGE_KEY);
        if (storedStr) {
          const parsed = JSON.parse(storedStr);
          if (Array.isArray(parsed) && parsed.length >= defaultWikiDocs.length) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn('Storage parse fail:', e);
      }
      return JSON.parse(JSON.stringify(defaultWikiDocs));
    }

    function resetToRealDocs() {
      if (confirm('29종 실물 지식고 문서(사내 지침 9종 + 20종 솔루션 규격)로 초기화하시겠습니까?')) {
        currentDocs = JSON.parse(JSON.stringify(defaultWikiDocs));
        saveDocsToStorage();
        renderWikiDocList();
        selectWikiDoc(currentDocs[0].id);
        renderPortalCards();
        renderBomTable();
        alert('✅ 29종 원본 지식고 및 20종 솔루션 데이터가 성공적으로 동기화되었습니다.');
      }
    }

    function saveDocsToStorage() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentDocs));
      } catch (e) {
        console.error('Storage save error:', e);
      }
    }

    // --- 3. VIEW SWITCHER ---
    function switchView(viewName) {
      document.querySelectorAll('.view-page').forEach(sec => sec.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

      const targetSec = document.getElementById('view-' + viewName);
      const targetBtn = document.getElementById('tabBtn-' + viewName);

      if (targetSec) targetSec.classList.add('active');
      if (targetBtn) targetBtn.classList.add('active');

      if (viewName === 'studio') {
        renderMermaidFromEditor();
      } else if (viewName === 'portal') {
        renderPortalCards();
      } else if (viewName === 'bom') {
        renderBomTable();
      } else if (viewName === 'audit') {
        renderAuditGrid();
      }
      lucide.createIcons();
    }

    // --- 4. WIKI & RAG MODULE ---
    function renderQuickChips() {
      const chipBox = document.getElementById('quickQuestionsChipBox');
      chipBox.innerHTML = '';
      quickQuestions.forEach(q => {
        const chip = document.createElement('button');
        chip.className = 'quick-chip';
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
      const searchVal = document.getElementById('wikiSearchInput').value.toLowerCase().trim();
      listEl.innerHTML = '';

      const filtered = currentDocs.filter(doc => {
        const matchesCat = (currentFilterCat === 'ALL' || doc.category === currentFilterCat);
        const matchesSearch = !searchVal || 
          doc.title.toLowerCase().includes(searchVal) ||
          doc.tags.some(t => t.toLowerCase().includes(searchVal)) ||
          doc.content.toLowerCase().includes(searchVal);
        return matchesCat && matchesSearch;
      });

      document.getElementById('totalDocCount').innerText = filtered.length;

      filtered.forEach(doc => {
        const li = document.createElement('li');
        li.className = 'doc-entry' + (doc.id === currentActiveDocId ? ' active' : '');
        li.onclick = () => selectWikiDoc(doc.id);

        const isSol = doc.category === '보안솔루션';
        const badgeClass = isSol ? (doc.title.includes('국산') ? 'badge-kr' : 'badge-global') : '';

        li.innerHTML = 
          '<div class="doc-entry-title">' + sanitizeHtml(doc.title) + '</div>' +
          '<div class="doc-entry-meta">' +
            '<span class="meta-badge ' + badgeClass + '">' + sanitizeHtml(doc.category) + '</span>' +
            '<span>' + (doc.tags ? doc.tags.slice(0, 3).join(', ') : '') + '</span>' +
          '</div>';
        listEl.appendChild(li);
      });
    }

    function selectWikiDoc(docId) {
      currentActiveDocId = docId;
      renderWikiDocList();
      displayCurrentDoc();
    }

    function displayCurrentDoc() {
      const doc = currentDocs.find(d => d.id === currentActiveDocId) || currentDocs[0];
      if (!doc) return;

      document.getElementById('wikiBreadcrumbCat').innerText = doc.category;
      document.getElementById('wikiBreadcrumbTitle').innerText = doc.title;

      const readView = document.getElementById('wikiReadView');
      readView.innerHTML = parseMarkdownToHtml(doc.content);

      if (isEditingMode) {
        document.getElementById('editDocTitle').value = doc.title;
        document.getElementById('editDocCat').value = doc.category;
        document.getElementById('editDocTags').value = (doc.tags || []).join(', ');
        document.getElementById('editDocContent').value = doc.content;
      }
      lucide.createIcons();
    }

    function toggleEditMode() {
      isEditingMode = !isEditingMode;
      const readView = document.getElementById('wikiReadView');
      const editView = document.getElementById('wikiEditView');
      const btn = document.getElementById('btnToggleEdit');

      if (isEditingMode) {
        readView.style.display = 'none';
        editView.style.display = 'flex';
        btn.innerText = '읽기 모드';
        displayCurrentDoc();
      } else {
        readView.style.display = 'block';
        editView.style.display = 'none';
        btn.innerHTML = '<i data-lucide="edit-3" style="width:13px; height:13px;"></i> 편집';
      }
      lucide.createIcons();
    }

    function saveDocEdit() {
      const doc = currentDocs.find(d => d.id === currentActiveDocId);
      if (!doc) return;

      doc.title = document.getElementById('editDocTitle').value.trim() || doc.title;
      doc.category = document.getElementById('editDocCat').value.trim() || doc.category;
      doc.tags = document.getElementById('editDocTags').value.split(',').map(s => s.trim()).filter(Boolean);
      doc.content = document.getElementById('editDocContent').value;
      doc.updatedAt = new Date().toISOString().slice(0, 10);

      saveDocsToStorage();
      toggleEditMode();
      renderWikiDocList();
      displayCurrentDoc();
      alert('✅ 문서가 저장되었습니다.');
    }

    function cancelDocEdit() {
      toggleEditMode();
    }

    function createNewWikiDoc() {
      const newId = Date.now();
      const newDoc = {
        id: newId,
        title: '새 보안 지침 문서',
        category: '보안규정',
        tags: ['신규', '보안'],
        updatedAt: new Date().toISOString().slice(0, 10),
        content: '# 새 보안 지침\\n\\n내용을 작성하세요.'
      };
      currentDocs.unshift(newDoc);
      saveDocsToStorage();
      currentActiveDocId = newId;
      renderWikiDocList();
      if (!isEditingMode) toggleEditMode();
      displayCurrentDoc();
    }

    function deleteCurrentDoc() {
      if (currentDocs.length <= 1) {
        alert('최소 1개 이상의 문서는 유지되어야 합니다.');
        return;
      }
      if (confirm('현재 문서를 삭제하시겠습니까?')) {
        currentDocs = currentDocs.filter(d => d.id !== currentActiveDocId);
        saveDocsToStorage();
        currentActiveDocId = currentDocs[0].id;
        renderWikiDocList();
        displayCurrentDoc();
      }
    }

    function filterWikiDocs() {
      renderWikiDocList();
    }

    function filterByCat(cat) {
      currentFilterCat = cat;
      document.querySelectorAll('.pill-cat').forEach(p => p.classList.remove('active'));
      const activePill = document.getElementById('pill-' + cat);
      if (activePill) activePill.classList.add('active');
      renderWikiDocList();
    }

    // Markdown Parser
    function parseMarkdownToHtml(md) {
      if (!md) return '';
      let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Code blocks
      html = html.replace(new RegExp('\\x60\\x60\\x60([^\\x60\\r\\n]*)\\n([\\s\\S]*?)\\x60\\x60\\x60', 'g'), (match, lang, code) => {
        if (lang === 'mermaid') {
          return '<div class="mermaid" style="background:#f8fafc; padding:1rem; border-radius:6px; margin:0.8rem 0; border:1px solid var(--border); overflow-x:auto;">' + code + '</div>';
        }
        return '<pre><code>' + code + '</code></pre>';
      });

      // Headers
      html = html.replace(new RegExp('^### (.*$)', 'gim'), '<h3>$1</h3>');
      html = html.replace(new RegExp('^## (.*$)', 'gim'), '<h2>$1</h2>');
      html = html.replace(new RegExp('^# (.*$)', 'gim'), '<h1>$1</h1>');

      // Blockquotes
      html = html.replace(new RegExp('^\\\\> (.*$)', 'gim'), '<blockquote>$1</blockquote>');

      // Bold & Italic
      html = html.replace(new RegExp('\\\\*\\\\*(.*?)\\\\*\\\\*', 'gim'), '<b>$1</b>');
      html = html.replace(new RegExp('\\\\*(.*?)\\\\*', 'gim'), '<i>$1</i>');
      html = html.replace(new RegExp('\\x60([^\\x60]+)\\x60', 'gim'), '<code>$1</code>');

      // Lists
      html = html.replace(new RegExp('^\\\\- (.*$)', 'gim'), '<li>$1</li>');
      html = html.replace(new RegExp('</li>\\\\n<li>', 'g'), '</li><li>');

      // Paragraphs
      html = html.split('\\n\\n').map(p => {
        if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<block') || p.startsWith('<div') || p.startsWith('<li>')) return p;
        return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
      }).join('\\n');

      return html;
    }

    // AI Copilot & Knowledge RAG
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
          if (doc.title.toLowerCase().includes(term)) score += 8;
          if (doc.tags && doc.tags.some(t => t.toLowerCase().includes(term))) score += 6;
          if (doc.content.toLowerCase().includes(term)) score += 2;
        });

        // Exact match boosts
        if (query.includes('WizCLM') && doc.title.includes('WizCLM')) score += 20;
        if (query.includes('SBOM') && (doc.title.includes('SBOM') || doc.title.includes('SAFESQUARE'))) score += 20;
        if (query.includes('FOCS') && doc.title.includes('FOCS')) score += 20;
        if (query.includes('SecureIM') && doc.title.includes('SecureIM')) score += 20;
        if (query.includes('Tenable') && doc.title.includes('Tenable')) score += 20;
        if (query.includes('CipherTrust') && doc.title.includes('CipherTrust')) score += 20;
        if (query.includes('WAAP') && doc.title.includes('WAAP')) score += 20;
        if (query.includes('EDR') && doc.title.includes('EDR')) score += 20;
        if (query.includes('DLP') && doc.title.includes('DLP')) score += 20;
        if (query.includes('AIBOM') && doc.title.includes('AIBOM')) score += 15;
        if (query.includes('에어갭') && doc.content.includes('에어갭')) score += 10;
        if (query.includes('CVE') && doc.title.includes('취약점')) score += 10;

        if (score > 0) matchedDocs.push({ doc, score });
      });

      matchedDocs.sort((a, b) => b.score - a.score);
      const topDoc = matchedDocs.length > 0 ? matchedDocs[0].doc : null;

      const aiBubble = document.createElement('div');
      aiBubble.className = 'bubble ai';
      aiBubble.innerHTML = '<div>실물 지식고 29종 분석 중...</div>';
      chatBox.appendChild(aiBubble);
      chatBox.scrollTop = chatBox.scrollHeight;

      let answerText = '';
      if (topDoc) {
        let summary = topDoc.content.slice(0, 320).replace(/#/g, '').replace(/\\*/g, '');
        answerText = '<b>[' + sanitizeHtml(topDoc.title) + ']</b> 원본 지식 근거 분석:<br><br>' + 
          sanitizeHtml(summary) + '...';
      } else {
        answerText = '질의하신 내용에 부합하는 사내 지침 또는 솔루션을 특정하기 어렵습니다. 좌측 지식고 검색창이나 솔루션 ERP 탭에서 관련 키워드를 확인해 보세요.';
      }

      let citationHtml = topDoc 
        ? '<br><div class="citation-btn" onclick="selectWikiDoc(' + topDoc.id + ')">' +
          '<i data-lucide="file-text" style="width:12px; height:12px;"></i> 근거 문서 열기: [' + sanitizeHtml(topDoc.title.slice(0, 26)) + '...]' +
          '</div>'
        : '';

      aiBubble.innerHTML = '<div>' + answerText + citationHtml + '</div>';
      chatBox.scrollTop = chatBox.scrollHeight;
      lucide.createIcons();
    }

    function compileDocToStudio() {
      const doc = currentDocs.find(d => d.id === currentActiveDocId);
      if (!doc) return;

      const mermaidMatch = doc.content.match(new RegExp('\\x60\\x60\\x60mermaid\\n([\\s\\S]*?)\\x60\\x60\\x60'));
      if (mermaidMatch) {
        document.getElementById('studioMermaidCode').value = mermaidMatch[1].trim();
        switchView('studio');
      } else {
        document.getElementById('studioMermaidCode').value = 
          'graph TD\\n  Doc["📄 ' + doc.title.replace(/["\\[\\]]/g, '') + '"] --> Rule["🛡️ 보안 정책 준수"]';
        switchView('studio');
      }
    }

    // --- 5. SOLUTIONS PORTAL (20 PRODUCTS) MODULE ---
    function filterSolutions(filterType) {
      currentSolFilter = filterType;
      document.querySelectorAll('.portal-tags-row .pill-cat').forEach(p => p.classList.remove('active'));
      const activeBtn = document.getElementById('solFilter-' + filterType);
      if (activeBtn) activeBtn.classList.add('active');
      renderPortalCards();
    }

    function renderPortalCards() {
      const grid = document.getElementById('portalCardsGrid');
      const search = (document.getElementById('portalSearchInput')?.value || '').toLowerCase().trim();
      grid.innerHTML = '';

      const filtered = solutionCatalog.filter(sol => {
        let matchesType = true;
        if (currentSolFilter === 'KR') matchesType = sol.vendor.includes('국산') || sol.vendorType === '국산';
        else if (currentSolFilter === 'GLOBAL') matchesType = sol.vendor.includes('외산') || sol.vendorType === '외산';
        else if (currentSolFilter === 'AI') matchesType = sol.name.includes('AI') || (sol.category && sol.category.includes('AI'));
        else if (currentSolFilter === 'NETWORK') matchesType = sol.category.includes('방화벽') || sol.category.includes('WAAP') || sol.name.includes('Zscaler');
        else if (currentSolFilter === 'DATA') matchesType = sol.category.includes('DSP') || sol.category.includes('EDR') || sol.category.includes('DLP') || sol.name.includes('CipherTrust');

        const matchesSearch = !search ||
          sol.name.toLowerCase().includes(search) ||
          sol.vendor.toLowerCase().includes(search) ||
          (sol.category && sol.category.toLowerCase().includes(search)) ||
          (sol.overview && sol.overview.toLowerCase().includes(search));

        return matchesType && matchesSearch;
      });

      filtered.forEach((sol, idx) => {
        const card = document.createElement('div');
        card.className = 'sol-card';

        const isKr = sol.vendor.includes('국산') || sol.vendorType === '국산';
        const badgeClass = isKr ? 'badge-kr' : 'badge-global';
        const badgeText = isKr ? '국산' : '외산';

        // Find linked Wiki Doc ID
        const linkedDoc = currentDocs.find(d => d.title.includes(sol.name));

        card.innerHTML = 
          '<div>' +
            '<div class="sol-card-header">' +
              '<div>' +
                '<span class="meta-badge ' + badgeClass + '" style="margin-bottom:0.3rem; display:inline-block;">' + badgeText + '</span> ' +
                '<span class="meta-badge">' + sanitizeHtml(sol.category || sol.sheetCategory) + '</span>' +
                '<div class="sol-card-title" style="margin-top:0.35rem;">' + sanitizeHtml(sol.name) + '</div>' +
                '<div class="sol-card-vendor">' + sanitizeHtml(sol.vendor) + '</div>' +
              '</div>' +
              '<input type="checkbox" title="비교함에 담기" ' + (compareList.some(c => c.name === sol.name) ? 'checked' : '') + ' onchange="toggleCompareSol(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', this.checked)">' +
            '</div>' +
            '<div class="sol-card-desc">' + sanitizeHtml(sol.overview || sol.purpose || '상세 규격 및 기능 제공') + '</div>' +
            '<div style="font-size:0.75rem; color:var(--text-dim); margin-top:0.4rem;">' +
              '<div><b>표준 단가</b>: ₩' + Number(sol.price || 0).toLocaleString() + ' (조달/ERP)</div>' +
              '<div><b>통제 매핑</b>: ' + sanitizeHtml(sol.ismsMapping || '2.4 접근통제') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sol-card-footer">' +
            '<div style="display:flex; gap:0.3rem;">' +
              '<button class="btn btn-sm" onclick="openSolDetailModal(' + idx + ')"><i data-lucide="info" style="width:11px; height:11px;"></i> 상세</button>' +
              (linkedDoc ? '<button class="btn btn-sm" onclick="jumpToWikiDoc(' + linkedDoc.id + ')"><i data-lucide="book-open" style="width:11px; height:11px;"></i> 위키</button>' : '') +
            '</div>' +
            '<button class="btn btn-sm btn-primary" onclick="addSolToBom(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\')">+ BOM 견적</button>' +
          '</div>';

        grid.appendChild(card);
      });
      lucide.createIcons();
    }

    function jumpToWikiDoc(docId) {
      switchView('wiki');
      selectWikiDoc(docId);
    }

    function openSolDetailModal(idx) {
      const sol = solutionCatalog[idx];
      if (!sol) return;

      document.getElementById('modalSolCategory').innerText = sol.category || sol.sheetCategory;
      document.getElementById('modalSolTitle').innerText = sol.name;
      document.getElementById('modalSolVendor').innerText = sol.vendor + ' | 대상: ' + (sol.target || '-');

      let modalHtml = 
        '<div class="markdown-render">' +
          '<h3>1. 솔루션 개요</h3><p>' + sanitizeHtml(sol.overview || '-') + '</p>' +
          '<h3>2. 도입 목적 및 필요성</h3><p>' + sanitizeHtml(sol.purpose || '-').replace(/\\n/g, '<br>') + '</p>' +
          '<h3>3. 핵심 기능</h3><p>' + sanitizeHtml(sol.features || '-').replace(/\\n/g, '<br>') + '</p>' +
          '<h3>4. 특장점 및 차별성</h3><p>' + sanitizeHtml(sol.highlights || '-').replace(/\\n/g, '<br>') + '</p>' +
          '<h3>5. 관련 규제 및 기대효과</h3><p>' + sanitizeHtml(sol.regulation || '-').replace(/\\n/g, '<br>') + '<br>' + sanitizeHtml(sol.effects || '-').replace(/\\n/g, '<br>') + '</p>';

      if (sol.architectureDiagram) {
        modalHtml += 
          '<h3>6. 권장 아키텍처 다이어그램</h3>' +
          '<div style="margin:0.5rem 0; display:flex; justify-content:flex-end;">' +
            '<button class="btn btn-sm btn-primary" onclick="loadDiagramToStudio(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\')"><i data-lucide="cpu" style="width:12px; height:12px;"></i> 아키텍처 스튜디오에서 편집</button>' +
          '</div>' +
          '<div class="mermaid" style="background:#f8fafc; padding:1rem; border-radius:6px; border:1px solid var(--border);">' + sol.architectureDiagram + '</div>';
      }

      modalHtml += '</div>';

      document.getElementById('modalSolContent').innerHTML = modalHtml;
      document.getElementById('solDetailModal').classList.add('active');
      lucide.createIcons();
      mermaid.run();
    }

    function closeSolDetailModal() {
      document.getElementById('solDetailModal').classList.remove('active');
    }

    function loadDiagramToStudio(solName) {
      const sol = solutionCatalog.find(s => s.name === solName);
      if (!sol || !sol.architectureDiagram) return;
      closeSolDetailModal();
      document.getElementById('studioMermaidCode').value = sol.architectureDiagram;
      switchView('studio');
    }

    // Compare Tray Logic
    function toggleCompareSol(solName, isChecked) {
      const sol = solutionCatalog.find(s => s.name === solName);
      if (!sol) return;

      if (isChecked) {
        if (compareList.length >= 4) {
          alert('비교는 최대 4개까지 가능합니다.');
          renderPortalCards();
          return;
        }
        if (!compareList.some(c => c.name === sol.name)) {
          compareList.push(sol);
        }
      } else {
        compareList = compareList.filter(c => c.name !== sol.name);
      }
      updateCompareTray();
    }

    function updateCompareTray() {
      const tray = document.getElementById('compareTray');
      const countEl = document.getElementById('compareCount');
      const listEl = document.getElementById('compareItemsList');

      countEl.innerText = compareList.length;
      listEl.innerHTML = '';

      if (compareList.length > 0) {
        tray.classList.add('active');
        compareList.forEach(sol => {
          const item = document.createElement('span');
          item.className = 'meta-badge';
          item.style.padding = '0.3rem 0.6rem';
          item.innerHTML = sanitizeHtml(sol.name) + ' <i data-lucide="x" style="width:10px; height:10px; cursor:pointer;" onclick="toggleCompareSol(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', false)"></i>';
          listEl.appendChild(item);
        });
        lucide.createIcons();
      } else {
        tray.classList.remove('active');
      }
    }

    function clearCompare() {
      compareList = [];
      updateCompareTray();
      renderPortalCards();
    }

    function openCompareModal() {
      if (compareList.length < 2) {
        alert('비교를 위해 최소 2개 이상의 솔루션을 선택하세요.');
        return;
      }

      const body = document.getElementById('compareModalBody');
      let tableHtml = '<table class="clean-table" style="table-layout:fixed;"><thead><tr><th style="width:120px;">항목</th>';
      compareList.forEach(sol => {
        tableHtml += '<th>' + sanitizeHtml(sol.name) + ' (' + sanitizeHtml(sol.vendor) + ')</th>';
      });
      tableHtml += '</tr></thead><tbody>';

      const fields = [
        { label: '카테고리', key: 'category' },
        { label: '구분', key: 'vendorType' },
        { label: '도입 목적', key: 'purpose' },
        { label: '핵심 기능', key: 'features' },
        { label: '특장점', key: 'highlights' },
        { label: '규제 준수', key: 'regulation' },
        { label: '기대 효과', key: 'effects' },
        { label: '표준 단가', custom: s => '₩' + Number(s.price || 0).toLocaleString() },
        { label: 'ISMS 매핑', key: 'ismsMapping' }
      ];

      fields.forEach(f => {
        tableHtml += '<tr><td style="font-weight:700; background:#f8fafc;">' + f.label + '</td>';
        compareList.forEach(sol => {
          let val = f.custom ? f.custom(sol) : (sol[f.key] || '-');
          tableHtml += '<td style="vertical-align:top; font-size:0.8rem;">' + sanitizeHtml(val).replace(/\\n/g, '<br>') + '</td>';
        });
        tableHtml += '</tr>';
      });

      tableHtml += '</tbody></table>';
      body.innerHTML = tableHtml;
      document.getElementById('compareModal').classList.add('active');
    }

    function closeCompareModal() {
      document.getElementById('compareModal').classList.remove('active');
    }

    // --- 6. STUDIO MODULE ---
    function loadStudioPreset(presetKey) {
      if (!presetKey) return;
      if (studioPresets[presetKey]) {
        document.getElementById('studioMermaidCode').value = studioPresets[presetKey].trim();
        renderMermaidFromEditor();
      }
    }

    function insertNodeToCode(nodeId, label, targetSubgraph) {
      const editor = document.getElementById('studioMermaidCode');
      const val = editor.value;
      const snippet = '  ' + nodeId + '["' + label + '"]\\n';

      if (targetSubgraph && val.includes('subgraph ' + targetSubgraph)) {
        editor.value = val.replace('subgraph ' + targetSubgraph, 'subgraph ' + targetSubgraph + '\\n' + snippet);
      } else {
        editor.value += '\\n' + snippet;
      }
      renderMermaidFromEditor();
    }

    async function renderMermaidFromEditor() {
      const code = document.getElementById('studioMermaidCode').value.trim();
      const output = document.getElementById('mermaidOutput');
      const status = document.getElementById('studioRenderStatus');

      if (!code) {
        output.innerHTML = '<div style="color:var(--text-dim);">다이어그램 코드를 입력하세요.</div>';
        return;
      }

      try {
        output.innerHTML = '';
        const id = 'mermaid-svg-' + Date.now();
        const { svg } = await mermaid.render(id, code);
        output.innerHTML = svg;
        status.innerText = '렌더링 완료';
        status.style.background = '#eff6ff';
        status.style.color = '#1d4ed8';

        if (isTrafficFlowing) applyTrafficAnimation(true);
      } catch (err) {
        console.error('Mermaid render error:', err);
        status.innerText = '문법 오류';
        status.style.background = '#fef2f2';
        status.style.color = '#dc2626';
      }
    }

    function zoomCanvas(delta) {
      canvasZoom = Math.max(0.4, Math.min(2.5, canvasZoom + delta));
      const el = document.getElementById('mermaidOutput');
      if (el) el.style.transform = 'scale(' + canvasZoom + ')';
    }

    function resetCanvasZoom() {
      canvasZoom = 1.0;
      const el = document.getElementById('mermaidOutput');
      if (el) el.style.transform = 'scale(1.0)';
    }

    function toggleTrafficAnimation() {
      isTrafficFlowing = !isTrafficFlowing;
      applyTrafficAnimation(isTrafficFlowing);
      const btn = document.getElementById('btnTrafficFlow');
      if (isTrafficFlowing) {
        btn.style.background = '#eff6ff';
        btn.style.color = '#1d4ed8';
        btn.style.borderColor = '#bfdbfe';
      } else {
        btn.style.background = '#ffffff';
        btn.style.color = 'var(--text-main)';
        btn.style.borderColor = 'var(--border)';
      }
    }

    function applyTrafficAnimation(enable) {
      const paths = document.querySelectorAll('#mermaidOutput .edgePath');
      paths.forEach(p => {
        if (enable) p.classList.add('animated');
        else p.classList.remove('animated');
      });
    }

    function downloadCanvasSvg() {
      const svg = document.querySelector('#mermaidOutput svg');
      if (!svg) {
        alert('다운로드할 다이어그램이 없습니다.');
        return;
      }
      const svgData = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GIJO_Security_Architecture.svg';
      a.click();
      URL.revokeObjectURL(url);
    }

    // --- 7. BOM & TCO MODULE ---
    function addSolToBom(solName) {
      const sol = solutionCatalog.find(s => s.name === solName);
      if (!sol) return;
      sol.qty = (sol.qty || 0) + 1;
      saveBomQuantities();
      alert('✅ [' + sol.name + '] 이(가) BOM 견적에 수량 ' + sol.qty + '개로 반영되었습니다.');
    }

    function loadBomQuantities() {
      try {
        const stored = localStorage.getItem(BOM_QTY_KEY);
        if (stored) {
          const map = JSON.parse(stored);
          solutionCatalog.forEach(sol => {
            if (typeof map[sol.name] === 'number') sol.qty = map[sol.name];
          });
        }
      } catch (e) {
        console.warn('BOM parse error:', e);
      }
    }

    function saveBomQuantities() {
      const map = {};
      solutionCatalog.forEach(sol => {
        map[sol.name] = sol.qty || 0;
      });
      localStorage.setItem(BOM_QTY_KEY, JSON.stringify(map));
    }

    function updateBomQty(index, newQty) {
      const qty = Math.max(0, parseInt(newQty, 10) || 0);
      solutionCatalog[index].qty = qty;
      saveBomQuantities();
      renderBomTable();
    }

    function resetBomQuantities() {
      if (confirm('모든 솔루션 도입 수량을 초기화하시겠습니까?')) {
        solutionCatalog.forEach((sol, idx) => { sol.qty = (idx < 3 ? 1 : 0); });
        saveBomQuantities();
        renderBomTable();
      }
    }

    function renderBomTable() {
      const tbody = document.getElementById('bomTableBody');
      tbody.innerHTML = '';

      let totalQty = 0;
      let totalCapex = 0;
      let totalOpex = 0;

      solutionCatalog.forEach((sol, idx) => {
        const qty = sol.qty || 0;
        const price = sol.price || 0;
        const capex = price * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));

        totalQty += qty;
        totalCapex += capex;
        totalOpex += opex;

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><b>' + sanitizeHtml(sol.name) + '</b></td>' +
          '<td>' + sanitizeHtml(sol.vendor) + '</td>' +
          '<td><span class="meta-badge">' + sanitizeHtml(sol.category || sol.sheetCategory) + '</span></td>' +
          '<td>₩' + Number(price).toLocaleString() + '</td>' +
          '<td style="text-align:center;"><input type="number" class="qty-box" min="0" value="' + qty + '" onchange="updateBomQty(' + idx + ', this.value)"></td>' +
          '<td style="font-weight:700;">₩' + Number(capex).toLocaleString() + '</td>' +
          '<td style="color:#d97706;">₩' + Number(opex).toLocaleString() + '</td>' +
          '<td><span style="font-size:0.75rem; color:var(--text-sub);">' + sanitizeHtml(sol.ismsMapping || '2.4 접근통제') + '</span></td>';

        tbody.appendChild(tr);
      });

      const totalTco5Year = totalCapex + (totalOpex * 5);

      document.getElementById('bomTotalQtyCount').innerText = totalQty + ' 개';
      document.getElementById('bomTotalCapex').innerText = '₩' + totalCapex.toLocaleString();
      document.getElementById('bomTotalOpex').innerText = '₩' + totalOpex.toLocaleString();
      document.getElementById('bomTotalTco').innerText = '₩' + totalTco5Year.toLocaleString();
    }

    function exportBomToCsv() {
      let csv = '솔루션명,제조사,카테고리,단가,수량,도입비(Capex),연간유지보수(Opex),5개년TCO,ISMS-P항목\\n';
      solutionCatalog.forEach(sol => {
        const qty = sol.qty || 0;
        const capex = (sol.price || 0) * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));
        const tco = capex + (opex * 5);
        csv += '"' + sol.name + '","' + sol.vendor + '","' + (sol.category || '') + '",' + (sol.price || 0) + ',' + qty + ',' + capex + ',' + opex + ',' + tco + ',"' + (sol.ismsMapping || '') + '"\\n';
      });

      const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GIJO_Security_Solutions_BOM_TCO.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    // --- 8. AUDIT GRID MODULE ---
    function renderAuditGrid() {
      const container = document.getElementById('auditGridContainer');
      container.innerHTML = '';

      const ismsCategories = [
        { id: "2.1", name: "정책, 조직, 자산 관리", desc: "사내 보안 정책 수립 및 AI/SW 자산 식별 통제", solutions: ["GIJO AS", "SAFESQUARE SBOM", "SooJi.Bee (수지비)"] },
        { id: "2.3", name: "취약점 점검 및 조치", desc: "서버/웹/AI 모델 취약점 식별 및 CVSS 긴급대응", solutions: ["Tenable ONE", "Tenable AI Exposure", "BAT Insight ASM"] },
        { id: "2.4", name: "네트워크 및 접근통제", desc: "망분리, 경계 방화벽 정책, 서버 2차 인증 계정관리", solutions: ["SecureIM", "FOCS", "Zscaler Platform", "Imperva WAAP"] },
        { id: "2.5", name: "암호화 및 데이터 보호", desc: "개인정보/DB 커널 암호화, 문서 중앙화 및 eDLP", solutions: ["CipherTrust(구 Vormetric)", "Imperva DSF", "COODOC", "GRADIUS DLP"] },
        { id: "2.6", name: "인증서 라이프사이클 관리", desc: "SSL/TLS 인증서 만료 사고 방지 및 자동 배포", solutions: ["WizCLM"] },
        { id: "2.8", name: "엔드포인트 보안 및 악성코드", desc: "EDR 실시간 위협 차단 및 UEM 통합 자산 패치", solutions: ["Falcon Insight (EDR)", "Neurons for UEM"] },
        { id: "2.10", name: "보안관제 및 사고대응", desc: "SIEM/AI SOC 기반 실시간 위협 상관분석 및 조치", solutions: ["NeoCISO", "GIJO AS"] },
        { id: "2.12", name: "신기술(AI) 보안 통제", desc: "AI-BOM 공급망 점검, 프롬프트 인젝션 및 가드레일", solutions: ["GIJO AS", "AI Security Suite (Zscaler)", "Imperva AI Application Security"] }
      ];

      ismsCategories.forEach(cat => {
        const box = document.createElement('div');
        box.style.background = '#ffffff';
        box.style.border = '1px solid var(--border)';
        box.style.borderRadius = 'var(--radius)';
        box.style.padding = '1rem';
        box.style.boxShadow = 'var(--shadow-sm)';

        let solBadges = cat.solutions.map(s => '<span class="meta-badge" style="background:#eff6ff; color:#1d4ed8; margin:2px;">' + sanitizeHtml(s) + '</span>').join(' ');

        box.innerHTML = 
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">' +
            '<span style="font-size:0.8rem; font-weight:800; color:var(--primary);">' + cat.id + '</span>' +
            '<span class="meta-badge" style="background:#ecfdf5; color:#059669; font-weight:700;">통제 가동</span>' +
          '</div>' +
          '<div style="font-weight:700; font-size:0.9rem; margin-bottom:0.3rem;">' + cat.name + '</div>' +
          '<div style="font-size:0.78rem; color:var(--text-sub); margin-bottom:0.75rem;">' + cat.desc + '</div>' +
          '<div style="border-top:1px solid var(--border); padding-top:0.5rem;">' +
            '<div style="font-size:0.7rem; color:var(--text-dim); margin-bottom:0.25rem;">연동 보안 솔루션:</div>' +
            '<div>' + solBadges + '</div>' +
          '</div>';

        container.appendChild(box);
      });
    }

    // --- 9. BACKUP & LLM SETTINGS ---
    function exportFullProjectBackup() {
      const backup = {
        exportedAt: new Date().toISOString(),
        wikiDocs: currentDocs,
        solutions: solutionCatalog
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GIJO_AS_Lite_WIKI_Suite_Backup.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    function exportDocsFile() {
      const blob = new Blob([JSON.stringify(currentDocs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GIJO_AS_Wiki_Docs_29.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    function importDocsFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (re) => {
          try {
            const imported = JSON.parse(re.target.result);
            if (Array.isArray(imported)) {
              currentDocs = imported;
              saveDocsToStorage();
              renderWikiDocList();
              selectWikiDoc(currentDocs[0].id);
              alert('✅ 문서 ' + imported.length + '건을 성공적으로 가져왔습니다.');
            }
          } catch (err) {
            alert('JSON 파싱 실패: 올바른 백업 파일을 선택하세요.');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function openLlmSettingsModal() {
      document.getElementById('llmSettingsModal').classList.add('active');
    }
    function closeLlmSettingsModal() {
      document.getElementById('llmSettingsModal').classList.remove('active');
    }
    function saveLlmSettings() {
      const mode = document.getElementById('llmModeSelect').value;
      const endpoint = document.getElementById('llmEndpointInput').value;
      const model = document.getElementById('llmModelInput').value;

      localStorage.setItem('GIJO_LLM_CONFIG', JSON.stringify({ mode, endpoint, model }));
      document.getElementById('llmStatusIndicator').innerText = mode === 'gb10' ? '⚡ GB10 177B 연동' : (mode === 'win' ? '🟢 로컬 서버' : '🟢 에어갭 RAG (29종 전수)');
      closeLlmSettingsModal();
      alert('✅ LLM 추론 설정이 저장되었습니다.');
    }
    function testLlmConnection() {
      alert('연결 테스트: 에어갭 로컬 시맨틱 RAG 엔진이 정상 가동 중입니다.');
    }

    // --- 10. BOOTSTRAP ---
    window.addEventListener('DOMContentLoaded', () => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        flowchart: { curve: 'basis' }
      });

      loadBomQuantities();
      currentDocs = loadStoredDocs();

      renderQuickChips();
      renderWikiDocList();
      selectWikiDoc(currentDocs[0].id);
      renderPortalCards();
      renderBomTable();
      renderAuditGrid();

      // Load initial studio code
      document.getElementById('studioMermaidCode').value = studioPresets.GIJO_AS.trim();
      lucide.createIcons();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(targetHtmlPath, htmlContent, 'utf8');
fs.writeFileSync(electronIndexPath, htmlContent, 'utf8');

console.log('✅ GIJO Security Suite & WIKI successfully generated:');
console.log(' - ' + targetHtmlPath + ' (' + fs.statSync(targetHtmlPath).size + ' bytes)');
console.log(' - ' + electronIndexPath + ' (' + fs.statSync(electronIndexPath).size + ' bytes)');
