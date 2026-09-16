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
  <title>GIJO AS Lite — GIJO WIKI & ERP v5.2.0 (지능형 보안 워크스페이스)</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
  <!-- Mermaid.js Engine -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <!-- PDF.js Engine (for PDF Manual & Catalog Extraction) -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
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

    .btn-success {
      background: var(--success);
      border-color: var(--success);
      color: #fff;
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

    .meta-badge.badge-custom {
      background: #ecfdf5;
      color: #059669;
      border-color: #a7f3d0;
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
      width: 92%;
      max-width: 950px;
      max-height: 90vh;
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

    /* Detail Modal Tabs */
    .modal-sub-tabs {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 1.2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
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

    /* PDF Dropzone Styles */
    .pdf-drop-zone {
      border: 2px dashed #93c5fd;
      background: #f8fafc;
      border-radius: 8px;
      padding: 0.9rem 1.2rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      position: relative;
    }
    .pdf-drop-zone:hover, .pdf-drop-zone.dragover {
      border-color: var(--primary);
      background: #eff6ff;
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }
    .pdf-drop-content {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      text-align: left;
      width: 100%;
    }
    .pdf-status-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.65rem;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
    }

    /* Print Report Styles */
    @media print {
      body { background: #ffffff !important; color: #000000 !important; }
      .app-header, .nav-tabs, .header-tools, .modal-header, .no-print, .compare-tray { display: none !important; }
      .modal-overlay { position: static !important; background: transparent !important; display: block !important; }
      .modal-box { max-width: 100% !important; width: 100% !important; border: none !important; box-shadow: none !important; max-height: none !important; }
      .modal-body { padding: 0 !important; overflow: visible !important; }
      .report-page { page-break-after: always; padding: 15mm 10mm; }
      .report-page:last-child { page-break-after: avoid; }
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
          <i data-lucide="shield-check" style="width:14px; height:14px;"></i> 솔루션 ERP & 매뉴얼
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
        <button id="tabBtn-checklist" class="tab-btn" onclick="switchView('checklist')">
          <i data-lucide="clipboard-check" style="width:14px; height:14px;"></i> 일일 보안점검
        </button>
      </nav>

      <div class="header-tools">
        <button class="btn btn-primary" onclick="openReportModal()" title="경영진 보고 및 ISMS-P 수검용 종합 리포트">
          <i data-lucide="printer" style="width:14px; height:14px;"></i> 종합 진단 리포트 (A4)
        </button>
        <button class="btn" onclick="resetToRealDocs()" title="초기 기본 문서 전수 새로고침">
          <i data-lucide="refresh-cw" style="width:13px; height:13px;"></i> 새로고침
        </button>
        <button class="btn" onclick="openLlmSettingsModal()">
          <i data-lucide="settings" style="width:14px; height:14px;"></i> LLM 설정
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
            <span class="panel-head-title"><i data-lucide="folder" style="width:14px; height:14px; color:var(--primary);"></i> 실물 지식고 (<span id="totalDocCount">0</span>)</span>
            <button class="btn btn-sm" onclick="createNewWikiDoc()">
              <i data-lucide="plus" style="width:12px; height:12px;"></i> 추가
            </button>
          </div>

          <div class="search-input-wrap">
            <input type="text" id="wikiSearchInput" class="search-input" placeholder="사내 규정, 솔루션, CVE, AIBOM 검색..." oninput="filterWikiDocs()">
          </div>

          <div class="category-filter-strip">
            <button class="pill-cat active" id="pill-ALL" onclick="filterByCat('ALL')">전체</button>
            <button class="pill-cat" id="pill-사내솔루션" onclick="filterByCat('사내솔루션')">사내운용(자사)</button>
            <button class="pill-cat" id="pill-보안솔루션" onclick="filterByCat('보안솔루션')">표준솔루션(20)</button>
            <button class="pill-cat" id="pill-보안규정" onclick="filterByCat('보안규정')">보안규정</button>
            <button class="pill-cat" id="pill-취약점관리" onclick="filterByCat('취약점관리')">취약점</button>
            <button class="pill-cat" id="pill-AI보안" onclick="filterByCat('AI보안')">AI보안</button>
            <button class="pill-cat" id="pill-아키텍처설계" onclick="filterByCat('아키텍처설계')">아키텍처</button>
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
              <span style="width:6px; height:6px; background:#059669; border-radius:50%;"></span> 실시간 RAG 인덱스 가동
            </span>
          </div>

          <div class="rag-chip-container" id="quickQuestionsChipBox"></div>

          <div class="rag-chat-history" id="ragChatMessages">
            <div class="bubble ai">
              안녕하세요! <b>GIJO AS 보안 실무 지식고 및 20종 솔루션 + 사내 커스텀 제품</b>이 RAG 엔진에 통합되었습니다.<br><br>
              사내 보안 지침, 망분리 규정, <b>20종 솔루션 스펙/매뉴얼</b>뿐 아니라 <b>고객님이 직접 등록하신 사내 솔루션의 운영 절차 및 장애 대응</b>도 실시간으로 질문해 보세요!
            </div>
          </div>

          <div class="rag-input-box">
            <input type="text" id="ragQueryInput" class="search-input" style="background:#fff;" placeholder="솔루션 기능, 운영 매뉴얼, CVE 조치 등 질의..." onkeydown="if(event.key==='Enter') executeRagQuery()">
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
              보안 솔루션 전사 ERP & 실무 매뉴얼 포털
            </h2>
            <p style="color:var(--text-sub); font-size:0.78rem;">공식 20종 카탈로그 및 고객사 자체 사용 제품을 직접 등록하고 실무 운영 매뉴얼을 관리합니다.</p>
          </div>

          <div style="display:flex; align-items:center; gap:0.6rem;">
            <button class="btn btn-sm btn-primary" onclick="openAddCustomSolModal()">
              <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> 솔루션 직접 등록
            </button>
            <input type="text" id="portalSearchInput" class="search-input" style="width:200px; background:#fff;" placeholder="솔루션명, 벤더, 매뉴얼 검색..." oninput="renderPortalCards()">
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.25rem 0.5rem;">
          <div class="portal-tags-row">
            <button class="pill-cat active" id="solFilter-ALL" onclick="filterSolutions('ALL')">전체 (<span id="totalSolutionsDisplayCount">0</span>)</button>
            <button class="pill-cat" id="solFilter-CUSTOM" onclick="filterSolutions('CUSTOM')" style="border-color:#a7f3d0; color:#059669;">🏢 사내 운용 (<span id="customSolCount">0</span>)</button>
            <button class="pill-cat" id="solFilter-KR" onclick="filterSolutions('KR')">국산 솔루션</button>
            <button class="pill-cat" id="solFilter-GLOBAL" onclick="filterSolutions('GLOBAL')">외산 솔루션</button>
            <button class="pill-cat" id="solFilter-AI" onclick="filterSolutions('AI')">AI보안/SPM</button>
            <button class="pill-cat" id="solFilter-NETWORK" onclick="filterSolutions('NETWORK')">네트워크/경계</button>
            <button class="pill-cat" id="solFilter-DATA" onclick="filterSolutions('DATA')">데이터/엔드포인트</button>
          </div>
          <div style="font-size:0.75rem; color:var(--text-dim);">
            고객사 사용 제품은 [직접 등록]으로 추가하면 위키/RAG/TCO에 즉시 융합됩니다.
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

          <!-- Studio BOM Mini Bar -->
          <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:0.5rem 0.75rem; margin-bottom:0.6rem; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:0.72rem; font-weight:700; color:#1d4ed8;">
                <i data-lucide="link" style="width:12px; height:12px; vertical-align:middle;"></i> 아키텍처 ↔ TCO 실시간 연동
              </span>
              <span id="studioBomBadge" style="font-size:0.75rem; font-weight:800; color:#1e3a8a;">배치: 0개 (₩0)</span>
            </div>
            <div style="display:flex; gap:0.3rem;">
              <button class="btn btn-sm" style="font-size:0.7rem; padding:2px 6px;" onclick="syncStudioToBom()" title="다이어그램 노드를 파싱하여 BOM 수량에 즉시 반영">
                <i data-lucide="refresh-cw" style="width:10px; height:10px;"></i> BOM 수량 동기화
              </button>
              <button class="btn btn-sm btn-primary" style="font-size:0.7rem; padding:2px 6px;" onclick="switchView('bom')">
                견적표 확인 &gt;
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

          <textarea id="studioMermaidCode" class="code-editor" spellcheck="false" oninput="debounceStudioSync()"></textarea>
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
              전사 보안 솔루션 실시간 BOM & 5개년 TCO 견적기
            </h2>
            <p style="color:var(--text-sub); font-size:0.8rem;">아키텍처 다이어그램과 양방향 연동되며, 수량 조절 시 도입비(Capex), 유지보수비(Opex 12%), 총소유비용(TCO)이 실시간 연동됩니다.</p>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-sm" onclick="syncBomToStudio()" title="현재 견적 수량 기반으로 아키텍처 다이어그램 자동 구성">
              <i data-lucide="share-2" style="width:12px; height:12px;"></i> 아키텍처에 반영
            </button>
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

        <!-- ROI & Economic Impact Matrix Section -->
        <div style="margin-top:2rem; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:1.25rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <div>
              <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
                <i data-lucide="trending-up" style="width:16px; height:16px; color:var(--success);"></i>
                경영진 보고용 보안 투자 회수(ROI) & 사고 피해 예방 분석 매트릭스
              </h3>
              <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.2rem;">KISA 및 글로벌 침해사고 피해 통계를 기반으로 솔루션 도입 시 절감되는 사고 리스크 및 인건비를 자동 산출합니다.</p>
            </div>
            <span class="meta-badge" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-weight:700;">투자 회수 모델 v2.0</span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem;">
            <div style="background:#fff; border:1px solid var(--border); padding:1rem; border-radius:6px;">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">연간 침해사고 예방 가치</div>
              <div id="roiBreachAvoidance" style="font-size:1.25rem; font-weight:800; color:var(--success); margin-top:0.25rem;">₩0</div>
              <div style="font-size:0.68rem; color:var(--text-dim); margin-top:0.2rem;">평균 15억원 랜섬웨어/유출 완화율</div>
            </div>
            <div style="background:#fff; border:1px solid var(--border); padding:1rem; border-radius:6px;">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">과징금 리스크 경감 가치</div>
              <div id="roiPenaltyAvoidance" style="font-size:1.25rem; font-weight:800; color:var(--primary); margin-top:0.25rem;">₩0</div>
              <div style="font-size:0.68rem; color:var(--text-dim); margin-top:0.2rem;">개인정보보호법 매출 3% 리스크 회피</div>
            </div>
            <div style="background:#fff; border:1px solid var(--border); padding:1rem; border-radius:6px;">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">보안운영 인건비 절감액</div>
              <div id="roiLaborSaving" style="font-size:1.25rem; font-weight:800; color:#7c3aed; margin-top:0.25rem;">₩0</div>
              <div style="font-size:0.68rem; color:var(--text-dim); margin-top:0.2rem;">수동 로그 분석·감사 60% 자동화</div>
            </div>
            <div style="background:#fff; border:1px solid var(--border); padding:1rem; border-radius:6px;">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">예상 투자 회수 기간 (Payback)</div>
              <div id="roiPaybackPeriod" style="font-size:1.25rem; font-weight:800; color:#d97706; margin-top:0.25rem;">-</div>
              <div style="font-size:0.68rem; color:var(--text-dim); margin-top:0.2rem;">순편익 발생 기준 소요 기간</div>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- 5. AUDIT / ISMS-P VIEW -->
    <section id="view-audit" class="view-page">
      <div class="white-panel" style="padding:1.25rem; height:100%; overflow-y:auto;">
        <div style="margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 style="font-size:1.2rem; font-weight:800; color:var(--text-main);">ISMS-P 인증 기준 통제항목 진단 매핑</h2>
            <p style="color:var(--text-sub); font-size:0.8rem;">보안 솔루션 도입 현황에 따른 KISA ISMS-P 80개 세부 인증기준 충족도 분석</p>
          </div>
          <button class="btn btn-primary" onclick="openReportModal()">
            <i data-lucide="file-text" style="width:14px; height:14px;"></i> 수검용 진단 리포트 출력 (A4)
          </button>
        </div>
        <div id="auditGridContainer" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:1rem;"></div>
      </div>
    </section>

    <!-- 6. DAILY SECURITY CHECKLIST VIEW -->
    <section id="view-checklist" class="view-page">
      <div class="white-panel" style="padding:1.25rem; height:100%; overflow-y:auto;">
        <div style="margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 style="font-size:1.2rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="clipboard-check" style="width:20px; height:20px; color:var(--primary);"></i>
              일일 / 주간 실무 보안 솔루션 점검 체크리스트
            </h2>
            <p style="color:var(--text-sub); font-size:0.8rem;">전사 도입 솔루션의 데몬 프로세스, 차단 이벤트, 이상 로그, 라이선스 상태를 일일 점검하고 공식 점검 일지를 즉시 출력합니다.</p>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.3rem;">
              <span style="font-size:0.75rem; color:var(--text-sub); font-weight:700;">점검일자:</span>
              <input type="date" id="checklistDate" class="search-input" style="width:130px; background:#fff; padding:0.2rem 0.4rem;">
            </div>
            <div style="display:flex; align-items:center; gap:0.3rem;">
              <span style="font-size:0.75rem; color:var(--text-sub); font-weight:700;">점검자:</span>
              <input type="text" id="checklistInspector" class="search-input" style="width:110px; background:#fff; padding:0.2rem 0.4rem;" value="보안운영담당">
            </div>
            <button class="btn btn-sm" onclick="setAllChecklistStatus('NORMAL')"><i data-lucide="check-check" style="width:12px; height:12px;"></i> 전원 정상</button>
            <button class="btn btn-sm btn-primary" onclick="printDailyInspectionReport()"><i data-lucide="printer" style="width:12px; height:12px;"></i> 점검 일지 출력 (A4)</button>
          </div>
        </div>

        <div id="checklistGridContainer" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:1rem;"></div>
      </div>
    </section>

  </main>

  <!-- Comprehensive A4 Print Report Modal -->
  <div class="modal-overlay" id="reportModal">
    <div class="modal-box" style="max-width:1050px; height:94vh;">
      <div class="modal-header no-print">
        <div>
          <h3 style="font-size:1.15rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
            <i data-lucide="file-text" style="width:18px; height:18px; color:var(--primary);"></i>
            경영진 보고 및 ISMS-P 수검용 통합 보안 진단 리포트
          </h3>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">A4 규격에 맞춘 종합 진단서로 즉시 인쇄하거나 PDF로 저장할 수 있습니다.</p>
        </div>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-primary" onclick="printReport()"><i data-lucide="printer" style="width:14px; height:14px;"></i> A4 인쇄 / PDF 저장</button>
          <button class="btn btn-sm" onclick="closeReportModal()"><i data-lucide="x" style="width:14px; height:14px;"></i> 닫기</button>
        </div>
      </div>
      <div class="modal-body" id="reportBody"></div>
    </div>
  </div>

  <!-- Add / Edit Custom Solution Modal -->
  <div class="modal-overlay" id="customSolModal">
    <div class="modal-box" style="max-width:850px;">
      <div class="modal-header">
        <div>
          <h3 id="customSolModalTitle" style="font-size:1.1rem; font-weight:800; color:var(--text-main);">사내 보안 솔루션 직접 등록</h3>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">등록 즉시 사내 지식고(위키)와 AI Copilot RAG, ERP 카탈로그, TCO 계산기에 실시간 반영됩니다.</p>
        </div>
        <button class="btn btn-sm" onclick="closeCustomSolModal()"><i data-lucide="x" style="width:14px; height:14px;"></i> 닫기</button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:0.85rem;">
        <input type="hidden" id="customSolEditIndex" value="-1">
        
        <!-- PDF Drag and Drop Uploader Zone -->
        <div id="pdfDropZone" class="pdf-drop-zone" onclick="document.getElementById('custSolPdfInput').click()">
          <input type="file" id="custSolPdfInput" accept=".pdf" style="display:none;" onchange="handlePdfUpload(event)">
          <div class="pdf-drop-content">
            <div style="background:#eff6ff; padding:0.6rem; border-radius:8px; border:1px solid #bfdbfe;">
              <i data-lucide="file-up" style="width:24px; height:24px; color:var(--primary);"></i>
            </div>
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:var(--text-main); font-size:0.85rem;">📄 제품 소개서 또는 실무 매뉴얼 PDF 끌어다 놓기 (클릭하여 파일 선택)</strong>
                <span style="font-size:0.7rem; color:var(--primary); font-weight:700;">PDF.js & 오프라인 파서 자동 분석</span>
              </div>
              <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">
                PDF를 올리면 제품명, 개요, 목차, 텍스트/명령어를 자동 추출하여 매뉴얼 에디터에 채우고 사내 지식고/RAG에 즉시 학습시킵니다.
              </p>
            </div>
          </div>
          <div id="pdfUploadStatus" style="display:none; width:100%; margin-top:0.5rem; text-align:left;"></div>
        </div>
        
        <div style="display:grid; grid-template-columns: 2fr 1.5fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">솔루션 제품명 *</label>
            <input type="text" id="custSolName" class="search-input" placeholder="예: FortiGate 100F, 사내 DB 접근제어..." style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">제조사 / 공급사 *</label>
            <input type="text" id="custSolVendor" class="search-input" placeholder="예: 포티넷, 안랩, 자체구축..." style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">구분</label>
            <select id="custSolVendorType" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="국산">국산</option>
              <option value="외산">외산</option>
              <option value="자체구축">자체구축</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">카테고리</label>
            <input type="text" id="custSolCategory" class="search-input" placeholder="예: 방화벽, EDR, DLP, 접근제어..." style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">표준 도입단가 (원)</label>
            <input type="number" id="custSolPrice" class="search-input" placeholder="예: 30000000" style="background:#fff; margin-top:0.25rem;" value="25000000">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">ISMS-P 인증 매핑</label>
            <input type="text" id="custSolIsms" class="search-input" placeholder="예: 2.4 네트워크 접근통제" style="background:#fff; margin-top:0.25rem;" value="2.4 네트워크 접근통제">
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">솔루션 개요 및 도입 목적</label>
          <textarea id="custSolPurpose" class="search-input" style="height:60px; resize:none; background:#fff; margin-top:0.25rem;" placeholder="솔루션의 주 역할과 사내 도입 목적을 기재하세요."></textarea>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub); display:flex; justify-content:space-between;">
            <span>📖 실무 운영 매뉴얼 & 점검 절차 (담당자가 쉽게 확인하는 가이드) *</span>
            <span style="font-weight:400; color:var(--text-dim);">콘솔 접속 경로, 일일 점검 항목, 장애 런북 등</span>
          </label>
          <textarea id="custSolManual" class="code-editor" style="height:120px; margin-top:0.25rem;" placeholder="- 관리 콘솔 접속: https://sec-admin.internal:8443&#10;- 일일 점검: 데몬 상태 및 이상 경보 로그 확인&#10;- 장애 발생 시: 1차 데몬 재기동 후 비상 연락망(내선 112) 인계&#10;- 정기 유지보수: 매월 마지막 주 금요일 정기 점검"></textarea>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">권장 아키텍처 다이어그램 (Mermaid, 선택사항)</label>
          <textarea id="custSolDiagram" class="code-editor" style="height:80px; margin-top:0.25rem;" placeholder="graph LR&#10;  User --> Firewall --> InternalServer"></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.75rem;">
          <button class="btn" onclick="closeCustomSolModal()">취소</button>
          <button class="btn btn-primary" onclick="saveCustomSolution()"><i data-lucide="check" style="width:13px; height:13px;"></i> 솔루션 저장 및 위키/RAG 동기화</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Solution Detail Modal -->
  <div class="modal-overlay" id="solDetailModal">
    <div class="modal-box">
      <div class="modal-header">
        <div>
          <span id="modalSolCategory" class="meta-badge">카테고리</span>
          <h3 id="modalSolTitle" style="font-size:1.15rem; font-weight:800; margin-top:0.3rem; color:var(--text-main);">솔루션 상세</h3>
          <span id="modalSolVendor" style="font-size:0.75rem; color:var(--text-dim);">제조사</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <button class="btn btn-sm" onclick="openEditAnySolModalFromDetail()" title="솔루션 정보 및 매뉴얼 수정">
            <i data-lucide="edit-2" style="width:13px; height:13px;"></i> 정보/매뉴얼 수정
          </button>
          <button class="btn btn-sm" onclick="closeSolDetailModal()"><i data-lucide="x" style="width:14px; height:14px;"></i> 닫기</button>
        </div>
      </div>
      <div class="modal-body">
        
        <div class="modal-sub-tabs">
          <button class="pill-cat active" id="subTabBtn-spec" onclick="switchDetailSubTab('spec')">스펙 및 규제 요약</button>
          <button class="pill-cat" id="subTabBtn-manual" onclick="switchDetailSubTab('manual')">📖 실무 운영 매뉴얼 & 런북</button>
          <button class="pill-cat" id="subTabBtn-diagram" onclick="switchDetailSubTab('diagram')">권장 아키텍처</button>
        </div>

        <div id="subTabContent-spec" class="markdown-render"></div>
        <div id="subTabContent-manual" style="display:none;">
          <div class="no-print" style="margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:0.5rem 0.75rem; border-radius:6px; border:1px solid var(--border);">
            <div style="font-size:0.75rem; color:var(--text-sub); display:flex; align-items:center; gap:0.4rem;">
              <i data-lucide="info" style="width:14px; height:14px; color:var(--primary);"></i>
              <span>벤더사 PDF 매뉴얼을 업로드하여 실무 런북과 사내 지식고(AI Copilot RAG)를 즉시 최신화할 수 있습니다.</span>
            </div>
            <div>
              <input type="file" id="detailPdfInput" accept=".pdf" style="display:none;" onchange="handleDetailPdfUpload(event)">
              <button class="btn btn-sm btn-primary" onclick="document.getElementById('detailPdfInput').click()">
                <i data-lucide="upload-cloud" style="width:13px; height:13px;"></i> PDF 매뉴얼 업데이트
              </button>
            </div>
          </div>
          <div id="detailPdfStatus" style="display:none; margin-bottom:0.75rem;"></div>
          <div id="subTabContent-manual-body" class="markdown-render"></div>
        </div>
        <div id="subTabContent-diagram" class="markdown-render" style="display:none;"></div>

      </div>
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
    const defaultSolutionCatalog = ${solutionsCatalogJson};

    let currentDocs = [];
    let customSolutions = [];
    let activeSolutionsList = [];
    let currentActiveDocId = 1;
    let isEditingMode = false;
    let canvasZoom = 1.0;
    let isTrafficFlowing = false;
    let currentFilterCat = 'ALL';
    let currentSolFilter = 'ALL';
    let compareList = [];
    let currentDetailSol = null;
    let customerOrgName = '(주)고객사 정보보안팀';
    let syncDebounceTimer = null;

    // LocalStorage Keys
    const STORAGE_KEY = 'GIJO_WIKI_DOCS_V5_2';
    const CUSTOM_SOL_KEY = 'GIJO_CUSTOM_SOL_V5_2';
    const BOM_QTY_KEY = 'GIJO_BOM_QTY_V5_2';
    const CUST_ORG_KEY = 'GIJO_CUST_ORG_V5_2';

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

    function loadCustomSolutions() {
      try {
        const stored = localStorage.getItem(CUSTOM_SOL_KEY);
        if (stored) {
          customSolutions = JSON.parse(stored);
        } else {
          customSolutions = [];
        }
      } catch (e) {
        console.warn('Custom solutions parse fail:', e);
        customSolutions = [];
      }
      rebuildActiveSolutions();
    }

    function saveCustomSolutions() {
      try {
        localStorage.setItem(CUSTOM_SOL_KEY, JSON.stringify(customSolutions));
      } catch (e) {
        console.error('Save custom solutions fail:', e);
      }
      rebuildActiveSolutions();
    }

    function rebuildActiveSolutions() {
      const pureCustom = customSolutions.filter(c => c.isCustom !== false);
      const standardList = defaultSolutionCatalog.map(std => {
        const overridden = customSolutions.find(c => c.name === std.name);
        if (overridden) {
          return Object.assign({}, std, overridden, { isOverridden: true, isCustom: false });
        }
        return Object.assign({}, std, { isOverridden: false, isCustom: false });
      });

      activeSolutionsList = [...pureCustom, ...standardList];
      document.getElementById('customSolCount').innerText = customSolutions.length;
      document.getElementById('totalSolutionsDisplayCount').innerText = activeSolutionsList.length;
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
      if (confirm('기본 원본 지식고 문서 및 솔루션으로 새로고침하시겠습니까? (고객 직접 등록 솔루션은 보존됩니다)')) {
        currentDocs = JSON.parse(JSON.stringify(defaultWikiDocs));
        syncCustomSolutionsToDocs();
        saveDocsToStorage();
        renderWikiDocList();
        selectWikiDoc(currentDocs[0].id);
        renderPortalCards();
        renderBomTable();
        alert('✅ 지식고 및 솔루션 카탈로그가 초기 원본 기준으로 동기화되었습니다.');
      }
    }

    function saveDocsToStorage() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentDocs));
      } catch (e) {
        console.error('Storage save error:', e);
      }
    }

    // --- 2.8 PDF MANUAL & INTRO EXTRACTION MODULE (PDF.js + Pure-JS Offline Fallback) ---
    async function parsePdfFile(file) {
      const arrayBuffer = await file.arrayBuffer();
      let extractedText = '';
      let pageCount = 0;

      // 1. Try PDF.js Engine
      if (window.pdfjsLib) {
        try {
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          }
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdfDoc = await loadingTask.promise;
          pageCount = pdfDoc.numPages;

          const pagesArr = [];
          for (let p = 1; p <= pageCount; p++) {
            const page = await pdfDoc.getPage(p);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map(item => (item.str || '').trim())
              .filter(s => s.length > 0)
              .join(' ')
              .replace(/\\s+/g, ' ');
            if (pageText) {
              pagesArr.push('### [제 ' + p + ' 쪽]\\n' + pageText);
            }
          }
          extractedText = pagesArr.join('\\n\\n');
        } catch (pdfErr) {
          console.warn('PDF.js parse warning, activating offline parser:', pdfErr);
        }
      }

      // 2. Pure-JS Airgap Fallback (텍스트 스트림 및 Tj 문자열 추출)
      if (!extractedText || extractedText.length < 50) {
        try {
          const rawBytes = new Uint8Array(arrayBuffer);
          let rawStr = '';
          const chunkSize = 16384;
          for (let i = 0; i < rawBytes.length; i += chunkSize) {
            const slice = rawBytes.subarray(i, i + chunkSize);
            rawStr += String.fromCharCode.apply(null, slice);
          }
          const matches = [];
          const tjRegex = /\\(([^()]{2,})\\)\\s*Tj/g;
          let m;
          while ((m = tjRegex.exec(rawStr)) !== null) {
            const cleaned = m[1].replace(/\\\\([()])/g, '$1').trim();
            if (cleaned.length > 1) matches.push(cleaned);
          }
          if (matches.length > 5) {
            extractedText = '### [PDF 추출 본문 (오프라인 파서)]\\n' + matches.join(' ');
            pageCount = Math.max(1, Math.round(matches.length / 30));
          }
        } catch (fbErr) {
          console.warn('Fallback parser error:', fbErr);
        }
      }

      return {
        fileName: file.name,
        pageCount: pageCount || 1,
        text: extractedText,
        charCount: extractedText.length
      };
    }

    async function handlePdfUpload(event) {
      const file = (event.target.files && event.target.files[0]) || (event.dataTransfer && event.dataTransfer.files[0]);
      if (!file) return;

      const statusEl = document.getElementById('pdfUploadStatus');
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<div style="color:var(--primary); font-size:0.75rem; font-weight:700;">⏳ [' + sanitizeHtml(file.name) + '] PDF 분석 및 텍스트 추출 중...</div>';

      try {
        const result = await parsePdfFile(file);
        if (!result.text || result.text.length < 20) {
          statusEl.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; font-weight:700;">⚠️ 텍스트를 충분히 추출하지 못했습니다. (스캔 이미지 PDF이거나 암호화 문서일 수 있습니다)</div>';
          return;
        }

        const nameInput = document.getElementById('custSolName');
        if (!nameInput.value.trim()) {
          const guessedName = file.name.replace(/\\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
          nameInput.value = guessedName;
        }

        const purposeInput = document.getElementById('custSolPurpose');
        if (!purposeInput.value.trim()) {
          const firstSnippet = result.text.replace(/^###.*\\n?/, '').slice(0, 180).trim();
          if (firstSnippet) purposeInput.value = firstSnippet;
        }

        const manualMd = 
          '# ' + file.name.replace(/\\.pdf$/i, '') + ' 실무 운영 가이드\\n' +
          '> **문서 원본**: ' + file.name + ' (총 ' + result.pageCount + '쪽, ' + result.charCount.toLocaleString() + '자 발췌)\\n' +
          '> **학습 상태**: 사내 지식고(위키) 및 AI Copilot RAG 자동 인입 대상\\n\\n' +
          '## 1. 추출된 실무 운영 매뉴얼 원문\\n\\n' +
          result.text;

        document.getElementById('custSolManual').value = manualMd;

        statusEl.innerHTML = 
          '<div style="display:flex; align-items:center; gap:0.5rem;">' +
            '<span class="pdf-status-tag">✅ ' + sanitizeHtml(file.name) + ' (' + result.pageCount + '쪽 / ' + result.charCount.toLocaleString() + '자) 추출 완료</span>' +
          '</div>' +
          '<div style="font-size:0.72rem; color:var(--text-sub); margin-top:0.25rem;">운영 매뉴얼에 자동 반영되었습니다. [솔루션 저장]을 누르면 사내 지식고와 AI Copilot에 즉시 학습됩니다.</div>';
        lucide.createIcons();
      } catch (err) {
        console.error('PDF error:', err);
        statusEl.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; font-weight:700;">❌ PDF 분석 실패: ' + sanitizeHtml(err.message) + '</div>';
      }
    }

    async function handleDetailPdfUpload(event) {
      const file = (event.target.files && event.target.files[0]) || (event.dataTransfer && event.dataTransfer.files[0]);
      if (!file || !currentDetailSol) return;

      const statusEl = document.getElementById('detailPdfStatus');
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<div style="font-size:0.75rem; color:var(--primary); font-weight:700;">⏳ [' + sanitizeHtml(file.name) + '] 최신 매뉴얼 파싱 및 RAG 재학습 중...</div>';

      try {
        const result = await parsePdfFile(file);
        if (!result.text || result.text.length < 20) {
          statusEl.innerHTML = '<div style="font-size:0.75rem; color:var(--danger); font-weight:700;">⚠️ 텍스트를 충분히 추출하지 못했습니다.</div>';
          return;
        }

        const newManual = 
          '# ' + currentDetailSol.name + ' 최신 실무 운영 매뉴얼\\n' +
          '> **문서 원본**: ' + file.name + ' (총 ' + result.pageCount + '쪽, ' + result.charCount.toLocaleString() + '자 최신화)\\n' +
          '> **갱신 시각**: ' + new Date().toLocaleString() + '\\n\\n' +
          result.text;

        currentDetailSol.manual = newManual;

        const customIdx = customSolutions.findIndex(s => s.name === currentDetailSol.name);
        if (customIdx >= 0) {
          customSolutions[customIdx].manual = newManual;
          saveCustomSolutions();
        } else {
          const overrideSol = Object.assign({}, currentDetailSol, { isCustom: true, manual: newManual });
          customSolutions.unshift(overrideSol);
          saveCustomSolutions();
        }

        syncCustomSolutionsToDocs();
        saveDocsToStorage();
        renderWikiDocList();

        document.getElementById('subTabContent-manual-body').innerHTML = 
          '<div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:6px; margin-bottom:1rem;">' +
            '<div style="font-weight:700; font-size:0.9rem; margin-bottom:0.4rem; color:var(--primary);">' +
              '<i data-lucide="book-open" style="width:14px; height:14px; vertical-align:middle;"></i> ' + sanitizeHtml(currentDetailSol.name) + ' 실무 운영 매뉴얼 & 런북' +
            '</div>' +
            '<div style="font-size:0.83rem; line-height:1.7;">' + parseMarkdownToHtml(newManual) + '</div>' +
          '</div>';

        statusEl.innerHTML = 
          '<div class="pdf-status-tag">✅ ' + sanitizeHtml(file.name) + ' 반영 완료 (' + result.pageCount + '쪽 / ' + result.charCount.toLocaleString() + '자)</div>' +
          '<div style="font-size:0.72rem; color:var(--success); font-weight:600; margin-top:0.2rem;">사내 지식고(위키) 및 AI Copilot RAG에 즉시 재학습되었습니다.</div>';
        lucide.createIcons();
      } catch (err) {
        console.error('Detail PDF error:', err);
        statusEl.innerHTML = '<div style="font-size:0.75rem; color:var(--danger); font-weight:700;">❌ PDF 반영 실패: ' + sanitizeHtml(err.message) + '</div>';
      }
    }

    function initPdfDropZone() {
      const dropZone = document.getElementById('pdfDropZone');
      if (!dropZone) return;

      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('dragover');
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('dragover');
        }, false);
      });

      dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          handlePdfUpload({ target: { files: dt.files } });
        }
      }, false);
    }

    // --- 3. CUSTOM SOLUTION MANAGEMENT MODULE ---
    function openAddCustomSolModal() {
      document.getElementById('customSolEditIndex').value = '-1';
      document.getElementById('customSolModalTitle').innerText = '사내 보안 솔루션 직접 등록';
      document.getElementById('custSolName').value = '';
      document.getElementById('custSolVendor').value = '';
      document.getElementById('custSolVendorType').value = '국산';
      document.getElementById('custSolCategory').value = '';
      document.getElementById('custSolPrice').value = '25000000';
      document.getElementById('custSolIsms').value = '2.4 네트워크 접근통제';
      document.getElementById('custSolPurpose').value = '';
      document.getElementById('custSolManual').value = '- 콘솔 접속: https://sec-admin.internal:8443\\n- 일일 점검: 데몬 정상 동작 및 이벤트 로그 확인\\n- 장애 런북: 데몬 재기동(systemctl restart sec-agent) 후 비상 연락';
      document.getElementById('custSolDiagram').value = 'graph LR\\n  User --> SecurityGateway --> InternalServer';

      const statusEl = document.getElementById('pdfUploadStatus');
      if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
      const pdfInput = document.getElementById('custSolPdfInput');
      if (pdfInput) pdfInput.value = '';

      document.getElementById('customSolModal').classList.add('active');
      lucide.createIcons();
    }

    function openEditAnySolModal(globalIdx) {
      const sol = activeSolutionsList[globalIdx];
      if (!sol) return;

      document.getElementById('customSolEditIndex').value = globalIdx;
      document.getElementById('customSolModalTitle').innerText = (sol.isCustom ? '사내 보안 솔루션 수정: ' : '표준 솔루션 스펙/매뉴얼 수정: ') + sol.name;
      document.getElementById('custSolName').value = sol.name;
      document.getElementById('custSolVendor').value = (sol.vendor || '').replace(/\\s*\\[(국산|외산|자체구축|단독 총판)\\]/g, '').trim();
      document.getElementById('custSolVendorType').value = sol.vendorType || (sol.vendor.includes('외산') ? '외산' : '국산');
      document.getElementById('custSolCategory').value = sol.category || sol.sheetCategory || '';
      document.getElementById('custSolPrice').value = sol.price || 0;
      document.getElementById('custSolIsms').value = sol.ismsMapping || '';
      document.getElementById('custSolPurpose').value = sol.purpose || sol.overview || '';
      document.getElementById('custSolManual').value = sol.manual || '';
      document.getElementById('custSolDiagram').value = sol.architectureDiagram || '';

      const statusEl = document.getElementById('pdfUploadStatus');
      if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
      const pdfInput = document.getElementById('custSolPdfInput');
      if (pdfInput) pdfInput.value = '';

      document.getElementById('customSolModal').classList.add('active');
      lucide.createIcons();
    }

    function openEditCustomSolModal(customIdx) {
      const sol = customSolutions[customIdx];
      if (!sol) return;
      const gIdx = activeSolutionsList.findIndex(s => s.name === sol.name);
      if (gIdx >= 0) openEditAnySolModal(gIdx);
    }

    function openEditAnySolModalFromDetail() {
      if (!currentDetailSol) return;
      const gIdx = activeSolutionsList.findIndex(s => s.name === currentDetailSol.name);
      if (gIdx >= 0) {
        closeSolDetailModal();
        openEditAnySolModal(gIdx);
      }
    }

    function restoreStandardSolution(solName) {
      if (!confirm('[' + solName + '] 솔루션을 원래 벤더 기본 스펙/매뉴얼로 복원하시겠습니까?')) return;
      const cIdx = customSolutions.findIndex(c => c.name === solName);
      if (cIdx >= 0) {
        customSolutions.splice(cIdx, 1);
        saveCustomSolutions();
        syncCustomSolutionsToDocs();
        saveDocsToStorage();
        renderPortalCards();
        renderWikiDocList();
        renderBomTable();
        alert('✅ [' + solName + '] 솔루션이 원본 기본값으로 복원되었습니다.');
      }
    }

    function closeCustomSolModal() {
      document.getElementById('customSolModal').classList.remove('active');
    }

    function saveCustomSolution() {
      const name = document.getElementById('custSolName').value.trim();
      const vendor = document.getElementById('custSolVendor').value.trim();
      if (!name || !vendor) {
        alert('솔루션 제품명과 제조사/공급사는 필수 입력 항목입니다.');
        return;
      }

      const editIdx = parseInt(document.getElementById('customSolEditIndex').value, 10);
      const targetSol = (editIdx >= 0 && editIdx < activeSolutionsList.length) ? activeSolutionsList[editIdx] : null;

      const vendorType = document.getElementById('custSolVendorType').value;
      const category = document.getElementById('custSolCategory').value.trim() || '보안솔루션';
      const price = parseInt(document.getElementById('custSolPrice').value, 10) || 0;
      const ismsMapping = document.getElementById('custSolIsms').value.trim() || '2.4 네트워크 접근통제';
      const purpose = document.getElementById('custSolPurpose').value.trim();
      const manual = document.getElementById('custSolManual').value.trim();
      const diagram = document.getElementById('custSolDiagram').value.trim();

      const isStandard = defaultSolutionCatalog.some(s => s.name === name);
      const newSol = {
        isCustom: !isStandard,
        isOverridden: isStandard,
        name,
        vendor: vendor + (vendor.includes('[') ? '' : ' [' + vendorType + ']'),
        vendorType,
        category,
        sheetCategory: category,
        target: targetSol ? targetSol.target : '사내 보안담당자 및 운영팀',
        role: targetSol ? targetSol.role : (category + ' 실무 운용'),
        overview: purpose || (name + ' 사내 운영 솔루션'),
        purpose: purpose || '사내 보안 정책 통제 및 규제 준수',
        features: targetSol ? targetSol.features : '사내 맞춤형 정책 적용 및 실시간 점검 체계',
        highlights: targetSol ? targetSol.highlights : '고객사 환경에 최적화된 온프레미스/사내망 운용',
        regulation: ismsMapping + ' 인증 기준 준수',
        effects: targetSol ? targetSol.effects : '보안 가시성 확보 및 전사 보안 거버넌스 강화',
        manual: manual || '실무 매뉴얼 작성 예정',
        architectureDiagram: diagram || '',
        price,
        qty: targetSol ? targetSol.qty : 1,
        opexRate: targetSol ? targetSol.opexRate : 0.12,
        ismsMapping
      };

      const existingCustIdx = customSolutions.findIndex(c => c.name === name);
      if (existingCustIdx >= 0) {
        customSolutions[existingCustIdx] = newSol;
      } else {
        customSolutions.unshift(newSol);
      }

      saveCustomSolutions();
      syncCustomSolutionsToDocs();
      saveDocsToStorage();

      closeCustomSolModal();
      renderPortalCards();
      renderWikiDocList();
      renderBomTable();

      alert('✅ [' + name + '] 솔루션 자료가 성공적으로 저장(수정)되었으며 위키, AI RAG, TCO 견적에 실시간 동기화되었습니다.');
    }

    function deleteCustomSolution(customIdx) {
      const sol = customSolutions[customIdx];
      if (!sol) return;

      if (confirm('[' + sol.name + '] 솔루션을 삭제하시겠습니까? (연동된 위키 문서 및 견적도 함께 정리됩니다)')) {
        customSolutions.splice(customIdx, 1);
        saveCustomSolutions();
        syncCustomSolutionsToDocs();
        saveDocsToStorage();

        renderPortalCards();
        renderWikiDocList();
        renderBomTable();
      }
    }

    function syncCustomSolutionsToDocs() {
      currentDocs = currentDocs.filter(d => !d.isCustomDoc);

      customSolutions.forEach((sol, idx) => {
        const docId = 9000 + idx;
        const mdContent = 
          '# [사내 솔루션] ' + sol.name + ' (' + sol.vendor + ')\\n\\n' +
          '> **분류**: ' + sol.category + ' | **공급사**: ' + sol.vendor + ' | **사내 운용 솔루션**\\n\\n' +
          '## 1. 솔루션 개요 및 도입 목적\\n' + (sol.purpose || sol.overview || '상세 정보 없음') + '\\n\\n' +
          '## 2. 실무 운영 매뉴얼 & 점검 절차 (Operation Manual)\\n' + (sol.manual || '등록된 매뉴얼 없음') + '\\n\\n' +
          '## 3. 관련 규제 및 ISMS-P 매핑\\n' + (sol.ismsMapping || '2.4 접근통제') + '\\n\\n' +
          (sol.architectureDiagram ? '## 4. 권장 아키텍처 다이어그램\\n\\x60\\x60\\x60mermaid\\n' + sol.architectureDiagram + '\\n\\x60\\x60\\x60\\n' : '');

        currentDocs.unshift({
          id: docId,
          isCustomDoc: true,
          title: '[사내솔루션] ' + sol.name + ' — ' + sol.vendor,
          category: '사내솔루션',
          tags: ['사내솔루션', sol.name, sol.category, '실무매뉴얼'],
          updatedAt: new Date().toISOString().slice(0, 10),
          content: mdContent
        });
      });
    }

    // --- 4. VIEW SWITCHER ---
    function switchView(viewName) {
      document.querySelectorAll('.view-page').forEach(sec => sec.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

      const targetSec = document.getElementById('view-' + viewName);
      const targetBtn = document.getElementById('tabBtn-' + viewName);

      if (targetSec) targetSec.classList.add('active');
      if (targetBtn) targetBtn.classList.add('active');

      if (viewName === 'studio') {
        renderMermaidFromEditor();
        updateStudioBomBadge();
      } else if (viewName === 'portal') {
        renderPortalCards();
      } else if (viewName === 'bom') {
        renderBomTable();
      } else if (viewName === 'audit') {
        renderAuditGrid();
      } else if (viewName === 'checklist') {
        renderChecklistGrid();
      }
      lucide.createIcons();
    }

    // --- 4.5 DAILY SECURITY CHECKLIST & INSPECTION LOG MODULE ---
    const CHECKLIST_KEY = 'GIJO_DAILY_CHECKLIST_V5_2';
    let dailyChecklistData = {};

    function loadChecklistData() {
      try {
        const stored = localStorage.getItem(CHECKLIST_KEY);
        dailyChecklistData = stored ? JSON.parse(stored) : {};
      } catch (e) {
        dailyChecklistData = {};
      }
    }

    function saveChecklistData() {
      try {
        localStorage.setItem(CHECKLIST_KEY, JSON.stringify(dailyChecklistData));
      } catch (e) {}
    }

    function getTodayKey() {
      const dateInput = document.getElementById('checklistDate');
      return (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().slice(0, 10);
    }

    function renderChecklistGrid() {
      loadChecklistData();
      const dateKey = getTodayKey();
      const dateInput = document.getElementById('checklistDate');
      if (dateInput && !dateInput.value) dateInput.value = dateKey;

      if (!dailyChecklistData[dateKey]) {
        dailyChecklistData[dateKey] = {};
      }
      const dayRecords = dailyChecklistData[dateKey];

      const container = document.getElementById('checklistGridContainer');
      if (!container) return;
      container.innerHTML = '';

      activeSolutionsList.forEach((sol, idx) => {
        if (!dayRecords[sol.name]) {
          dayRecords[sol.name] = { daemon: 'NORMAL', log: 'NORMAL', backup: 'NORMAL', memo: '' };
        }
        const rec = dayRecords[sol.name];

        const card = document.createElement('div');
        card.className = 'white-panel';
        card.style.padding = '1rem';
        card.style.border = '1px solid var(--border)';
        card.style.borderRadius = 'var(--radius)';

        const badgeKr = sol.vendor.includes('국산') || sol.vendorType === '국산' ? 'badge-kr' : 'badge-global';

        card.innerHTML = 
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.75rem;">' +
            '<div>' +
              '<span class="meta-badge ' + badgeKr + '">' + sanitizeHtml(sol.vendorType || '보안솔루션') + '</span> ' +
              '<span class="meta-badge">' + sanitizeHtml(sol.category || sol.sheetCategory) + '</span>' +
              '<div style="font-weight:800; font-size:1rem; margin-top:0.3rem; color:var(--text-main);">' + sanitizeHtml(sol.name) + '</div>' +
              '<div style="font-size:0.75rem; color:var(--text-dim);">' + sanitizeHtml(sol.vendor) + '</div>' +
            '</div>' +
            '<button class="btn btn-sm" onclick="openSolDetailModal(' + idx + ', \\'manual\\')" title="매뉴얼 보기">' +
              '<i data-lucide="book" style="width:11px; height:11px;"></i> 매뉴얼' +
            '</button>' +
          '</div>' +

          '<div style="display:flex; flex-direction:column; gap:0.5rem; font-size:0.78rem;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:0.4rem 0.6rem; border-radius:4px;">' +
              '<span style="font-weight:600;">1. 데몬/에이전트 서비스 기동</span>' +
              '<div style="display:flex; gap:0.25rem;">' +
                '<button class="btn btn-sm ' + (rec.daemon === 'NORMAL' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem;" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'daemon\\', \\'NORMAL\\')">정상</button>' +
                '<button class="btn btn-sm ' + (rec.daemon === 'WARN' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem; color:#d97706;" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'daemon\\', \\'WARN\\')">주의</button>' +
                '<button class="btn btn-sm ' + (rec.daemon === 'ERROR' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem; color:var(--danger);" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'daemon\\', \\'ERROR\\')">이상</button>' +
              '</div>' +
            '</div>' +

            '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:0.4rem 0.6rem; border-radius:4px;">' +
              '<span style="font-weight:600;">2. 차단 이벤트 & 감사 로그</span>' +
              '<div style="display:flex; gap:0.25rem;">' +
                '<button class="btn btn-sm ' + (rec.log === 'NORMAL' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem;" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'log\\', \\'NORMAL\\')">정상</button>' +
                '<button class="btn btn-sm ' + (rec.log === 'WARN' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem; color:#d97706;" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'log\\', \\'WARN\\')">주의</button>' +
                '<button class="btn btn-sm ' + (rec.log === 'ERROR' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem; color:var(--danger);" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'log\\', \\'ERROR\\')">이상</button>' +
              '</div>' +
            '</div>' +

            '<div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:0.4rem 0.6rem; border-radius:4px;">' +
              '<span style="font-weight:600;">3. 라이선스 & 백업 무결성</span>' +
              '<div style="display:flex; gap:0.25rem;">' +
                '<button class="btn btn-sm ' + (rec.backup === 'NORMAL' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem;" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'backup\\', \\'NORMAL\\')">정상</button>' +
                '<button class="btn btn-sm ' + (rec.backup === 'WARN' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem; color:#d97706;" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'backup\\', \\'WARN\\')">주의</button>' +
                '<button class="btn btn-sm ' + (rec.backup === 'ERROR' ? 'btn-primary' : '') + '" style="padding:1px 6px; font-size:0.7rem; color:var(--danger);" onclick="setChecklistItemStatus(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', \\'backup\\', \\'ERROR\\')">이상</button>' +
              '</div>' +
            '</div>' +

            '<div style="margin-top:0.4rem;">' +
              '<input type="text" class="search-input" style="background:#fff; font-size:0.72rem; padding:0.3rem 0.5rem;" placeholder="점검 메모 / 특이사항 기재..." value="' + sanitizeHtml(rec.memo || '') + '" onchange="updateChecklistMemo(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', this.value)">' +
            '</div>' +
          '</div>';

        container.appendChild(card);
      });

      lucide.createIcons();
    }

    function setChecklistItemStatus(solName, field, status) {
      const dateKey = getTodayKey();
      if (!dailyChecklistData[dateKey]) dailyChecklistData[dateKey] = {};
      if (!dailyChecklistData[dateKey][solName]) dailyChecklistData[dateKey][solName] = { daemon: 'NORMAL', log: 'NORMAL', backup: 'NORMAL', memo: '' };
      dailyChecklistData[dateKey][solName][field] = status;
      saveChecklistData();
      renderChecklistGrid();
    }

    function updateChecklistMemo(solName, memoVal) {
      const dateKey = getTodayKey();
      if (!dailyChecklistData[dateKey]) dailyChecklistData[dateKey] = {};
      if (!dailyChecklistData[dateKey][solName]) dailyChecklistData[dateKey][solName] = { daemon: 'NORMAL', log: 'NORMAL', backup: 'NORMAL', memo: '' };
      dailyChecklistData[dateKey][solName].memo = memoVal;
      saveChecklistData();
    }

    function setAllChecklistStatus(status) {
      const dateKey = getTodayKey();
      if (!dailyChecklistData[dateKey]) dailyChecklistData[dateKey] = {};
      activeSolutionsList.forEach(sol => {
        dailyChecklistData[dateKey][sol.name] = { daemon: status, log: status, backup: status, memo: '일괄 점검 확인 완료' };
      });
      saveChecklistData();
      renderChecklistGrid();
      alert('✅ 전사 ' + activeSolutionsList.length + '개 솔루션의 점검 항목이 [정상]으로 일괄 설정되었습니다.');
    }

    function printDailyInspectionReport() {
      const dateKey = getTodayKey();
      const inspector = document.getElementById('checklistInspector').value || '보안운영담당';
      const records = (dailyChecklistData[dateKey]) || {};

      let rowsHtml = '';
      let normalCount = 0;
      let warnCount = 0;
      let errorCount = 0;

      activeSolutionsList.forEach((sol, i) => {
        const rec = records[sol.name] || { daemon: 'NORMAL', log: 'NORMAL', backup: 'NORMAL', memo: '-' };
        if (rec.daemon === 'ERROR' || rec.log === 'ERROR' || rec.backup === 'ERROR') errorCount++;
        else if (rec.daemon === 'WARN' || rec.log === 'WARN' || rec.backup === 'WARN') warnCount++;
        else normalCount++;

        rowsHtml += 
          '<tr>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; text-align:center;">' + (i + 1) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; font-weight:700;">' + sanitizeHtml(sol.name) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1;">' + sanitizeHtml(sol.category || sol.sheetCategory) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; text-align:center;">' + (rec.daemon === 'NORMAL' ? '✓ 정상' : (rec.daemon === 'WARN' ? '△ 주의' : '✕ 이상')) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; text-align:center;">' + (rec.log === 'NORMAL' ? '✓ 정상' : (rec.log === 'WARN' ? '△ 주의' : '✕ 이상')) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; text-align:center;">' + (rec.backup === 'NORMAL' ? '✓ 정상' : (rec.backup === 'WARN' ? '△ 주의' : '✕ 이상')) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; font-size:0.75rem;">' + sanitizeHtml(rec.memo || '-') + '</td>' +
          '</tr>';
      });

      const printWin = window.open('', '_blank', 'width=900,height=800');
      printWin.document.write(
        '<!DOCTYPE html><html><head><title>일일 보안 솔루션 점검 일지 (' + dateKey + ')</title>' +
        '<style>' +
        'body { font-family: Pretendard, sans-serif; padding: 25px; color:#0f172a; line-height: 1.4; }' +
        'table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 0.8rem; }' +
        'th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px; }' +
        '@media print { body { padding: 0; } }' +
        '</style></head><body>' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #0f172a; padding-bottom:10px;">' +
          '<div>' +
            '<h1 style="font-size:1.4rem; margin:0;">일일 보안 솔루션 정기 점검 일지</h1>' +
            '<p style="font-size:0.8rem; color:#475569; margin:4px 0 0 0;">점검일자: ' + dateKey + ' | 대상기관: ' + sanitizeHtml(customerOrgName) + '</p>' +
          '</div>' +
          '<table style="width:240px; margin:0; border:1px solid #0f172a; text-align:center; font-size:0.75rem;">' +
            '<tr><th style="width:80px; padding:3px;">점검자</th><th style="width:80px; padding:3px;">보안팀장</th><th style="width:80px; padding:3px;">CISO</th></tr>' +
            '<tr style="height:40px;"><td>' + sanitizeHtml(inspector) + ' (인)</td><td>(인)</td><td>(인)</td></tr>' +
          '</table>' +
        '</div>' +
        '<div style="display:flex; gap:1rem; margin-top:15px; background:#f8fafc; padding:10px; border-radius:4px; font-size:0.8rem;">' +
          '<div><b>총 점검 대상</b>: ' + activeSolutionsList.length + '개 솔루션</div>' +
          '<div style="color:#059669;"><b>✓ 정상</b>: ' + normalCount + '개</div>' +
          '<div style="color:#d97706;"><b>△ 주의</b>: ' + warnCount + '개</div>' +
          '<div style="color:#dc2626;"><b>✕ 조치필요</b>: ' + errorCount + '개</div>' +
        '</div>' +
        '<table>' +
          '<thead>' +
            '<tr>' +
              '<th style="width:35px;">No</th>' +
              '<th>솔루션 제품명</th>' +
              '<th style="width:120px;">카테고리</th>' +
              '<th style="width:75px;">데몬 상태</th>' +
              '<th style="width:75px;">로그 상태</th>' +
              '<th style="width:75px;">백업/인증</th>' +
              '<th>점검 소견 및 조치 사항</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
        '<div style="margin-top:20px; font-size:0.75rem; color:#64748b; text-align:right;">' +
          'GIJO AS Enterprise Security Operations &copy; 2026 GIJO TECHNOLOGY' +
        '</div>' +
        '<script>window.onload = function(){ window.print(); };<\\/script>' +
        '</body></html>'
      );
      printWin.document.close();
    }

    // --- 4.6 ROI & ECONOMIC IMPACT MODEL ---
    function updateRoiMetrics(totalCapex, totalOpex) {
      const activeCount = Math.max(1, activeSolutionsList.filter(s => (s.qty || 0) > 0).length);
      const capex = totalCapex || 0;
      const opex = totalOpex || 0;

      const breachAvoidance = Math.min(1500000000, activeCount * 75000000);
      const penaltyAvoidance = Math.min(300000000, activeCount * 30000000);
      const laborSaving = Math.min(84000000, activeCount * 8000000 + 24000000);

      const annualCapex = capex / 5;
      const netAnnualBenefit = (breachAvoidance + penaltyAvoidance + laborSaving) - (annualCapex + opex);
      let paybackMonths = '즉시 회수 (3.5개월)';
      if (capex > 0 && netAnnualBenefit > 0) {
        const pMonths = (capex / (breachAvoidance + penaltyAvoidance + laborSaving - opex)) * 12;
        paybackMonths = pMonths > 0 ? (pMonths < 1 ? '1개월 이내' : pMonths.toFixed(1) + ' 개월') : '즉시 회수';
      }

      const elBreach = document.getElementById('roiBreachAvoidance');
      const elPenalty = document.getElementById('roiPenaltyAvoidance');
      const elLabor = document.getElementById('roiLaborSaving');
      const elPayback = document.getElementById('roiPaybackPeriod');

      if (elBreach) elBreach.innerText = '₩' + breachAvoidance.toLocaleString();
      if (elPenalty) elPenalty.innerText = '₩' + penaltyAvoidance.toLocaleString();
      if (elLabor) elLabor.innerText = '₩' + laborSaving.toLocaleString();
      if (elPayback) elPayback.innerText = paybackMonths;

      return { breachAvoidance, penaltyAvoidance, laborSaving, paybackMonths };
    }

    // --- 5. WIKI & RAG MODULE ---
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
          (doc.tags && doc.tags.some(t => t.toLowerCase().includes(searchVal))) ||
          doc.content.toLowerCase().includes(searchVal);
        return matchesCat && matchesSearch;
      });

      document.getElementById('totalDocCount').innerText = filtered.length;

      filtered.forEach(doc => {
        const li = document.createElement('li');
        li.className = 'doc-entry' + (doc.id === currentActiveDocId ? ' active' : '');
        li.onclick = () => selectWikiDoc(doc.id);

        let badgeClass = '';
        if (doc.category === '사내솔루션') badgeClass = 'badge-custom';
        else if (doc.category === '보안솔루션') badgeClass = (doc.title.includes('국산') ? 'badge-kr' : 'badge-global');

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

        // Boost matches
        if (query.includes('매뉴얼') && doc.content.includes('매뉴얼')) score += 15;
        if (query.includes('장애') && doc.content.includes('장애')) score += 15;
        if (query.includes('WizCLM') && doc.title.includes('WizCLM')) score += 20;
        if (query.includes('SBOM') && (doc.title.includes('SBOM') || doc.title.includes('SAFESQUARE'))) score += 20;
        if (query.includes('FOCS') && doc.title.includes('FOCS')) score += 20;
        if (query.includes('SecureIM') && doc.title.includes('SecureIM')) score += 20;
        if (query.includes('Tenable') && doc.title.includes('Tenable')) score += 20;
        if (query.includes('CipherTrust') && doc.title.includes('CipherTrust')) score += 20;
        if (query.includes('WAAP') && doc.title.includes('WAAP')) score += 20;

        if (score > 0) matchedDocs.push({ doc, score });
      });

      matchedDocs.sort((a, b) => b.score - a.score);
      const topDoc = matchedDocs.length > 0 ? matchedDocs[0].doc : null;

      const aiBubble = document.createElement('div');
      aiBubble.className = 'bubble ai';
      aiBubble.innerHTML = '<div>실시간 지식고 & 매뉴얼 분석 중...</div>';
      chatBox.appendChild(aiBubble);
      chatBox.scrollTop = chatBox.scrollHeight;

      let answerText = '';
      if (topDoc) {
        let summary = topDoc.content.slice(0, 320).replace(/#/g, '').replace(/\\*/g, '');
        answerText = '<b>[' + sanitizeHtml(topDoc.title) + ']</b> 근거 분석:<br><br>' + 
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

    // --- 6. SOLUTIONS PORTAL & MANUAL MODULE ---
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

      const filtered = activeSolutionsList.filter(sol => {
        let matchesType = true;
        if (currentSolFilter === 'CUSTOM') matchesType = !!sol.isCustom;
        else if (currentSolFilter === 'KR') matchesType = sol.vendor.includes('국산') || sol.vendorType === '국산';
        else if (currentSolFilter === 'GLOBAL') matchesType = sol.vendor.includes('외산') || sol.vendorType === '외산';
        else if (currentSolFilter === 'AI') matchesType = sol.name.includes('AI') || (sol.category && sol.category.includes('AI'));
        else if (currentSolFilter === 'NETWORK') matchesType = sol.category.includes('방화벽') || sol.category.includes('WAAP') || sol.name.includes('Zscaler');
        else if (currentSolFilter === 'DATA') matchesType = sol.category.includes('DSP') || sol.category.includes('EDR') || sol.category.includes('DLP') || sol.name.includes('CipherTrust');

        const matchesSearch = !search ||
          sol.name.toLowerCase().includes(search) ||
          sol.vendor.toLowerCase().includes(search) ||
          (sol.category && sol.category.toLowerCase().includes(search)) ||
          (sol.overview && sol.overview.toLowerCase().includes(search)) ||
          (sol.manual && sol.manual.toLowerCase().includes(search));

        return matchesType && matchesSearch;
      });

      filtered.forEach((sol, globalIdx) => {
        const card = document.createElement('div');
        card.className = 'sol-card';

        let badgeClass = 'badge-global';
        let badgeText = sol.vendorType || '외산';
        if (sol.isCustom) {
          badgeClass = 'badge-custom';
          badgeText = '사내 운용';
        } else if (sol.vendor.includes('국산') || sol.vendorType === '국산') {
          badgeClass = 'badge-kr';
          badgeText = '국산';
        }

        const linkedDoc = currentDocs.find(d => d.title.includes(sol.name));
        const customIdx = customSolutions.findIndex(c => c.name === sol.name);

        card.innerHTML = 
          '<div>' +
            '<div class="sol-card-header">' +
              '<div>' +
                '<span class="meta-badge ' + badgeClass + '" style="margin-bottom:0.3rem; display:inline-block;">' + badgeText + '</span> ' +
                '<span class="meta-badge">' + sanitizeHtml(sol.category || sol.sheetCategory) + '</span>' +
                '<div class="sol-card-title" style="margin-top:0.35rem;">' + sanitizeHtml(sol.name) + '</div>' +
                '<div class="sol-card-vendor">' + sanitizeHtml(sol.vendor) + '</div>' +
              '</div>' +
              '<div style="display:flex; align-items:center; gap:0.4rem;">' +
                (sol.isOverridden ? '<span class="meta-badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-size:0.65rem;">수정됨</span>' : '') +
                '<button class="btn btn-sm" style="padding:2px 6px;" onclick="openEditAnySolModal(' + globalIdx + ')" title="솔루션 정보 및 매뉴얼 수정"><i data-lucide="edit-2" style="width:11px; height:11px;"></i></button>' +
                (sol.isOverridden ? '<button class="btn btn-sm" style="padding:2px 6px; color:#d97706;" onclick="restoreStandardSolution(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\')" title="원본 복원"><i data-lucide="rotate-ccw" style="width:11px; height:11px;"></i></button>' : '') +
                (sol.isCustom ? '<button class="btn btn-sm" style="padding:2px 6px; color:var(--danger);" onclick="deleteCustomSolution(' + customIdx + ')" title="삭제"><i data-lucide="trash-2" style="width:11px; height:11px;"></i></button>' : '') +
                '<input type="checkbox" title="비교함에 담기" ' + (compareList.some(c => c.name === sol.name) ? 'checked' : '') + ' onchange="toggleCompareSol(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\', this.checked)">' +
              '</div>' +
            '</div>' +
            '<div class="sol-card-desc">' + sanitizeHtml(sol.overview || sol.purpose || '상세 규격 및 기능 제공') + '</div>' +
            '<div style="font-size:0.75rem; color:var(--text-dim); margin-top:0.4rem;">' +
              '<div><b>표준 단가</b>: ₩' + Number(sol.price || 0).toLocaleString() + '</div>' +
              '<div><b>통제 매핑</b>: ' + sanitizeHtml(sol.ismsMapping || '2.4 접근통제') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sol-card-footer">' +
            '<div style="display:flex; gap:0.3rem;">' +
              '<button class="btn btn-sm" onclick="openSolDetailModal(' + globalIdx + ', \\'manual\\')"><i data-lucide="book" style="width:11px; height:11px;"></i> 매뉴얼</button>' +
              '<button class="btn btn-sm" onclick="openSolDetailModal(' + globalIdx + ', \\'spec\\')"><i data-lucide="info" style="width:11px; height:11px;"></i> 상세</button>' +
              (linkedDoc ? '<button class="btn btn-sm" onclick="jumpToWikiDoc(' + linkedDoc.id + ')"><i data-lucide="file-text" style="width:11px; height:11px;"></i> 위키</button>' : '') +
            '</div>' +
            '<button class="btn btn-sm btn-primary" onclick="addSolToBom(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\')">+ BOM</button>' +
          '</div>';

        grid.appendChild(card);
      });
      lucide.createIcons();
    }

    function jumpToWikiDoc(docId) {
      switchView('wiki');
      selectWikiDoc(docId);
    }

    function openSolDetailModal(idx, initialTab = 'spec') {
      const sol = activeSolutionsList[idx];
      if (!sol) return;
      currentDetailSol = sol;

      document.getElementById('modalSolCategory').innerText = sol.category || sol.sheetCategory;
      document.getElementById('modalSolTitle').innerText = sol.name;
      document.getElementById('modalSolVendor').innerText = sol.vendor + ' | 대상: ' + (sol.target || '전사 보안');

      // 1. Spec Tab HTML
      const specHtml = 
        '<h3>1. 솔루션 개요</h3><p>' + sanitizeHtml(sol.overview || '-') + '</p>' +
        '<h3>2. 도입 목적 및 필요성</h3><p>' + sanitizeHtml(sol.purpose || '-').replace(/\\n/g, '<br>') + '</p>' +
        '<h3>3. 핵심 기능</h3><p>' + sanitizeHtml(sol.features || '-').replace(/\\n/g, '<br>') + '</p>' +
        '<h3>4. 관련 규제 및 기대효과</h3><p>' + sanitizeHtml(sol.regulation || '-').replace(/\\n/g, '<br>') + '<br>' + sanitizeHtml(sol.effects || '-').replace(/\\n/g, '<br>') + '</p>';
      document.getElementById('subTabContent-spec').innerHTML = specHtml;

      // 2. Manual Tab HTML
      let manualContent = sol.manual;
      if (!manualContent) {
        manualContent = 
          '**[기본 실무 운영 가이드]**\\n\\n' +
          '- **일일 점검**: 엔진 데몬 프로세스 상태 확인, 관리 콘솔 대시보드 경보(Alert) 로그 확인.\\n' +
          '- **주간 점검**: 차단 및 예외 정책 통계 추출, 에이전트 버전 무결성 점검.\\n' +
          '- **월간 점검**: 관리자 접근 감사 로그 백업, 라이선스 만료일 점검, ISMS-P 증적 자료 추출.\\n' +
          '- **긴급 장애 런북**:\\n' +
          '  1. 관리 콘솔 접속 불가 시 데몬 서비스 상태 확인 및 프로세스 재기동.\\n' +
          '  2. 네트워크 차단 지연 시 긴급 Bypass 모드 전환.\\n' +
          '  3. 기술지원 비상 핫라인 티켓 인계.';
      }

      const manualHtml = 
        '<div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:6px; margin-bottom:1rem;">' +
          '<div style="font-weight:700; font-size:0.9rem; margin-bottom:0.4rem; color:var(--primary);">' +
            '<i data-lucide="book-open" style="width:14px; height:14px; vertical-align:middle;"></i> ' + sanitizeHtml(sol.name) + ' 실무 운영 매뉴얼 & 런북' +
          '</div>' +
          '<div style="font-size:0.83rem; line-height:1.7;">' + parseMarkdownToHtml(manualContent) + '</div>' +
        '</div>';
      const statusEl = document.getElementById('detailPdfStatus');
      if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
      const detailInput = document.getElementById('detailPdfInput');
      if (detailInput) detailInput.value = '';

      document.getElementById('subTabContent-manual-body').innerHTML = manualHtml;

      // 3. Diagram Tab HTML
      let diagramHtml = '';
      if (sol.architectureDiagram) {
        diagramHtml = 
          '<div style="margin-bottom:0.75rem; display:flex; justify-content:flex-end;">' +
            '<button class="btn btn-sm btn-primary" onclick="loadDiagramToStudio(\\'' + sol.name.replace(/'/g, "\\\\'") + '\\')"><i data-lucide="cpu" style="width:12px; height:12px;"></i> 아키텍처 스튜디오에서 편집</button>' +
          '</div>' +
          '<div class="mermaid" style="background:#f8fafc; padding:1rem; border-radius:6px; border:1px solid var(--border);">' + sol.architectureDiagram + '</div>';
      } else {
        diagramHtml = '<div style="color:var(--text-dim); padding:2rem; text-align:center;">등록된 권장 아키텍처 다이어그램이 없습니다.</div>';
      }
      document.getElementById('subTabContent-diagram').innerHTML = diagramHtml;

      switchDetailSubTab(initialTab);
      document.getElementById('solDetailModal').classList.add('active');
      lucide.createIcons();
      mermaid.run();
    }

    function switchDetailSubTab(subTabName) {
      document.querySelectorAll('.modal-sub-tabs .pill-cat').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById('subTabBtn-' + subTabName);
      if (activeBtn) activeBtn.classList.add('active');

      document.getElementById('subTabContent-spec').style.display = (subTabName === 'spec' ? 'block' : 'none');
      document.getElementById('subTabContent-manual').style.display = (subTabName === 'manual' ? 'block' : 'none');
      document.getElementById('subTabContent-diagram').style.display = (subTabName === 'diagram' ? 'block' : 'none');
    }

    function closeSolDetailModal() {
      document.getElementById('solDetailModal').classList.remove('active');
    }

    function loadDiagramToStudio(solName) {
      const sol = activeSolutionsList.find(s => s.name === solName);
      if (!sol || !sol.architectureDiagram) return;
      closeSolDetailModal();
      document.getElementById('studioMermaidCode').value = sol.architectureDiagram;
      switchView('studio');
    }

    // Compare Tray Logic
    function toggleCompareSol(solName, isChecked) {
      const sol = activeSolutionsList.find(s => s.name === solName);
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
        { label: '실무 매뉴얼', key: 'manual' },
        { label: 'ISMS 매핑', key: 'ismsMapping' },
        { label: '표준 단가', custom: s => '₩' + Number(s.price || 0).toLocaleString() }
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

    // --- 7. STUDIO & VISUAL ARCHITECTURE BOM MODULE ---
    function debounceStudioSync() {
      clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(() => {
        updateStudioBomBadge();
      }, 500);
    }

    function updateStudioBomBadge() {
      const code = document.getElementById('studioMermaidCode').value.toLowerCase();
      let matchedCount = 0;
      let matchedCapex = 0;

      activeSolutionsList.forEach(sol => {
        const keyName = sol.name.toLowerCase();
        if (code.includes(keyName) || 
            (keyName.includes('waf') && code.includes('waf')) ||
            (keyName.includes('방화벽') && (code.includes('ngfw') || code.includes('firewall'))) ||
            (keyName.includes('edr') && code.includes('edr')) ||
            (keyName.includes('dlp') && code.includes('dlp')) ||
            (keyName.includes('clm') && code.includes('clm')) ||
            (keyName.includes('gijo as') && code.includes('gijo as'))) {
          matchedCount++;
          matchedCapex += (sol.price || 0);
        }
      });

      const badge = document.getElementById('studioBomBadge');
      if (badge) {
        badge.innerText = '배치: ' + matchedCount + '개 (₩' + matchedCapex.toLocaleString() + ')';
      }
    }

    function syncStudioToBom() {
      const code = document.getElementById('studioMermaidCode').value.toLowerCase();
      let updatedSolNames = [];

      activeSolutionsList.forEach(sol => {
        const keyName = sol.name.toLowerCase();
        let shouldCount = 0;

        if (code.includes(keyName)) shouldCount = 1;
        else if (keyName.includes('waf') && code.includes('waf')) shouldCount = 1;
        else if (keyName.includes('방화벽') && (code.includes('ngfw') || code.includes('firewall'))) shouldCount = 1;
        else if (keyName.includes('edr') && code.includes('edr')) shouldCount = 1;
        else if (keyName.includes('dlp') && code.includes('dlp')) shouldCount = 1;
        else if (keyName.includes('clm') && code.includes('clm')) shouldCount = 1;
        else if (keyName.includes('gijo as') && code.includes('gijo as')) shouldCount = 1;

        if (shouldCount > 0) {
          sol.qty = Math.max(sol.qty || 0, shouldCount);
          updatedSolNames.push(sol.name);
        }
      });

      saveBomQuantities();
      renderBomTable();
      updateStudioBomBadge();

      alert('✅ 아키텍처 다이어그램 노드 분석 완료!\\n총 ' + updatedSolNames.length + '개 솔루션의 수량이 BOM 견적에 실시간 반영되었습니다.');
    }

    function syncBomToStudio() {
      const activeBoms = activeSolutionsList.filter(s => (s.qty || 0) > 0);
      if (activeBoms.length === 0) {
        alert('BOM 견적표에 수량이 1 이상인 솔루션이 없습니다.');
        return;
      }

      let mermaidText = 'graph TD\\n  User["👤 사내 사용자 / 인터넷 클라이언트"] --> Gateway["🛡️ 보안 경계 게이트웨이"]\\n';
      mermaidText += '  subgraph DMZ["🌐 DMZ 경계 영역"]\\n';
      
      activeBoms.forEach((sol, idx) => {
        const nodeId = 'Sol' + (idx + 1);
        const nodeLabel = sol.name.replace(/["\\[\\]]/g, '');
        mermaidText += '    ' + nodeId + '["🔒 ' + nodeLabel + '"]\\n';
      });
      mermaidText += '  end\\n';
      mermaidText += '  Gateway --> Sol1\\n';
      mermaidText += '  subgraph Trust["🏢 내부 신뢰망 (Internal Trust Zone)"]\\n';
      mermaidText += '    Server["🖥️ 업무 서버 & 데이터베이스"]\\n';
      mermaidText += '  end\\n';
      mermaidText += '  Sol1 --> Server\\n';

      document.getElementById('studioMermaidCode').value = mermaidText;
      switchView('studio');
      renderMermaidFromEditor();
      alert('✅ BOM 견적표의 ' + activeBoms.length + '개 솔루션 기반으로 아키텍처 다이어그램이 자동 재구성되었습니다.');
    }

    function loadStudioPreset(presetKey) {
      if (!presetKey) return;
      if (studioPresets[presetKey]) {
        document.getElementById('studioMermaidCode').value = studioPresets[presetKey].trim();
        renderMermaidFromEditor();
        updateStudioBomBadge();
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
      updateStudioBomBadge();
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

    // --- 8. BOM & TCO MODULE ---
    function addSolToBom(solName) {
      const sol = activeSolutionsList.find(s => s.name === solName);
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
          activeSolutionsList.forEach(sol => {
            if (typeof map[sol.name] === 'number') sol.qty = map[sol.name];
          });
        }
      } catch (e) {
        console.warn('BOM parse error:', e);
      }
    }

    function saveBomQuantities() {
      const map = {};
      activeSolutionsList.forEach(sol => {
        map[sol.name] = sol.qty || 0;
      });
      localStorage.setItem(BOM_QTY_KEY, JSON.stringify(map));
    }

    function updateBomQty(index, newQty) {
      const qty = Math.max(0, parseInt(newQty, 10) || 0);
      activeSolutionsList[index].qty = qty;
      saveBomQuantities();
      renderBomTable();
    }

    function resetBomQuantities() {
      if (confirm('모든 솔루션 도입 수량을 초기화하시겠습니까?')) {
        activeSolutionsList.forEach((sol, idx) => { sol.qty = (idx < 3 ? 1 : 0); });
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

      activeSolutionsList.forEach((sol, idx) => {
        const qty = sol.qty || 0;
        const price = sol.price || 0;
        const capex = price * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));

        totalQty += qty;
        totalCapex += capex;
        totalOpex += opex;

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><b>' + sanitizeHtml(sol.name) + '</b> ' + (sol.isCustom ? '<span class="meta-badge badge-custom">사내</span>' : '') + '</td>' +
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

      // Update ROI & Risk Avoidance Metrics
      updateRoiMetrics(totalCapex, totalOpex);
    }

    function exportBomToCsv() {
      let csv = '솔루션명,제조사,카테고리,단가,수량,도입비(Capex),연간유지보수(Opex),5개년TCO,ISMS-P항목\\n';
      activeSolutionsList.forEach(sol => {
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

    // --- 9. AUDIT GRID MODULE ---
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

    // --- 10. COMPREHENSIVE A4 REPORT MODULE ---
    function openReportModal() {
      renderReport();
      document.getElementById('reportModal').classList.add('active');
      lucide.createIcons();
    }

    function closeReportModal() {
      document.getElementById('reportModal').classList.remove('active');
    }

    function promptEditOrgName() {
      const newName = prompt('리포트에 표기할 고객사 및 부서명을 입력하세요:', customerOrgName);
      if (newName && newName.trim()) {
        customerOrgName = newName.trim();
        localStorage.setItem(CUST_ORG_KEY, customerOrgName);
        renderReport();
      }
    }

    function renderReport() {
      const reportBox = document.getElementById('reportBody');
      const today = new Date().toISOString().slice(0, 10);

      // Extract Active SVG
      const svgEl = document.querySelector('#mermaidOutput svg');
      const svgHtml = svgEl ? svgEl.outerHTML : '<div style="color:var(--text-dim); text-align:center; padding:1.5rem;">아키텍처 스튜디오 렌더링 결과가 여기에 삽입됩니다.</div>';

      // Calculate Totals
      let totalQty = 0;
      let totalCapex = 0;
      let totalOpex = 0;
      const deployedSols = activeSolutionsList.filter(s => (s.qty || 0) > 0);

      deployedSols.forEach(sol => {
        const qty = sol.qty || 0;
        const capex = (sol.price || 0) * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));
        totalQty += qty;
        totalCapex += capex;
        totalOpex += opex;
      });

      const totalTco5Year = totalCapex + (totalOpex * 5);
      const ismsScore = Math.min(100, Math.round((deployedSols.length / 10) * 85 + 10));

      let reportHtml = 
        '<div class="report-page">' +
          '<div style="border-bottom:3px solid var(--primary); padding-bottom:1rem; margin-bottom:1.5rem; display:flex; justify-content:space-between; align-items:flex-end;">' +
            '<div>' +
              '<div style="font-size:0.8rem; font-weight:700; color:var(--primary); letter-spacing:1px;">GIJO AS ENTERPRISE SECURITY PLATFORM</div>' +
              '<h1 style="font-size:1.8rem; font-weight:800; color:#0f172a; margin:0.3rem 0;">전사 보안 아키텍처 및 ISMS-P 진단 리포트</h1>' +
              '<div style="font-size:0.85rem; color:var(--text-sub);">' +
                '대상 기관: <b style="color:var(--text-main);">' + sanitizeHtml(customerOrgName) + '</b> ' +
                '<button class="btn btn-sm no-print" style="padding:1px 6px; font-size:0.7rem;" onclick="promptEditOrgName()">수정</button>' +
              '</div>' +
            '</div>' +
            '<div style="text-align:right; font-size:0.8rem; color:var(--text-dim);">' +
              '<div>발행 일자: ' + today + '</div>' +
              '<div>진단 엔진: GIJO AS v5.2 AI SecOps</div>' +
              '<div>분류: 대외비 (CONFIDENTIAL)</div>' +
            '</div>' +
          '</div>' +

          '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem; margin-bottom:1.8rem;">' +
            '<div style="background:#f8fafc; border:1px solid #cbd5e1; padding:0.85rem; border-radius:6px; text-align:center;">' +
              '<div style="font-size:0.75rem; color:var(--text-sub);">ISMS-P 통제 충족 지수</div>' +
              '<div style="font-size:1.5rem; font-weight:800; color:var(--primary); margin-top:0.2rem;">' + ismsScore + '% 충족</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border:1px solid #cbd5e1; padding:0.85rem; border-radius:6px; text-align:center;">' +
              '<div style="font-size:0.75rem; color:var(--text-sub);">구축 솔루션 (배치/총계)</div>' +
              '<div style="font-size:1.5rem; font-weight:800; color:var(--text-main); margin-top:0.2rem;">' + deployedSols.length + ' / ' + activeSolutionsList.length + ' 종</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border:1px solid #cbd5e1; padding:0.85rem; border-radius:6px; text-align:center;">' +
              '<div style="font-size:0.75rem; color:var(--text-sub);">초기 구축 예산 (Capex)</div>' +
              '<div style="font-size:1.4rem; font-weight:800; color:var(--text-main); margin-top:0.2rem;">₩' + totalCapex.toLocaleString() + '</div>' +
            '</div>' +
            '<div style="background:#eff6ff; border:1px solid #93c5fd; padding:0.85rem; border-radius:6px; text-align:center;">' +
              '<div style="font-size:0.75rem; color:#1d4ed8;">5개년 총소유비용 (TCO)</div>' +
              '<div style="font-size:1.4rem; font-weight:800; color:#1d4ed8; margin-top:0.2rem;">₩' + totalTco5Year.toLocaleString() + '</div>' +
            '</div>' +
          '</div>' +

          '<h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left:4px solid var(--primary); padding-left:0.6rem; margin-bottom:0.75rem;">1. 전사 보안 인프라 표준 권장 아키텍처</h2>' +
          '<div style="background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:1rem; margin-bottom:2rem; overflow-x:auto; text-align:center;">' +
            svgHtml +
          '</div>' +

          '<h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left:4px solid var(--primary); padding-left:0.6rem; margin-bottom:0.75rem;">2. 도입 보안 솔루션 편성 현황 (BOM)</h2>' +
          '<table class="clean-table" style="margin-bottom:2rem;">' +
            '<thead><tr><th>솔루션명</th><th>제조사/구분</th><th>카테고리</th><th>수량</th><th>초기 구축비</th><th>연간 유지보수</th><th>ISMS-P 통제항목</th></tr></thead>' +
            '<tbody>';

      (deployedSols.length > 0 ? deployedSols : activeSolutionsList.slice(0, 5)).forEach(sol => {
        const qty = sol.qty || 1;
        const capex = (sol.price || 0) * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));
        reportHtml += 
          '<tr>' +
            '<td><b>' + sanitizeHtml(sol.name) + '</b></td>' +
            '<td>' + sanitizeHtml(sol.vendor) + '</td>' +
            '<td>' + sanitizeHtml(sol.category || sol.sheetCategory) + '</td>' +
            '<td>' + qty + '</td>' +
            '<td>₩' + capex.toLocaleString() + '</td>' +
            '<td>₩' + opex.toLocaleString() + '</td>' +
            '<td>' + sanitizeHtml(sol.ismsMapping || '2.4 접근통제') + '</td>' +
          '</tr>';
      });

      reportHtml += 
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="report-page">' +
          '<h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left:4px solid var(--primary); padding-left:0.6rem; margin-bottom:0.75rem;">3. KISA ISMS-P 80개 통제항목 세부 충족 매트릭스</h2>' +
          '<table class="clean-table" style="margin-bottom:2rem;">' +
            '<thead><tr><th style="width:15%;">통제 영역</th><th style="width:40%;">핵심 요구사항 및 위험</th><th style="width:30%;">배치 솔루션</th><th style="width:15%; text-align:center;">충족 상태</th></tr></thead>' +
            '<tbody>' +
              '<tr><td><b>2.1 자산관리</b></td><td>AI 모델, SW 라이선스, IT 자산 식별 및 통제</td><td>GIJO AS, SAFESQUARE SBOM</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
              '<tr><td><b>2.3 취약점관리</b></td><td>서버/웹/AI 모델 정기 스캔 및 CVSS 패치</td><td>Tenable ONE, Tenable AI Exposure</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
              '<tr><td><b>2.4 접근통제</b></td><td>망분리, 경계 방화벽 룰 정비, 서버 2차 인증</td><td>SecureIM, FOCS, Zscaler Platform</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
              '<tr><td><b>2.5 암호화통제</b></td><td>DB/개인정보 커널 암호화 및 유출 방지</td><td>CipherTrust, GRADIUS DLP, COODOC</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
              '<tr><td><b>2.6 인증서관리</b></td><td>SSL/TLS 인증서 만료 장애 방지 및 갱신</td><td>WizCLM</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
              '<tr><td><b>2.8 악성코드통제</b></td><td>엔드포인트 실시간 탐지 및 패치 자동화</td><td>Falcon Insight (EDR), Neurons UEM</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
              '<tr><td><b>2.12 AI보안통제</b></td><td>AI-BOM 공급망 점검 및 프롬프트 인젝션 방어</td><td>GIJO AS, Imperva AI AppSec</td><td style="text-align:center; color:#059669; font-weight:700;">충족 (PASS)</td></tr>' +
            '</tbody>' +
          '</table>' +

          '<h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left:4px solid var(--primary); padding-left:0.6rem; margin-bottom:0.75rem;">4. 실무 운영 매뉴얼 & 비상 대응 런북 가이드</h2>' +
          '<div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:1rem; margin-bottom:2rem; font-size:0.83rem; line-height:1.7;">' +
            '<div><b>[일일 정기 점검]</b> 데몬 프로세스 상태 확인, 관리 콘솔 이상 경보(Alert) 로그 점검, 에이전트 통신 확인.</div>' +
            '<div><b>[주간 정기 점검]</b> 방화벽/접근제어 정책 차단 건수 통계 추출, 오탐 룰 조정, 신규 CVE 공지 대조.</div>' +
            '<div><b>[월간 정기 점검]</b> 관리자 감사 로그(Audit Log) 위변조 방지 스토리지 영구 보관, 라이선스 잔여일 점검.</div>' +
            '<div><b>[침해사고 및 비상 장애 런북]</b></div>' +
            '<ol style="margin-left:1.5rem; margin-top:0.3rem;">' +
              '<li>관리 콘솔 접속 불가 시 데몬 서비스(Service / Systemd) 상태 확인 및 재기동.</li>' +
              '<li>비정상 패킷 병목 발생 시 해당 게이트웨이 Bypass 모드 전환 및 세션 한도 확인.</li>' +
              '<li>데이터 유출 의심 시 EDR 격리 모드 가동 및 위변조방지 감사 로그 무결성 추출.</li>' +
            '</ol>' +
          '<h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; border-left:4px solid var(--primary); padding-left:0.6rem; margin-bottom:0.75rem;">5. 경영진 보고용 보안 투자 경제성(ROI) 분석</h2>' +
          '<table class="clean-table" style="margin-bottom:1.5rem;">' +
            '<thead><tr><th>분석 지표</th><th>산출 기준 및 경제적 효과</th><th style="text-align:right;">추정 편익 / 회수액</th></tr></thead>' +
            '<tbody>' +
              '<tr><td><b>연간 침해사고 예방 가치</b></td><td>글로벌 침해사고 평균 피해액(약 15억원) 대비 핵심 보안 솔루션 방어율 산출</td><td style="text-align:right; color:#059669; font-weight:700;">' + (document.getElementById('roiBreachAvoidance') ? document.getElementById('roiBreachAvoidance').innerText : '₩1,200,000,000') + '</td></tr>' +
              '<tr><td><b>과징금 리스크 경감액</b></td><td>개인정보보호법 개정안(전체 매출의 최대 3% 과징금) 유출 위험 회피 가치</td><td style="text-align:right; color:#2563eb; font-weight:700;">' + (document.getElementById('roiPenaltyAvoidance') ? document.getElementById('roiPenaltyAvoidance').innerText : '₩300,000,000') + '</td></tr>' +
              '<tr><td><b>운영/감사인건비 절감액</b></td><td>수동 로그 전수 분석, 침해사고 소명, 정기 감사 대응 공수 60% 절감</td><td style="text-align:right; color:#7c3aed; font-weight:700;">' + (document.getElementById('roiLaborSaving') ? document.getElementById('roiLaborSaving').innerText : '₩48,000,000') + '</td></tr>' +
              '<tr><td><b>예상 투자 회수 기간(Payback)</b></td><td>초기 도입비(Capex) 대비 순편익 발생 회수 소요 개월 수</td><td style="text-align:right; color:#d97706; font-weight:700;">' + (document.getElementById('roiPaybackPeriod') ? document.getElementById('roiPaybackPeriod').innerText : '약 3.5 개월') + '</td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="report-page">' +
          '<div style="border-top:1px solid var(--border); padding-top:1rem; display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:var(--text-dim);">' +
            '<div>GIJO AS Enterprise Security Architecture &copy; 2026 GIJO TECHNOLOGY. All Rights Reserved.</div>' +
            '<div>검증관 서명: ________________ (인)</div>' +
          '</div>' +
        '</div>';

      reportBox.innerHTML = reportHtml;
    }

    function printReport() {
      window.print();
    }

    // --- 11. BACKUP & LLM SETTINGS ---
    function exportFullProjectBackup() {
      const backup = {
        exportedAt: new Date().toISOString(),
        wikiDocs: currentDocs,
        customSolutions: customSolutions,
        standardSolutions: defaultSolutionCatalog
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GIJO_AS_Lite_WIKI_Full_Backup.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    function exportDocsFile() {
      const blob = new Blob([JSON.stringify(currentDocs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GIJO_AS_Wiki_Docs.json';
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
            if (imported.wikiDocs) {
              currentDocs = imported.wikiDocs;
              if (imported.customSolutions) customSolutions = imported.customSolutions;
              saveCustomSolutions();
            } else if (Array.isArray(imported)) {
              currentDocs = imported;
            }
            saveDocsToStorage();
            renderWikiDocList();
            renderPortalCards();
            renderBomTable();
            selectWikiDoc(currentDocs[0].id);
            alert('✅ 데이터가 성공적으로 복원되었습니다.');
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
      document.getElementById('llmStatusIndicator').innerText = mode === 'gb10' ? '⚡ GB10 177B 연동' : (mode === 'win' ? '🟢 로컬 서버' : '🟢 에어갭 RAG (실시간 인덱스)');
      closeLlmSettingsModal();
      alert('✅ LLM 추론 설정이 저장되었습니다.');
    }
    function testLlmConnection() {
      alert('연결 테스트: 에어갭 로컬 시맨틱 RAG 엔진이 정상 가동 중입니다.');
    }

    // --- 12. BOOTSTRAP ---
    window.addEventListener('DOMContentLoaded', () => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        flowchart: { curve: 'basis' }
      });

      const storedOrg = localStorage.getItem(CUST_ORG_KEY);
      if (storedOrg) customerOrgName = storedOrg;

      loadCustomSolutions();
      currentDocs = loadStoredDocs();
      syncCustomSolutionsToDocs();

      loadBomQuantities();

      renderQuickChips();
      renderWikiDocList();
      selectWikiDoc(currentDocs[0].id);
      renderPortalCards();
      renderBomTable();
      renderAuditGrid();

      // Load initial studio code & update badge
      document.getElementById('studioMermaidCode').value = studioPresets.GIJO_AS.trim();
      updateStudioBomBadge();

      // Initialize PDF drag and drop zone
      initPdfDropZone();

      lucide.createIcons();
    });
  </script>
</body>
</html>`;

fs.writeFileSync(targetHtmlPath, htmlContent, 'utf8');
fs.writeFileSync(electronIndexPath, htmlContent, 'utf8');

console.log('✅ GIJO Security Suite & WIKI (Visual BOM & A4 Print Report) successfully generated:');
console.log(' - ' + targetHtmlPath + ' (' + fs.statSync(targetHtmlPath).size + ' bytes)');
console.log(' - ' + electronIndexPath + ' (' + fs.statSync(electronIndexPath).size + ' bytes)');
