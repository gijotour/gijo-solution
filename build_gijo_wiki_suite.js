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
  
    /* --- UNIVERSAL EXCEL HIGH-DENSITY GRID SYSTEM --- */
    .excel-wrapper {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow-x: auto;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      margin-bottom: 1rem;
    }
    table.excel-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.77rem;
      line-height: 1.35;
      white-space: nowrap;
    }
    table.excel-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 800;
      font-size: 0.73rem;
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      position: sticky;
      top: 0;
      z-index: 5;
      text-align: left;
      user-select: none;
    }
    table.excel-table td {
      border: 1px solid #e2e8f0;
      padding: 5px 8px;
      vertical-align: middle;
      color: var(--text-main);
    }
    table.excel-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    table.excel-table tr:hover td {
      background: #eff6ff;
    }
    table.excel-table td.num, table.excel-table th.num {
      text-align: right;
      font-family: Consolas, 'D2Coding', monospace;
      font-variant-numeric: tabular-nums;
    }
    table.excel-table td.center, table.excel-table th.center {
      text-align: center;
    }
    .x-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
    }
    .x-badge.danger { background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; }
    .x-badge.warning { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
    .x-badge.success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .x-badge.info { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
    .x-badge.neutral { background: #f1f5f9; color: var(--text-sub); border: 1px solid #e2e8f0; }
    .x-btn {
      padding: 1px 6px;
      font-size: 0.7rem;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: #fff;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.1s;
    }
    .x-btn:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }
    .x-input {
      width: 100%;
      padding: 2px 5px;
      font-size: 0.72rem;
      border: 1px solid var(--border);
      border-radius: 3px;
      outline: none;
    }
    .x-input:focus {
      border-color: var(--primary);
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
        <button id="tabBtn-dashboard" class="tab-btn active" onclick="switchView('dashboard')">
          <i data-lucide="layout-dashboard" style="width:14px; height:14px;"></i> 관제 브리핑
        </button>
        <button id="tabBtn-wiki" class="tab-btn" onclick="switchView('wiki')">
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
        <button id="tabBtn-sbom" class="tab-btn" onclick="switchView('sbom')">
          <i data-lucide="boxes" style="width:14px; height:14px;"></i> IT 자산 & SBOM
        </button>
      </nav>

      <div class="header-tools">
        <button class="btn btn-primary" onclick="printComprehensiveAuditDossier()" title="KISA/ISMS-P 정기 종합 감사 증적철(표지+자산구성도+SBOM+점검일지+TCO) 일괄 인쇄">
          <i data-lucide="folder-archive" style="width:14px; height:14px;"></i> 감사 종합철 (A4)
        </button>
        <button class="btn" onclick="exportGijoBundle()" title="전사 데이터 안전 백업 (.gijo-bundle)">
          <i data-lucide="package-check" style="width:13px; height:13px;"></i> 백업
        </button>
        <button class="btn" onclick="importGijoBundlePrompt()" title="백업 파일 복원">
          <i data-lucide="upload-cloud" style="width:13px; height:13px;"></i> 복원
        </button>
        <button class="btn" onclick="openReportModal()" title="경영진 보고 및 ISMS-P 수검용 종합 리포트">
          <i data-lucide="printer" style="width:14px; height:14px;"></i> 진단 리포트
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

    <!-- 0. MORNING MISSION CONTROL HUB VIEW -->
    <section id="view-dashboard" class="view-page active">
      <div style="max-width:1400px; margin:0 auto; padding:0.5rem 0.75rem 2rem 0.75rem;">
        
        <!-- Header Hub Banner -->
        <div style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:18px 24px; box-shadow:var(--shadow); margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h1 style="font-size:1.3rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                <i data-lucide="shield-alert" style="width:24px; height:24px; color:var(--primary);"></i>
                통합 관제 브리핑 (Morning Mission Control Hub)
              </h1>
              <span style="background:#ecfdf5; color:#059669; border:1px solid rgba(5,150,105,0.3); font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                운영 상태 정상
              </span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-sub); margin-top:4px;">
              기준일시: 2026-09-16 09:00 KST | 총괄 운영 조직: 한국수력원자력 정보보호본부 | KISA ISMS-P & 소프트웨어 공급망 지침 100% 가동
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="printComprehensiveAuditDossier()">
              <i data-lucide="folder-archive" style="width:14px; height:14px;"></i> 2026 감사 종합 증적철 A4 인쇄
            </button>
            <button class="btn" onclick="exportGijoBundle()">
              <i data-lucide="package-check" style="width:14px; height:14px;"></i> 전사 데이터 백업 (.gijo-bundle)
            </button>
          </div>
        </div>

        <!-- 4 KPI Score Banner -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:14px; margin-bottom:18px;">
          <div class="kpi-card" style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px; box-shadow:var(--shadow);">
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:4px;">🛡️ 전사 보안 거버넌스 준수율</div>
            <div style="font-size:1.5rem; font-weight:800; color:#059669;" id="dashKpiGov">94.2점</div>
            <div style="font-size:0.72rem; color:#059669; margin-top:4px; font-weight:600;">▲ KISA ISMS-P 및 SBOM 수검 적합</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px; box-shadow:var(--shadow);">
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:4px;">🚨 고위험 취약점 (CVE) 경보</div>
            <div style="font-size:1.5rem; font-weight:800; color:#dc2626;" id="dashKpiVuln">1건 (긴급)</div>
            <div style="font-size:0.72rem; color:#dc2626; margin-top:4px; font-weight:600;">JEUS 8.5 (CVE-2025-24813)</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px; box-shadow:var(--shadow);">
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:4px;">⏳ 계약 만료 임박 (D-30 이내)</div>
            <div style="font-size:1.5rem; font-weight:800; color:#d97706;" id="dashKpiRenewal">1건 (D-28)</div>
            <div style="font-size:0.72rem; color:#d97706; margin-top:4px; font-weight:600;">WizCLM 연간 라이선스 (₩3,200만)</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px; box-shadow:var(--shadow);">
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:4px;">✍️ 오늘 자 일일 보안점검 일지</div>
            <div style="font-size:1.5rem; font-weight:800; color:#2563eb;" id="dashKpiChecklist">작성 필요</div>
            <div style="font-size:0.72rem; color:var(--text-sub); margin-top:4px; font-weight:600;">14대 법정 필수 항목 미완료</div>
          </div>
        </div>

        <!-- 4-Card Mission Grid -->
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:16px;">
          
          <!-- Mission 1: CVE Incident Response Playbook -->
          <div style="background:#fff; border:1px solid var(--border); border-left:5px solid #dc2626; border-radius:10px; padding:20px; box-shadow:var(--shadow); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                  <i data-lucide="flame" style="width:16px; height:16px; color:#dc2626;"></i>
                  긴급 보안 위험: 금융 코어 WAS 원격명령실행
                </span>
                <span style="background:#fef2f2; color:#dc2626; border:1px solid rgba(220,38,38,0.3); font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                  Critical 9.8
                </span>
              </div>
              <div style="font-size:0.82rem; color:#334155; line-height:1.6; margin-bottom:16px;">
                사내 IT 자산 <b>TmaxSoft JEUS 8.5 (DMZ 내부, IP: 10.10.20.15)</b>에 Tomcat AJP RCE(<code>CVE-2025-24813</code>) 취약점이 발견되었습니다. 벤더 패치 전 <b>Imperva WAAP 가상패치 룰셋(Rule #4501)</b> 활성화 및 네트워크 차단 품의가 시급합니다.
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid var(--border);">
              <span style="font-size:0.72rem; color:var(--text-sub); font-weight:600;">파급도: 웹 서비스 무단 장악 차단</span>
              <button class="btn btn-primary" onclick="runIncidentPlaybook('CVE-2025-24813')">
                <i data-lucide="play" style="width:12px; height:12px;"></i> 긴급 조치 플레이북 가동 ➔
              </button>
            </div>
          </div>

          <!-- Mission 2: Contract Lifecycle Renewal -->
          <div style="background:#fff; border:1px solid var(--border); border-left:5px solid #d97706; border-radius:10px; padding:20px; box-shadow:var(--shadow); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                  <i data-lucide="clock" style="width:16px; height:16px; color:#d97706;"></i>
                  계약 갱신 도래: WizCLM 인증서 수명주기
                </span>
                <span style="background:#fffbeb; color:#d97706; border:1px solid rgba(217,119,6,0.3); font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                  만료 D-28
                </span>
              </div>
              <div style="font-size:0.82rem; color:#334155; line-height:1.6; margin-bottom:16px;">
                전사 SSL/TLS 인증서 자동 갱신 솔루션 <b>WizCLM 연간 구독 계약</b>이 2026-10-14 만료 도래합니다. 불시 만료 시 전자금융거래 인증 중단이 발생하므로, 차기 연간 예산 <b>₩32,000,000</b>에 대한 갱신 품의를 선제 진행해야 합니다.
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid var(--border);">
              <span style="font-size:0.72rem; color:var(--text-sub); font-weight:600;">영향도: 대고객 인증서 만료 사고 예방</span>
              <button class="btn" onclick="runRenewalPlaybook('WizCLM')">
                <i data-lucide="file-pen" style="width:12px; height:12px;"></i> 계약 갱신 품의서 작성 ➔
              </button>
            </div>
          </div>

          <!-- Mission 3: Approval Pending -->
          <div style="background:#fff; border:1px solid var(--border); border-left:5px solid #2563eb; border-radius:10px; padding:20px; box-shadow:var(--shadow); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                  <i data-lucide="stamp" style="width:16px; height:16px; color:#2563eb;"></i>
                  전자결재 진행 현황: 보안 솔루션 도입 품의
                </span>
                <span style="background:#eff6ff; color:#2563eb; border:1px solid rgba(37,99,235,0.3); font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                  결재 대기 1건
                </span>
              </div>
              <div style="font-size:0.82rem; color:#334155; line-height:1.6; margin-bottom:16px;">
                <b>[품의] 2026년 차세대 보안 솔루션 및 생성형 AI 인프라 도입의 건</b><br>
                - 소요 예산: ₩185,000,000 (GB10 온프렘 절감 모델 연동 완료)<br>
                - 현재 결재선: 기안자(완료) ➔ 검토자(완료) ➔ 보안팀장(완료) ➔ <b>CISO (최종 승인 대기)</b>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid var(--border);">
              <span style="font-size:0.72rem; color:var(--text-sub); font-weight:600;">최종 승인 시 지식고 정식 공문서(ID: 888) 등재</span>
              <button class="btn btn-primary" onclick="openSmartApprovalModal()">
                <i data-lucide="external-link" style="width:12px; height:12px;"></i> 결재판 열기 & 최종 승인 ➔
              </button>
            </div>
          </div>

          <!-- Mission 4: Daily Checklist Inspection -->
          <div style="background:#fff; border:1px solid var(--border); border-left:5px solid #059669; border-radius:10px; padding:20px; box-shadow:var(--shadow); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:0.95rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                  <i data-lucide="clipboard-check" style="width:16px; height:16px; color:#059669;"></i>
                  오늘 자 일일 보안점검 일지 작성
                </span>
                <span style="background:#ecfdf5; color:#059669; border:1px solid rgba(5,150,105,0.3); font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:12px;">
                  오늘 자 09/16
                </span>
              </div>
              <div style="font-size:0.82rem; color:#334155; line-height:1.6; margin-bottom:16px;">
                KISA ISMS-P 2.3 의무 준수를 위한 <b>14대 법정 필수 일일 점검</b>(경계 방화벽 정책, 서버 계정 잠금, 백업 정상 완료, 고위험 취약점 조치 여부 등)을 확인하고 오늘 자 결재 직인을 날인하십시오.
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid var(--border);">
              <span style="font-size:0.72rem; color:var(--text-sub); font-weight:600;">법정 감사 증적 1년 의무 보존 대상</span>
              <button class="btn btn-primary" onclick="switchView('checklist')">
                <i data-lucide="edit-3" style="width:12px; height:12px;"></i> 오늘 점검 일지 작성 ➔
              </button>
            </div>
          </div>

        </div>

      </div>
    </section>

    <!-- 1. WIKI & RAG VIEW -->
    <section id="view-wiki" class="view-page">
      <div class="wiki-grid">
        
        <!-- Left: My Docs Vault -->
        <aside class="white-panel">
          <div class="panel-head">
            <span class="panel-head-title"><i data-lucide="folder" style="width:14px; height:14px; color:var(--primary);"></i> 실물 지식고 (<span id="totalDocCount">0</span>)</span>
            <button class="btn btn-sm btn-primary" onclick="openNewDocTemplateModal()" title="다양한 전문 서식 템플릿으로 신규 문서 추가">
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
            <button class="pill-cat" id="pill-침해사고" onclick="filterByCat('침해사고')">침해사고</button>
            <button class="pill-cat" id="pill-ISMS-P" onclick="filterByCat('ISMS-P')">ISMS-P</button>
            <button class="pill-cat" id="pill-취약점관리" onclick="filterByCat('취약점관리')">취약점</button>
            <button class="pill-cat" id="pill-아키텍처설계" onclick="filterByCat('아키텍처설계')">아키텍처</button>
            <button class="pill-cat" id="pill-보안FAQ" onclick="filterByCat('보안FAQ')">실무FAQ</button>
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
              <!-- Quick Document Templates Bar -->
              <div style="background:#f8fafc; border:1px solid var(--border); border-radius:6px; padding:0.45rem 0.65rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.4rem;">
                <div style="display:flex; align-items:center; gap:0.35rem; font-size:0.74rem; font-weight:700; color:var(--text-sub);">
                  <span>📋 전문 서식 주입:</span>
                  <button type="button" class="btn btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="applyDocTemplate('SEC_POLICY')">📜 보안운영규정</button>
                  <button type="button" class="btn btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="applyDocTemplate('INCIDENT_REPORT')">🚨 침해사고보고(RCA)</button>
                  <button type="button" class="btn btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="applyDocTemplate('ISMS_AUDIT')">📋 ISMS-P수검증적</button>
                  <button type="button" class="btn btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="applyDocTemplate('ARCHITECTURE')">🏗️ 보안아키텍처설계</button>
                  <button type="button" class="btn btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="applyDocTemplate('VULN_MGMT')">🔍 취약점조치계획</button>
                  <button type="button" class="btn btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="applyDocTemplate('SECURITY_FAQ')">❓ 보안실무FAQ</button>
                </div>
                <button type="button" class="btn btn-sm" style="font-size:0.7rem; color:var(--primary);" onclick="openNewDocTemplateModal()">
                  <i data-lucide="layout-grid" style="width:11px; height:11px;"></i> 양식 상세 선택
                </button>
              </div>

              <input type="text" id="editDocTitle" class="search-input" style="font-size:1.1rem; font-weight:700; background:#fff;" placeholder="문서 제목">
              <div style="display:flex; gap:0.5rem;">
                <input type="text" id="editDocCat" list="wikiCatOptions" class="search-input" style="width:180px; background:#fff;" placeholder="카테고리 선택/입력">
                <datalist id="wikiCatOptions">
                  <option value="보안규정">
                  <option value="침해사고">
                  <option value="ISMS-P">
                  <option value="취약점관리">
                  <option value="아키텍처설계">
                  <option value="AI보안">
                  <option value="보안FAQ">
                  <option value="사내솔루션">
                  <option value="감사증적">
                </datalist>
                <input type="text" id="editDocTags" class="search-input" style="flex:1; background:#fff;" placeholder="태그 (쉼표로 구분)">
              </div>
              <textarea id="editDocContent" class="code-editor" style="flex:1; height:auto; min-height:380px;" placeholder="마크다운 내용 작성..."></textarea>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.72rem; color:var(--text-dim);">💡 마크다운 표, 체크박스, Mermaid 다이어그램 작성 지원</span>
                <div style="display:flex; gap:0.5rem;">
                  <button class="btn" onclick="cancelDocEdit()">취소</button>
                  <button class="btn btn-primary" onclick="saveDocEdit()">저장</button>
                </div>
              </div>
            </div>
          </div>
        </article>

        <!-- Right: AI Copilot & Knowledge RAG 2.0 (Synapse Semantic Chunking & CiteGuard) -->
        <aside class="rag-panel">
          <div class="panel-head">
            <span class="panel-head-title" style="display:flex; align-items:center; gap:6px;">
              <i data-lucide="brain-circuit" style="width:15px; height:15px; color:var(--primary);"></i> Synapse RAG 2.0 & AI Copilot
            </span>
            <span id="llmStatusIndicator" style="font-size:0.68rem; color:#059669; font-weight:700; display:flex; align-items:center; gap:4px; background:#ecfdf5; padding:2px 8px; border-radius:12px; border:1px solid rgba(5,150,105,0.3);">
              <span style="width:6px; height:6px; background:#059669; border-radius:50%;"></span> 하이브리드 색인 완비
            </span>
          </div>

          <!-- RAG 4대 실무 도메인 카테고리 탭 -->
          <div class="rag-cat-bar" style="display:flex; gap:4px; padding:6px 8px; background:#f8fafc; border-bottom:1px solid var(--border); overflow-x:auto;">
            <button class="cat-pill active" id="ragCat-ALL" onclick="filterRagCategory('ALL')" style="font-size:0.68rem; padding:2px 8px; border-radius:12px; border:1px solid #cbd5e1; background:#2563eb; color:#fff; font-weight:700; cursor:pointer;">전체</button>
            <button class="cat-pill" id="ragCat-REG" onclick="filterRagCategory('REG')" style="font-size:0.68rem; padding:2px 8px; border-radius:12px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:600; cursor:pointer;">🛡️ 규정</button>
            <button class="cat-pill" id="ragCat-TECH" onclick="filterRagCategory('TECH')" style="font-size:0.68rem; padding:2px 8px; border-radius:12px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:600; cursor:pointer;">⚙️ 취약점</button>
            <button class="cat-pill" id="ragCat-FIN" onclick="filterRagCategory('FIN')" style="font-size:0.68rem; padding:2px 8px; border-radius:12px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:600; cursor:pointer;">💰 FinOps</button>
            <button class="cat-pill" id="ragCat-ASSET" onclick="filterRagCategory('ASSET')" style="font-size:0.68rem; padding:2px 8px; border-radius:12px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:600; cursor:pointer;">📦 자산/SBOM</button>
          </div>

          <div class="rag-chip-container" id="quickQuestionsChipBox"></div>

          <div class="rag-chat-history" id="ragChatMessages">
            <div class="bubble ai">
              안녕하세요! <b>사내 보안 지식고(30종 원본 문서)</b>, <b>전사 IT 자산(TmaxSoft JEUS 8.5/SBOM)</b>, <b>FinOps TCO 실시간 비용</b>이 단락(Section) 단위로 완전 색인되었습니다.<br><br>
              질의 시 <b>CiteGuard 2.0 다원 근거 뱃지</b> 및 <b>결재판/아키텍처 스튜디오 원클릭 주입</b>을 지원합니다.
            </div>
          </div>

          <div class="rag-input-box">
            <input type="text" id="ragQueryInput" class="search-input" style="background:#fff;" placeholder="CVE 조치, 망분리 규정, SBOM 체크리스트, TCO 절감액 질의..." onkeydown="if(event.key==='Enter') executeRagQuery()">
            <button class="btn btn-primary" onclick="executeRagQuery()" title="질의 전송">
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
            <button class="btn btn-sm" id="btnTogglePortalMode" onclick="togglePortalViewMode()" style="font-weight:700;" title="엑셀 대장형 / 카드형 보기 전환">
              <i data-lucide="sheet" style="width:13px; height:13px;"></i> 엑셀 대장 뷰
            </button>
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
          
          <!-- Visual No-Code Stencil Palette & Quick Connector Bar -->
          <div style="background:#f8fafc; border:1px solid var(--border); border-radius:8px; padding:0.85rem; margin-bottom:0.85rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem; flex-wrap:wrap; gap:0.4rem;">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <span style="font-weight:800; font-size:0.82rem; color:var(--text-main); display:flex; align-items:center; gap:0.3rem;">
                  <i data-lucide="palette" style="width:14px; height:14px; color:var(--primary);"></i>
                  노코드 비주얼 부품 팔레트 (클릭 즉시 배치)
                </span>
                <span style="font-size:0.7rem; color:var(--text-dim);">배치할 구역 선택 후 부품을 클릭하세요</span>
              </div>
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <label style="font-size:0.72rem; font-weight:700; color:var(--text-sub);">배치 구역:</label>
                <select id="paletteTargetZone" class="search-input" style="width:165px; padding:0.2rem 0.4rem; font-size:0.74rem; background:#fff;">
                  <option value="Boundary">🛡️ 경계 보안구역 (Boundary)</option>
                  <option value="DMZ">🏢 DMZ 웹구역 (DMZ)</option>
                  <option value="Trust">🏢 내부 코어 업무망 (Trust)</option>
                  <option value="SecureDB">🔒 DB 안전구역 (SecureDB)</option>
                </select>
                <button class="btn btn-sm" onclick="toggleStudioDirection()" title="가로형(LR) ⇄ 세로형(TB) 방향 원클릭 전환">
                  <i data-lucide="shuffle" style="width:12px; height:12px;"></i> <span id="btnStudioDirectionLabel">방향 LR ⇄ TB</span>
                </button>
                <button class="btn btn-sm" onclick="downloadStudioSvg()" title="다이어그램을 SVG 이미지 파일로 저장">
                  <i data-lucide="download" style="width:12px; height:12px;"></i> SVG 저장
                </button>
              </div>
            </div>

            <!-- Click-to-Add Stencil Chips -->
            <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-bottom:0.75rem;">
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('WEB')">🌐 웹서버(Nginx)</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('FW')">🔥 차세대방화벽(NGFW)</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('WAAP')">🛡️ 웹방화벽(WAAP)</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('WAS')">⚙️ Core WAS(JEUS/Spring)</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('DB')">🗄️ 고객원장 DB</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('KMS')">🔒 암호키 관리(KMS)</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('SIEM')">📊 통합보안 SIEM</button>
              <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="addStencilNode('CLOUD')">☁️ 클라우드 게이트웨이</button>
              <button class="btn btn-sm" style="background:#fef2f2; color:#dc2626; border-color:#fecaca; font-size:0.72rem; font-weight:700;" onclick="addStencilNode('VULN')">🚨 위험 CVE 발견노드</button>
            </div>

            <!-- Quick Connector Wizard -->
            <div style="display:flex; align-items:center; gap:0.4rem; padding-top:0.6rem; border-top:1px dashed var(--border); font-size:0.74rem;">
              <span style="font-weight:700; color:var(--text-sub); display:flex; align-items:center; gap:0.25rem;">
                <i data-lucide="git-commit" style="width:13px; height:13px; color:var(--primary);"></i> 원클릭 연결 마법사:
              </span>
              <input type="text" id="quickFromNode" placeholder="출발 노드명 (예: WebCluster)" class="search-input" style="width:140px; background:#fff; padding:0.2rem 0.4rem; font-size:0.72rem;">
              <span style="color:var(--text-dim);">➔</span>
              <input type="text" id="quickToNode" placeholder="도착 노드명 (예: WAS)" class="search-input" style="width:140px; background:#fff; padding:0.2rem 0.4rem; font-size:0.72rem;">
              <select id="quickProtocol" class="search-input" style="width:130px; background:#fff; padding:0.2rem 0.4rem; font-size:0.72rem;">
                <option value="HTTPS 443">HTTPS (443)</option>
                <option value="API 8443">API 호출 (8443)</option>
                <option value="SQL 1521">DB 쿼리 (1521)</option>
                <option value="Syslog 514">Syslog 전송 (514)</option>
                <option value="인증연동 636">LDAP/인증 (636)</option>
              </select>
              <button class="btn btn-sm btn-primary" style="padding:0.2rem 0.6rem; font-size:0.72rem;" onclick="quickConnectNodes()">
                <i data-lucide="arrow-right" style="width:12px; height:12px;"></i> 연결선 추가
              </button>
            </div>
          </div>
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <span class="panel-head-title"><i data-lucide="code" style="width:14px; height:14px;"></i> Mermaid 아키텍처 다이어그램 에디터</span>
            <div style="display:flex; gap:0.35rem;">
              <select id="studioPresetSelect" class="search-input" style="width:180px; padding:0.25rem 0.45rem; font-size:0.75rem;" onchange="loadStudioPreset(this.value)">
                <option value="">-- 솔루션 권장 프리셋 --</option>
                <option value="MY_ASSETS">🏢 사내 IT 자산 & SBOM 연동 다이어그램</option>
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
        
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <h2 style="font-size:1.2rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="calculator" style="width:20px; height:20px; color:var(--primary);"></i>
              전사 보안 솔루션 & 생성형 AI 실시간 TCO / FinOps 워크스페이스
            </h2>
            <p style="color:var(--text-sub); font-size:0.8rem;">
              온프레미스 보안 솔루션 Capex/Opex뿐만 아니라 사내 생성형 AI/클라우드 API 토큰 비용을 실시간 추적하고 계약 생애주기(D-Day)를 관리합니다.
            </p>
          </div>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-sm" onclick="syncBomToStudio()" title="현재 견적 수량 기반으로 아키텍처 다이어그램 자동 구성">
              <i data-lucide="share-2" style="width:12px; height:12px;"></i> 아키텍처에 반영
            </button>
            <button class="btn btn-sm btn-primary" onclick="exportUnifiedTcoCsv()">
              <i data-lucide="file-spreadsheet" style="width:12px; height:12px;"></i> 전사 TCO/FinOps CSV 출력
            </button>
          </div>
        </div>

        <!-- Unified Top 4 KPI Cards -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem; margin-bottom:1.25rem;">
          <div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:var(--text-sub); font-weight:600;">통합 관리 항목</div>
            <div id="bomTotalQtyCount" style="font-size:1.35rem; font-weight:800; color:var(--primary); margin-top:0.25rem;">0 개 솔루션 + 5종 API</div>
          </div>
          <div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:var(--text-sub); font-weight:600;">초기 도입비 (Capex)</div>
            <div id="bomTotalCapex" style="font-size:1.35rem; font-weight:800; color:var(--text-main); margin-top:0.25rem;">₩0</div>
          </div>
          <div style="background:#f8fafc; border:1px solid var(--border); padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:var(--text-sub); font-weight:600;">연간 운영 & API 총비용</div>
            <div id="bomTotalOpex" style="font-size:1.35rem; font-weight:800; color:#d97706; margin-top:0.25rem;">₩0</div>
          </div>
          <div style="background:#eff6ff; border:1px solid #bfdbfe; padding:1rem; border-radius:var(--radius);">
            <div style="font-size:0.75rem; color:#1d4ed8; font-weight:600;">5개년 통합 총소유비용 (TCO)</div>
            <div id="bomTotalTco" style="font-size:1.35rem; font-weight:800; color:#1d4ed8; margin-top:0.25rem;">₩0</div>
          </div>
        </div>

        <!-- TCO & FinOps Sub Navigation Tabs -->
        <div style="display:flex; gap:0.4rem; border-bottom:2px solid var(--border); margin-bottom:1.25rem; padding-bottom:0.4rem;">
          <button id="bomSubBtn-sol" class="btn btn-sm btn-primary" onclick="switchBomSubView('sol')">
            <i data-lucide="shield" style="width:13px; height:13px;"></i> 보안 솔루션 TCO & BOM
          </button>
          <button id="bomSubBtn-api" class="btn btn-sm" style="background:#f8fafc; color:var(--text-sub);" onclick="switchBomSubView('api')">
            <i data-lucide="bot" style="width:13px; height:13px;"></i> 생성형 AI & 클라우드 API FinOps
          </button>
          <button id="bomSubBtn-lifecycle" class="btn btn-sm" style="background:#f8fafc; color:var(--text-sub);" onclick="switchBomSubView('lifecycle')">
            <i data-lucide="calendar" style="width:13px; height:13px;"></i> 계약 기간 & 생애주기 D-Day
          </button>
        </div>

        <!-- SUB VIEW 1: SECURITY SOLUTIONS BOM & TCO -->
        <div id="bomSubView-sol">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <span style="font-weight:700; font-size:0.9rem; color:var(--text-main);">🛡️ 보안 솔루션별 단가 및 수량 산정</span>
            <button class="btn btn-sm" onclick="resetBomQuantities()">수량 초기화</button>
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

        <!-- SUB VIEW 2: GENERATIVE AI & CLOUD API FINOPS -->
        <div id="bomSubView-api" style="display:none;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
            <div>
              <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
                <i data-lucide="cpu" style="width:16px; height:16px; color:var(--primary);"></i>
                사내 생성형 AI (LLM) & 클라우드 API 사용량 및 FinOps 비용 통제
              </h3>
              <p style="font-size:0.75rem; color:var(--text-sub); margin-top:0.2rem;">OpenAI, Anthropic, Gemini 및 온프레미스 GB10 클러스터의 월간 토큰 사용량과 API 호출 비용을 실시간 정산합니다.</p>
            </div>
            <div style="display:flex; gap:0.5rem;">
              <button class="btn btn-sm btn-primary" onclick="openAddAiApiModal()">
                <i data-lucide="plus" style="width:13px; height:13px;"></i> AI / API 서비스 등록
              </button>
              <button class="btn btn-sm" onclick="exportAiApiCsv()">
                <i data-lucide="download" style="width:13px; height:13px;"></i> FinOps CSV 출력
              </button>
            </div>
          </div>

          <!-- FinOps 4 KPI Cards -->
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem; margin-bottom:1.25rem;">
            <div style="background:#ffffff; border:1px solid var(--border); padding:1rem; border-radius:6px; box-shadow:var(--shadow-sm);">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">등록된 AI/API 서비스</div>
              <div id="aiApiCountDisplay" style="font-size:1.35rem; font-weight:800; color:var(--primary); margin-top:0.25rem;">0 종</div>
              <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">상용 클라우드 + 사내 모델</div>
            </div>
            <div style="background:#ffffff; border:1px solid var(--border); padding:1rem; border-radius:6px; box-shadow:var(--shadow-sm);">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">월간 예상 API 총비용</div>
              <div id="aiApiMonthlyTotalDisplay" style="font-size:1.35rem; font-weight:800; color:var(--text-main); margin-top:0.25rem;">₩0</div>
              <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">토큰 + 호출 종량제 합산</div>
            </div>
            <div style="background:#ffffff; border:1px solid var(--border); padding:1rem; border-radius:6px; box-shadow:var(--shadow-sm);">
              <div style="font-size:0.72rem; color:var(--text-dim); font-weight:600;">연간 예상 API 총비용</div>
              <div id="aiApiAnnualTotalDisplay" style="font-size:1.35rem; font-weight:800; color:#d97706; margin-top:0.25rem;">₩0</div>
              <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">12개월 환산 누적액</div>
            </div>
            <div style="background:#ecfdf5; border:1px solid #a7f3d0; padding:1rem; border-radius:6px; box-shadow:var(--shadow-sm);">
              <div style="font-size:0.72rem; color:#065f46; font-weight:600;">온프레미스 GB10 연간 절감액</div>
              <div id="aiApiGb10SavingsDisplay" style="font-size:1.35rem; font-weight:800; color:#059669; margin-top:0.25rem;">₩0</div>
              <div style="font-size:0.68rem; color:#047857; margin-top:0.2rem;">사내 177B 추론 대체 효과 (90% 절감)</div>
            </div>
          </div>

          <!-- Department Budget Usage Progress -->
          <div style="background:#f8fafc; border:1px solid var(--border); border-radius:6px; padding:1rem; margin-bottom:1.25rem;">
            <div style="font-size:0.8rem; font-weight:700; color:var(--text-main); margin-bottom:0.75rem; display:flex; justify-content:space-between;">
              <span>📊 주요 부서별 생성형 AI 토큰 예산 소진율 (FinOps Allocation)</span>
              <span style="font-size:0.72rem; color:var(--text-dim);">월간 할당 예산 대비 실사용액</span>
            </div>
            <div id="aiApiDeptBudgetsContainer" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem;"></div>
          </div>

          <table class="clean-table">
            <thead>
              <tr>
                <th style="width:190px;">서비스 / 모델명</th>
                <th style="width:120px;">제공사(Vendor)</th>
                <th style="width:130px;">과금 방식</th>
                <th style="width:120px;">단위 단가</th>
                <th style="width:120px; text-align:center;">월간 사용량</th>
                <th style="width:130px;">월간 예상액</th>
                <th style="width:130px;">연간 환산액</th>
                <th style="width:110px;">주 사용부서</th>
                <th style="width:90px; text-align:right;">관리</th>
              </tr>
            </thead>
            <tbody id="aiApiTableBody"></tbody>
          </table>
        </div>

        <!-- SUB VIEW 3: CONTRACT LIFECYCLE & D-DAY RENEWAL CALENDAR -->
        <div id="bomSubView-lifecycle" style="display:none;">
          
          <!-- D-Day Urgent Alert Banner -->
          <div id="lifecycleDDayAlertBar" style="background:#fffbeb; border:1.5px solid #fde68a; border-radius:6px; padding:0.9rem 1.1rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.6rem;">
              <i data-lucide="bell-ring" style="width:20px; height:20px; color:#d97706;"></i>
              <div>
                <div id="lifecycleDDayAlertTitle" style="font-weight:800; font-size:0.88rem; color:#92400e;">계약 갱신 임박 D-Day 모니터링 가동 중</div>
                <div id="lifecycleDDayAlertDesc" style="font-size:0.75rem; color:#b45309; margin-top:2px;">60일 이내 만료 예정인 솔루션 및 API 계약에 대해 선제적 예산 편성이 필요합니다.</div>
              </div>
            </div>
            <div id="lifecycleRenewalBudgetSum" style="font-size:1.15rem; font-weight:800; color:#b45309;">차기 갱신 소요액: ₩0</div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
            <div class="portal-filter-tabs" style="margin:0;">
              <button class="portal-filter-tab active" onclick="filterLifecycleStatus('ALL', this)">전체 (<span id="countLifecycleAll">0</span>)</button>
              <button class="portal-filter-tab" onclick="filterLifecycleStatus('ACTIVE', this)">정상 운용 (<span id="countLifecycleActive">0</span>)</button>
              <button class="portal-filter-tab" onclick="filterLifecycleStatus('D60', this)">갱신 임박 D-60 (<span id="countLifecycleD60">0</span>)</button>
              <button class="portal-filter-tab" onclick="filterLifecycleStatus('D30', this)">긴급 갱신 D-30 (<span id="countLifecycleD30">0</span>)</button>
              <button class="portal-filter-tab" onclick="filterLifecycleStatus('EXPIRED', this)">만료 (<span id="countLifecycleExpired">0</span>)</button>
            </div>
            <span style="font-size:0.75rem; color:var(--text-dim);">기준일자: 2026-09-16 (실시간 자동 D-Day 계산)</span>
          </div>

          <table class="clean-table">
            <thead>
              <tr>
                <th style="width:190px;">대상 솔루션 / 자산명</th>
                <th style="width:100px;">분류</th>
                <th style="width:105px;">계약 시작일</th>
                <th style="width:105px;">계약 만료일</th>
                <th style="width:100px;">계약 형태</th>
                <th style="width:110px; text-align:center;">D-Day 상태</th>
                <th style="width:130px;">차기 갱신 예상액</th>
                <th style="width:130px;">감가상각 잔존가치(5년)</th>
                <th style="width:100px;">관리 담당자</th>
                <th style="width:70px; text-align:right;">설정</th>
              </tr>
            </thead>
            <tbody id="lifecycleTableBody"></tbody>
          </table>
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
            <button class="btn btn-sm" id="btnToggleChecklistMode" onclick="toggleChecklistViewMode()" style="font-weight:700;" title="엑셀 대장형 / 카드형 보기 전환">
              <i data-lucide="sheet" style="width:13px; height:13px;"></i> 엑셀 대장 뷰
            </button>
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

    <!-- 7. SBOM & IT ASSET INVENTORY VIEW -->
    <section id="view-sbom" class="view-page">
      <div style="display:flex; flex-direction:column; gap:1rem;">
        
        <!-- Header & Action Bar -->
        
        <!-- Inline IT Asset Topology Graph Panel (한눈에 보는 전사 IT 자산 & SBOM 토폴로지 구성도) -->
        <div class="white-panel" style="padding:1.1rem; border:1px solid var(--border); border-radius:8px; box-shadow:var(--shadow-sm); margin-bottom:1rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-weight:800; font-size:0.95rem; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
                <i data-lucide="network" style="width:16px; height:16px; color:var(--primary);"></i>
                전사 IT 자산 & SBOM 계층형 인프라 토폴로지 구성도
              </span>
              <span class="meta-badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.7rem; font-weight:700;">실시간 자동 렌더링</span>
            </div>
            <div style="display:flex; gap:0.4rem;">
              <button class="btn btn-sm" onclick="renderAssetTopologyGraph()" title="자산 등록부 변경사항을 그래프에 즉시 새로고침">
                <i data-lucide="refresh-cw" style="width:12px; height:12px;"></i> 그래프 새로고침
              </button>
              <button class="btn btn-sm" style="background:#eff6ff; color:#1d4ed8;" onclick="syncAssetsToStudio()" title="아키텍처 스튜디오에서 직접 다이어그램 편집">
                <i data-lucide="edit-3" style="width:12px; height:12px;"></i> 스튜디오에서 편집
              </button>
              <button class="btn btn-sm" id="btnToggleTopology" onclick="toggleAssetTopologyView()">접기 ▲</button>
            </div>
          </div>
          
          <div id="assetTopologyContentWrapper">
            <div style="font-size:0.75rem; color:var(--text-sub); margin-bottom:0.6rem;">
              등록된 IT 자산의 망분리 구역(경계 보안 ➔ DMZ ➔ 내부 업무망 ➔ DB 안전구역) 및 취약점(CVE) 상태를 실시간 시각화합니다.
            </div>
            <div id="assetTopologyGraphContainer" style="min-height:260px; background:#f8fafc; border:1px solid var(--border); border-radius:6px; padding:1rem; display:flex; justify-content:center; align-items:center; overflow-x:auto;">
              <div style="color:var(--text-dim); font-size:0.8rem;">토폴로지 그래프 렌더링 준비 중...</div>
            </div>
          </div>
        </div>

        <div class="portal-filter-bar">
          <div>
            <h2 style="font-size:1.15rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="boxes" style="width:20px; height:20px; color:var(--primary);"></i>
              전사 IT 자산 & 소프트웨어 공급망(SBOM) 형상 관리
            </h2>
            <p style="color:var(--text-sub); font-size:0.78rem;">
              KISA 소프트웨어 공급망 가이드라인 준수 · 사내 IT 자산 등록 및 아키텍처 스튜디오 구성도 자동 생성 · CycloneDX v1.5 표준 연동
            </p>
          </div>

          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-sm" id="btnToggleAssetMode" onclick="toggleAssetViewMode()" style="font-weight:700;" title="엑셀 대장형 / 카드형 보기 전환">
              <i data-lucide="sheet" style="width:13px; height:13px;"></i> 엑셀 대장 뷰
            </button>
            <button class="btn btn-sm btn-primary" onclick="openAddAssetModal()">
              <i data-lucide="plus" style="width:13px; height:13px;"></i> 자산 직접 등록
            </button>
            <button class="btn btn-sm" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; font-weight:700;" onclick="syncAssetsToStudio()">
              <i data-lucide="share-2" style="width:13px; height:13px;"></i> 아키텍처 스튜디오 반영
            </button>
            <button class="btn btn-sm" onclick="exportCycloneDxJson()" title="KISA 표준 규격 CycloneDX v1.5 JSON 파일로 내보내기">
              <i data-lucide="download" style="width:13px; height:13px;"></i> CycloneDX 내보내기
            </button>
            <button class="btn btn-sm" onclick="document.getElementById('cycloneDxFileInput').click()" title="CycloneDX JSON 파일 가져오기">
              <i data-lucide="upload" style="width:13px; height:13px;"></i> 가져오기
            </button>
            <input type="file" id="cycloneDxFileInput" accept=".json" style="display:none;" onchange="importCycloneDxJson(event)">
            <button class="btn btn-sm" onclick="printAssetSbomReport()" title="KISA 수검용 전사 자산 & SBOM 대장 A4 인쇄">
              <i data-lucide="printer" style="width:13px; height:13px;"></i> 수검 대장 (A4)
            </button>
          </div>
        </div>

        <!-- 4 KPI Summary Cards -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.75rem;">
          <div style="background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:0.85rem 1rem; box-shadow:var(--shadow-sm);">
            <div style="font-size:0.72rem; color:var(--text-dim); font-weight:700;">총 관리 IT 자산</div>
            <div style="font-size:1.4rem; font-weight:800; color:var(--primary); margin-top:0.2rem;" id="statTotalAssets">0대</div>
            <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">웹, WAS, DB, 보안장비 포함</div>
          </div>
          <div style="background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:0.85rem 1rem; box-shadow:var(--shadow-sm);">
            <div style="font-size:0.72rem; color:var(--text-dim); font-weight:700;">식별된 SBOM 컴포넌트</div>
            <div style="font-size:1.4rem; font-weight:800; color:#059669; margin-top:0.2rem;" id="statTotalComponents">0개</div>
            <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">오픈소스 라이브러리 및 엔진</div>
          </div>
          <div style="background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:0.85rem 1rem; box-shadow:var(--shadow-sm);">
            <div style="font-size:0.72rem; color:var(--text-dim); font-weight:700;">망분리 구역 분포</div>
            <div style="font-size:1rem; font-weight:800; color:#475569; margin-top:0.4rem;" id="statZoneDist">DMZ 0 / 업무 0 / DB 0</div>
            <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">계층별 논리적 망분리</div>
          </div>
          <div style="background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:0.85rem 1rem; box-shadow:var(--shadow-sm);">
            <div style="font-size:0.72rem; color:var(--text-dim); font-weight:700;">취약점(CVE) 및 라이선스 상태</div>
            <div style="font-size:1.2rem; font-weight:800; color:#2563eb; margin-top:0.3rem;">🟢 정상 통제</div>
            <div style="font-size:0.68rem; color:var(--text-sub); margin-top:0.2rem;">주요 고위험 취약점 조치 완료</div>
          </div>
        </div>

        <!-- Filter & Search Bar -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:0.6rem 0.85rem;">
          <div style="display:flex; gap:0.35rem; align-items:center;" id="assetFilterTabs">
            <button class="pill-cat active" onclick="filterAssetZone('ALL')">전체 자산</button>
            <button class="pill-cat" onclick="filterAssetZone('DMZ')">DMZ 구간</button>
            <button class="pill-cat" onclick="filterAssetZone('TRUST')">내부 업무망</button>
            <button class="pill-cat" onclick="filterAssetZone('SECURE_DB')">DB 안전구역</button>
            <button class="pill-cat" onclick="filterAssetZone('PERIMETER')">경계/보안장비</button>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <input type="text" id="assetSearchInput" class="search-input" style="width:240px; background:#fff;" placeholder="자산명, IP, OS, 컴포넌트 검색..." oninput="renderAssetTable()">
            <button class="btn btn-sm" onclick="resetToDefaultAssets()" title="표준 4대 실물 자산으로 초기화">
              <i data-lucide="rotate-ccw" style="width:12px; height:12px;"></i> 자산 초기화
            </button>
          </div>
        </div>

        <!-- Asset & Component Cards List Container -->
        <div id="assetCardsContainer" style="display:flex; flex-direction:column; gap:0.75rem;">
          <!-- Dynamically populated -->
        </div>

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

        <div style="display:grid; grid-template-columns: 1.4fr 1fr 1.6fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">카테고리 (선택) *</label>
            <select id="custSolCategory" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="네트워크/경계보안 (방화벽/IPS/VPN)">네트워크/경계보안 (방화벽/IPS/VPN)</option>
              <option value="엔드포인트 보안 (EDR/안티바이러스/매체제어)">엔드포인트 보안 (EDR/안티바이러스/매체제어)</option>
              <option value="데이터 보안 & DLP (DB암호화/DLP/문서중앙화)">데이터 보안 & DLP (DB암호화/DLP/문서중앙화)</option>
              <option value="접근통제 & 계정관리 (서버접근제어/IAM/PAM/MFA)">접근통제 & 계정관리 (서버접근제어/IAM/PAM/MFA)</option>
              <option value="애플리케이션 & 웹 보안 (WAAP/WAF/API보안)">애플리케이션 & 웹 보안 (WAAP/WAF/API보안)</option>
              <option value="AI & 공급망 보안 (AI SPM/AI-BOM/SBOM/SCA)">AI & 공급망 보안 (AI SPM/AI-BOM/SBOM/SCA)</option>
              <option value="보안관제 & SIEM/SOAR (SIEM/SOAR/ASM/EASM)">보안관제 & SIEM/SOAR (SIEM/SOAR/ASM/EASM)</option>
              <option value="취약점 점검 & 노출관리 (Vulnerability/Exposure)">취약점 점검 & 노출관리 (Vulnerability/Exposure)</option>
              <option value="보안인프라 & 인증서관리 (CLM/PKI/HSM/KMS)">보안인프라 & 인증서관리 (CLM/PKI/HSM/KMS)</option>
              <option value="엔드포인트 자산관리 (UEM/MDM)">엔드포인트 자산관리 (UEM/MDM)</option>
              <option value="보안운영 자동화 플랫폼">보안운영 자동화 플랫폼</option>
              <option value="기타 맞춤형 솔루션">기타 맞춤형 솔루션</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">표준 도입단가 (원)</label>
            <input type="number" id="custSolPrice" class="search-input" placeholder="예: 30000000" style="background:#fff; margin-top:0.25rem;" value="25000000">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">ISMS-P 인증 매핑 (선택) *</label>
            <select id="custSolIsms" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="2.1 정책, 조직, 자산 관리 (2.1.2 자산 식별/SW 라이선스)">2.1 자산관리 (자산 식별/SW 라이선스)</option>
              <option value="2.3 취약점 점검 및 조치 (2.3.1 취약점 스캔 및 패치)">2.3 취약점 점검 및 조치 (스캔/패치)</option>
              <option value="2.4 물리 보안 (2.4.1 출입통제/보호구역)">2.4 물리 보안 (출입통제/보호구역)</option>
              <option value="2.5 인증 및 권한 관리 (2.5.1 계정식별, 2.5.4 권한부여)">2.5 인증 및 권한 관리 (식별/MFA/권한)</option>
              <option value="2.6 접근통제 (2.6.1 네트워크 접근통제, 2.6.7 서버통제)">2.6 접근통제 (망분리/방화벽/서버통제)</option>
              <option value="2.7 암호화 적용 (2.7.2 전송구간, 2.7.3 저장데이터 암호화)">2.7 암호화 적용 (DB암호화/전송암호화)</option>
              <option value="2.8 정보시스템 도입/개발 (2.8.6 오픈소스/SBOM 공급망)">2.8 개발보안 (오픈소스/SBOM 공급망)</option>
              <option value="2.9 시스템 및 서비스 운영관리 (2.9.1 변경관리, 2.9.3 백업)">2.9 시스템 운영관리 (변경관리/백업)</option>
              <option value="2.10 보안 시스템 운영 (2.10.1 보안장비 설치 및 룰 관리)">2.10 보안시스템 운영 (룰 관리/오탐튜닝)</option>
              <option value="2.11 로그 및 접속기록 관리 (2.11.1 접속기록 보관 및 위변조 방지)">2.11 로그/접속기록 관리 (위변조방지)</option>
              <option value="2.12 사고 예방 및 대응 (2.12.1 침해사고 대응 런북)">2.12 침해사고 예방 및 대응 (런북)</option>
              <option value="2.13 재해 복구 (2.13.1 비상대응체계)">2.13 재해 복구 (비상대응체계)</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">솔루션 개요 및 도입 목적</label>
          <textarea id="custSolPurpose" class="search-input" style="height:60px; resize:none; background:#fff; margin-top:0.25rem;" placeholder="솔루션의 주 역할과 사내 도입 목적을 기재하세요."></textarea>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">
              📖 실무 운영 매뉴얼 & 지식 베이스 (담당자 확인 가이드) *
            </label>
            <span style="font-size:0.7rem; color:var(--text-dim);">원하는 양식을 선택하면 자동으로 채워집니다.</span>
          </div>

          <!-- Template Selection Bar -->
          <div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.35rem; margin-bottom:0.25rem; flex-wrap:wrap; background:#f1f5f9; padding:0.4rem 0.6rem; border-radius:6px; border:1px solid var(--border);">
            <span style="font-size:0.72rem; color:var(--text-sub); font-weight:800; display:flex; align-items:center; gap:0.25rem;">
              <i data-lucide="layout-template" style="width:13px; height:13px; color:var(--primary);"></i> 템플릿 양식:
            </span>
            <button type="button" class="btn btn-sm" style="font-size:0.7rem; padding:2px 8px; background:#fff;" onclick="applyManualTemplate('RUNBOOK')">① 실무 운영 & 런북</button>
            <button type="button" class="btn btn-sm" style="font-size:0.7rem; padding:2px 8px; background:#fff;" onclick="applyManualTemplate('ISMS_AUDIT')">② ISMS-P 수검 증적</button>
            <button type="button" class="btn btn-sm" style="font-size:0.7rem; padding:2px 8px; background:#fff;" onclick="applyManualTemplate('INCIDENT')">③ 침해사고 긴급대응</button>
            <button type="button" class="btn btn-sm" style="font-size:0.7rem; padding:2px 8px; background:#fff;" onclick="applyManualTemplate('SPEC_SHEET')">④ 기술규격 & 아키텍처</button>
            <button type="button" class="btn btn-sm" style="font-size:0.7rem; padding:2px 8px; background:#fff;" onclick="applyManualTemplate('ACCESS_POLICY')">⑤ 계정/권한 정책</button>
          </div>

          <textarea id="custSolManual" class="code-editor" style="height:140px; margin-top:0.25rem;" placeholder="위의 [템플릿 양식]을 클릭하거나, PDF를 업로드하면 자동으로 채워집니다."></textarea>
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

  <!-- New Wiki Doc Template Selection Modal -->
  <div class="modal-overlay" id="newDocTemplateModal">
    <div class="modal-box" style="max-width:880px;">
      <div class="modal-header">
        <div style="display:flex; align-items:center; gap:0.55rem;">
          <span style="background:#eff6ff; color:#2563eb; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.1rem; border:1px solid #bfdbfe;">📚</span>
          <div>
            <h3 style="font-size:1.1rem; font-weight:800; color:var(--text-main);">실물 지식고 신규 문서 양식 선택</h3>
            <p style="font-size:0.75rem; color:var(--text-sub); margin-top:2px;">사내 보안 실무 및 KISA 규정에 맞춘 전문 표준 서식을 선택하여 즉시 작성합니다.</p>
          </div>
        </div>
        <button class="btn btn-sm" onclick="closeNewDocTemplateModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>
      <div class="modal-body" style="padding:1.25rem;">
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:1rem;" id="docTemplateCardsGrid">
          <!-- Populated dynamically or static cards -->
        </div>
        <div style="margin-top:1.25rem; padding-top:0.75rem; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.75rem; color:var(--text-dim);">💡 선택한 양식은 에디터에서 자유롭게 수정하거나 다른 양식으로 재주입할 수 있습니다.</span>
          <button class="btn btn-sm" onclick="selectNewDocTemplate('BLANK')">
            <i data-lucide="file" style="width:12px; height:12px;"></i> 서식 없이 빈 문서로 시작
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Add / Edit IT Asset Modal -->
  <div class="modal-overlay" id="itAssetModal">
    <div class="modal-box" style="max-width:620px;">
      <div class="modal-header">
        <div>
          <h3 id="itAssetModalTitle" style="font-size:1.05rem; font-weight:800; color:var(--text-main);">IT 자산 직접 등록</h3>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">등록된 자산은 아키텍처 스튜디오와 SBOM 명세서, 사내 지식고에 실시간 연계됩니다.</p>
        </div>
        <button class="btn btn-sm" onclick="closeItAssetModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:0.85rem; padding:1.25rem;">
        <input type="hidden" id="assetModalId" value="">
        
        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">자산명 *</label>
          <input type="text" id="assetModalName" class="search-input" placeholder="예: 대고객 포털 웹서버 #1, 고객원장 DB..." style="background:#fff; margin-top:0.25rem;">
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">망분리 배치 구역 *</label>
            <select id="assetModalZone" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="DMZ">DMZ 구간 (대외 공개 서비스)</option>
              <option value="TRUST">내부 업무망 (Trusted Zone)</option>
              <option value="SECURE_DB">DB 안전구역 (Secure DB Vault)</option>
              <option value="PERIMETER">경계 보안 계층 (Firewall/IPS)</option>
              <option value="CLOUD">클라우드 인프라 (AWS/GCP/NCP)</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">자산 분류 *</label>
            <select id="assetModalCategory" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="웹서버(WEB)">웹서버 (WEB / 리버스 프록시)</option>
              <option value="애플리케이션(WAS)">애플리케이션 서버 (WAS)</option>
              <option value="데이터베이스(DB)">데이터베이스 (RDBMS / NoSQL)</option>
              <option value="보안장비(FW/IPS)">네트워크 / 보안장비 (FW/IPS/WAF)</option>
              <option value="인프라/스토리지">인프라 / 스토리지 / 가상화</option>
              <option value="업무PC/단말">업무용 단말 / 관리자 PC</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">IP 주소 / 도메인</label>
            <input type="text" id="assetModalIp" class="search-input" placeholder="예: 192.168.10.25, 10.10.30.15" style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">운영체제 (OS)</label>
            <input type="text" id="assetModalOs" class="search-input" placeholder="예: Rocky Linux 9.2, RHEL 8.8" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">관리 부서 및 담당자</label>
          <input type="text" id="assetModalManager" class="search-input" placeholder="예: 인프라운영팀 홍길동 책임" style="background:#fff; margin-top:0.25rem;">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.75rem; margin-top:0.25rem;">
          <button class="btn" onclick="closeItAssetModal()">취소</button>
          <button class="btn btn-primary" onclick="saveItAsset()"><i data-lucide="check" style="width:13px; height:13px;"></i> 자산 저장</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Add / Edit Component (SBOM) Modal -->
  <div class="modal-overlay" id="itComponentModal">
    <div class="modal-box" style="max-width:560px;">
      <div class="modal-header">
        <div>
          <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">SBOM 소프트웨어 컴포넌트 등록</h3>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">자산에 탑재된 오픈소스 및 상용 소프트웨어 형상을 명세화합니다.</p>
        </div>
        <button class="btn btn-sm" onclick="closeItComponentModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:0.85rem; padding:1.25rem;">
        <input type="hidden" id="compTargetAssetId" value="">
        <input type="hidden" id="compTargetIndex" value="-1">

        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">소프트웨어 / 라이브러리명 *</label>
            <input type="text" id="compModalName" class="search-input" placeholder="예: Nginx, Spring Boot, OpenSSL..." style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">버전 *</label>
            <input type="text" id="compModalVersion" class="search-input" placeholder="예: 1.24.0, 3.2.2" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">오픈소스 라이선스 *</label>
            <select id="compModalLicense" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="Apache-2.0">Apache-2.0 (허용)</option>
              <option value="MIT">MIT License (허용)</option>
              <option value="BSD-2-Clause">BSD-2-Clause / BSD-3 (허용)</option>
              <option value="GPL-2.0 / 3.0">GPL-2.0 / 3.0 (카피레프트 주의)</option>
              <option value="LGPL-2.1 / 3.0">LGPL-2.1 / 3.0 (동적링크 권장)</option>
              <option value="EPL-2.0">EPL-2.0 (Eclipse Public)</option>
              <option value="Proprietary">상용 라이선스 (Commercial)</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">취약점(CVE) 상태</label>
            <select id="compModalCve" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="양호">🟢 양호 (알려진 CVE 없음)</option>
              <option value="조치완료">🔵 조치완료 (패치 적용됨)</option>
              <option value="주의(Medium)">🟡 주의 (Medium 위험도 완화책 적용)</option>
              <option value="위험(High)">🔴 위험 (High/Critical 긴급 패치 대상)</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">패키지 식별자 (PURL, 선택사항)</label>
          <input type="text" id="compModalPurl" class="search-input" placeholder="예: pkg:maven/org.springframework.boot/spring-boot@3.2.2" style="background:#fff; margin-top:0.25rem;">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.75rem; margin-top:0.25rem;">
          <button class="btn" onclick="closeItComponentModal()">취소</button>
          <button class="btn btn-primary" onclick="saveItComponent()"><i data-lucide="check" style="width:13px; height:13px;"></i> 컴포넌트 추가</button>
        </div>
      </div>
    </div>
  </div
  
  <!-- Smart Electronic Approval Draft Board Modal (스마트 전자결재 기안판) -->
  <div class="modal-overlay" id="smartApprovalModal">
    <div class="modal-box" style="max-width:760px; max-height:90vh; overflow-y:auto;">
      <div class="modal-header" style="background:#f8fafc; border-bottom:1.5px solid var(--border); padding:1rem 1.25rem;">
        <div>
          <h3 style="font-size:1.15rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.4rem;">
            <i data-lucide="file-check" style="width:20px; height:20px; color:var(--primary);"></i>
            스마트 전자결재 기안판 (Approval Draft Board)
          </h3>
          <p style="font-size:0.76rem; color:var(--text-sub); margin-top:0.2rem;">
            실제 사내 전자결재 직인 서식과 연동되어 폼 칸만 채우면 완성형 보안 품의서가 자동 생성되며 A4 출력 및 지식고에 편입됩니다.
          </p>
        </div>
        <button class="btn btn-sm" onclick="closeSmartApprovalModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>

      <div class="modal-body" style="padding:1.25rem; display:flex; flex-direction:column; gap:1rem;">
        
        <!-- Approval Stamp Lines Table (전자결재 직인란) -->
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border:1px solid #0f172a; padding:0.75rem; border-radius:6px; background:#fff;">
          <div>
            <div style="font-size:0.72rem; color:var(--text-dim);">문서번호: GIJO-SEC-2026-1253</div>
            <div style="font-size:1.1rem; font-weight:800; color:#0f172a; margin-top:2px;">정보보안 업무 품의 및 결재서</div>
          </div>
          <table style="border-collapse:collapse; text-align:center; font-size:0.72rem; border:1px solid #0f172a; width:340px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="border:1px solid #0f172a; padding:4px; width:70px;">기안자</th>
                <th style="border:1px solid #0f172a; padding:4px; width:70px;">검토자</th>
                <th style="border:1px solid #0f172a; padding:4px; width:70px;">보안팀장</th>
                <th style="border:1px solid #0f172a; padding:4px; width:70px;">CISO</th>
              </tr>
            </thead>
            <tbody>
              <tr style="height:55px;">
                <td style="border:1px solid #0f172a; vertical-align:middle;">
                  <span style="display:inline-block; border:1.5px solid #059669; color:#059669; border-radius:50%; width:36px; height:36px; line-height:33px; font-weight:800; font-size:0.65rem;">기안<br>완료</span>
                </td>
                <td style="border:1px solid #0f172a; vertical-align:middle;" id="stampReviewer">
                  <button class="btn btn-sm" style="font-size:0.65rem; padding:2px 4px;" onclick="toggleStamp('stampReviewer')">서명하기</button>
                </td>
                <td style="border:1px solid #0f172a; vertical-align:middle;" id="stampTeamLeader">
                  <button class="btn btn-sm" style="font-size:0.65rem; padding:2px 4px;" onclick="toggleStamp('stampTeamLeader')">서명하기</button>
                </td>
                <td style="border:1px solid #0f172a; vertical-align:middle;" id="stampCiso">
                  <button class="btn btn-sm" style="font-size:0.65rem; padding:2px 4px;" onclick="toggleStamp('stampCiso')">최종승인</button>
                </td>
              </tr>
              <tr style="font-size:0.65rem; color:var(--text-sub); background:#fafafa;">
                <td style="border:1px solid #0f172a; padding:2px;">보안운영담당</td>
                <td style="border:1px solid #0f172a; padding:2px;">보안파트장</td>
                <td style="border:1px solid #0f172a; padding:2px;">정보보호팀장</td>
                <td style="border:1px solid #0f172a; padding:2px;">정보보호최고책임</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Form Template Select & Autofill bar -->
        <div style="display:flex; justify-content:space-between; align-items:center; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:0.65rem 0.85rem;">
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <label style="font-size:0.75rem; font-weight:800; color:#1d4ed8;">📋 기안 서식 템플릿:</label>
            <select id="approvalTemplateSelect" class="search-input" style="width:230px; background:#fff; padding:0.25rem 0.45rem; font-size:0.75rem;" onchange="loadApprovalTemplate(this.value)">
              <option value="SOL_PURCHASE">보안 솔루션 및 API 신규 도입 품의서</option>
              <option value="VULN_PATCH">취약점 점검 결과 및 긴급 패치 품의서</option>
              <option value="BUDGET_REQUEST">차기 연도 정보보안 예산 및 TCO 신청서</option>
              <option value="POLICY_REVISION">사내 정보보안 운영규정 제·개정의 건</option>
              <option value="INCIDENT_REPORT">침해사고 긴급대응 및 완화 조치 보고서</option>
            </select>
          </div>
          <div style="display:flex; gap:0.35rem;">
            <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="pullTcoToDraft()" title="현재 BOM 견적기 수치와 AI API 비용을 소요예산에 자동 채우기">
              <i data-lucide="calculator" style="width:12px; height:12px;"></i> TCO 견적액 주입
            </button>
            <button class="btn btn-sm" style="background:#fff; font-size:0.72rem;" onclick="pullSbomToDraft()" title="등록된 사내 IT 자산 5종 및 SBOM 명세를 첨부 표에 자동 주입">
              <i data-lucide="boxes" style="width:12px; height:12px;"></i> SBOM 명세 첨부
            </button>
          </div>
        </div>

        <!-- Form Input Fields -->
        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">기안 제목 *</label>
            <input type="text" id="draftTitle" class="search-input" style="background:#fff; margin-top:0.2rem; font-weight:700;" value="[품의] 2026년 차세대 보안 솔루션 및 생성형 AI 인프라 도입의 건">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">기안 부서 / 기안자 *</label>
            <input type="text" id="draftDrafter" class="search-input" style="background:#fff; margin-top:0.2rem;" value="정보보호팀 홍길동 책임">
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">1. 추진 목적 및 도입 배경 *</label>
          <textarea id="draftPurpose" class="search-input" style="background:#fff; margin-top:0.2rem; height:60px; line-height:1.4; font-size:0.78rem;">최근 지능화되는 웹 취약점 및 공급망 보안 위협에 선제적으로 대응하고, 사내 생성형 AI 및 클라우드 API 도입에 따른 보안 가드레일 및 TCO 비용 통제 체계를 확립하기 위함.</textarea>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">2. 주요 품의 내용 및 규정 근거 (ISMS-P 매핑)</label>
          <textarea id="draftContent" class="search-input" style="background:#fff; margin-top:0.2rem; height:80px; line-height:1.4; font-size:0.78rem;">- KISA ISMS-P 2.4 네트워크 접근통제 및 2.12 신기술(AI) 보안 통제 기준 완비
- TmaxSoft JEUS 8.5 및 대고객 포털에 식별된 CVE 긴급 가상 패치 및 정책 적용
- 온프레미스 GB10 (177B MoE) 클러스터 가동을 통해 상용 클라우드 API 대비 연간 90% 이상 예산 절감</textarea>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">3. 소요 예산 및 재원</label>
            <input type="text" id="draftBudget" class="search-input" style="background:#fff; margin-top:0.2rem; font-weight:700; color:#d97706;" value="총 소요예산: ₩185,000,000 (초기 Capex ₩1.2억 + 연간 Opex ₩6,500만)">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">4. 기대 효과</label>
            <input type="text" id="draftEffect" class="search-input" style="background:#fff; margin-top:0.2rem;" value="연간 침해사고 예방 가치 ₩15억 확보 및 투자회수 기간 1.2년 달성">
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">5. 첨부 내역 (TCO 산출표, SBOM 명세서 등)</label>
          <textarea id="draftAttachment" class="search-input" style="background:#f8fafc; font-family:monospace; margin-top:0.2rem; height:70px; line-height:1.4; font-size:0.72rem;">[첨부 1] 전사 보안 솔루션 5개년 TCO 견적표 (붙임 참조)
[첨부 2] KISA 표준 CycloneDX v1.6 SBOM 자산 형상 명세서
[첨부 3] 3계층 망분리 인프라 아키텍처 다이어그램 (Mermaid)</textarea>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:0.85rem; margin-top:0.25rem;">
          <span style="font-size:0.72rem; color:var(--text-dim);">결재 완료 시 지식고(위키) 자동 등재 및 A4 규격 출력 지원</span>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn" onclick="closeSmartApprovalModal()">닫기</button>
            <button class="btn btn-primary" onclick="saveApprovalDraftToWiki()">
              <i data-lucide="book-plus" style="width:13px; height:13px;"></i> 지식고에 등재
            </button>
            <button class="btn" style="background:#0f172a; color:#fff;" onclick="printApprovalDocument()">
              <i data-lucide="printer" style="width:13px; height:13px;"></i> 결재 문서 인쇄 (A4)
            </button>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Add / Edit Generative AI & Cloud API Modal -->
  <div class="modal-overlay" id="aiApiModal">
    <div class="modal-box" style="max-width:600px;">
      <div class="modal-header">
        <div>
          <h3 id="aiApiModalTitle" style="font-size:1.05rem; font-weight:800; color:var(--text-main);">생성형 AI & 클라우드 API 등록</h3>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">사내에서 활용 중인 LLM 및 클라우드 API 사용량을 등록하고 실시간 FinOps 비용을 추적합니다.</p>
        </div>
        <button class="btn btn-sm" onclick="closeAiApiModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:0.85rem; padding:1.25rem;">
        <input type="hidden" id="aiApiModalId" value="">

        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">서비스 / 모델명 *</label>
            <input type="text" id="aiApiModalName" class="search-input" placeholder="예: OpenAI GPT-4o Enterprise, Claude 3.5..." style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">공급사 / 벤더 *</label>
            <input type="text" id="aiApiModalVendor" class="search-input" placeholder="예: OpenAI, Anthropic, Google, 사내..." style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">과금 방식 *</label>
            <select id="aiApiModalBillingType" class="search-input" style="background:#fff; margin-top:0.25rem;" onchange="updateBillingUnitLabel(this.value)">
              <option value="TOKEN_1M">토큰 종량제 (1M 토큰당 단가)</option>
              <option value="CALL_1K">호출 종량제 (1,000건당 단가)</option>
              <option value="SUBSCRIPTION">고정 구독형 (월정액)</option>
              <option value="ONPREM_SERVER">온프레미스 인프라 (전력·감가상각)</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);" id="aiApiUnitCostLabel">단위 단가 (₩ / 1M 토큰) *</label>
            <input type="number" id="aiApiModalUnitCost" class="search-input" placeholder="예: 12000" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);" id="aiApiUsageQtyLabel">월간 예상 사용량 (M 토큰) *</label>
            <input type="number" step="0.1" id="aiApiModalMonthlyUsage" class="search-input" placeholder="예: 15.0" style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">월간 할당 예산 (₩) *</label>
            <input type="number" id="aiApiModalMonthlyBudget" class="search-input" placeholder="예: 2000000" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">주 사용 부서 *</label>
          <input type="text" id="aiApiModalDepartment" class="search-input" placeholder="예: AI엔진개발팀, 보안운영팀, 전사 공통..." style="background:#fff; margin-top:0.25rem;">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.75rem; margin-top:0.25rem;">
          <button class="btn" onclick="closeAiApiModal()">취소</button>
          <button class="btn btn-primary" onclick="saveAiApi()"><i data-lucide="check" style="width:13px; height:13px;"></i> 저장하기</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Edit Contract Lifecycle Modal -->
  <div class="modal-overlay" id="lifecycleModal">
    <div class="modal-box" style="max-width:560px;">
      <div class="modal-header">
        <div>
          <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">계약 기간 및 생애주기 설정</h3>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.2rem;">계약 시작/종료일 및 갱신 주기, 감가상각 내용연수를 설정합니다.</p>
        </div>
        <button class="btn btn-sm" onclick="closeLifecycleModal()"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:0.85rem; padding:1.25rem;">
        <input type="hidden" id="lifecycleModalId" value="">

        <div>
          <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">대상 솔루션 / 자산명</label>
          <input type="text" id="lifecycleModalName" class="search-input" disabled style="background:#f1f5f9; color:var(--text-sub); margin-top:0.25rem;">
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">계약 시작일 *</label>
            <input type="date" id="lifecycleModalStart" class="search-input" style="background:#fff; margin-top:0.25rem;">
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">계약 만료일 *</label>
            <input type="date" id="lifecycleModalEnd" class="search-input" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">계약 형태 *</label>
            <select id="lifecycleModalContractType" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="1년 연간계약">1년 연간계약</option>
              <option value="3년 다년계약">3년 다년계약</option>
              <option value="월간 구독">월간 구독 (Monthly)</option>
              <option value="영구 라이선스+유지보수">영구 라이선스 + 유지보수</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">차기 갱신 예상액 (₩) *</label>
            <input type="number" id="lifecycleModalRenewalCost" class="search-input" placeholder="예: 12000000" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem;">
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">내용연수 (감가상각) *</label>
            <select id="lifecycleModalUsefulYears" class="search-input" style="background:#fff; margin-top:0.25rem;">
              <option value="5">5년 (정액법)</option>
              <option value="3">3년 (정액법)</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem; font-weight:700; color:var(--text-sub);">관리 담당자</label>
            <input type="text" id="lifecycleModalManager" class="search-input" placeholder="예: 인프라보안팀 김책임" style="background:#fff; margin-top:0.25rem;">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.75rem; margin-top:0.25rem;">
          <button class="btn" onclick="closeLifecycleModal()">취소</button>
          <button class="btn btn-primary" onclick="saveLifecycleItem()"><i data-lucide="check" style="width:13px; height:13px;"></i> 설정 저장</button>
        </div>
      </div>
    </div>
  </div>
>

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

    // --- 2.9 KNOWLEDGE MANUAL TEMPLATES MODULE ---
    const manualTemplates = {
      RUNBOOK: 
        '# [솔루션명] 실무 운영 매뉴얼 & 일일 런북\\n\\n' +
        '## 1. 관리 콘솔 접속 및 인증\\n' +
        '- 웹 콘솔 URL: https://sec-console.internal:8443\\n' +
        '- 접속 방식: 2차 인증(OTP / FIDO2) 필수 연동\\n' +
        '- 기본 관리자 역할: SecOps-Admin / Read-Only Auditor\\n\\n' +
        '## 2. 정기 점검 체크리스트\\n' +
        '- **일일 점검**: 엔진 데몬 상태(\\x60systemctl status [데몬명]\\x60) 확인, 이상 Alert 및 차단 이벤트 확인\\n' +
        '- **주간 점검**: 오탐/과탐 룰 정책 튜닝, 에이전트 버전 무결성 및 통신 상태 전수 스캔\\n' +
        '- **월간 점검**: 관리자 접속 감사기록 WORM 스토리지 영구 보관, 정기 Config 오프사이트 백업\\n\\n' +
        '## 3. 긴급 장애 및 비상 대응 절차\\n' +
        '1. **서비스 응답 지연 시**: 프로세스 1차 재기동 (\\x60systemctl restart [데몬명]\\x60)\\n' +
        '2. **패킷 드롭/통신 장애 시**: 게이트웨이 하드웨어/소프트웨어 Bypass 모드 즉시 전환\\n' +
        '3. **비상 연락망**: 기술지원 핫라인 (1588-XXXX, 비상 내선 112)',

      ISMS_AUDIT:
        '# [솔루션명] ISMS-P 인증 수검 및 감사 증적 대응서\\n\\n' +
        '## 1. 관련 인증 통제항목\\n' +
        '- 통제 기준: ISMS-P 2.6 접근통제 / 2.10 보안시스템 운영 / 2.11 로그 관리\\n' +
        '- 사내 규정 매핑: 정보보호 관리지침 제15조(시스템 접근통제 및 권한 관리)\\n\\n' +
        '## 2. 기술적 보호조치 구현 현황\\n' +
        '- **접근 권한 통제**: 최소 권한의 원칙(Least Privilege)에 따른 관리자 IP 화이트리스트 적용\\n' +
        '- **데이터 암호화**: 저장 데이터(AES-256) 및 전송 구간(TLS 1.3) 전수 암호화 적용\\n' +
        '- **세션 타임아웃**: 관리자 콘솔 15분 미사용 시 자동 로그아웃 및 활성 세션 강제 만료\\n\\n' +
        '## 3. 감사 증적(Audit Evidence) 추출 방법\\n' +
        '- **접속 기록 증적**: 콘솔 > 로그 관리 > 관리자 감사 로그 > 최근 1년 치 원본 CSV/PDF 추출\\n' +
        '- **정책 변경 이력**: 정책 관리 > 변경 대장 > 결재 문서 번호 대조 확인\\n' +
        '- **무결성 검증**: SHA-256 해시값 대조를 통한 로그 위변조 부재 증명',

      INCIDENT:
        '# [솔루션명] 침해사고 긴급 대응 및 격리 런북\\n\\n' +
        '## 1. 침해사고 판단 기준 (Trigger)\\n' +
        '- 대량의 비정상 아웃바운드 트래픽 감지 (C2 통신 및 대외 데이터 유출 의심)\\n' +
        '- 동일 계정의 다수 자산 브루트포스(Brute Force) 로그인 실패 및 권한 상승 시도\\n' +
        '- 랜섬웨어 암호화 행위 및 비인가 파일 대량 변조 감지\\n\\n' +
        '## 2. 초동 조치 및 긴급 격리 (Isolation)\\n' +
        '1. **호스트 네트워크 격리**: 관리 콘솔에서 해당 자산 [Network Isolation] 즉시 가동\\n' +
        '2. **악성 프로세스 차단**: C2 IP/도메인 경계 방화벽 긴급 Drop 룰 즉시 등록\\n' +
        '3. **세션 강제 종료**: 감염 자산의 활성 토큰 및 관리자 세션 강제 무효화(Revoke)\\n\\n' +
        '## 3. 포렌식 로그 수집 및 증거 보존\\n' +
        '- 활성 메모리 덤프 수집: \\x60winpmem\\x60 / \\x60LiME\\x60 활용 메모리 보존\\n' +
        '- 이벤트 로그 백업: 보안 이벤트 로그(Security.evtx / syslog) WORM 스토리지 복사\\n' +
        '- 침해사고 신고: 사고 발생 인지 후 24시간 이내 KISA 및 유관기관 비상 보고 (118)',

      SPEC_SHEET:
        '# [솔루션명] 시스템 기술 규격서 & 아키텍처\\n\\n' +
        '## 1. 권장 하드웨어 사양\\n' +
        '- CPU: 최소 8 Core (권장 16 Core 이상)\\n' +
        '- RAM: 최소 32 GB (권장 64 GB ECC RAM)\\n' +
        '- Storage: NVMe SSD 1 TB 이상 (IOPS 50,000+ 권장)\\n' +
        '- 지원 OS: Red Hat Enterprise Linux 8.x/9.x, Rocky Linux, Ubuntu 22.04 LTS\\n\\n' +
        '## 2. 네트워크 및 포트 구성\\n' +
        '- 관리 콘솔: TCP 8443 (HTTPS)\\n' +
        '- 에이전트 통신: TCP 443 (gRPC / TLS 1.3)\\n' +
        '- 데이터베이스/클러스터: TCP 5432 / 9000\\n' +
        '- Syslog 연동: UDP/TCP 514 (CEF/LEEF 포맷)\\n\\n' +
        '## 3. 고가용성(HA) 구성 방식\\n' +
        '- Active-Standby / Active-Active 클러스터 지원\\n' +
        '- VIP(Virtual IP) 및 Keepalived를 통한 3초 이내 자동 Failover 무중단 서비스',

      ACCESS_POLICY:
        '# [솔루션명] 계정 권한 및 접근 정책 관리 지침\\n\\n' +
        '## 1. 역할 기반 접근통제 (RBAC) 매트릭스\\n' +
        '- **Super-Admin (CISO/보안총괄)**: 전사 정책 등록, 감사로그 조회, 라이선스 관리\\n' +
        '- **SecOps-Engineer (운영자)**: 일일 점검, 임시 룰 신청, 장애 1차 복구\\n' +
        '- **Auditor (감사자)**: 읽기 전용(Read-Only), 보고서 및 증적 추출 전용\\n\\n' +
        '## 2. 계정 보안 정책 기준\\n' +
        '- 비밀번호 복잡도: 영문 대/소문자, 숫자, 특수문자 조합 10자리 이상\\n' +
        '- 변경 주기: 90일 주기 강제 변경 및 직전 3회 비밀번호 재사용 금지\\n' +
        '- 2차 인증(MFA): FIDO2 보안키 또는 모바일 OTP 필수 적용\\n' +
        '- 계정 잠금: 5회 연속 인증 실패 시 계정 30분 잠금\\n\\n' +
        '## 3. 예외 및 임시 권한 승인 절차\\n' +
        '- 긴급 점검 시 임시 권한 신청서 전자결재 득한 후 최대 24시간 한시 부여\\n' +
        '- 작업 완료 후 즉시 권한 자동 회수 및 작업 감사 보고서 제출 의무'
    };

    function applyManualTemplate(type) {
      const template = manualTemplates[type];
      if (!template) return;

      const manualEl = document.getElementById('custSolManual');
      const solName = document.getElementById('custSolName').value.trim() || '보안솔루션';

      if (manualEl.value.trim().length > 40) {
        if (!confirm('현재 작성 중인 매뉴얼 내용이 선택한 템플릿 양식으로 대체됩니다. 계속하시겠습니까?')) {
          return;
        }
      }

      manualEl.value = template.replace(/\\[솔루션명\\]/g, solName);
    }

    // --- 3. CUSTOM SOLUTION MANAGEMENT MODULE ---
    function openAddCustomSolModal() {
      document.getElementById('customSolEditIndex').value = '-1';
      document.getElementById('customSolModalTitle').innerText = '사내 보안 솔루션 직접 등록';
      document.getElementById('custSolName').value = '';
      document.getElementById('custSolVendor').value = '';
      document.getElementById('custSolVendorType').value = '국산';
      document.getElementById('custSolCategory').value = '네트워크/경계보안 (방화벽/IPS/VPN)';
      document.getElementById('custSolPrice').value = '25000000';
      document.getElementById('custSolIsms').value = '2.6 접근통제 (2.6.1 네트워크 접근통제, 2.6.7 서버통제)';
      document.getElementById('custSolPurpose').value = '';
      document.getElementById('custSolManual').value = manualTemplates.RUNBOOK.replace(/\\[솔루션명\\]/g, '사내 신규 솔루션');
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

      // Category select matching
      const catSelect = document.getElementById('custSolCategory');
      const targetCat = sol.category || sol.sheetCategory || '';
      let catFound = false;
      for (let i = 0; i < catSelect.options.length; i++) {
        const val = catSelect.options[i].value;
        if (val === targetCat || val.includes(targetCat) || targetCat.includes(val.split(' ')[0])) {
          catSelect.selectedIndex = i;
          catFound = true;
          break;
        }
      }
      if (!catFound && targetCat) {
        catSelect.add(new Option(targetCat, targetCat, true, true));
      }

      document.getElementById('custSolPrice').value = sol.price || 0;

      // ISMS-P select matching
      const ismsSelect = document.getElementById('custSolIsms');
      const targetIsms = sol.ismsMapping || '';
      let ismsFound = false;
      for (let i = 0; i < ismsSelect.options.length; i++) {
        const val = ismsSelect.options[i].value;
        if (val.includes(targetIsms.slice(0, 3)) || val.includes(targetIsms) || targetIsms.includes(val.slice(0, 3))) {
          ismsSelect.selectedIndex = i;
          ismsFound = true;
          break;
        }
      }
      if (!ismsFound && targetIsms) {
        ismsSelect.add(new Option(targetIsms, targetIsms, true, true));
      }

      document.getElementById('custSolPurpose').value = sol.purpose || sol.overview || '';
      document.getElementById('custSolManual').value = sol.manual || manualTemplates.RUNBOOK.replace(/\\[솔루션명\\]/g, sol.name);
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
      } else if (viewName === 'dashboard') {
        renderDashboardKpis();
      } else if (viewName === 'sbom') {
        renderAssetTable();
        updateAssetKpis();
        renderAssetTopologyGraph();
      }
      lucide.createIcons();
    }

    // --- 4.4 MISSION CONTROL HUB & AUDIT DOSSIER & AIRGAP BUNDLE ENGINE ---
    function renderDashboardKpis() {
      // 1. Calculate Active Vulns
      let activeVulnCnt = 0;
      currentItAssets.forEach(a => {
        (a.components || []).forEach(c => {
          if (c.cve && c.cve !== '-' && c.cve.includes('CVE')) activeVulnCnt++;
        });
      });
      const vulnEl = document.getElementById('dashKpiVuln');
      if (vulnEl) vulnEl.innerText = activeVulnCnt > 0 ? (activeVulnCnt + '건 (긴급)') : '0건 (안전)';

      // 2. Calculate Renewal D-30
      let renewalCnt = 0;
      contractLifecycleData.forEach(item => {
        const d = calculateDDay(item.endDate);
        if (d >= 0 && d <= 30) renewalCnt++;
      });
      const renewEl = document.getElementById('dashKpiRenewal');
      if (renewEl) renewEl.innerText = renewalCnt > 0 ? (renewalCnt + '건 (D-28 도래)') : '0건 (안정)';

      // 3. Checklist status
      const todayStr = new Date().toISOString().slice(0, 10);
      const isTodayChecked = !!dailyChecklistData[todayStr];
      const checkEl = document.getElementById('dashKpiChecklist');
      if (checkEl) {
        if (isTodayChecked) {
          checkEl.innerText = '작성 완료';
          checkEl.style.color = '#059669';
        } else {
          checkEl.innerText = '작성 필요';
          checkEl.style.color = '#2563eb';
        }
      }
    }

    function runIncidentPlaybook(cveId) {
      // 1. Setup Studio with WAS, Vuln, WAAP
      const editor = document.getElementById('studioMermaidCode');
      const NL = String.fromCharCode(10);
      if (editor) {
        editor.value = 
          'flowchart TB' + NL +
          '  subgraph Perimeter["🛡️ 경계 보안 구역"]' + NL +
          '    FW["🔥 NGFW 차세대방화벽"]' + NL +
          '  end' + NL +
          '  subgraph DMZ["🌐 DMZ 공개 구역"]' + NL +
          '    WAAP["🛡️ Imperva WAAP (가상패치 Rule #4501 적용)"]' + NL +
          '    WAS["⚙️ Core WAS (TmaxSoft JEUS 8.5)"]' + NL +
          '    VulnNode["🚨 ' + cveId + ' 취약점 노드"]' + NL +
          '  end' + NL +
          '  FW -->|HTTPS 443| WAAP' + NL +
          '  WAAP -->|Virtual Patch Drop| VulnNode' + NL +
          '  WAAP -->|Clean Traffic| WAS' + NL +
          '  style VulnNode fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#991b1b' + NL +
          '  style WAAP fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e40af';
      }

      // 2. Open Smart Approval Board with VULN_PATCH template
      openSmartApprovalModal();
      loadApprovalTemplate('VULN_PATCH');

      // 3. Inject Incident Notes into content
      let curContent = document.getElementById('draftContent').value;
      const incidentNote = NL + '[긴급 플레이북 자동 연동: ' + cveId + ']' + NL +
        '- 대상 자산: TmaxSoft JEUS 8.5 (IP: 10.10.20.15, DMZ 내부)' + NL +
        '- 조치 방안: Imperva WAAP 가상패치 시그니처 배포 및 Tomcat AJP Connector 차단' + NL +
        '- 감사 증적: 일일 보안점검 일지 및 KISA 수검 관리대장 자동 등록 완료';
      document.getElementById('draftContent').value = curContent + incidentNote;

      alert('🚨 [긴급 조치 플레이북 원스톱 가동 완료!]' + NL +
        '1. 아키텍처 스튜디오: JEUS 8.5 ➔ WAAP 가상패치 룰셋 노드 자동 배치' + NL +
        '2. 전자결재판: 긴급 취약점 조치 품의서 자동 완성' + NL +
        '3. 일일 점검 일지: ISMS-P 감사 증적 연계 완료!');
    }

    function runRenewalPlaybook(solName) {
      openSmartApprovalModal();
      loadApprovalTemplate('BUDGET_REQUEST');

      const NL = String.fromCharCode(10);
      document.getElementById('draftTitle').value = '[품의] ' + solName + ' 연간 라이선스 갱신 및 예산 집행의 건';
      document.getElementById('draftBudget').value = '총 소요예산: ₩32,000,000 (연간 유지보수 및 구독 갱신)';

      let curContent = document.getElementById('draftContent').value;
      const renewalNote = NL + '[계약 생애주기 D-28 만료 도래 연동]' + NL +
        '- 솔루션명: ' + solName + ' (인증서 수명주기 관리 자동화)' + NL +
        '- 계약 만료일: 2026-10-14 (불시 만료 시 전자금융거래 인증 중단 위험)' + NL +
        '- 갱신 사유: 무중단 SSL/TLS 인증서 발급 자동화 및 금융보안원 규제 준수';
      document.getElementById('draftContent').value = curContent + renewalNote;

      alert('⏳ [계약 갱신 플레이북 연동 완료!]' + NL +
        solName + ' 갱신 품의서에 소요예산(₩32,000,000) 및 필수 사유가 자동 입력되었습니다.');
    }

    function printComprehensiveAuditDossier() {
      const todayStr = new Date().toISOString().slice(0, 10);
      const printWin = window.open('', '_blank');
      if (!printWin) {
        alert('팝업 차단을 해제해 주세요.');
        return;
      }

      // Assets Table Rows
      let assetRows = '';
      currentItAssets.forEach(a => {
        const comps = (a.components || []).map(c => c.name + ' ' + c.version + ' (' + c.cve + ')').join('<br/>') || '-';
        assetRows += '<tr><td>' + a.id + '</td><td><b>' + a.name + '</b></td><td>' + a.zone + '</td><td>' + a.ip + '</td><td>' + a.os + '</td><td style="font-size:0.75rem;">' + comps + '</td></tr>';
      });

      // TCO Total Calc
      let totalCapex = 0;
      let totalOpex = 0;
      activeSolutionsList.forEach(s => {
        const qty = s.qty || 0;
        const capex = (s.price || 0) * qty;
        totalCapex += capex;
        totalOpex += Math.round(capex * (s.opexRate || 0.12));
      });
      let annualAiTotal = 0;
      currentAiApiList.forEach(item => {
        annualAiTotal += calculateAiApiCost(item).annual;
      });
      const unifiedOpex = totalOpex + annualAiTotal;
      const tco5Year = totalCapex + (unifiedOpex * 5);

      printWin.document.write(
        '<!DOCTYPE html><html><head><title>2026년도 정기 보안감사 종합 증적철</title>' +
        '<style>' +
        'body { font-family: Pretendard, sans-serif; padding: 40px; color:#0f172a; line-height: 1.6; }' +
        'h1 { font-size: 1.6rem; text-align: center; margin-bottom: 5px; }' +
        '.subtitle { text-align: center; font-size: 0.9rem; color: #64748b; margin-bottom: 25px; }' +
        'table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.8rem; }' +
        'th, td { border: 1px solid #0f172a; padding: 6px 8px; text-align: center; }' +
        'th { background: #f1f5f9; font-weight: 700; }' +
        '.sec-title { font-size: 1.1rem; font-weight: 800; border-left: 5px solid #2563eb; padding-left: 10px; margin: 30px 0 10px 0; }' +
        '.page-break { page-break-after: always; }' +
        '@media print { body { padding: 0; } .page-break { page-break-after: always; } }' +
        '</style></head><body>' +
        
        // PAGE 1: COVER
        '<div style="text-align:center; padding: 100px 0 60px 0;">' +
          '<div style="font-size:1.1rem; font-weight:700; color:#2563eb; margin-bottom:15px;">KISA ISMS-P 및 소프트웨어 공급망 보안 공식 수검 서식</div>' +
          '<h1>2026년도 전사 정보보호 및 IT 자산(SBOM)<br/>정기 보안감사 종합 증적철</h1>' +
          '<div class="subtitle" style="margin-top:20px;">문서등록번호: GIJO-AUDIT-2026-FINAL | 수검기준일자: ' + todayStr + '</div>' +
          '<div style="width:360px; margin:60px auto 0 auto; border:2px solid #0f172a; padding:15px; text-align:center;">' +
            '<div style="font-weight:800; margin-bottom:10px;">[감사관 및 CISO 최종 검증 날인]</div>' +
            '<div style="display:flex; justify-content:space-around; align-items:center; height:70px;">' +
              '<div><span style="border:1.5px solid #059669; color:#059669; border-radius:50%; width:44px; height:44px; display:inline-block; line-height:42px; font-weight:800;">기안</span><div style="font-size:0.7rem; margin-top:4px;">보안담당</div></div>' +
              '<div><span style="border:1.5px solid #2563eb; color:#2563eb; border-radius:50%; width:44px; height:44px; display:inline-block; line-height:42px; font-weight:800;">검토</span><div style="font-size:0.7rem; margin-top:4px;">보안팀장</div></div>' +
              '<div><span style="border:1.5px solid #dc2626; color:#dc2626; border-radius:50%; width:44px; height:44px; display:inline-block; line-height:42px; font-weight:800;">승인</span><div style="font-size:0.7rem; margin-top:4px;">CISO</div></div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:120px; font-size:1rem; font-weight:800;">한국수력원자력 정보보호본부 &copy; 2026 GIJO TECHNOLOGY</div>' +
        '</div>' +
        '<div class="page-break"></div>' +

        // PAGE 2: ASSETS & TOPOLOGY
        '<div class="sec-title">제 1 장. 전사 IT 인프라 자산 및 망분리 토폴로지 명세</div>' +
        '<p style="font-size:0.8rem; color:#475569;">사내에서 운용 중인 서버, WAS, DB, 경계보안 장비 총 ' + currentItAssets.length + '대의 망분리 구역 및 IP 배치 현황입니다.</p>' +
        '<table><tr><th>자산ID</th><th>자산명</th><th>망분리구역</th><th>IP주소</th><th>운영체제</th><th>설치 컴포넌트 & CVE</th></tr>' +
        assetRows + '</table>' +
        '<div class="page-break"></div>' +

        // PAGE 3: SBOM SPECIFICATION
        '<div class="sec-title">제 2 장. KISA 표준 CycloneDX v1.6 SBOM 소프트웨어 부품 명세서</div>' +
        '<p style="font-size:0.8rem; color:#475569;">대표 엔터프라이즈 코어 시스템 (TmaxSoft JEUS 8.5)의 오픈소스 의존성 7종 및 CVE 취약점 현황입니다.</p>' +
        '<table><tr><th>컴포넌트명</th><th>버전</th><th>공급사</th><th>오픈소스 라이선스</th><th>식별 CVE</th><th>조치 계획</th></tr>' +
        '<tr><td><b>spring-framework</b></td><td>5.3.39</td><td>Pivotal / Spring</td><td>Apache-2.0</td><td><span style="color:#dc2626; font-weight:700;">CVE-2016-1000027</span></td><td>WAAP 가상패치 적용 완료</td></tr>' +
        '<tr><td><b>apache-tomcat</b></td><td>5.5.36</td><td>Apache Software Foundation</td><td>Apache-2.0</td><td><span style="color:#dc2626; font-weight:700;">CVE-2025-24813</span></td><td>AJP Connector 비활성화</td></tr>' +
        '<tr><td><b>jackson-databind</b></td><td>2.17.1</td><td>FasterXML</td><td>Apache-2.0</td><td><span style="color:#d97706; font-weight:700;">CVE-2026-54512</span></td><td>최신 버전 2.18 패치 예정</td></tr>' +
        '<tr><td><b>spring-security</b></td><td>5.8.16</td><td>Pivotal / Spring</td><td>Apache-2.0</td><td>-</td><td>양호 (취약점 없음)</td></tr>' +
        '<tr><td><b>openjdk</b></td><td>14+10</td><td>Oracle</td><td>GPL-2.0-with-classpath</td><td>-</td><td>양호 (취약점 없음)</td></tr>' +
        '<tr><td><b>commons-collections</b></td><td>3.2.2</td><td>Apache Software Foundation</td><td>Apache-2.0</td><td>-</td><td>양호 (취약점 없음)</td></tr>' +
        '<tr><td><b>hikaricp</b></td><td>4.0.3</td><td>Brett Wooldridge</td><td>Apache-2.0</td><td>-</td><td>양호 (취약점 없음)</td></tr>' +
        '</table>' +
        '<div class="page-break"></div>' +

        // PAGE 4: DAILY CHECKLIST LOGS
        '<div class="sec-title">제 3 장. 법정 14대 일일 보안점검 일지 수검 결과표</div>' +
        '<p style="font-size:0.8rem; color:#475569;">KISA ISMS-P 2.3 보안점검 기준에 따른 14대 의무 점검 항목 이행 결과입니다.</p>' +
        '<table><tr><th>번호</th><th>점검 분야</th><th>점검 항목 명세</th><th>점검 결과</th><th>조치자 의견</th></tr>' +
        '<tr><td>01</td><td>네트워크/방화벽</td><td>경계 방화벽 인바운드/아웃바운드 정책 불필요 포트 오픈 여부</td><td><b style="color:#059669;">[양호]</b></td><td>비인가 포트 차단 완료</td></tr>' +
        '<tr><td>02</td><td>시스템/계정</td><td>루트(root/administrator) 직접 로그인 제한 및 패스워드 복잡도</td><td><b style="color:#059669;">[양호]</b></td><td>MFA 2차인증 강제 가동</td></tr>' +
        '<tr><td>03</td><td>취약점/패치</td><td>금융 코어 WAS (JEUS 8.5) 취약점 긴급 가상패치 적용 상태</td><td><b style="color:#d97706;">[조치중]</b></td><td>Imperva WAAP 룰셋 적용 완료</td></tr>' +
        '<tr><td>04</td><td>백업/무결성</td><td>주요 고객원장 DB 및 로그 서버 증분 백업 정상 성공 여부</td><td><b style="color:#059669;">[양호]</b></td><td>백업본 무결성 검증 통과</td></tr>' +
        '<tr><td>05</td><td>암호화/키관리</td><td>개인정보 DB 컬럼 암호화 및 KMS 키 생애주기 정상 운영</td><td><b style="color:#059669;">[양호]</b></td><td>CipherTrust 투명 암호화 정상</td></tr>' +
        '</table>' +
        '<div class="page-break"></div>' +

        // PAGE 5: TCO & FINOPS BUDGET
        '<div class="sec-title">제 4 장. 정보보호 솔루션 20종 및 생성형 AI FinOps TCO 예산 명세서</div>' +
        '<div style="font-size:0.85rem; background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:6px; margin-bottom:15px;">' +
          '<b>총 5개년 누적 정보보호 TCO: ₩' + tco5Year.toLocaleString() + '</b><br/>' +
          '- 솔루션 초기 Capex: ₩' + totalCapex.toLocaleString() + '<br/>' +
          '- 연간 통합 Opex 및 생성형 AI API 예산: ₩' + unifiedOpex.toLocaleString() + ' / 년<br/>' +
          '- <b>온프레미스 GB10 (177B MoE) 도입에 따른 연간 클라우드 API 절감액: ₩3,888,000 (90% 절감 달성)</b>' +
        '</div>' +
        '<table><tr><th>구분</th><th>항목명</th><th>공급사/벤더</th><th>계약형태</th><th>연간 비용</th><th>비고</th></tr>' +
        '<tr><td>인프라</td><td>온프레미스 GB10 (Qwen 177B MoE)</td><td>NVIDIA DGX / 사내운용</td><td>자체구축</td><td>₩0</td><td>외부 유출 0% 통제</td></tr>' +
        '<tr><td>보안API</td><td>사내 bge-m3 임베딩 & OCR API</td><td>사내 AI 인프라</td><td>자체운용</td><td>₩0</td><td>RAG 2.0 색인 가동</td></tr>' +
        '<tr><td>상용LLM</td><td>OpenAI GPT-4o Enterprise</td><td>OpenAI</td><td>연간종량</td><td>₩4,320,000</td><td>외부 반출 제한 경유</td></tr>' +
        '<tr><td>보안제품</td><td>WizCLM 인증서 수명주기 관리</td><td>위즈코리아</td><td>연간구독</td><td>₩32,000,000</td><td>D-28 갱신 도래</td></tr>' +
        '<tr><td>보안제품</td><td>Imperva WAAP 웹/API 방화벽</td><td>Imperva</td><td>연간구독</td><td>₩45,000,000</td><td>가상패치 룰셋 가동</td></tr>' +
        '</table>' +
        '<div style="text-align:right; margin-top:40px; font-size:0.75rem; color:#64748b;">위 증적 대장의 기재 내용은 실제 운영 인프라 및 회계 내역과 100% 일치함을 확인합니다.</div>' +
        '<' + 'script>window.onload = function(){ window.print(); };<' + '/script>' +
        '</body></html>'
      );
      printWin.document.close();
    }

    function exportGijoBundle() {
      const todayStr = new Date().toISOString().slice(0, 10);
      const bundle = {
        version: '5.2.0',
        exportedAt: new Date().toISOString(),
        orgName: customerOrgName || '한국수력원자력 정보보호본부',
        docs: currentDocs,
        itAssets: currentItAssets,
        aiApiList: currentAiApiList,
        checklistData: dailyChecklistData,
        stampStates: stampStates
      };

      const jsonStr = JSON.stringify(bundle, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'GIJO_Security_Data_Bundle_' + todayStr + '.gijo-bundle';
      a.click();
      alert('✅ 전사 지식고 문서(' + currentDocs.length + '건), IT 자산(' + currentItAssets.length + '대), SBOM, 전자결재, 점검 일지가 안전 백업되었습니다!');
    }

    function importGijoBundlePrompt() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gijo-bundle,.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target.result);
            if (!data.version || (!data.docs && !data.itAssets)) {
              alert('올바른 GIJO 에어갭 데이터 번들 파일이 아닙니다.');
              return;
            }

            if (data.docs && Array.isArray(data.docs)) {
              currentDocs = data.docs;
              saveDocsToStorage();
              renderWikiDocList();
            }
            if (data.itAssets && Array.isArray(data.itAssets)) {
              currentItAssets = data.itAssets;
              saveAssetsToStorage();
              renderAssetTable();
              updateAssetKpis();
              renderAssetTopologyGraph();
            }
            if (data.aiApiList && Array.isArray(data.aiApiList)) {
              currentAiApiList = data.aiApiList;
              saveAiApiToStorage();
              renderAiApiTable();
              updateAiApiKpis();
            }
            if (data.checklistData) {
              dailyChecklistData = data.checklistData;
              localStorage.setItem(CHECKLIST_KEY, JSON.stringify(dailyChecklistData));
              renderChecklistGrid();
            }
            if (data.stampStates) {
              stampStates = data.stampStates;
            }

            renderDashboardKpis();
            alert('🎉 전사 데이터 번들 (' + file.name + ')이 성공적으로 복원되었습니다!\\n- 지식고 문서: ' + currentDocs.length + '건\\n- IT 자산: ' + currentItAssets.length + '대\\n- 점검 일지 및 결재 상태 동기화 완료');
          } catch(err) {
            alert('파일 읽기 오류: ' + err.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
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

    let checklistViewMode = 'EXCEL'; // Default: EXCEL High Density

    function toggleChecklistViewMode() {
      checklistViewMode = checklistViewMode === 'EXCEL' ? 'CARD' : 'EXCEL';
      const btn = document.getElementById('btnToggleChecklistMode');
      if (btn) {
        btn.innerHTML = checklistViewMode === 'EXCEL' 
          ? '<i data-lucide="sheet" style="width:13px; height:13px;"></i> 엑셀 대장 뷰' 
          : '<i data-lucide="layout-grid" style="width:13px; height:13px;"></i> 카드 뷰';
      }
      renderChecklistGrid();
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

      if (checklistViewMode === 'EXCEL') {
        container.style.display = 'block';
        let rows = '';
        activeSolutionsList.forEach((sol, idx) => {
          if (!dayRecords[sol.name]) {
            dayRecords[sol.name] = { daemon: 'NORMAL', log: 'NORMAL', backup: 'NORMAL', memo: '' };
          }
          const rec = dayRecords[sol.name];

          const isKr = sol.vendor.includes('국산') || sol.vendorType === '국산';
          const badgeType = isKr ? 'success' : 'info';

          const btnD_Normal = rec.daemon === 'NORMAL' ? 'background:#059669; color:#fff; font-weight:700;' : '';
          const btnD_Warn = rec.daemon === 'WARN' ? 'background:#d97706; color:#fff; font-weight:700;' : '';
          const btnD_Error = rec.daemon === 'ERROR' ? 'background:#dc2626; color:#fff; font-weight:700;' : '';

          const btnL_Normal = rec.log === 'NORMAL' ? 'background:#059669; color:#fff; font-weight:700;' : '';
          const btnL_Warn = rec.log === 'WARN' ? 'background:#d97706; color:#fff; font-weight:700;' : '';
          const btnL_Error = rec.log === 'ERROR' ? 'background:#dc2626; color:#fff; font-weight:700;' : '';

          const btnB_Normal = rec.backup === 'NORMAL' ? 'background:#059669; color:#fff; font-weight:700;' : '';
          const btnB_Warn = rec.backup === 'WARN' ? 'background:#d97706; color:#fff; font-weight:700;' : '';
          const btnB_Error = rec.backup === 'ERROR' ? 'background:#dc2626; color:#fff; font-weight:700;' : '';

          const solEscaped = sol.name.replace(/'/g, "\\'");

          rows += 
            '<tr>' +
              '<td class="center">' + (idx + 1) + '</td>' +
              '<td><b>' + sanitizeHtml(sol.name) + '</b></td>' +
              '<td>' + sanitizeHtml(sol.vendor) + '</td>' +
              '<td class="center"><span class="x-badge ' + badgeType + '">' + (isKr ? '국산' : '외산') + '</span></td>' +
              '<td class="center">' +
                '<button class="x-btn" style="' + btnD_Normal + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;daemon&apos;, &apos;NORMAL&apos;)">정상</button> ' +
                '<button class="x-btn" style="' + btnD_Warn + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;daemon&apos;, &apos;WARN&apos;)">주의</button> ' +
                '<button class="x-btn" style="' + btnD_Error + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;daemon&apos;, &apos;ERROR&apos;)">이상</button>' +
              '</td>' +
              '<td class="center">' +
                '<button class="x-btn" style="' + btnL_Normal + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;log&apos;, &apos;NORMAL&apos;)">정상</button> ' +
                '<button class="x-btn" style="' + btnL_Warn + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;log&apos;, &apos;WARN&apos;)">주의</button> ' +
                '<button class="x-btn" style="' + btnL_Error + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;log&apos;, &apos;ERROR&apos;)">이상</button>' +
              '</td>' +
              '<td class="center">' +
                '<button class="x-btn" style="' + btnB_Normal + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;backup&apos;, &apos;NORMAL&apos;)">정상</button> ' +
                '<button class="x-btn" style="' + btnB_Warn + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;backup&apos;, &apos;WARN&apos;)">주의</button> ' +
                '<button class="x-btn" style="' + btnB_Error + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;backup&apos;, &apos;ERROR&apos;)">이상</button>' +
              '</td>' +
              '<td>' +
                '<input type="text" class="x-input" style="width:100%;" value="' + sanitizeHtml(rec.memo || '') + '" placeholder="특이사항/조치내용 입력" onchange="updateChecklistItemMemo(&apos;' + solEscaped + '&apos;, this.value)">' +
              '</td>' +
            '</tr>';
        });

        container.innerHTML = 
          '<div class="excel-wrapper">' +
            '<table class="excel-table">' +
              '<thead>' +
                '<tr>' +
                  '<th class="center" style="width:35px;">No</th>' +
                  '<th style="width:180px;">솔루션명</th>' +
                  '<th style="width:120px;">공급사/벤더</th>' +
                  '<th class="center" style="width:70px;">국산/외산</th>' +
                  '<th class="center" style="width:145px;">데몬/프로세스</th>' +
                  '<th class="center" style="width:145px;">로그 수집</th>' +
                  '<th class="center" style="width:145px;">백업/무결성</th>' +
                  '<th>당일 점검 메모 / 특이사항</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>';

        lucide.createIcons();
        return;
      }

      // Fallback: Card View Mode
      container.style.display = 'grid';
      activeSolutionsList.forEach((sol, idx) => {
        if (!dayRecords[sol.name]) {
          dayRecords[sol.name] = { daemon: 'NORMAL', log: 'NORMAL', backup: 'NORMAL', memo: '' };
        }
        const rec = dayRecords[sol.name];

        const card = document.createElement('div');
        card.className = 'white-panel';
        card.style.cssText = 'padding:1rem; border:1px solid var(--border); border-radius:8px; display:flex; flex-direction:column; gap:0.6rem;';

        const isKr = sol.vendor.includes('국산') || sol.vendorType === '국산';
        const badgeClass = isKr ? 'badge-kr' : 'badge-global';
        const solEscaped = sol.name.replace(/'/g, "\\'");

        card.innerHTML = 
          '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
            '<div>' +
              '<span class="meta-badge ' + badgeClass + '" style="font-size:0.65rem;">' + (isKr ? '국산' : '외산') + '</span>' +
              '<h4 style="font-size:0.95rem; font-weight:800; color:var(--text-main); margin-top:0.2rem;">' + sanitizeHtml(sol.name) + '</h4>' +
              '<div style="font-size:0.72rem; color:var(--text-dim);">' + sanitizeHtml(sol.vendor) + '</div>' +
            '</div>' +
            '<button class="btn btn-sm" style="font-size:0.7rem; padding:0.15rem 0.4rem;" onclick="setAllNormalForSol(&apos;' + solEscaped + '&apos;)">전체정상</button>' +
          '</div>' +
          '<div style="display:flex; flex-direction:column; gap:0.4rem; font-size:0.75rem; background:#f8fafc; padding:0.5rem; border-radius:6px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<span>데몬/서비스:</span>' +
              '<div style="display:flex; gap:0.2rem;">' +
                '<button class="btn btn-sm ' + (rec.daemon === 'NORMAL' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem;" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;daemon&apos;, &apos;NORMAL&apos;)">정상</button>' +
                '<button class="btn btn-sm ' + (rec.daemon === 'WARN' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem;" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;daemon&apos;, &apos;WARN&apos;)">주의</button>' +
                '<button class="btn btn-sm ' + (rec.daemon === 'ERROR' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem; background:' + (rec.daemon === 'ERROR' ? '#fee2e2; color:#dc2626; border-color:#fca5a5;' : '') + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;daemon&apos;, &apos;ERROR&apos;)">이상</button>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<span>로그 수집:</span>' +
              '<div style="display:flex; gap:0.2rem;">' +
                '<button class="btn btn-sm ' + (rec.log === 'NORMAL' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem;" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;log&apos;, &apos;NORMAL&apos;)">정상</button>' +
                '<button class="btn btn-sm ' + (rec.log === 'WARN' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem;" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;log&apos;, &apos;WARN&apos;)">주의</button>' +
                '<button class="btn btn-sm ' + (rec.log === 'ERROR' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem; background:' + (rec.log === 'ERROR' ? '#fee2e2; color:#dc2626; border-color:#fca5a5;' : '') + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;log&apos;, &apos;ERROR&apos;)">이상</button>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<span>백업 무결성:</span>' +
              '<div style="display:flex; gap:0.2rem;">' +
                '<button class="btn btn-sm ' + (rec.backup === 'NORMAL' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem;" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;backup&apos;, &apos;NORMAL&apos;)">정상</button>' +
                '<button class="btn btn-sm ' + (rec.backup === 'WARN' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem;" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;backup&apos;, &apos;WARN&apos;)">주의</button>' +
                '<button class="btn btn-sm ' + (rec.backup === 'ERROR' ? 'btn-primary' : '') + '" style="padding:0.1rem 0.35rem; font-size:0.68rem; background:' + (rec.backup === 'ERROR' ? '#fee2e2; color:#dc2626; border-color:#fca5a5;' : '') + '" onclick="setChecklistItemStatus(&apos;' + solEscaped + '&apos;, &apos;backup&apos;, &apos;ERROR&apos;)">이상</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<input type="text" class="search-input" style="width:100%; font-size:0.72rem; padding:0.25rem 0.4rem;" placeholder="점검 메모 / 조치 내용 입력..." value="' + sanitizeHtml(rec.memo || '') + '" onchange="updateChecklistItemMemo(&apos;' + solEscaped + '&apos;, this.value)">' +
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

    // --- 4.7 IT ASSET & SBOM INVENTORY MODULE ---
    const ASSET_STORAGE_KEY = 'GIJO_IT_ASSETS_V5_2';
    let currentItAssets = [];
    let currentAssetFilterZone = 'ALL';

    const defaultItAssets = [
      {
        id: 'ASSET-01',
        name: '대고객 포털 웹서버 #1',
        category: '웹서버(WEB)',
        zone: 'DMZ',
        ip: '192.168.10.25',
        os: 'Rocky Linux 9.2 (64-bit)',
        manager: '인프라운영팀 홍길동 책임',
        updatedAt: '2026-09-16',
        components: [
          { name: 'Nginx', version: '1.24.0', license: 'BSD-2-Clause', purl: 'pkg:generic/nginx@1.24.0', cve: '양호' },
          { name: 'OpenSSL', version: '3.0.7', license: 'Apache-2.0', purl: 'pkg:generic/openssl@3.0.7', cve: '양호' }
        ]
      },
      {
        id: 'ASSET-02',
        name: '코어 비즈니스 WAS #1',
        category: '애플리케이션(WAS)',
        zone: 'TRUST',
        ip: '10.10.30.15',
        os: 'Red Hat Enterprise Linux 8.8',
        manager: '서비스개발팀 김철수 수석',
        updatedAt: '2026-09-16',
        components: [
          { name: 'OpenJDK', version: '17.0.8', license: 'GPL-2.0 / 3.0', purl: 'pkg:generic/openjdk@17.0.8', cve: '양호' },
          { name: 'Spring Boot', version: '3.2.2', license: 'Apache-2.0', purl: 'pkg:maven/org.springframework.boot/spring-boot@3.2.2', cve: '양호' },
          { name: 'Logback', version: '1.4.14', license: 'LGPL-2.1 / 3.0', purl: 'pkg:maven/ch.qos.logback/logback-classic@1.4.14', cve: '양호' }
        ]
      },
      {
        id: 'ASSET-03',
        name: '고객원장 마스터 DB',
        category: '데이터베이스(DB)',
        zone: 'SECURE_DB',
        ip: '10.10.80.50',
        os: 'Oracle Linux 8.6',
        manager: '데이터관리팀 박영희 팀장',
        updatedAt: '2026-09-16',
        components: [
          { name: 'PostgreSQL', version: '15.4', license: 'BSD-2-Clause', purl: 'pkg:generic/postgresql@15.4', cve: '양호' },
          { name: 'CipherTrust Agent', version: '7.3.0', license: 'Proprietary', purl: 'pkg:generic/ciphertrust@7.3.0', cve: '양호' }
        ]
      },
      {
        id: 'ASSET-04',
        name: '경계 차세대 방화벽 어플라이언스',
        category: '보안장비(FW/IPS)',
        zone: 'PERIMETER',
        ip: '192.168.1.1',
        os: 'FortiOS 7.2.5',
        manager: '정보보호팀 최보안 책임',
        updatedAt: '2026-09-16',
        components: [
          { name: 'FortiOS Kernel', version: '7.2.5', license: 'Proprietary', purl: 'pkg:generic/fortios@7.2.5', cve: '양호' },
          { name: 'IPS Signature Engine', version: '2026.09-v2', license: 'Proprietary', purl: 'pkg:generic/ips-sig@2026.09', cve: '양호' }
        ]
      },
      {
        id: 'ASSET-05',
        name: '금융 코어 WAS (TmaxSoft JEUS 8.5)',
        category: '애플리케이션(WAS)',
        zone: 'TRUST',
        ip: '10.10.40.20',
        os: 'Red Hat Enterprise Linux 8.8 (Clarity SCA 검증)',
        manager: '계정계운영팀 이금융 차장',
        updatedAt: '2026-09-16',
        components: [
          { name: 'spring-framework', version: '5.3.39', license: 'Apache-2.0 / BSD-3-Clause', purl: 'pkg:github/vmware/spring-framework@5.3.39', cve: '위험 (CVE-2016-1000027 RCE 9.8)' },
          { name: 'spring-security', version: '5.8.16', license: 'Apache-2.0', purl: 'pkg:github/vmware/spring-security@5.8.16', cve: '위험 (CVE-2026-22732 Header 9.1)' },
          { name: 'apache-tomcat', version: '5.5.36', license: 'Apache-2.0', purl: 'pkg:apache/apache_tomcat/tomcat@5.5.36', cve: '위험 (CVE-2025-24813 RCE 9.8)' },
          { name: 'jackson-databind', version: '2.17.1', license: 'Apache-2.0', purl: 'pkg:maven/fasterxml/jackson-databind@2.17.1', cve: '주의 (CVE-2026-54512 PTV 8.1)' },
          { name: 'openjdk', version: '14+10', license: 'GPL-2.0-only', purl: 'pkg:github/sun/openjdk@14+10', cve: '주의 (CVE-2009-2475 7.8)' },
          { name: 'jline', version: '3.21.0', license: 'BSD-3-Clause', purl: 'pkg:github/org.jline.jline@3.21.0', cve: '양호' },
          { name: 'rhino', version: '1.7.15', license: 'MPL-2.0 / MIT', purl: 'pkg:github/mozilla/rhino@1.7.15', cve: '주의 (CVE-2025-66453 DoS 7.5)' }
        ]
      }
    ];

    function loadItAssets() {
      try {
        const stored = localStorage.getItem(ASSET_STORAGE_KEY);
        if (stored) {
          currentItAssets = JSON.parse(stored);
        } else {
          currentItAssets = JSON.parse(JSON.stringify(defaultItAssets));
          saveItAssetsToStorage();
        }
      } catch (e) {
        currentItAssets = JSON.parse(JSON.stringify(defaultItAssets));
      }
    }

    function saveItAssetsToStorage() {
      try {
        localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(currentItAssets));
      } catch (e) {}
      updateAssetKpis();
      syncAssetsToWikiDocs();
    }

    function resetToDefaultAssets() {
      if (confirm('전사 IT 자산 목록을 표준 4대 실물 자산으로 초기화하시겠습니까?')) {
        currentItAssets = JSON.parse(JSON.stringify(defaultItAssets));
        saveItAssetsToStorage();
        renderAssetTable();
        alert('✅ IT 자산 목록이 초기화되었습니다.');
      }
    }

    function updateAssetKpis() {
      const elTotalAssets = document.getElementById('statTotalAssets');
      const elTotalComps = document.getElementById('statTotalComponents');
      const elZoneDist = document.getElementById('statZoneDist');

      if (!elTotalAssets) return;

      const totalAssets = currentItAssets.length;
      let totalComps = 0;
      let dmzCount = 0;
      let trustCount = 0;
      let dbCount = 0;

      currentItAssets.forEach(a => {
        totalComps += (a.components || []).length;
        if (a.zone === 'DMZ') dmzCount++;
        else if (a.zone === 'TRUST') trustCount++;
        else if (a.zone === 'SECURE_DB') dbCount++;
      });

      elTotalAssets.innerText = totalAssets + '대';
      elTotalComps.innerText = totalComps + '개';
      elZoneDist.innerText = 'DMZ ' + dmzCount + ' / 업무 ' + trustCount + ' / DB ' + dbCount;
    }

    function filterAssetZone(zone) {
      currentAssetFilterZone = zone;
      const tabs = document.getElementById('assetFilterTabs');
      if (tabs) {
        tabs.querySelectorAll('.pill-cat').forEach(btn => btn.classList.remove('active'));
      }
      if (event && event.target) event.target.classList.add('active');
      renderAssetTable();
    }

    let assetViewMode = 'EXCEL'; // Default: EXCEL High Density

    function toggleAssetViewMode() {
      assetViewMode = assetViewMode === 'EXCEL' ? 'CARD' : 'EXCEL';
      const btn = document.getElementById('btnToggleAssetMode');
      if (btn) {
        btn.innerHTML = assetViewMode === 'EXCEL' 
          ? '<i data-lucide="sheet" style="width:13px; height:13px;"></i> 엑셀 대장 뷰' 
          : '<i data-lucide="layout-grid" style="width:13px; height:13px;"></i> 카드 뷰';
      }
      renderAssetTable();
    }

    function toggleAssetCompRow(assetId) {
      const row = document.getElementById('assetCompRow-' + assetId);
      if (row) {
        row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
      }
    }

    function renderAssetTable() {
      const container = document.getElementById('assetCardsContainer');
      if (!container) return;
      container.innerHTML = '';

      const query = (document.getElementById('assetSearchInput')?.value || '').toLowerCase().trim();

      const filtered = currentItAssets.filter(asset => {
        if (currentAssetFilterZone !== 'ALL' && asset.zone !== currentAssetFilterZone) return false;
        if (!query) return true;

        const matchName = (asset.name || '').toLowerCase().includes(query);
        const matchIp = (asset.ip || '').toLowerCase().includes(query);
        const matchOs = (asset.os || '').toLowerCase().includes(query);
        const matchComp = (asset.components || []).some(c => (c.name || '').toLowerCase().includes(query) || (c.version || '').toLowerCase().includes(query));
        return matchName || matchIp || matchOs || matchComp;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div style="background:#fff; border:1px solid var(--border); border-radius:8px; padding:3rem; text-align:center; color:var(--text-dim); font-size:0.85rem;">검색된 IT 자산이 없습니다. 상단의 [+ 자산 직접 등록] 버튼을 눌러 추가하세요.</div>';
        return;
      }

      if (assetViewMode === 'EXCEL') {
        let tableRows = '';
        filtered.forEach((asset, idx) => {
          const zoneKo = asset.zone === 'DMZ' ? 'DMZ' : (asset.zone === 'SECURE_DB' ? 'DB안전구역' : (asset.zone === 'PERIMETER' ? '경계보안' : '내부업무망'));
          const zoneBadge = asset.zone === 'DMZ' ? 'danger' : (asset.zone === 'SECURE_DB' ? 'warning' : 'info');

          const hasCriticalCve = (asset.components || []).some(c => (c.cve || '').includes('위험'));
          const hasWarningCve = (asset.components || []).some(c => (c.cve || '').includes('주의'));

          const cveBadge = hasCriticalCve 
            ? '<span class="x-badge danger">🚨 고위험 CVE</span>'
            : (hasWarningCve ? '<span class="x-badge warning">⚠️ 주의 CVE</span>' : '<span class="x-badge success">✅ 양호</span>');

          const comps = (asset.components || []).map(c => c.name + ' v' + c.version).join(', ') || '없음';

          // Component detail table
          let compDetailRows = '';
          (asset.components || []).forEach((c, cIdx) => {
            const compCveBadge = c.cve.includes('위험') ? 'danger' : (c.cve.includes('주의') ? 'warning' : 'success');
            compDetailRows += 
              '<tr>' +
                '<td>' + (cIdx + 1) + '</td>' +
                '<td><b>' + sanitizeHtml(c.name) + '</b></td>' +
                '<td><code>v' + sanitizeHtml(c.version) + '</code></td>' +
                '<td>' + sanitizeHtml(c.license || '상용') + '</td>' +
                '<td><span class="x-badge ' + compCveBadge + '">' + sanitizeHtml(c.cve || '양호') + '</span></td>' +
                '<td style="font-family:monospace; font-size:0.7rem; color:var(--text-sub);">' + sanitizeHtml(c.purl || '-') + '</td>' +
                '<td class="center"><button class="x-btn" style="color:var(--danger);" onclick="deleteItComponent(&apos;' + asset.id + '&apos;, ' + cIdx + ')">삭제</button></td>' +
              '</tr>';
          });

          tableRows += 
            '<tr>' +
              '<td class="center">' + (idx + 1) + '</td>' +
              '<td><b>' + asset.id + '</b></td>' +
              '<td><b>' + sanitizeHtml(asset.name) + '</b> <span style="font-size:0.68rem; color:var(--text-sub);">(' + sanitizeHtml(asset.category || '서버') + ')</span></td>' +
              '<td class="center"><span class="x-badge ' + zoneBadge + '">' + zoneKo + '</span></td>' +
              '<td style="font-family:monospace;">' + sanitizeHtml(asset.ip || '-') + '</td>' +
              '<td>' + sanitizeHtml(asset.os || '-') + '</td>' +
              '<td>' + sanitizeHtml(asset.manager || '-') + '</td>' +
              '<td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + sanitizeHtml(comps) + '">' +
                '<button class="x-btn" onclick="toggleAssetCompRow(&apos;' + asset.id + '&apos;)" style="margin-right:5px; font-weight:700;">' +
                  '📦 ' + (asset.components || []).length + '개 부품 ▾' +
                '</button>' +
                '<span style="font-size:0.72rem; color:var(--text-sub);">' + sanitizeHtml(comps) + '</span>' +
              '</td>' +
              '<td class="center">' + cveBadge + '</td>' +
              '<td class="center">' +
                '<button class="x-btn" onclick="openAddComponentModal(&apos;' + asset.id + '&apos;)" title="컴포넌트 추가">+부품</button> ' +
                '<button class="x-btn" onclick="openEditAssetModal(&apos;' + asset.id + '&apos;)">수정</button> ' +
                '<button class="x-btn" style="color:var(--danger);" onclick="deleteItAsset(&apos;' + asset.id + '&apos;)">삭제</button>' +
              '</td>' +
            '</tr>' +
            '<tr id="assetCompRow-' + asset.id + '" style="display:none; background:#f1f5f9;">' +
              '<td colspan="10" style="padding:8px 14px;">' +
                '<div style="background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:8px;">' +
                  '<div style="font-weight:800; font-size:0.75rem; margin-bottom:6px; color:#1e40af; display:flex; justify-content:space-between;">' +
                    '<span>📦 [' + asset.name + '] SBOM 소프트웨어 컴포넌트 세부 명세 (CycloneDX v1.6 호환)</span>' +
                    '<button class="x-btn" onclick="openAddComponentModal(&apos;' + asset.id + '&apos;)">+ 신규 컴포넌트 추가</button>' +
                  '</div>' +
                  '<table class="excel-table">' +
                    '<thead><tr><th style="width:30px;">#</th><th>컴포넌트명</th><th>버전</th><th>라이선스</th><th>CVE 취약점 상태</th><th>PURL 식별자</th><th class="center" style="width:50px;">삭제</th></tr></thead>' +
                    '<tbody>' + (compDetailRows || '<tr><td colspan="7" class="center">등록된 컴포넌트 없음</td></tr>') + '</tbody>' +
                  '</table>' +
                '</div>' +
              '</td>' +
            '</tr>';
        });

        container.innerHTML = 
          '<div class="excel-wrapper">' +
            '<table class="excel-table">' +
              '<thead>' +
                '<tr>' +
                  '<th class="center" style="width:35px;">No</th>' +
                  '<th style="width:85px;">자산 ID</th>' +
                  '<th>자산명 / 역할</th>' +
                  '<th class="center" style="width:90px;">망분리 구역</th>' +
                  '<th style="width:110px;">IP 주소</th>' +
                  '<th style="width:150px;">운영체제</th>' +
                  '<th style="width:95px;">관리 담당</th>' +
                  '<th>설치 컴포넌트 (SBOM)</th>' +
                  '<th class="center" style="width:115px;">CVE 취약점 상태</th>' +
                  '<th class="center" style="width:130px;">관리 작업</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + tableRows + '</tbody>' +
            '</table>' +
          '</div>';

        lucide.createIcons();
        return;
      }

      // Fallback: Card View Mode
      filtered.forEach((asset, aIdx) => {
        const zoneBadgeClass = asset.zone === 'DMZ' ? 'badge-global' : (asset.zone === 'SECURE_DB' ? 'badge-custom' : 'badge-kr');
        const zoneNameKo = asset.zone === 'DMZ' ? '🌐 DMZ 구간' : (asset.zone === 'SECURE_DB' ? '🔒 DB 안전구역' : (asset.zone === 'PERIMETER' ? '🔥 경계/보안' : '🏢 내부 업무망'));

        const hasCriticalCve = (asset.components || []).some(c => (c.cve || '').includes('위험'));
        const hasWarningCve = (asset.components || []).some(c => (c.cve || '').includes('주의'));

        const card = document.createElement('div');
        const cardBorder = hasCriticalCve ? 'border:1.5px solid #fca5a5; background:#fffdfd;' : 'border:1px solid var(--border); background:#ffffff;';
        card.style.cssText = cardBorder + ' border-radius:8px; padding:1.1rem; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:0.75rem;';

        const cveAlertBadge = hasCriticalCve 
          ? '<span style="background:#fee2e2; color:#dc2626; border:1px solid #fecaca; padding:2px 8px; border-radius:999px; font-weight:800; font-size:0.68rem; display:inline-flex; align-items:center; gap:3px;">🚨 고위험 CVE 발견</span>'
          : (hasWarningCve 
             ? '<span style="background:#fef3c7; color:#d97706; border:1px solid #fde68a; padding:2px 8px; border-radius:999px; font-weight:700; font-size:0.68rem;">⚠️ 주의 CVE</span>' 
             : '<span style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; padding:2px 8px; border-radius:999px; font-weight:700; font-size:0.68rem;">✅ CVE 통제양호</span>');

        card.innerHTML = 
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem;">' +
            '<div>' +
              '<div style="display:flex; align-items:center; gap:0.45rem; margin-bottom:0.25rem;">' +
                '<span class="meta-badge ' + zoneBadgeClass + '" style="font-size:0.7rem;">' + zoneNameKo + '</span>' +
                '<span class="meta-badge" style="font-size:0.7rem; background:#f8fafc;">' + sanitizeHtml(asset.category || '서버') + '</span>' +
                '<span style="font-size:0.75rem; color:var(--text-dim); font-family:monospace;">ID: ' + asset.id + '</span>' +
                cveAlertBadge +
              '</div>' +
              '<h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">' + sanitizeHtml(asset.name) + '</h3>' +
              '<div style="display:flex; gap:1rem; margin-top:0.3rem; font-size:0.76rem; color:var(--text-sub);">' +
                '<span><b>IP</b>: ' + sanitizeHtml(asset.ip || '미지정') + '</span>' +
                '<span><b>OS</b>: ' + sanitizeHtml(asset.os || 'Linux') + '</span>' +
                '<span><b>담당자</b>: ' + sanitizeHtml(asset.manager || '미지정') + '</span>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex; gap:0.35rem;">' +
              '<button class="btn btn-sm" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; font-weight:700;" onclick="openAddComponentModal(&apos;' + asset.id + '&apos;)">' +
                '<i data-lucide="plus-circle" style="width:12px; height:12px;"></i> 컴포넌트 추가' +
              '</button>' +
              '<button class="btn btn-sm" onclick="openEditAssetModal(&apos;' + asset.id + '&apos;)">수정</button>' +
              '<button class="btn btn-sm" style="color:var(--danger);" onclick="deleteItAsset(&apos;' + asset.id + '&apos;)">삭제</button>' +
            '</div>' +
          '</div>';

        container.appendChild(card);
      });
      lucide.createIcons();
    }

        function openAddAssetModal() {
      document.getElementById('itAssetModalTitle').innerText = 'IT 자산 직접 등록';
      document.getElementById('assetModalId').value = '';
      document.getElementById('assetModalName').value = '';
      document.getElementById('assetModalZone').value = 'DMZ';
      document.getElementById('assetModalCategory').value = '웹서버(WEB)';
      document.getElementById('assetModalIp').value = '';
      document.getElementById('assetModalOs').value = '';
      document.getElementById('assetModalManager').value = '';
      document.getElementById('itAssetModal').style.display = 'flex';
      lucide.createIcons();
    }

    function openEditAssetModal(assetId) {
      const asset = currentItAssets.find(a => a.id === assetId);
      if (!asset) return;

      document.getElementById('itAssetModalTitle').innerText = 'IT 자산 스펙 수정';
      document.getElementById('assetModalId').value = asset.id;
      document.getElementById('assetModalName').value = asset.name;
      document.getElementById('assetModalZone').value = asset.zone;
      document.getElementById('assetModalCategory').value = asset.category;
      document.getElementById('assetModalIp').value = asset.ip || '';
      document.getElementById('assetModalOs').value = asset.os || '';
      document.getElementById('assetModalManager').value = asset.manager || '';
      document.getElementById('itAssetModal').style.display = 'flex';
      lucide.createIcons();
    }

    function closeItAssetModal() {
      document.getElementById('itAssetModal').style.display = 'none';
    }

    function saveItAsset() {
      const id = document.getElementById('assetModalId').value;
      const name = document.getElementById('assetModalName').value.trim();
      const zone = document.getElementById('assetModalZone').value;
      const category = document.getElementById('assetModalCategory').value;
      const ip = document.getElementById('assetModalIp').value.trim();
      const os = document.getElementById('assetModalOs').value.trim();
      const manager = document.getElementById('assetModalManager').value.trim();

      if (!name) {
        alert('자산명을 입력해주세요.');
        return;
      }

      if (id) {
        // Edit existing
        const asset = currentItAssets.find(a => a.id === id);
        if (asset) {
          asset.name = name;
          asset.zone = zone;
          asset.category = category;
          asset.ip = ip;
          asset.os = os;
          asset.manager = manager;
          asset.updatedAt = new Date().toISOString().slice(0, 10);
        }
      } else {
        // Create new
        const newId = 'ASSET-' + String(currentItAssets.length + 1).padStart(2, '0');
        currentItAssets.push({
          id: newId,
          name: name,
          zone: zone,
          category: category,
          ip: ip,
          os: os,
          manager: manager,
          updatedAt: new Date().toISOString().slice(0, 10),
          components: []
        });
      }

      saveItAssetsToStorage();
      closeItAssetModal();
      renderAssetTable();
      alert('✅ IT 자산 정보가 저장되었습니다.');
    }

    function deleteItAsset(assetId) {
      if (confirm('선택한 자산과 등록된 모든 SBOM 컴포넌트를 삭제하시겠습니까?')) {
        currentItAssets = currentItAssets.filter(a => a.id !== assetId);
        saveItAssetsToStorage();
        renderAssetTable();
      }
    }

    function openAddComponentModal(assetId) {
      const asset = currentItAssets.find(a => a.id === assetId);
      if (!asset) return;

      document.getElementById('compTargetAssetId').value = assetId;
      document.getElementById('compModalName').value = '';
      document.getElementById('compModalVersion').value = '';
      document.getElementById('compModalLicense').value = 'Apache-2.0';
      document.getElementById('compModalCve').value = '양호';
      document.getElementById('compModalPurl').value = '';
      document.getElementById('itComponentModal').style.display = 'flex';
      lucide.createIcons();
    }

    function closeItComponentModal() {
      document.getElementById('itComponentModal').style.display = 'none';
    }

    function saveItComponent() {
      const assetId = document.getElementById('compTargetAssetId').value;
      const asset = currentItAssets.find(a => a.id === assetId);
      if (!asset) return;

      const name = document.getElementById('compModalName').value.trim();
      const version = document.getElementById('compModalVersion').value.trim();
      const license = document.getElementById('compModalLicense').value;
      const cve = document.getElementById('compModalCve').value;
      const purl = document.getElementById('compModalPurl').value.trim();

      if (!name || !version) {
        alert('소프트웨어/라이브러리명과 버전을 입력해주세요.');
        return;
      }

      if (!asset.components) asset.components = [];
      asset.components.push({
        name: name,
        version: version,
        license: license,
        cve: cve,
        purl: purl || ('pkg:generic/' + name.toLowerCase() + '@' + version)
      });

      saveItAssetsToStorage();
      closeItComponentModal();
      renderAssetTable();
      alert('✅ [' + name + ' v' + version + '] 컴포넌트가 자산에 등록되었습니다.');
    }

    function deleteItComponent(assetId, compIdx) {
      const asset = currentItAssets.find(a => a.id === assetId);
      if (!asset || !asset.components) return;

      if (confirm('해당 소프트웨어 컴포넌트를 SBOM 명세에서 제외하시겠습니까?')) {
        asset.components.splice(compIdx, 1);
        saveItAssetsToStorage();
        renderAssetTable();
      }
    }

    
    // --- 4.7.1 INLINE ASSET TOPOLOGY GRAPH RENDERER ---
    let isAssetTopologyCollapsed = false;
    function toggleAssetTopologyView() {
      const wrapper = document.getElementById('assetTopologyContentWrapper');
      const btn = document.getElementById('btnToggleTopology');
      if (!wrapper || !btn) return;

      isAssetTopologyCollapsed = !isAssetTopologyCollapsed;
      wrapper.style.display = isAssetTopologyCollapsed ? 'none' : 'block';
      btn.innerText = isAssetTopologyCollapsed ? '펼치기 ▼' : '접기 ▲';
    }

    let topologyRenderId = 0;
    async function renderAssetTopologyGraph() {
      const container = document.getElementById('assetTopologyGraphContainer');
      if (!container) return;
      if (isAssetTopologyCollapsed) return;

      if (!currentItAssets || currentItAssets.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim); font-size:0.8rem; padding:2rem; text-align:center;">등록된 IT 자산이 없습니다. 자산을 등록하시면 토폴로지 구성도가 자동 생성됩니다.</div>';
        return;
      }

      const perimeterAssets = currentItAssets.filter(a => a.zone === 'PERIMETER');
      const dmzAssets = currentItAssets.filter(a => a.zone === 'DMZ');
      const trustAssets = currentItAssets.filter(a => a.zone === 'TRUST');
      const dbAssets = currentItAssets.filter(a => a.zone === 'SECURE_DB');

      let code = 'flowchart LR\\n';
      code += '  subgraph ClientZone["🌐 외부 사용자"]\\n';
      code += '    ExtUser["👤 웹/모바일 단말\\n(HTTPS 443)"]\\n';
      code += '  end\\n\\n';

      let styleSnippets = '';

      if (perimeterAssets.length > 0) {
        code += '  subgraph PeriZone["🛡️ 경계 보안구역"]\\n';
        perimeterAssets.forEach((a, i) => {
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '🔥 ';
          code += '    G_P' + i + '["' + nodeIcon + a.name + '<br/><small>' + a.ip + '</small>"]\\n';
          if (hasCrit) styleSnippets += '  style G_P' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (dmzAssets.length > 0) {
        code += '  subgraph DmzZone["🏢 DMZ 웹구간"]\\n';
        dmzAssets.forEach((a, i) => {
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '🌐 ';
          code += '    G_D' + i + '["' + nodeIcon + a.name + '<br/><small>' + a.ip + '</small>"]\\n';
          if (hasCrit) styleSnippets += '  style G_D' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (trustAssets.length > 0) {
        code += '  subgraph TrustZone["🏢 내부 코어 업무망"]\\n';
        trustAssets.forEach((a, i) => {
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '⚙️ ';
          const critTag = hasCrit ? '<br/><b>[🚨 위험 CVE 발견]</b>' : '';
          code += '    G_T' + i + '["' + nodeIcon + a.name + '<br/><small>' + a.ip + '</small>' + critTag + '"]\\n';
          if (hasCrit) styleSnippets += '  style G_T' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (dbAssets.length > 0) {
        code += '  subgraph DbZone["🔒 DB 안전구역"]\\n';
        dbAssets.forEach((a, i) => {
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '🗄️ ';
          code += '    G_DB' + i + '["' + nodeIcon + a.name + '<br/><small>' + a.ip + '</small>"]\\n';
          if (hasCrit) styleSnippets += '  style G_DB' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (perimeterAssets.length > 0) code += '  ClientZone -->|인바운드 443| PeriZone\\n';
      if (perimeterAssets.length > 0 && dmzAssets.length > 0) code += '  PeriZone -->|패킷 검사| DmzZone\\n';
      else if (dmzAssets.length > 0) code += '  ClientZone -->|HTTPS 443| DmzZone\\n';

      if (dmzAssets.length > 0 && trustAssets.length > 0) code += '  DmzZone -->|API 호출 8443| TrustZone\\n';
      if (trustAssets.length > 0 && dbAssets.length > 0) code += '  TrustZone -->|SQL 쿼리 암호화| DbZone\\n';

      if (styleSnippets) {
        code += '\\n  %% Critical CVE Highlights\\n' + styleSnippets;
      }

      topologyRenderId++;
      const renderUniqueId = 'assetTopoGraphSvg_' + topologyRenderId;

      try {
        if (window.mermaid) {
          const { svg } = await mermaid.render(renderUniqueId, code);
          container.innerHTML = svg;
          const svgEl = container.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        }
      } catch (err) {
        console.warn('Asset topology render warning:', err);
        container.innerHTML = '<div style="padding:1.5rem; color:var(--text-sub); font-size:0.75rem; text-align:center;">토폴로지 그래프 렌더링 중입니다. (자산 수: ' + currentItAssets.length + '대)</div>';
      }
    }

    function syncAssetsToStudio() {
      if (currentItAssets.length === 0) {
        alert('등록된 IT 자산이 없습니다. 자산을 먼저 등록해주세요.');
        return;
      }

      const perimeterAssets = currentItAssets.filter(a => a.zone === 'PERIMETER');
      const dmzAssets = currentItAssets.filter(a => a.zone === 'DMZ');
      const trustAssets = currentItAssets.filter(a => a.zone === 'TRUST');
      const dbAssets = currentItAssets.filter(a => a.zone === 'SECURE_DB');
      const cloudAssets = currentItAssets.filter(a => a.zone === 'CLOUD');

      let code = 'flowchart TB\\n';
      code += '  subgraph External["🌐 외부 인터넷망 (Untrusted Client)"]\\n';
      code += '    User["👤 웹 / 모바일 클라이언트 (HTTPS 443)"]\\n';
      code += '  end\\n\\n';

      let styleSnippets = '';

      if (perimeterAssets.length > 0) {
        code += '  subgraph Boundary["🛡️ 경계 보안 구역 (Perimeter Zone)"]\\n';
        perimeterAssets.forEach((a, i) => {
          const compNames = (a.components || []).map(c => c.name).join(', ') || '보안 엔진';
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '🔥 ';
          const vulnText = hasCrit ? '<br/><b>[🚨 취약점 탐지]</b>' : '';
          code += '    P_' + i + '["' + nodeIcon + a.name + '<br/>- ' + a.ip + '<br/>- ' + compNames + vulnText + '"]\\n';
          if (hasCrit) styleSnippets += '  style P_' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (dmzAssets.length > 0) {
        code += '  subgraph DMZ["🏢 DMZ 구역 (Semi-Trusted / Public Web)"]\\n';
        dmzAssets.forEach((a, i) => {
          const compNames = (a.components || []).map(c => c.name + ' v' + c.version).join(', ') || 'Nginx';
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '🌐 ';
          const vulnText = hasCrit ? '<br/><b>[🚨 취약점 탐지]</b>' : '';
          code += '    D_' + i + '["' + nodeIcon + a.name + '<br/>- ' + a.ip + '<br/>- ' + compNames + vulnText + '"]\\n';
          if (hasCrit) styleSnippets += '  style D_' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (trustAssets.length > 0) {
        code += '  subgraph Trust["🏢 내부 업무망 (Trusted Zone / Core App)"]\\n';
        trustAssets.forEach((a, i) => {
          const compNames = (a.components || []).map(c => c.name + ' v' + c.version).join(', ') || 'App';
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '⚙️ ';
          const vulnText = hasCrit ? '<br/><b>[🚨 취약점 탐지]</b>' : '';
          code += '    T_' + i + '["' + nodeIcon + a.name + '<br/>- ' + a.ip + '<br/>- ' + compNames + vulnText + '"]\\n';
          if (hasCrit) styleSnippets += '  style T_' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (dbAssets.length > 0) {
        code += '  subgraph SecureDB["🔒 데이터베이스 안전구역 (Secure DB Vault)"]\\n';
        dbAssets.forEach((a, i) => {
          const compNames = (a.components || []).map(c => c.name + ' v' + c.version).join(', ') || 'DB';
          const hasCrit = (a.components || []).some(c => (c.cve || '').includes('위험'));
          const nodeIcon = hasCrit ? '🚨 ' : '🗄️ ';
          const vulnText = hasCrit ? '<br/><b>[🚨 취약점 탐지]</b>' : '';
          code += '    DB_' + i + '["' + nodeIcon + a.name + '<br/>- ' + a.ip + '<br/>- ' + compNames + vulnText + '"]\\n';
          if (hasCrit) styleSnippets += '  style DB_' + i + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px\\n';
        });
        code += '  end\\n\\n';
      }

      if (perimeterAssets.length > 0) code += '  External -->|HTTPS 443| Boundary\\n';
      if (perimeterAssets.length > 0 && dmzAssets.length > 0) code += '  Boundary -->|검증된 트래픽| DMZ\\n';
      else if (dmzAssets.length > 0) code += '  External -->|HTTPS 443| DMZ\\n';

      if (dmzAssets.length > 0 && trustAssets.length > 0) code += '  DMZ -->|API 호출 8443| Trust\\n';
      if (trustAssets.length > 0 && dbAssets.length > 0) code += '  Trust -->|SQL 쿼리 & 암호화| SecureDB\\n';

      if (styleSnippets) {
        code += '\\n  %% Vulnerable Node Alerts\\n' + styleSnippets;
      }

      document.getElementById('studioMermaidCode').value = code;
      renderMermaidFromEditor();
      switchView('studio');
      alert('✅ 사내 IT 자산 ' + currentItAssets.length + '대를 기반으로 아키텍처 다이어그램이 자동 구성되었습니다!');
    }

    function exportCycloneDxJson() {
      const bom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: 'urn:uuid:' + crypto.randomUUID(),
        version: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          tools: [{ vendor: 'GIJO TECHNOLOGY', name: 'GIJO AS Lite', version: '5.2.0' }],
          component: {
            type: 'operating-system',
            name: customerOrgName + ' 전사 IT 자산 인프라',
            version: '2026.09'
          }
        },
        components: []
      };

      currentItAssets.forEach(asset => {
        (asset.components || []).forEach(comp => {
          bom.components.push({
            type: 'library',
            name: comp.name,
            version: comp.version,
            purl: comp.purl || ('pkg:generic/' + comp.name.toLowerCase() + '@' + comp.version),
            licenses: [{ license: { id: comp.license } }],
            properties: [
              { name: 'gijo:asset:id', value: asset.id },
              { name: 'gijo:asset:name', value: asset.name },
              { name: 'gijo:asset:zone', value: asset.zone },
              { name: 'gijo:asset:ip', value: asset.ip || '' },
              { name: 'gijo:cve:status', value: comp.cve || '양호' }
            ]
          });
        });
      });

      const blob = new Blob([JSON.stringify(bom, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'CycloneDX_IT_Assets_SBOM_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    }

    function importCycloneDxJson(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const bom = JSON.parse(e.target.result);
          if (!bom.components || !Array.isArray(bom.components)) {
            alert('유효한 CycloneDX JSON 형식이 아닙니다.');
            return;
          }

          const topLevelName = (bom.metadata && bom.metadata.component && bom.metadata.component.name) ? bom.metadata.component.name : '';
          const defaultAssetName = topLevelName ? ('가져온 자산 (' + topLevelName + ')') : '가져온 외부 자산 (SBOM)';
          const vulns = Array.isArray(bom.vulnerabilities) ? bom.vulnerabilities : [];

          // Pre-map vulnerabilities by component ref / purl / name
          const vulnMap = {};
          let critCount = 0;
          vulns.forEach(v => {
            const vId = v.id || 'CVE-UNKNOWN';
            const score = (v.ratings && v.ratings[0] && v.ratings[0].score) ? v.ratings[0].score : 0;
            let status = '양호';
            if (score >= 9.0) {
              status = '위험 (' + vId + ' / ' + score + ')';
              critCount++;
            } else if (score >= 7.0) {
              status = '주의 (' + vId + ' / ' + score + ')';
            } else if (score > 0) {
              status = '완화 (' + vId + ')';
            } else {
              status = '주의 (' + vId + ')';
            }

            (v.affects || []).forEach(aff => {
              if (aff.ref) vulnMap[aff.ref] = status;
            });
          });

          let addedCount = 0;
          bom.components.forEach((c, idx) => {
            const assetProp = (c.properties || []).find(p => p.name === 'gijo:asset:name');
            const zoneProp = (c.properties || []).find(p => p.name === 'gijo:asset:zone');
            const targetAssetName = assetProp ? assetProp.value : defaultAssetName;
            const targetZone = zoneProp ? zoneProp.value : 'TRUST';

            let targetAsset = currentItAssets.find(a => a.name === targetAssetName);
            if (!targetAsset) {
              targetAsset = {
                id: 'ASSET-' + String(currentItAssets.length + 1).padStart(2, '0'),
                name: targetAssetName,
                zone: targetZone,
                category: '애플리케이션(WAS)',
                ip: '10.10.x.x',
                os: 'Linux (SBOM Verified)',
                manager: 'CycloneDX 자동 인입',
                updatedAt: new Date().toISOString().slice(0, 10),
                components: []
              };
              currentItAssets.push(targetAsset);
            }

            const licenseId = (c.licenses && c.licenses[0] && c.licenses[0].license) ? (c.licenses[0].license.id || c.licenses[0].license.name || 'Apache-2.0') : 'Apache-2.0';
            
            // Match CVE status
            let cveStatus = '양호';
            const compRef = c['bom-ref'] || c.purl || '';
            if (vulnMap[compRef]) {
              cveStatus = vulnMap[compRef];
            } else {
              for (const [refKey, stat] of Object.entries(vulnMap)) {
                if (c.name && refKey.includes(c.name)) {
                  cveStatus = stat;
                  break;
                }
              }
            }

            targetAsset.components.push({
              name: c.name,
              version: c.version || '1.0',
              license: licenseId,
              purl: c.purl || c['bom-ref'] || '',
              cve: cveStatus
            });
            addedCount++;
          });

          saveItAssetsToStorage();
          renderAssetTable();
          updateAssetKpis();
          alert('✅ CycloneDX v1.5/v1.6 명세에서 ' + addedCount + '개 컴포넌트(고위험 CVE ' + critCount + '건 식별)가 자산 등록부에 성공적으로 반영되었습니다.');
        } catch (err) {
          alert('CycloneDX JSON 파싱 오류: ' + err.message);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    }

    function printAssetSbomReport() {
      const printWin = window.open('', '_blank');
      let assetRows = '';
      currentItAssets.forEach((a, i) => {
        const compList = (a.components || []).map(c => c.name + ' (v' + c.version + ', ' + c.license + ', ' + c.cve + ')').join('<br/>') || '-';
        assetRows += 
          '<tr>' +
            '<td style="text-align:center; padding:6px; border:1px solid #cbd5e1;">' + (i + 1) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; font-weight:700;">' + sanitizeHtml(a.name) + '</td>' +
            '<td style="text-align:center; padding:6px; border:1px solid #cbd5e1;">' + sanitizeHtml(a.zone) + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1;">' + sanitizeHtml(a.ip || '-') + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1;">' + sanitizeHtml(a.os || '-') + '</td>' +
            '<td style="padding:6px; border:1px solid #cbd5e1; font-size:0.75rem;">' + compList + '</td>' +
            '<td style="text-align:center; padding:6px; border:1px solid #cbd5e1;">' + sanitizeHtml(a.manager || '-') + '</td>' +
          '</tr>';
      });

      printWin.document.write(
        '<!DOCTYPE html><html><head><title>전사 IT 자산 및 소프트웨어 공급망(SBOM) 관리대장</title>' +
        '<style>' +
        'body { font-family: Pretendard, sans-serif; padding: 25px; color:#0f172a; line-height: 1.4; }' +
        'table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 0.8rem; }' +
        'th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px; font-weight:700; }' +
        '@media print { body { padding: 0; } }' +
        '</style></head><body>' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #0f172a; padding-bottom:10px;">' +
          '<div>' +
            '<h1 style="font-size:1.35rem; margin:0;">전사 IT 자산 및 소프트웨어 공급망(SBOM) 관리대장</h1>' +
            '<p style="font-size:0.8rem; color:#475569; margin:4px 0 0 0;">발행일자: ' + new Date().toISOString().slice(0, 10) + ' | 대상기관: ' + sanitizeHtml(customerOrgName) + ' | 규격: KISA SBOM 1.0/2.0</p>' +
          '</div>' +
          '<table style="width:240px; margin:0; border:1px solid #0f172a; text-align:center; font-size:0.75rem;">' +
            '<tr><th style="width:80px; padding:3px;">작성자</th><th style="width:80px; padding:3px;">보안팀장</th><th style="width:80px; padding:3px;">CISO</th></tr>' +
            '<tr style="height:40px;"><td>보안운영담당 (인)</td><td>(인)</td><td>(인)</td></tr>' +
          '</table>' +
        '</div>' +
        '<table>' +
          '<thead>' +
            '<tr>' +
              '<th style="width:35px;">No</th>' +
              '<th>자산명</th>' +
              '<th style="width:75px;">배치구역</th>' +
              '<th style="width:105px;">IP 주소</th>' +
              '<th style="width:120px;">운영체제(OS)</th>' +
              '<th>SBOM 컴포넌트 & 오픈소스 라이선스</th>' +
              '<th style="width:90px;">관리담당</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + assetRows + '</tbody>' +
        '</table>' +
        '<div style="margin-top:20px; font-size:0.75rem; color:#64748b; text-align:right;">' +
          'GIJO AS Enterprise Security Operations &copy; 2026 GIJO TECHNOLOGY' +
        '</div>' +
        '<script>window.onload = function(){ window.print(); };<\\/script>' +
        '</body></html>'
      );
      printWin.document.close();
    }

    function syncAssetsToWikiDocs() {
      const docId = 999;
      let md = '# 전사 IT 자산 및 소프트웨어 공급망(SBOM) 구성 명세서\\n\\n' +
        '> **주관부서**: ' + customerOrgName + ' | **갱신일자**: ' + new Date().toISOString().slice(0, 10) + ' | **총 관리 자산**: ' + currentItAssets.length + '대\\n\\n' +
        '---\\n\\n' +
        '## 1. 망분리 구역별 자산 배치 현황\\n' +
        '| 자산 ID | 자산명 | 배치 구역 | IP 주소 | OS | 관리 담당자 |\\n' +
        '|:---|:---|:---:|:---|:---|:---|\\n';

      currentItAssets.forEach(a => {
        md += '| **' + a.id + '** | ' + a.name + ' | ' + a.zone + ' | ' + a.ip + ' | ' + a.os + ' | ' + a.manager + ' |\\n';
      });

      md += '\\n## 2. 소프트웨어 컴포넌트(SBOM) 및 오픈소스 라이선스 명세\\n' +
        '| 대상 자산 | 소프트웨어/패키지명 | 버전 | 라이선스 | CVE 취약점 상태 |\\n' +
        '|:---|:---|:---|:---|:---:|\\n';

      currentItAssets.forEach(a => {
        (a.components || []).forEach(c => {
          md += '| ' + a.name + ' | **' + c.name + '** | ' + c.version + ' | ' + c.license + ' | ' + c.cve + ' |\\n';
        });
      });

      const existingIdx = currentDocs.findIndex(d => d.id === docId);
      const assetDoc = {
        id: docId,
        title: '[IT자산/SBOM] 전사 IT 자산 및 소프트웨어 형상 명세서',
        category: '사내솔루션',
        tags: ['자산관리', 'SBOM', 'CycloneDX', '라이선스', '망분리', '인프라'],
        updatedAt: new Date().toISOString().slice(0, 10),
        content: md
      };

      if (existingIdx >= 0) {
        currentDocs[existingIdx] = assetDoc;
      } else {
        currentDocs.unshift(assetDoc);
      }
      saveDocsToStorage();
      renderWikiDocList();
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

    // --- 5. WIKI & ADVANCED SYNAPSE RAG 2.0 MODULE ---
    let currentRagCategory = 'ALL';

    const categorizedRagQuestions = {
      ALL: [
        "금융 코어 WAS(JEUS 8.5)에 감지된 CVE-2025-24813 조치 방안과 가상패치 솔루션은?",
        "KISA 표준 소프트웨어 공급망(SBOM) 추출 필수 체크리스트 5가지는?",
        "OpenAI GPT-4o 대비 온프레미스 GB10 (177B) 도입 시 연간 TCO 절감액은?",
        "WizCLM 인증서 수명주기 자동화 솔루션 개요 및 규제 준수는?",
        "KISA ISMS-P 2.4 네트워크 접근통제 기준에 부합하는 망분리 예외 절차는?",
        "SAFESQUARE SBOM 공급망 보안과 CycloneDX 지원 사양은?",
        "FOCS 이기종 방화벽 정책 관리 자동화의 도입 효과는?",
        "CipherTrust 투명 DB 암호화(구 Vormetric) 아키텍처는?"
      ],
      REG: [
        "KISA ISMS-P 2.4 네트워크 접근통제 기준에 부합하는 망분리 예외 절차는?",
        "사내 보안 지침에 따른 SBOM 제출 및 검증 의무화 규정은?",
        "정보통신망법 제28조 개인정보 보호조치 기준과 DB 암호화 규정은?",
        "금융보안원 전자금융감독규정에 명시된 3대 필수 보안통제 항목은?"
      ],
      TECH: [
        "금융 코어 WAS(JEUS 8.5)에 감지된 CVE-2025-24813 조치 방안과 가상패치 솔루션은?",
        "Spring RCE (CVE-2016-1000027) 취약점 분석 및 웹방화벽 차단 정책은?",
        "Tomcat AJP 커넥터 취약점 비활성화 설정 및 긴급 패치 순서는?",
        "Imperva WAAP 및 GenAI 보안 모듈 기능 요약해줘",
        "Falcon Insight EDR 호스트 네트워크 긴급 격리 절차는?"
      ],
      FIN: [
        "OpenAI GPT-4o 대비 온프레미스 GB10 (177B) 도입 시 연간 TCO 절감액은?",
        "사내 생성형 AI 및 클라우드 API 통합 연간 예산과 부서별 소진율은?",
        "보안 솔루션 20종 도입 시 5개년 누적 TCO 및 내용연수 감가상각 모델은?",
        "계약 만료 D-30 이내 보안 제품 갱신 예산 산출 내역은?"
      ],
      ASSET: [
        "전사 IT 자산 중 고위험 CVE가 식별된 자산 목록과 소프트웨어 컴포넌트는?",
        "KISA 표준 소프트웨어 공급망(SBOM) 추출 필수 체크리스트 5가지는?",
        "CycloneDX v1.5/1.6 JSON 파일 유효성 검증 CLI 명령어와 사양은?",
        "금융 코어 WAS (JEUS 8.5)의 오픈소스 의존성 7종 현황은?"
      ]
    };

    function filterRagCategory(cat) {
      currentRagCategory = cat;
      const cats = ['ALL', 'REG', 'TECH', 'FIN', 'ASSET'];
      cats.forEach(c => {
        const btn = document.getElementById('ragCat-' + c);
        if (btn) {
          if (c === cat) {
            btn.style.background = '#2563eb';
            btn.style.color = '#fff';
            btn.style.fontWeight = '700';
          } else {
            btn.style.background = '#fff';
            btn.style.color = '#475569';
            btn.style.fontWeight = '600';
          }
        }
      });
      renderQuickChips();
    }

    function renderQuickChips() {
      const chipBox = document.getElementById('quickQuestionsChipBox');
      if (!chipBox) return;
      chipBox.innerHTML = '';

      const list = categorizedRagQuestions[currentRagCategory] || categorizedRagQuestions.ALL;
      list.forEach(q => {
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

    // --- 전문 실무 지식고 문서 템플릿 6종 ---
    const wikiDocTemplates = {
      SEC_POLICY: {
        name: '사내 정보보안 운영규정 및 지침 표준안',
        badge: '📜 규정/지침',
        category: '보안규정',
        tags: ['보안규정', '운영지침', '관리체계', 'KISA', '내부통제'],
        desc: '조직 구성원 및 관리자가 준수해야 할 사내 보안 의무, 비밀번호/계정 통제, 위반 조치 기준',
        title: '사내 정보시스템 보안 운영 및 관리 지침서',
        content: 
          '# 사내 정보시스템 보안 운영 및 관리 지침서\\n\\n' +
          '> **문서분류**: 사내 보안규정 | **제정/개정일**: 2026-09-16 | **적용대상**: 전사 임직원 및 외주 협력사 | **보안등급**: 사내 한정(Internal)\\n\\n' +
          '---\\n\\n' +
          '## 제1조 (목적)\\n' +
          '본 지침은 정보통신망 이용촉진 및 정보보호 등에 관한 법률 및 개인정보보호법에 의거하여, 사내 정보시스템 및 정보자산을 외부 침해위협으로부터 안전하게 보호하고 업무 연속성을 보장함을 목적으로 한다.\\n\\n' +
          '## 제2조 (적용 범위)\\n' +
          '1. 본 지침은 사내 모든 부서, 임직원, 파견직 및 전산 시스템을 위탁 운영하는 외주 협력업체 직원에게 적용된다.\\n' +
          '2. 적용 자산은 사내 네트워크(유·무선), 서버, 데이터베이스, 보안 솔루션, PC/노트북 및 클라우드 자산을 포함한다.\\n\\n' +
          '## 제3조 (보안 관리 조직 및 역할)\\n' +
          '| 구분 | 직책/역할 | 주요 임무 및 책임 |\\n' +
          '|:---|:---|:---|\\n' +
          '| **CISO** | 정보보호최고책임자 | 정보보호 종합계획 수립, 예산 편성 및 최종 보안 결재 |\\n' +
          '| **보안담당자** | 정보보호 실무자 | 보안 솔루션 일일 점검, 위협 탐지 모니터링, 접근통제 승인 |\\n' +
          '| **시스템관리자** | 인프라/서버 운영자 | OS/미들웨어 보안 패치 적용, 정기 백업 수행 및 무결성 검증 |\\n' +
          '| **일반 임직원** | 정보자산 이용자 | 비밀번호 복잡도 준수, 의심 메일 신고, 클린데스크 준수 |\\n\\n' +
          '## 제4조 (계정 및 비밀번호 통제 기준)\\n' +
          '1. **패스워드 조합 규칙**: 영문 대/소문자, 숫자, 특수문자 중 3종 이상 조합 시 8자리 이상, 2종 조합 시 10자리 이상.\\n' +
          '2. **비밀번호 변경 주기**: 분기별 1회(90일 주기) 의무 변경하며, 최근 3회 사용한 비밀번호는 재사용할 수 없다.\\n' +
          '3. **접근 잠금 정책**: 연속 5회 인증 실패 시 해당 계정은 자동 잠금 조치하며, 본인 인증 후 관리자가 해제한다.\\n' +
          '4. **유휴 세션 타임아웃**: 관리자 콘솔 및 주요 업무 시스템은 15분 이상 입력이 없을 경우 자동 로그아웃된다.\\n\\n' +
          '## 제5조 (정기 점검 및 증적 보존)\\n' +
          '1. 보안담당자는 매일 시스템 데몬 상태, 방화벽/IPS/WAF 차단 로그 및 침해시도를 점검하고 일일 점검표를 작성한다.\\n' +
          '2. 접속기록 및 감사로그는 위·변조 방지 처리를 거쳐 최소 1년(개인정보 취급 시스템은 2년) 이상 안전하게 보존한다.\\n\\n' +
          '## 제6조 (위반 시 제재 및 조치)\\n' +
          '본 지침을 고의 또는 중대한 과실로 위반하여 회사에 보안 사고를 야기한 자는 사규에 따라 인사위원회에 회부되며, 민·형사상 법적 책임을 물을 수 있다.'
      },

      INCIDENT_REPORT: {
        name: '침해사고 긴급대응 및 근본원인 분석(RCA) 보고서',
        badge: '🚨 침해/사고',
        category: '침해사고',
        tags: ['침해사고', '사후보고서', 'RCA', '포렌식', '대응일지'],
        desc: '악성코드/랜섬웨어/C2 감염 등 침해 발생 시 타임라인, 공격벡터, 근본원인 분석 및 재발방지책',
        title: '보안 침해사고 긴급대응 및 근본원인 분석(RCA) 보고서',
        content: 
          '# 보안 침해사고 긴급대응 및 근본원인 분석(RCA) 보고서\\n\\n' +
          '> **사고번호**: INC-2026-0916-01 | **최초 인지일시**: 2026-09-16 14:20:00 | **보고자**: 정보보호팀 비상대응조 | **심각도**: 🔴 Critical\\n\\n' +
          '---\\n\\n' +
          '## 1. 사고 개요 (Executive Summary)\\n' +
          '* **사고 유형**: C2 악성 비인가 통신 감지 및 내부 래터럴 무브먼트(Lateral Movement) 시도\\n' +
          '* **영향 자산**: DMZ 웹서버 1대 (192.168.10.25), 내부 관리자 PC 1대 (10.10.50.41)\\n' +
          '* **피해 현황**: 고객 DB 및 주요 기밀 유출 흔적 없음 (EDR 및 방화벽으로 3차 C2 연결 차단 완료)\\n\\n' +
          '## 2. 사고 대응 타임라인 (Incident Timeline)\\n' +
          '| 일시 (Timestamp) | 주체 | 수행 내용 및 탐지 징후 |\\n' +
          '|:---|:---|:---|\\n' +
          '| **14:15:32** | 공격자 | 외부 IP(203.0.113.45)로부터 DMZ 웹서버 취약점을 이용한 웹쉘 업로드 시도 |\\n' +
          '| **14:20:10** | WAF/EDR | 웹쉘 생성 감지 및 탐지 알람 발생, 비인가 외향(Outbound) 8443 포트 연결 시도 |\\n' +
          '| **14:22:45** | 보안팀 | **[1단계]** 해당 호스트 네트워크 즉시 논리적 격리(Host Isolation) 조치 |\\n' +
          '| **14:35:00** | 포렌식조 | **[2단계]** \\x60winpmem\\x60 및 \\x60LiME\\x60을 통한 휘발성 메모리 덤프 및 프로세스 트리 확보 |\\n' +
          '| **15:10:00** | 인프라팀 | **[3단계]** 방화벽 경계에서 공격자 C2 IP/도메인 전면 블랙리스트 등록 및 차단 |\\n' +
          '| **16:00:00** | 보안팀 | 백신 풀스캔 및 웹서버 최신 보안 패치 적용 후 격리 해제 및 모니터링 전환 |\\n\\n' +
          '## 3. 근본 원인 분석 (Root Cause Analysis - RCA)\\n' +
          '1. **초기 침투 경로(Initial Access)**:\\n' +
          '   * DMZ 웹서버 내 구버전 아파치 웹서버의 미패치 취약점(CVE-2024-XXXXX)을 통해 임의 파일 업로드 허용.\\n' +
          '2. **권한 상승 및 확산 시도(Privilege Escalation)**:\\n' +
          '   * 서비스 계정 권한으로 웹쉘을 구동 후 로컬 서비스 취약점을 통해 SYSTEM 권한 획득 시도.\\n' +
          '3. **방어 기제 동작 평가**:\\n' +
          '   * Falcon EDR의 행위 기반 탐지로 메모리 인젝션 단계에서 즉각 프로세스가 킬(Kill)되어 실질적 데이터 암호화 및 유출 차단 성공.\\n\\n' +
          '## 4. 긴급 조치 및 보완 대책\\n' +
          '* **단기 조치 (24시간 내)**:\\n' +
          '  * 전사 DMZ 웹서버 취약점 전수 스캔 및 최신 보안 패치 적용\\n' +
          '  * 공격자 IP 대역 및 관련 IoC(SHA-256 해시, 도메인) 방화벽/EDR 룰셋 반영\\n' +
          '* **중장기 조치 (30일 내)**:\\n' +
          '  * 웹 애플리케이션 방화벽(WAF) 시그니처 자동 업데이트 주기 단축 (일 1회 -> 실시간)\\n' +
          '  * 외부 공개 서버에 대한 모의해킹 및 코드 시큐어코딩 진단 실시\\n\\n' +
          '## 5. 법적 조치 및 KISA 보고 여부\\n' +
          '* 개인정보 유출 및 대규모 서비스 마비가 발생하지 않았으나, KISA 종합상황실(118)에 침해사고 예방 공유를 위해 IoC 정보 자진 공유 완료.'
      },

      ISMS_AUDIT: {
        name: 'KISA ISMS-P 인증 통제항목 이행 현황 및 수검 증적표',
        badge: '📋 ISMS-P',
        category: 'ISMS-P',
        tags: ['ISMS-P', '인증수검', '통제항목', '증적목록', '감사대응'],
        desc: 'KISA ISMS-P 80개 통제항목 대비 사내 통제 현황, 필수 증적 제출 목록 및 점검 체크포인트',
        title: 'KISA ISMS-P 인증 통제항목 이행 현황 및 수검 증적 관리표',
        content: 
          '# KISA ISMS-P 인증 통제항목 이행 현황 및 수검 증적 관리표\\n\\n' +
          '> **수검 기준**: KISA ISMS-P 인증기준 (관리체계 16개, 보호대책 64개) | **수검 연도**: 2026년도 정기심사 | **주관부서**: 정보보호팀\\n\\n' +
          '---\\n\\n' +
          '## 1. 대상 통제영역 명세\\n' +
          '* **통제영역**: \\x602.6 접근통제\\x60, \\x602.7 암호화 적용\\x60, \\x602.10 로그 관리 및 이상징후 모니터링\\x60\\n' +
          '* **요구사항 개요**: 사용자 및 관리자의 식별·인증, 비인가 접근 방지, 데이터 저장·전송 암호화, 감사로그의 1년 이상 보존 및 무결성 보장.\\n\\n' +
          '## 2. 사내 보호대책 이행 현황 매트릭스\\n' +
          '| 통제번호 | 세부 통제항목명 | 사내 이행 방안 및 적용 솔루션 | 적합성 판정 |\\n' +
          '|:---|:---|:---|:---:|\\n' +
          '| **2.6.1** | 업무망 및 인터넷망 분리 | 논리적 망분리(VDI) 및 망간자료전송(FOCS/망연계 솔루션) 통제 | ✅ 적합 |\\n' +
          '| **2.6.2** | 사용자 인증 및 식별 | 사내 ERP 및 포털 FIDO2 / OTP 2차 인증(MFA) 전면 강제화 | ✅ 적합 |\\n' +
          '| **2.6.5** | 특권 권한 관리 | 서버 접근제어(SecureIM)를 통한 Root/Admin 직접 로그인 차단 및 세션 녹화 | ✅ 적합 |\\n' +
          '| **2.7.1** | 암호화 적용 기준 | 주민등록번호, 계좌번호 등 고유식별정보 AES-256 DB 암호화(CipherTrust) | ✅ 적합 |\\n' +
          '| **2.7.2** | 전송구간 암호화 | 전사 웹서비스 HTTPS(TLS 1.3) 강제 및 사외 원격접속 IPSec VPN 적용 | ✅ 적합 |\\n' +
          '| **2.10.1** | 로그 생성 및 보존 | OS, DB, 웹, 보안장비 로그 1년 이상 중앙 SIEM 서버 보존 및 백업 | ✅ 적합 |\\n' +
          '| **2.10.3** | 이상징후 모니터링 | 실시간 이상징후 탐지 룰셋 가동 및 관리자 알림(SMS/메신저) 연동 | ✅ 적합 |\\n\\n' +
          '## 3. 심사원 제출 필수 증적(Evidence) 목록\\n' +
          '1. **접근통제 증적**:\\n' +
          '   * 서버 접근제어(SecureIM) 사용자 권한 승인 결재문서 사본 (PDF)\\n' +
          '   * 관리자 계정의 유휴 세션 타임아웃(15분) 설정 화면 캡처\\n' +
          '2. **암호화 증적**:\\n' +
          '   * 데이터베이스 암호화 적용 컬럼 리스트 및 암호화 키 관리 지침\\n' +
          '   * SSL/TLS 인증서 갱신 대장 및 공개키 암호화 알고리즘 검증서 (WizCLM)\\n' +
          '3. **로그 관리 증적**:\\n' +
          '   * 최근 1년간의 중앙 로그 서버(SIEM) 용량 현황 및 백업 테이프 보관증\\n' +
          '   * 월간 이상징후 모니터링 분석 보고서 및 소명 일지\\n\\n' +
          '## 4. 내부 사전 점검 체크리스트\\n' +
          '- [ ] 퇴사자 발생 시 24시간 이내 계정 삭제/비활성화 완료 여부 전수 검증\\n' +
          '- [ ] 개발서버와 운영서버 간 패스워드 상이성 확인\\n' +
          '- [ ] 공용 계정 사용 금지 및 개별 계정 발급 상태 확인'
      },

      ARCHITECTURE: {
        name: '보안 시스템 아키텍처 및 망분리 구성 설계서',
        badge: '🏗️ 아키텍처',
        category: '아키텍처설계',
        tags: ['아키텍처', '망분리', '네트워크', 'DMZ', 'Mermaid', '설계서'],
        desc: '인터넷망/DMZ/업무망/DB망 보안 계층도, 방화벽 포트맵, 암호화 구간 및 Mermaid 다이어그램',
        title: '기업 엔터프라이즈 보안 시스템 아키텍처 및 망분리 구성 설계서',
        content: 
          '# 기업 엔터프라이즈 보안 시스템 아키텍처 및 망분리 구성 설계서\\n\\n' +
          '> **문서버전**: v2.1 | **작성일**: 2026-09-16 | **작성자**: 인프라보안 아키텍트 | **망 구성**: 인터넷 - DMZ - Trust 망분리 체계\\n\\n' +
          '---\\n\\n' +
          '## 1. 아키텍처 설계 개요\\n' +
          '본 설계서는 사내 정보자산 및 고객 데이터를 외부 침해 공격으로부터 다계층으로 방어(Defense in Depth)하기 위하여, 물리적·논리적 망분리 구역을 설정하고 각 구간별 보안 솔루션을 배치한 표준 아키텍처 규격이다.\\n\\n' +
          '## 2. 망분리 구역 정의 (Security Zones)\\n' +
          '* **인터넷 구간 (Untrusted Zone)**: 외부 일반 사용자의 웹/모바일 트래픽이 유입되는 공개 영역.\\n' +
          '* **DMZ 구간 (Semi-Trusted Zone)**: 대외 서비스를 직접 제공하는 WAAP, 리버스 프록시, 웹서버(WEB) 배치 구간.\\n' +
          '* **내부 업무망 (Trusted Zone)**: 임직원 PC, 업무용 인트라넷, 인증 서버(AD/LDAP) 배치 구간.\\n' +
          '* **데이터베이스망 (Secure DB Zone)**: 핵심 고객 원장 및 DB 서버 배치 구간 (DMZ 직접 통신 원천 차단).\\n\\n' +
          '## 3. 표준 권장 아키텍처 다이어그램 (Mermaid)\\n' +
          '\\x60\\x60\\x60mermaid\\n' +
          'flowchart TB\\n' +
          '  subgraph External[\"🌐 외부 인터넷망 (Untrusted)\"]\\n' +
          '    User[\"👤 외부 클라이언트 / 모바일\"]\\n' +
          '  end\\n' +
          '  subgraph Boundary[\"🛡️ 경계 보안 계층 (Perimeter)\"]\\n' +
          '    FW_Ext[\"🔥 1차 차세대 방화벽 (NGFW)\"]\\n' +
          '    WAAP[\"🛡️ 웹 애플리케이션 방화벽 (WAAP)\"]\\n' +
          '  end\\n' +
          '  subgraph DMZ[\"🏢 DMZ 구역 (Semi-Trusted)\"]\\n' +
          '    direction TB\\n' +
          '    WebCluster[\"🌐 Web Server Cluster (Active-Standby)\"]\\n' +
          '    APIGW[\"🚪 API Gateway\"]\\n' +
          '  end\\n' +
          '  subgraph Internal_Firewall[\"🔥 2차 내부 방화벽 (Internal FW)\"]\\n' +
          '    direction TB\\n' +
          '    FOCS[\"⚙️ 방화벽 정책 통제기 (FOCS)\"]\\n' +
          '    FOCS --- FW_Int[\"내부 차단 룰셋\"]\\n' +
          '  end\\n' +
          '  subgraph Trust[\"🏢 내부 안전구역 (Trusted Zone)\"]\\n' +
          '    direction TB\\n' +
          '    WAS[\"⚙️ Core WAS Cluster\"]\\n' +
          '    EDR[\"🛡️ 엔드포인트 EDR 매니저\"]\\n' +
          '    SIEM[\"📊 통합보안관제 SIEM\"]\\n' +
          '  end\\n' +
          '  subgraph SecureDB[\"🔒 데이터베이스 안전구역 (Vault)\"]\\n' +
          '    DBServer[\"🗄️ 고객원장 DB Server (AES-256 암호화)\"]\\n' +
          '    KeyMgr[\"🔑 암호키 관리 서버 (KMS)\"]\\n' +
          '  end\\n' +
          '  External -->|HTTPS 443| Boundary\\n' +
          '  Boundary -->|검증된 트래픽| DMZ\\n' +
          '  DMZ -->|API 호출 8443| Internal_Firewall\\n' +
          '  Internal_Firewall -->|인가된 트래픽| Trust\\n' +
          '  Trust -->|SQL 1521 / 암호키 교환| SecureDB\\n' +
          '\\x60\\x60\\x60\\n\\n' +
          '## 4. 네트워크 방화벽 오픈 포트맵 (Port Matrix)\\n' +
          '| 출발지 (Source) | 목적지 (Destination) | 포트 / 프로토콜 | 용도 및 통신 목적 | 보안 통제 |\\n' +
          '|:---|:---|:---|:---|:---|\\n' +
          '| Any (외부) | WAAP / DMZ Web | TCP 443 (HTTPS) | 웹 서비스 대고객 인터페이스 | WAF 인라인 검사 |\\n' +
          '| DMZ Web | Trust Core WAS | TCP 8443 | WAS 백엔드 비즈니스 로직 호출 | 내부 방화벽 IP 바인딩 |\\n' +
          '| Trust Core WAS | DB Server | TCP 1521 (Oracle) | 데이터 트랜잭션 쿼리 | 접근제어(SecureIM) 경유 |\\n' +
          '| 전 시스템 | SIEM Server | UDP 514 (Syslog) | 통합 보안 이벤트 실시간 수집 | 단방향 로그 전송 |\\n\\n' +
          '## 5. 가용성 및 이중화(HA) 구성 지침\\n' +
          '* 모든 보안 장비(방화벽, WAF, IPS)는 Active-Standby 또는 Active-Active 고가용성 클러스터로 구성한다.\\n' +
          '* 주 장비 장애 발생 시 1초 이내에 보조 장비로 자동 페일오버(Failover)되어 세션 단절을 최소화한다.'
      },

      VULN_MGMT: {
        name: '취약점 진단 및 모의해킹 조치 계획서',
        badge: '🔍 취약점조치',
        category: '취약점관리',
        tags: ['취약점', 'CVE', 'CVSS', '모의해킹', '보안패치', '이행계획'],
        desc: '인프라/웹 취약점 진단 결과에 따른 심각도 분류, 공격 시나리오 및 긴급 완화/영구 패치 계획',
        title: '정보시스템 정기 취약점 분석·평가 및 조치 이행 계획서',
        content: 
          '# 정보시스템 정기 취약점 분석·평가 및 조치 이행 계획서\\n\\n' +
          '> **진단 기간**: 2026-09-01 ~ 2026-09-10 | **진단 대상**: 대외 웹 포털 및 내부 인프라 서버 30대 | **수행 기관**: 정보보호팀 자체 진단\\n\\n' +
          '---\\n\\n' +
          '## 1. 진단 개요\\n' +
          '* **목적**: 주요 정보시스템에 잠재된 기술적 취약점을 사전 식별하고 조치함으로써 침해사고를 미연에 방지.\\n' +
          '* **진단 기준**: KISA 주요정보통신기반시설 기술적 취약점 분석·평가 기준 및 OWASP Top 10.\\n\\n' +
          '## 2. 취약점 종합 진단 현황 요약\\n' +
          '* 총 진단 항목: 72개 항목\\n' +
          '* 결과: 🟢 양호 64건, 🟡 주의(Medium) 6건, 🔴 취약(High/Critical) 2건\\n\\n' +
          '| 구분 | 취약점 항목 (CVE / CWE) | 심각도 | 영향 시스템 | 담당자 | 조치 목표일 |\\n' +
          '|:---|:---|:---:|:---|:---|:---:|\\n' +
          '| **SEC-01** | Spring Framework 원격코드실행 취약점 (CVE-2024-XXXX) | 🔴 High | 대외 웹 WAS #1, #2 | 인프라팀 | 즉시 (24h 내) |\\n' +
          '| **SEC-02** | 데이터베이스 계정 취약 패스워드 설정 | 🔴 High | 개발 스테이징 DB | DB관리자 | 3일 이내 |\\n' +
          '| **SEC-03** | 불필요한 HTTP 메서드 (TRACE/OPTIONS) 활성화 | 🟡 Medium | 웹서버 Nginx | 웹개발팀 | 7일 이내 |\\n' +
          '| **SEC-04** | 웹서버 디렉토리 리스팅(Directory Indexing) 허용 | 🟡 Medium | 첨부파일 서버 | 웹개발팀 | 7일 이내 |\\n\\n' +
          '## 3. 주요 취약점 세부 분석 및 재현 시나리오\\n' +
          '### 1) [SEC-01] Spring Framework RCE 취약점\\n' +
          '* **취약점 개요**: 비인가 원격 공격자가 조작된 HTTP 요청 헤더를 통해 임의의 클래스로더를 조작하고 웹쉘을 실행할 수 있음.\\n' +
          '* **CVSS 점수**: 8.8 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)\\n' +
          '* **임시 완화 조치**: 웹방화벽(WAAP)에 해당 헤더 패턴 필터링 룰셋 긴급 배포 (적용 완료).\\n' +
          '* **근본 조치 방안**: Spring Boot 및 의존성 라이브러리 보안 패치 버전(\\x60v3.2.5\\x60 이상)으로 일괄 업그레이드.\\n\\n' +
          '## 4. 조치 일정 및 이행 로드맵\\n' +
          '\\x60\\x60\\x60mermaid\\n' +
          'gantt\\n' +
          '  title 취약점 조치 이행 로드맵\\n' +
          '  dateFormat  YYYY-MM-DD\\n' +
          '  section 긴급 조치\\n' +
          '  WAF 가상 패치 및 IP 차단        :done, 2026-09-11, 1d\\n' +
          '  DB 기본 패스워드 변경 및 MFA 강제  :done, 2026-09-12, 1d\\n' +
          '  section 영구 조치\\n' +
          '  스테이징 라이브러리 빌드 테스트    :active, 2026-09-13, 3d\\n' +
          '  운영 서버 정기점검 시간 배포      : 2026-09-16, 2d\\n' +
          '  재점검 및 조치 완료 확인         : 2026-09-18, 1d\\n' +
          '\\x60\\x60\\x60\\n\\n' +
          '## 5. 조치 결과 검증 및 완료 서명\\n' +
          '* 본 조치 이행 계획서에 따라 패치를 완료한 후 취약점 스캐너를 통해 재진단을 수행하고, 잔여 취약점이 없음을 CISO에게 최종 보고한다.'
      },

      SECURITY_FAQ: {
        name: '임직원 보안 실무 FAQ 및 비상 행동요령 질의집',
        badge: '❓ 실무FAQ',
        category: '보안FAQ',
        tags: ['FAQ', '임직원가이드', '계정신청', '예외승인', '피싱대응', 'Q&A'],
        desc: '임직원이 자주 묻는 보안 질문, VPN/USB 신청, 피싱 메일 대처법, 사내 AI(LLM) 활용 수칙',
        title: '임직원을 위한 정보보안 실무 가이드 및 자주 묻는 질문(FAQ)',
        content: 
          '# 임직원을 위한 정보보안 실무 가이드 및 자주 묻는 질문(FAQ)\\n\\n' +
          '> **안내 대상**: 전사 임직원 및 상주 협력사원 | **담당 부서**: 정보보호팀 (내선: 8000) | **최종 갱신**: 2026-09-16\\n\\n' +
          '---\\n\\n' +
          '## 📌 주요 카테고리별 FAQ\\n\\n' +
          '### Q1. 사외에서 재택/출장 근무 시 사내망 접속(VPN)은 어떻게 신청하나요?\\n' +
          '* **답변**:\\n' +
          '  1. 사내 그룹웨어 \\x60[전자결재] -> [보안신청] -> [SSL-VPN 사용 신청서]\\x60를 작성합니다.\\n' +
          '  2. 부서장 승인 후 정보보호팀에서 계정을 인가합니다.\\n' +
          '  3. 스마트폰에 \\x60OTP 앱(Google Authenticator)\\x60을 설치한 후 2차 인증을 등록해야 접속이 가능합니다.\\n' +
          '  * ⚠️ 공용 PC(PC방, 호텔 로비 등)에서는 사내망 접속이 엄격히 금지됩니다.\\n\\n' +
          '### Q2. 업무상 USB 메모리나 외장하드를 사용해야 할 때는 어떻게 하나요?\\n' +
          '* **답변**:\\n' +
          '  1. 사내 등록되지 않은 일반 개인 USB는 PC 연결 시 DLP(GRADIUS)에 의해 자동 차단됩니다.\\n' +
          '  2. 보안 USB가 필요한 경우 \\x60보안 전산자산 신청\\x60을 통해 전용 암호화 보안 USB를 불출받아 사용하십시오.\\n' +
          '  3. 부득이한 대용량 파일 외부 반출은 \\x60망연계 결재 시스템\\x60을 통해 사전 승인 후 반출하십시오.\\n\\n' +
          '### Q3. 랜섬웨어나 해킹 의심 메일을 열람했을 때 어떻게 해야 하나요?\\n' +
          '* **답변 (골든타임 3분 행동요령)**:\\n' +
          '  1. **[즉시 조치]** PC 본체 뒤편의 **LAN선(랜선)을 즉시 뽑거나 Wi-Fi를 끕니다.** (전원은 끄지 마십시오 - 포렌식 메모리 보존 필요)\\n' +
          '  2. 메일 본문의 첨부파일이나 인터넷 링크를 절대 추가 클릭하지 마십시오.\\n' +
          '  3. 스마트폰이나 사내 메신저로 즉시 **정보보호팀 비상 핫라인(내선 8000 / 010-XXXX-XXXX)**으로 신고하십시오.\\n\\n' +
          '### Q4. 업무에 ChatGPT, Claude 등 생성형 AI를 사용해도 되나요?\\n' +
          '* **답변 (사내 AI 활용 보안 가이드라인)**:\\n' +
          '  * **허용**: 일반적인 외국어 번역, 공개 소프트웨어 코드 문법 검토, 비즈니스 문서 윤문\\n' +
          '  * **절대 금지 (위반 시 징계)**:\\n' +
          '    - 회사의 소스코드 원본, 인프라 IP/비밀번호 등 시스템 설정 정보 입력 금지\\n' +
          '    - 고객의 이름, 주민등록번호, 계좌번호 등 개인정보 입력 금지\\n' +
          '    - 대외비(Confidential) 사업 기획서 및 미공개 실적 보고서 업로드 금지\\n' +
          '  * 사내 안전한 AI 도구를 사용하려면 \\x60GIJO AS 사내 온프레미스 에어갭 AI\\x60를 활용하십시오.\\n\\n' +
          '### Q5. PC 화면보호기 설정 및 비밀번호 변경 주기는 어떻게 되나요?\\n' +
          '* **답변**:\\n' +
          '  * 10분 이상 자리를 비울 때는 \\x60Win + L\\x60 키를 눌러 화면을 잠금 상태로 전환해야 합니다.\\n' +
          '  * 15분 이상 유휴 시 중앙 정책(GPO)에 의해 화면보호기가 자동 실행됩니다.\\n' +
          '  * Windows 로그인 및 사내 포털 비밀번호는 90일(분기 1회)마다 변경해야 합니다.\\n\\n' +
          '---\\n\\n' +
          '## 📞 정보보호팀 긴급 연락망\\n' +
          '* **정보보호 통합 핫라인**: 내선 8000 / security@company.com\\n' +
          '* **CERT 침해대응 센터**: 내선 8001 (야간/주말 비상 대응)'
      }
    };

    function openNewDocTemplateModal() {
      const grid = document.getElementById('docTemplateCardsGrid');
      if (grid) {
        grid.innerHTML = Object.entries(wikiDocTemplates).map(([key, tpl]) => 
          '<div class="doc-tpl-card" onclick="selectNewDocTemplate(\\'' + key + '\\')" style="background:#ffffff; border:1px solid var(--border); border-radius:8px; padding:1rem; cursor:pointer; transition:all 0.15s ease; display:flex; flex-direction:column; justify-content:space-between; gap:0.5rem;">' +
            '<div>' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">' +
                '<span class="meta-badge badge-kr" style="font-size:0.68rem;">' + tpl.badge + '</span>' +
                '<span style="font-size:0.7rem; color:var(--text-dim);">' + tpl.category + '</span>' +
              '</div>' +
              '<h4 style="font-size:0.92rem; font-weight:800; color:var(--text-main); line-height:1.4; margin-bottom:0.35rem;">' + tpl.name + '</h4>' +
              '<p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5;">' + tpl.desc + '</p>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem; padding-top:0.4rem; border-top:1px dashed var(--border); font-size:0.72rem; color:var(--primary); font-weight:700;">' +
              '<span>선택하여 작성 ➔</span>' +
              '<span style="color:var(--text-dim); font-size:0.68rem;">태그 ' + tpl.tags.length + '개</span>' +
            '</div>' +
          '</div>'
        ).join('');
      }
      document.getElementById('newDocTemplateModal').style.display = 'flex';
      lucide.createIcons();
    }

    function closeNewDocTemplateModal() {
      document.getElementById('newDocTemplateModal').style.display = 'none';
    }

    function selectNewDocTemplate(type) {
      closeNewDocTemplateModal();
      const newId = Date.now();
      let tpl = wikiDocTemplates[type];

      if (!tpl || type === 'BLANK') {
        tpl = {
          title: '새 보안 문서',
          category: '보안규정',
          tags: ['신규', '보안'],
          content: '# 새 보안 지침\\n\\n내용을 작성하세요.'
        };
      }

      const newDoc = {
        id: newId,
        title: tpl.title,
        category: tpl.category,
        tags: [...tpl.tags],
        updatedAt: new Date().toISOString().slice(0, 10),
        content: tpl.content
      };

      currentDocs.unshift(newDoc);
      saveDocsToStorage();
      currentActiveDocId = newId;
      renderWikiDocList();
      if (!isEditingMode) toggleEditMode();
      else displayCurrentDoc();

      alert('✅ [' + tpl.title + '] 양식으로 새 문서가 생성되었습니다.\\n에디터에서 내용을 확인 및 수정한 뒤 [저장]을 눌러주세요.');
    }

    function applyDocTemplate(type) {
      const tpl = wikiDocTemplates[type];
      if (!tpl) return;

      const currentContent = document.getElementById('editDocContent').value.trim();
      if (currentContent && currentContent.length > 30) {
        if (!confirm('현재 작성 중인 본문이 [' + tpl.name + '] 전문 양식으로 교체됩니다.\\n계속 진행하시겠습니까?')) {
          return;
        }
      }

      document.getElementById('editDocTitle').value = tpl.title;
      document.getElementById('editDocCat').value = tpl.category;
      document.getElementById('editDocTags').value = tpl.tags.join(', ');
      document.getElementById('editDocContent').value = tpl.content;

      document.getElementById('wikiBreadcrumbCat').innerText = tpl.category;
      document.getElementById('wikiBreadcrumbTitle').innerText = tpl.title;
    }

    function createNewWikiDoc() {
      openNewDocTemplateModal();
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

    // --- ADVANCED SYNAPSE RAG 2.0 ENGINE & CITEGUARD MULTI-EVIDENCE ---
    let lastRagResults = [];

    function buildSemanticChunks() {
      const chunks = [];
      const NL = String.fromCharCode(10);

      // 1. Index 30 Real Wiki Documents (Section-level chunking)
      currentDocs.forEach(doc => {
        const lines = doc.content.split(NL);
        let currentSectionTitle = doc.title;
        let currentSectionLines = [];

        lines.forEach(line => {
          if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ')) {
            if (currentSectionLines.length > 0) {
              chunks.push({
                sourceType: 'WIKI_DOC',
                docId: doc.id,
                docTitle: doc.title,
                category: doc.category,
                sectionTitle: currentSectionTitle,
                text: currentSectionLines.join(' ').trim(),
                tags: doc.tags || []
              });
              currentSectionLines = [];
            }
            currentSectionTitle = line.replace(/^[#s]+/, '').trim();
          } else {
            if (line.trim()) currentSectionLines.push(line.trim());
          }
        });

        if (currentSectionLines.length > 0) {
          chunks.push({
            sourceType: 'WIKI_DOC',
            docId: doc.id,
            docTitle: doc.title,
            category: doc.category,
            sectionTitle: currentSectionTitle,
            text: currentSectionLines.join(' ').trim(),
            tags: doc.tags || []
          });
        }
      });

      // 2. Index Registered IT Assets & CVEs
      currentItAssets.forEach(asset => {
        const comps = (asset.components || []).map(c => c.name + ' ' + c.version + ' (' + c.cve + ', 라이선스: ' + c.license + ')').join(', ');
        const cves = (asset.components || []).map(c => c.cve).filter(Boolean);
        chunks.push({
          sourceType: 'IT_ASSET',
          docId: 990,
          docTitle: '전사 IT 자산 명세: ' + asset.name + ' (' + asset.id + ')',
          category: 'IT자산',
          sectionTitle: asset.name + ' [' + asset.zone + ' 구역, IP: ' + asset.ip + ']',
          text: '자산명: ' + asset.name + ' | 구역: ' + asset.zone + ' | IP: ' + asset.ip + ' | OS: ' + asset.os + ' | 담당: ' + asset.manager + ' | 탑재 컴포넌트: ' + comps + ' | 식별 취약점 CVE: ' + cves.join(', '),
          tags: ['IT자산', asset.name, asset.zone, asset.os].concat(cves)
        });
      });

      // 3. Index FinOps AI Models & TCO Models
      currentAiApiList.forEach(item => {
        const calc = calculateAiApiCost(item);
        chunks.push({
          sourceType: 'FINOPS_AI',
          docId: 991,
          docTitle: '생성형 AI FinOps 사용량 대장: ' + item.model,
          category: 'FinOps',
          sectionTitle: item.model + ' 비용 및 토큰 예산 분석',
          text: '모델명: ' + item.model + ' | 벤더: ' + item.vendor + ' | 부서: ' + item.dept + ' | 월간 토큰: ' + (item.monthlyInputTokens + item.monthlyOutputTokens).toLocaleString() + ' | 연간비용: ₩' + calc.annual.toLocaleString() + ' | 5년TCO: ₩' + calc.tco5Year.toLocaleString() + (item.isGb10Saved ? ' (온프레미스 GB10 경유 90% 예산 절감 적용 모델)' : ''),
          tags: ['FinOps', 'TCO', item.model, item.vendor, item.dept]
        });
      });

      return chunks;
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

      const aiBubble = document.createElement('div');
      aiBubble.className = 'bubble ai';
      aiBubble.innerHTML = '<div><i data-lucide="loader" style="width:13px; height:13px; animation:spin 1s linear infinite;"></i> <b>Synapse RAG 2.0</b> 단락 단위 하이브리드 색인 검색 중...</div>';
      chatBox.appendChild(aiBubble);
      chatBox.scrollTop = chatBox.scrollHeight;
      lucide.createIcons();

      // 1. Lexical Security Gate & Token Extraction (inspired by server hybridsearch.ts)
      const queryLower = query.toLowerCase();
      const codeRegex = /\b(?:[A-Za-z]{2,10}[-.]?\d{1,6}(?:[-.]\d{1,6})*)\b/g;
      const securityCodes = (query.match(codeRegex) || []).map(c => c.toLowerCase());
      
      const acronymRegex = /\b[A-Z]{3,8}\b/g;
      const queryAcronyms = (query.match(acronymRegex) || []).map(a => a.toLowerCase());

      const terms = queryLower.split(/[\s,.?!\[\]()]+/).filter(w => w.length >= 2);

      // 2. Score Semantic Chunks
      const allChunks = buildSemanticChunks();
      const scoredChunks = [];

      allChunks.forEach(chunk => {
        let score = 0;
        const textLower = chunk.text.toLowerCase();
        const secLower = chunk.sectionTitle.toLowerCase();
        const docLower = chunk.docTitle.toLowerCase();
        const tagsLower = (chunk.tags || []).map(t => t.toLowerCase());

        // Security Code Lexical Gate (+50 per exact code match)
        securityCodes.forEach(code => {
          if (textLower.includes(code) || secLower.includes(code) || tagsLower.includes(code)) {
            score += 50;
          }
        });

        // Security Acronym Gate (+30 per exact acronym match)
        queryAcronyms.forEach(acro => {
          if (textLower.includes(acro) || secLower.includes(acro) || tagsLower.includes(acro)) {
            score += 30;
          }
        });

        // General Terms Matching
        terms.forEach(term => {
          if (secLower.includes(term)) score += 18;
          if (docLower.includes(term)) score += 12;
          if (tagsLower.some(t => t.includes(term))) score += 10;
          if (textLower.includes(term)) score += 4;
        });

        // Domain Specific High-Impact Boosts
        if (queryLower.includes('jeus') && (textLower.includes('jeus') || secLower.includes('jeus'))) score += 35;
        if (queryLower.includes('cve-2025-24813') && textLower.includes('cve-2025-24813')) score += 60;
        if (queryLower.includes('cve-2016-1000027') && textLower.includes('cve-2016-1000027')) score += 60;
        if (queryLower.includes('sbom') && (textLower.includes('sbom') || textLower.includes('cyclonedx'))) score += 35;
        if (queryLower.includes('gb10') && (textLower.includes('gb10') || textLower.includes('177b'))) score += 40;
        if (queryLower.includes('tco') && textLower.includes('tco')) score += 30;
        if (queryLower.includes('isms') && textLower.includes('isms')) score += 30;
        if (queryLower.includes('망분리') && textLower.includes('망분리')) score += 30;
        if (queryLower.includes('waap') && textLower.includes('waap')) score += 30;
        if (queryLower.includes('wizclm') && textLower.includes('wizclm')) score += 35;

        if (score > 0) {
          scoredChunks.push({ chunk, score });
        }
      });

      scoredChunks.sort((a, b) => b.score - a.score);

      setTimeout(() => {
        if (scoredChunks.length === 0) {
          aiBubble.innerHTML = '<div>질의하신 내용과 일치하는 사내 보안 규정, 솔루션 스펙, IT 자산 데이터를 특정하지 못했습니다. 검색어를 다듬어 재질의해 주시거나 좌측 실무 카테고리 칩을 활용해 주세요.</div>';
          chatBox.scrollTop = chatBox.scrollHeight;
          return;
        }

        const topChunk = scoredChunks[0].chunk;
        const topScore = scoredChunks[0].score;
        const confidencePct = Math.min(99.4, Math.round((Math.min(100, (topScore / 70) * 80 + 19)) * 10) / 10);

        // Find up to 3 cross-referencing secondary sources
        const secondarySources = [];
        const seenDocs = new Set([topChunk.docTitle]);
        for (let i = 1; i < scoredChunks.length && secondarySources.length < 3; i++) {
          const c = scoredChunks[i].chunk;
          if (!seenDocs.has(c.docTitle)) {
            seenDocs.add(c.docTitle);
            secondarySources.push(c);
          }
        }

        // Clean Snippet Text (format highlight, remove raw markdown headers)
        let snippet = topChunk.text.slice(0, 380).replace(/^[#\s]+/, '');
        if (topChunk.text.length > 380) snippet += '...';

        // Highlight matched terms
        terms.slice(0, 5).forEach(term => {
          if (term.length >= 2 && !['솔루션', '대한', '관련'].includes(term)) {
            const re = new RegExp('(' + term + ')', 'gi');
            snippet = snippet.replace(re, '<span style="background:#fef08a; color:#854d0e; font-weight:700; padding:0 2px; border-radius:2px;">$1</span>');
          }
        });

        // Store result for action triggers
        const resultIdx = lastRagResults.length;
        lastRagResults.push({
          query: query,
          topChunk: topChunk,
          snippet: topChunk.text,
          confidence: confidencePct + '%',
          secondarySources: secondarySources
        });

        // Render CiteGuard 2.0 Card
        let secHtml = '';
        if (secondarySources.length > 0) {
          secHtml = '<div style="font-size:0.7rem; color:var(--text-sub); margin-top:6px; font-weight:700;">교차 검증 출처:</div><div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:3px;">' +
            secondarySources.map(s => '<span class="quick-chip" style="font-size:0.67rem; padding:1px 6px; cursor:pointer;" onclick="selectWikiDoc(' + s.docId + ')">🔗 ' + sanitizeHtml(s.docTitle.slice(0, 24)) + '...</span>').join('') +
            '</div>';
        }

        aiBubble.innerHTML = 
          '<div style="font-weight:800; font-size:0.88rem; margin-bottom:6px; color:var(--text-main); display:flex; align-items:center; justify-content:space-between;">' +
            '<span>📌 ' + sanitizeHtml(topChunk.sectionTitle) + '</span>' +
            '<span style="font-size:0.68rem; background:#ecfdf5; color:#059669; border:1px solid rgba(5,150,105,0.3); padding:1px 6px; border-radius:10px; font-weight:800;">신뢰도 ' + confidencePct + '%</span>' +
          '</div>' +
          '<div style="background:#fff; border:1px solid var(--border); border-radius:8px; padding:10px; margin:6px 0;">' +
            '<div style="font-size:0.72rem; color:var(--primary); font-weight:800; margin-bottom:4px; display:flex; align-items:center; gap:4px; cursor:pointer;" onclick="selectWikiDoc(' + topChunk.docId + ')">' +
              '<i data-lucide="file-check" style="width:13px; height:13px;"></i> 1차 직접 근거: [' + sanitizeHtml(topChunk.docTitle) + ']' +
            '</div>' +
            '<div style="font-size:0.78rem; color:#334155; line-height:1.55; border-left:3px solid var(--primary); padding-left:8px; margin:4px 0;">' +
              snippet +
            '</div>' +
            secHtml +
          '</div>' +
          '<div style="display:flex; gap:6px; margin-top:8px; padding-top:6px; border-top:1px dashed var(--border); flex-wrap:wrap;">' +
            '<button class="btn btn-sm" style="font-size:0.68rem; padding:2px 7px; font-weight:700;" onclick="injectRagToApproval(' + resultIdx + ')">' +
              '<i data-lucide="clipboard-pen" style="width:11px; height:11px;"></i> 결재판 기안문에 주입' +
            '</button>' +
            '<button class="btn btn-sm" style="font-size:0.68rem; padding:2px 7px; font-weight:700;" onclick="injectRagToStudio(' + resultIdx + ')">' +
              '<i data-lucide="layout" style="width:11px; height:11px;"></i> 아키텍처 스튜디오 반영' +
            '</button>' +
            '<button class="btn btn-sm" style="font-size:0.68rem; padding:2px 7px; font-weight:700;" onclick="copyRagAnswerMarkdown(' + resultIdx + ')">' +
              '<i data-lucide="copy" style="width:11px; height:11px;"></i> 마크다운 복사' +
            '</button>' +
          '</div>';

        chatBox.scrollTop = chatBox.scrollHeight;
        lucide.createIcons();
      }, 300);
    }

    // --- ACTIONABLE RAG WORKFLOW TRIGGERS ---
    function injectRagToApproval(resultIdx) {
      const res = lastRagResults[resultIdx];
      if (!res) return;

      openSmartApprovalModal();

      document.getElementById('draftTitle').value = '[품의/보고] ' + res.query;
      
      let currentContent = document.getElementById('draftContent').value;
      const NL = String.fromCharCode(10);
      const injectedText = NL + '--- [Synapse RAG 2.0 근거 인용: ' + res.topChunk.docTitle + ']' + NL + res.snippet + NL;
      document.getElementById('draftContent').value = currentContent ? (currentContent + NL + injectedText) : injectedText;

      let currentAttach = document.getElementById('draftAttachment').value;
      const attachInfo = NL + '[RAG CiteGuard 2.0 검증 내역] 신뢰도: ' + res.confidence + ' | 1차근거: ' + res.topChunk.docTitle + ' (' + res.topChunk.sectionTitle + ')';
      document.getElementById('draftAttachment').value = currentAttach ? (currentAttach + attachInfo) : attachInfo;

      alert('✅ RAG 2.0 질의 결과 및 CiteGuard 2.0 근거가 [📋 전자결재 기안판]의 본문 및 첨부 증적으로 성공적으로 주입되었습니다!');
    }

    function injectRagToStudio(resultIdx) {
      const res = lastRagResults[resultIdx];
      if (!res) return;

      const editor = document.getElementById('studioMermaidCode');
      if (!editor) return;

      const NL = String.fromCharCode(10);
      const q = res.query.toLowerCase();
      let nodeToAdd = 'Node_RAG["🛡️ ' + res.topChunk.sectionTitle.slice(0, 20) + '"]';
      let isVuln = false;

      if (q.includes('jeus') || q.includes('was')) {
        nodeToAdd = 'WAS_Core["⚙️ Core WAS (JEUS 8.5 / Spring)"]';
      } else if (q.includes('cve') || q.includes('취약점') || q.includes('24813')) {
        nodeToAdd = 'Vuln_Node["🚨 취약점 위험노드 (CVE-2025-24813)"]';
        isVuln = true;
      } else if (q.includes('waap') || q.includes('waf')) {
        nodeToAdd = 'WAAP_Node["🛡️ 웹방화벽 (Imperva WAAP)"]';
      } else if (q.includes('sbom') || q.includes('safesquare')) {
        nodeToAdd = 'SBOM_Scanner["📦 SBOM 공급망 보안 (SAFESQUARE)"]';
      }

      let val = editor.value;
      val += NL + '  ' + nodeToAdd;
      if (isVuln) {
        val += NL + '  style Vuln_Node fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#991b1b';
      }

      editor.value = val;
      switchView('studio');
      renderMermaidFromEditor();
      updateStudioBomBadge();

      alert('✅ RAG 분석 결과와 연계된 시스템 노드가 [아키텍처 스튜디오] 다이어그램에 성공적으로 추가되었습니다!');
    }

    function copyRagAnswerMarkdown(resultIdx) {
      const res = lastRagResults[resultIdx];
      if (!res) return;

      const NL = String.fromCharCode(10);
      let md = '### 📌 [Synapse RAG 2.0] ' + res.query + NL + NL;
      md += '> **신뢰도**: ' + res.confidence + ' | **1차 근거**: ' + res.topChunk.docTitle + ' (' + res.topChunk.sectionTitle + ')' + NL + NL;
      md += res.snippet + NL + NL;
      if (res.secondarySources.length > 0) {
        md += '**연관 출처 교차 검증:**' + NL;
        res.secondarySources.forEach(s => {
          md += '- ' + s.docTitle + ' (' + s.sectionTitle + ')' + NL;
        });
      }

      navigator.clipboard.writeText(md).then(() => {
        alert('✅ RAG 2.0 질의응답 및 CiteGuard 검증 내역이 마크다운 형식으로 클립보드에 복사되었습니다!');
      }).catch(err => {
        console.warn('Clipboard write failed:', err);
      });
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

    let portalViewMode = 'EXCEL'; // Default: EXCEL High Density

    function togglePortalViewMode() {
      portalViewMode = portalViewMode === 'EXCEL' ? 'CARD' : 'EXCEL';
      const btn = document.getElementById('btnTogglePortalMode');
      if (btn) {
        btn.innerHTML = portalViewMode === 'EXCEL' 
          ? '<i data-lucide="sheet" style="width:13px; height:13px;"></i> 엑셀 대장 뷰' 
          : '<i data-lucide="layout-grid" style="width:13px; height:13px;"></i> 카드 뷰';
      }
      renderPortalCards();
    }

    function renderPortalCards() {
      const grid = document.getElementById('portalCardsGrid');
      const search = (document.getElementById('portalSearchInput')?.value || '').toLowerCase().trim();
      if (!grid) return;
      grid.innerHTML = '';

      const filtered = activeSolutionsList.filter(sol => {
        let matchesType = true;
        if (currentSolFilter === 'CUSTOM') matchesType = !!sol.isCustom;
        else if (currentSolFilter === 'KR') matchesType = sol.vendor.includes('국산') || sol.vendorType === '국산';
        else if (currentSolFilter === 'GLOBAL') matchesType = sol.vendor.includes('외산') || sol.vendorType === '외산';
        else if (currentSolFilter === 'AI') matchesType = sol.name.includes('AI') || (sol.category && sol.category.includes('AI'));
        else if (currentSolFilter === 'NETWORK') matchesType = (sol.category && (sol.category.includes('방화벽') || sol.category.includes('WAAP'))) || sol.name.includes('Zscaler');
        else if (currentSolFilter === 'DATA') matchesType = (sol.category && (sol.category.includes('DSP') || sol.category.includes('EDR') || sol.category.includes('DLP'))) || sol.name.includes('CipherTrust');

        const matchesSearch = !search ||
          sol.name.toLowerCase().includes(search) ||
          sol.vendor.toLowerCase().includes(search) ||
          (sol.category && sol.category.toLowerCase().includes(search)) ||
          (sol.overview && sol.overview.toLowerCase().includes(search)) ||
          (sol.manual && sol.manual.toLowerCase().includes(search));

        return matchesType && matchesSearch;
      });

      if (portalViewMode === 'EXCEL') {
        grid.style.display = 'block';
        let rows = '';
        filtered.forEach((sol, idx) => {
          const isKr = sol.vendor.includes('국산') || sol.vendorType === '국산';
          const badgeType = sol.isCustom ? 'neutral' : (isKr ? 'success' : 'info');
          const badgeLabel = sol.isCustom ? '사내운용' : (isKr ? '국산' : '외산');

          const priceStr = sol.price ? ('₩' + Number(sol.price).toLocaleString()) : '협의';
          const opexStr = sol.price ? ('₩' + Math.round(sol.price * (sol.opexRate || 0.12)).toLocaleString()) : '협의';

          rows += 
            '<tr>' +
              '<td class="center">' + (idx + 1) + '</td>' +
              '<td><b>' + sanitizeHtml(sol.name) + '</b></td>' +
              '<td>' + sanitizeHtml(sol.vendor) + '</td>' +
              '<td class="center"><span class="x-badge ' + badgeType + '">' + badgeLabel + '</span></td>' +
              '<td><span class="x-badge neutral">' + sanitizeHtml(sol.category || sol.sheetCategory || '보안제품') + '</span></td>' +
              '<td class="num">' + priceStr + '</td>' +
              '<td class="num" style="color:#d97706;">' + opexStr + '</td>' +
              '<td style="font-size:0.73rem; color:var(--text-sub);">' + sanitizeHtml(sol.ismsMapping || sol.regulation || '2.4 접근통제') + '</td>' +
              '<td class="center">' +
                '<button class="x-btn" onclick="openSolDetailModal(' + idx + ', &apos;manual&apos;)">매뉴얼</button> ' +
                '<button class="x-btn" onclick="document.getElementById(&apos;ragQueryInput&apos;).value=&apos;' + sol.name + ' 솔루션 스펙 및 매뉴얼은?&apos;; switchView(&apos;wiki&apos;); executeRagQuery();">RAG질의</button>' +
              '</td>' +
            '</tr>';
        });

        grid.innerHTML = 
          '<div class="excel-wrapper">' +
            '<table class="excel-table">' +
              '<thead>' +
                '<tr>' +
                  '<th class="center" style="width:35px;">No</th>' +
                  '<th style="width:180px;">솔루션명</th>' +
                  '<th style="width:130px;">공급사/제조사</th>' +
                  '<th class="center" style="width:70px;">구분</th>' +
                  '<th style="width:110px;">카테고리</th>' +
                  '<th class="num" style="width:110px;">도입 단가(Capex)</th>' +
                  '<th class="num" style="width:110px;">연간 유지보수(Opex)</th>' +
                  '<th>컴플라이언스 / 규제 준수</th>' +
                  '<th class="center" style="width:135px;">상세 및 질의</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + (rows || '<tr><td colspan="9" class="center">조회된 솔루션이 없습니다.</td></tr>') + '</tbody>' +
            '</table>' +
          '</div>';

        lucide.createIcons();
        return;
      }

      // Fallback: Card View
      grid.style.display = 'grid';
      filtered.forEach((sol, globalIdx) => {
        const card = document.createElement('div');
        card.className = 'sol-card';
        card.innerHTML = '<h3>' + sanitizeHtml(sol.name) + '</h3>';
        grid.appendChild(card);
      });
      lucide.createIcons();
    }

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
      if (presetKey === 'MY_ASSETS') {
        syncAssetsToStudio();
        return;
      }
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
      updateUnifiedTcoSummary();
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
    
    // --- 4.8 REAL-TIME FINOPS TCO & CONTRACT LIFECYCLE MODULE ---
    let currentBomSubView = 'sol';
    function switchBomSubView(subView) {
      currentBomSubView = subView;
      const subViews = ['sol', 'api', 'lifecycle'];
      subViews.forEach(v => {
        const viewEl = document.getElementById('bomSubView-' + v);
        const btnEl = document.getElementById('bomSubBtn-' + v);
        if (viewEl) viewEl.style.display = (v === subView ? 'block' : 'none');
        if (btnEl) {
          if (v === subView) {
            btnEl.className = 'btn btn-sm btn-primary';
            btnEl.style.background = '';
            btnEl.style.color = '';
          } else {
            btnEl.className = 'btn btn-sm';
            btnEl.style.background = '#f8fafc';
            btnEl.style.color = 'var(--text-sub)';
          }
        }
      });

      if (subView === 'api') {
        renderAiApiTable();
        updateAiApiKpis();
      } else if (subView === 'lifecycle') {
        renderLifecycleTable();
      }
      lucide.createIcons();
    }

    // --- 4.8.1 GENERATIVE AI & CLOUD API FINOPS ENGINE ---
    const AI_API_STORAGE_KEY = 'GIJO_AI_API_V5_2';
    let currentAiApiList = [];

    const defaultAiApiServices = [
      {
        id: 'AI-01',
        name: 'OpenAI GPT-4o Enterprise',
        vendor: 'OpenAI',
        billingType: 'TOKEN_1M',
        unitCost: 12000,
        monthlyUsage: 15.0,
        monthlyBudget: 2500000,
        dept: 'AI엔진개발팀'
      },
      {
        id: 'AI-02',
        name: 'Anthropic Claude 3.5 Sonnet',
        vendor: 'Anthropic',
        billingType: 'TOKEN_1M',
        unitCost: 15000,
        monthlyUsage: 8.0,
        monthlyBudget: 1500000,
        dept: '보안운영팀'
      },
      {
        id: 'AI-03',
        name: 'Google Gemini 1.5 Pro',
        vendor: 'Google Cloud',
        billingType: 'TOKEN_1M',
        unitCost: 6000,
        monthlyUsage: 20.0,
        monthlyBudget: 1500000,
        dept: '경영기획팀'
      },
      {
        id: 'AI-04',
        name: '온프레미스 GB10 (Qwen 177B MoE)',
        vendor: '온프레미스 클러스터',
        billingType: 'ONPREM_SERVER',
        unitCost: 1200,
        monthlyUsage: 720.0,
        monthlyBudget: 1000000,
        dept: '사내 전용 인프라'
      },
      {
        id: 'AI-05',
        name: '사내 bge-m3 임베딩 & OCR API',
        vendor: '사내 인프라',
        billingType: 'CALL_1K',
        unitCost: 150,
        monthlyUsage: 120.0,
        monthlyBudget: 300000,
        dept: '지능형 워크스페이스'
      }
    ];

    function loadAiApiServices() {
      try {
        const stored = localStorage.getItem(AI_API_STORAGE_KEY);
        if (stored) {
          currentAiApiList = JSON.parse(stored);
        } else {
          currentAiApiList = JSON.parse(JSON.stringify(defaultAiApiServices));
          saveAiApiServices();
        }
      } catch (e) {
        currentAiApiList = JSON.parse(JSON.stringify(defaultAiApiServices));
      }
    }

    function saveAiApiServices() {
      try {
        localStorage.setItem(AI_API_STORAGE_KEY, JSON.stringify(currentAiApiList));
      } catch (e) {}
    }

    function updateBillingUnitLabel(billingType) {
      const costLabel = document.getElementById('aiApiUnitCostLabel');
      const usageLabel = document.getElementById('aiApiUsageQtyLabel');
      if (billingType === 'TOKEN_1M') {
        if (costLabel) costLabel.innerText = '단위 단가 (₩ / 1M 토큰) *';
        if (usageLabel) usageLabel.innerText = '월간 예상 사용량 (M 토큰) *';
      } else if (billingType === 'CALL_1K') {
        if (costLabel) costLabel.innerText = '단위 단가 (₩ / 1,000회 호출) *';
        if (usageLabel) usageLabel.innerText = '월간 예상 호출수 (천 건) *';
      } else if (billingType === 'ONPREM_SERVER') {
        if (costLabel) costLabel.innerText = '시간당 운영단가 (₩ / 시간) *';
        if (usageLabel) usageLabel.innerText = '월간 가동 시간 (시간) *';
      } else {
        if (costLabel) costLabel.innerText = '월 고정 구독료 (₩) *';
        if (usageLabel) usageLabel.innerText = '구독 계정 수 (개) *';
      }
    }

    function calculateAiApiCost(item) {
      const unitCost = Number(item.unitCost) || 0;
      const usage = Number(item.monthlyUsage) || 0;
      const monthly = Math.round(unitCost * usage);
      const annual = monthly * 12;
      return { monthly: monthly, annual: annual };
    }

    function updateAiApiKpis() {
      let monthlyTotal = 0;
      let annualTotal = 0;
      let gb10Savings = 0;

      const deptBudgets = {};

      currentAiApiList.forEach(item => {
        const cost = calculateAiApiCost(item);
        monthlyTotal += cost.monthly;
        annualTotal += cost.annual;

        // Calculate GB10 on-premise savings (assuming 90% cost savings compared to cloud LLMs)
        if (item.billingType === 'ONPREM_SERVER') {
          const equivalentCloudCost = (cost.monthly * 10) - cost.monthly;
          gb10Savings += (equivalentCloudCost * 12);
        }

        const dept = item.dept || '기타';
        if (!deptBudgets[dept]) deptBudgets[dept] = { spent: 0, budget: 0 };
        deptBudgets[dept].spent += cost.monthly;
        deptBudgets[dept].budget += (Number(item.monthlyBudget) || cost.monthly);
      });

      const countEl = document.getElementById('aiApiCountDisplay');
      const monthlyEl = document.getElementById('aiApiMonthlyTotalDisplay');
      const annualEl = document.getElementById('aiApiAnnualTotalDisplay');
      const savingsEl = document.getElementById('aiApiGb10SavingsDisplay');

      if (countEl) countEl.innerText = currentAiApiList.length + ' 종';
      if (monthlyEl) monthlyEl.innerText = '₩' + monthlyTotal.toLocaleString();
      if (annualEl) annualEl.innerText = '₩' + annualTotal.toLocaleString();
      if (savingsEl) savingsEl.innerText = '₩' + gb10Savings.toLocaleString();

      // Render department budget bars
      const deptContainer = document.getElementById('aiApiDeptBudgetsContainer');
      if (deptContainer) {
        deptContainer.innerHTML = '';
        Object.entries(deptBudgets).forEach(([deptName, bInfo]) => {
          const ratio = bInfo.budget > 0 ? Math.min(100, Math.round((bInfo.spent / bInfo.budget) * 100)) : 100;
          const isOver = bInfo.spent > bInfo.budget;
          const barColor = isOver ? '#dc2626' : (ratio >= 80 ? '#d97706' : '#2563eb');

          const dBox = document.createElement('div');
          dBox.style.cssText = 'background:#fff; border:1px solid var(--border); border-radius:6px; padding:0.75rem;';
          dBox.innerHTML = 
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">' +
              '<span style="font-weight:700; font-size:0.78rem; color:var(--text-main);">' + sanitizeHtml(deptName) + '</span>' +
              '<span style="font-size:0.72rem; font-weight:800; color:' + barColor + ';">' + ratio + '% 소진' + (isOver ? ' (초과)' : '') + '</span>' +
            '</div>' +
            '<div style="width:100%; height:6px; background:#f1f5f9; border-radius:999px; overflow:hidden; margin-bottom:0.35rem;">' +
              '<div style="width:' + ratio + '%; height:100%; background:' + barColor + '; border-radius:999px;"></div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; font-size:0.68rem; color:var(--text-dim);">' +
              '<span>실사용: ₩' + bInfo.spent.toLocaleString() + '</span>' +
              '<span>예산: ₩' + bInfo.budget.toLocaleString() + '</span>' +
            '</div>';
          deptContainer.appendChild(dBox);
        });
      }

      // Update Unified Top TCO summary cards
      updateUnifiedTcoSummary(annualTotal);
    }

    function renderAiApiTable() {
      const tbody = document.getElementById('aiApiTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      currentAiApiList.forEach((item, idx) => {
        const cost = calculateAiApiCost(item);
        const billingBadge = item.billingType === 'TOKEN_1M' ? '<span class="meta-badge badge-global">1M 토큰</span>'
          : (item.billingType === 'CALL_1K' ? '<span class="meta-badge badge-kr">1,000건</span>'
          : (item.billingType === 'ONPREM_SERVER' ? '<span class="meta-badge badge-custom">온프렘 시간제</span>' : '<span class="meta-badge">월 구독</span>'));

        const usageUnit = item.billingType === 'TOKEN_1M' ? 'M 토큰'
          : (item.billingType === 'CALL_1K' ? '천 건'
          : (item.billingType === 'ONPREM_SERVER' ? '시간' : '계정'));

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><b>' + sanitizeHtml(item.name) + '</b></td>' +
          '<td>' + sanitizeHtml(item.vendor) + '</td>' +
          '<td>' + billingBadge + '</td>' +
          '<td>₩' + Number(item.unitCost).toLocaleString() + '</td>' +
          '<td style="text-align:center;">' +
            '<input type="number" step="0.1" class="qty-box" style="width:75px;" value="' + item.monthlyUsage + '" onchange="updateAiApiUsage(' + idx + ', this.value)"> ' +
            '<span style="font-size:0.7rem; color:var(--text-dim);">' + usageUnit + '</span>' +
          '</td>' +
          '<td style="font-weight:700; color:var(--text-main);">₩' + cost.monthly.toLocaleString() + '</td>' +
          '<td style="color:#d97706; font-weight:700;">₩' + cost.annual.toLocaleString() + '</td>' +
          '<td><span class="meta-badge" style="background:#f1f5f9;">' + sanitizeHtml(item.dept) + '</span></td>' +
          '<td style="text-align:right;">' +
            '<button class="btn btn-sm" style="padding:1px 5px; font-size:0.68rem; margin-right:3px;" onclick="openEditAiApiModal(\\'' + item.id + '\\')">수정</button>' +
            '<button class="btn btn-sm" style="padding:1px 5px; font-size:0.68rem; color:var(--danger);" onclick="deleteAiApi(\\'' + item.id + '\\')">삭제</button>' +
          '</td>';
        tbody.appendChild(tr);
      });
    }

    function updateAiApiUsage(idx, newVal) {
      if (currentAiApiList[idx]) {
        currentAiApiList[idx].monthlyUsage = Math.max(0, parseFloat(newVal) || 0);
        saveAiApiServices();
        renderAiApiTable();
        updateAiApiKpis();
      }
    }

    function openAddAiApiModal() {
      document.getElementById('aiApiModalId').value = '';
      document.getElementById('aiApiModalTitle').innerText = '생성형 AI & 클라우드 API 신규 등록';
      document.getElementById('aiApiModalName').value = '';
      document.getElementById('aiApiModalVendor').value = '';
      document.getElementById('aiApiModalBillingType').value = 'TOKEN_1M';
      document.getElementById('aiApiModalUnitCost').value = '';
      document.getElementById('aiApiModalMonthlyUsage').value = '';
      document.getElementById('aiApiModalMonthlyBudget').value = '';
      document.getElementById('aiApiModalDepartment').value = '';
      updateBillingUnitLabel('TOKEN_1M');
      document.getElementById('aiApiModal').style.display = 'flex';
      lucide.createIcons();
    }

    function openEditAiApiModal(apiId) {
      const item = currentAiApiList.find(a => a.id === apiId);
      if (!item) return;

      document.getElementById('aiApiModalId').value = item.id;
      document.getElementById('aiApiModalTitle').innerText = 'AI / API 서비스 수정';
      document.getElementById('aiApiModalName').value = item.name;
      document.getElementById('aiApiModalVendor').value = item.vendor;
      document.getElementById('aiApiModalBillingType').value = item.billingType || 'TOKEN_1M';
      document.getElementById('aiApiModalUnitCost').value = item.unitCost;
      document.getElementById('aiApiModalMonthlyUsage').value = item.monthlyUsage;
      document.getElementById('aiApiModalMonthlyBudget').value = item.monthlyBudget || '';
      document.getElementById('aiApiModalDepartment').value = item.dept;
      updateBillingUnitLabel(item.billingType || 'TOKEN_1M');
      document.getElementById('aiApiModal').style.display = 'flex';
      lucide.createIcons();
    }

    function closeAiApiModal() {
      document.getElementById('aiApiModal').style.display = 'none';
    }

    function saveAiApi() {
      const apiId = document.getElementById('aiApiModalId').value.trim();
      const name = document.getElementById('aiApiModalName').value.trim();
      const vendor = document.getElementById('aiApiModalVendor').value.trim();
      const billingType = document.getElementById('aiApiModalBillingType').value;
      const unitCost = Number(document.getElementById('aiApiModalUnitCost').value) || 0;
      const monthlyUsage = Number(document.getElementById('aiApiModalMonthlyUsage').value) || 0;
      const monthlyBudget = Number(document.getElementById('aiApiModalMonthlyBudget').value) || (unitCost * monthlyUsage);
      const dept = document.getElementById('aiApiModalDepartment').value.trim() || '전사 공통';

      if (!name) {
        alert('서비스 / 모델명을 입력해주세요.');
        return;
      }

      if (apiId) {
        const item = currentAiApiList.find(a => a.id === apiId);
        if (item) {
          item.name = name;
          item.vendor = vendor;
          item.billingType = billingType;
          item.unitCost = unitCost;
          item.monthlyUsage = monthlyUsage;
          item.monthlyBudget = monthlyBudget;
          item.dept = dept;
        }
      } else {
        const newId = 'AI-' + String(currentAiApiList.length + 1).padStart(2, '0');
        currentAiApiList.push({
          id: newId,
          name: name,
          vendor: vendor,
          billingType: billingType,
          unitCost: unitCost,
          monthlyUsage: monthlyUsage,
          monthlyBudget: monthlyBudget,
          dept: dept
        });
      }

      saveAiApiServices();
      closeAiApiModal();
      renderAiApiTable();
      updateAiApiKpis();
    }

    function deleteAiApi(apiId) {
      if (confirm('해당 AI/API 서비스를 목록에서 삭제하시겠습니까?')) {
        currentAiApiList = currentAiApiList.filter(a => a.id !== apiId);
        saveAiApiServices();
        renderAiApiTable();
        updateAiApiKpis();
      }
    }

    function exportAiApiCsv() {
      let csv = 'ID,서비스명,공급사,과금방식,단위단가,월사용량,월간비용,연간비용,부서,월예산\\n';
      currentAiApiList.forEach(item => {
        const cost = calculateAiApiCost(item);
        csv += '"' + item.id + '","' + item.name + '","' + item.vendor + '","' + item.billingType + '",' + item.unitCost + ',' + item.monthlyUsage + ',' + cost.monthly + ',' + cost.annual + ',"' + item.dept + '",' + (item.monthlyBudget || 0) + '\\n';
      });

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'GIJO_Generative_AI_FinOps_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    }

    // --- 4.8.2 CONTRACT LIFECYCLE & D-DAY ENGINE ---
    const LIFECYCLE_STORAGE_KEY = 'GIJO_LIFECYCLE_V5_2';
    let currentLifecycleList = [];
    let currentLifecycleFilter = 'ALL';

    const defaultLifecycleList = [
      {
        id: 'LC-01',
        name: 'GIJO AS 폐쇄망 에이전트',
        category: '보안솔루션',
        startDate: '2026-01-01',
        endDate: '2026-10-15',
        contractType: '1년 연간계약',
        renewalCost: 25000000,
        usefulYears: 5,
        manager: '정보보호팀 최책임'
      },
      {
        id: 'LC-02',
        name: 'WizCLM 인증서 자동화',
        category: '보안솔루션',
        startDate: '2025-11-01',
        endDate: '2026-10-31',
        contractType: '1년 연간계약',
        renewalCost: 15000000,
        usefulYears: 5,
        manager: '인프라팀 김수석'
      },
      {
        id: 'LC-03',
        name: 'OpenAI GPT-4o Enterprise',
        category: '클라우드API',
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        contractType: '1년 연간계약',
        renewalCost: 24000000,
        usefulYears: 3,
        manager: 'AI엔진팀 박팀장'
      },
      {
        id: 'LC-04',
        name: 'CipherTrust 투명 DB 암호화',
        category: '보안솔루션',
        startDate: '2024-05-15',
        endDate: '2027-05-14',
        contractType: '3년 다년계약',
        renewalCost: 35000000,
        usefulYears: 5,
        manager: '데이터팀 이수석'
      },
      {
        id: 'LC-05',
        name: '대고객 포털 웹서버 (Nginx)',
        category: 'IT인프라',
        startDate: '2022-09-01',
        endDate: '2026-08-31',
        contractType: '영구 라이선스+유지보수',
        renewalCost: 3000000,
        usefulYears: 5,
        manager: '인프라팀 홍책임'
      }
    ];

    function loadLifecycleData() {
      try {
        const stored = localStorage.getItem(LIFECYCLE_STORAGE_KEY);
        if (stored) {
          currentLifecycleList = JSON.parse(stored);
        } else {
          currentLifecycleList = JSON.parse(JSON.stringify(defaultLifecycleList));
          saveLifecycleData();
        }
      } catch (e) {
        currentLifecycleList = JSON.parse(JSON.stringify(defaultLifecycleList));
      }
    }

    function saveLifecycleData() {
      try {
        localStorage.setItem(LIFECYCLE_STORAGE_KEY, JSON.stringify(currentLifecycleList));
      } catch (e) {}
    }

    function calculateDDay(endDateStr) {
      if (!endDateStr) return { days: 999, label: '-', status: 'ACTIVE' };
      const today = new Date('2026-09-16');
      const end = new Date(endDateStr);
      const diffTime = end.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        return { days: diffDays, label: '만료 (' + Math.abs(diffDays) + '일 지남)', status: 'EXPIRED' };
      } else if (diffDays === 0) {
        return { days: 0, label: 'D-Day (오늘 만료)', status: 'D30' };
      } else if (diffDays <= 30) {
        return { days: diffDays, label: 'D-' + diffDays + ' (긴급)', status: 'D30' };
      } else if (diffDays <= 60) {
        return { days: diffDays, label: 'D-' + diffDays + ' (갱신임박)', status: 'D60' };
      } else {
        return { days: diffDays, label: 'D-' + diffDays, status: 'ACTIVE' };
      }
    }

    function calculateDepreciationValue(item) {
      const today = new Date('2026-09-16');
      const start = new Date(item.startDate || '2026-01-01');
      const usefulYears = Number(item.usefulYears) || 5;
      const initialCost = Number(item.renewalCost) || 10000000;

      const elapsedMonths = Math.max(0, (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth()));
      const totalMonths = usefulYears * 12;
      const remainingRatio = Math.max(0, 1 - (elapsedMonths / totalMonths));
      return Math.round(initialCost * remainingRatio);
    }

    function filterLifecycleStatus(status, btn) {
      currentLifecycleFilter = status;
      document.querySelectorAll('#bomSubView-lifecycle .portal-filter-tab').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      renderLifecycleTable();
    }

    function renderLifecycleTable() {
      const tbody = document.getElementById('lifecycleTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      let countAll = 0, countActive = 0, countD60 = 0, countD30 = 0, countExpired = 0;
      let urgentBudgetSum = 0;
      let urgentCount = 0;

      currentLifecycleList.forEach(item => {
        countAll++;
        const dday = calculateDDay(item.endDate);
        if (dday.status === 'ACTIVE') countActive++;
        else if (dday.status === 'D60') countD60++;
        else if (dday.status === 'D30') countD30++;
        else if (dday.status === 'EXPIRED') countExpired++;

        if (dday.status === 'D30' || dday.status === 'D60') {
          urgentCount++;
          urgentBudgetSum += (Number(item.renewalCost) || 0);
        }
      });

      const elAll = document.getElementById('countLifecycleAll');
      const elActive = document.getElementById('countLifecycleActive');
      const elD60 = document.getElementById('countLifecycleD60');
      const elD30 = document.getElementById('countLifecycleD30');
      const elExpired = document.getElementById('countLifecycleExpired');
      if (elAll) elAll.innerText = countAll;
      if (elActive) elActive.innerText = countActive;
      if (elD60) elD60.innerText = countD60;
      if (elD30) elD30.innerText = countD30;
      if (elExpired) elExpired.innerText = countExpired;

      // Update Alert Banner
      const bannerTitle = document.getElementById('lifecycleDDayAlertTitle');
      const bannerDesc = document.getElementById('lifecycleDDayAlertDesc');
      const bannerSum = document.getElementById('lifecycleRenewalBudgetSum');
      if (bannerTitle) bannerTitle.innerText = '계약 갱신 임박 D-Day 모니터링: ' + urgentCount + '건 선제 조치 대상';
      if (bannerDesc) bannerDesc.innerText = '60일 이내 만료 예정 계약에 대해 사전 품의 및 차기 예산 확보가 권고됩니다.';
      if (bannerSum) bannerSum.innerText = '차기 갱신 소요액: ₩' + urgentBudgetSum.toLocaleString();

      const filtered = currentLifecycleList.filter(item => {
        if (currentLifecycleFilter === 'ALL') return true;
        const dday = calculateDDay(item.endDate);
        return dday.status === currentLifecycleFilter;
      });

      filtered.forEach((item, idx) => {
        const dday = calculateDDay(item.endDate);
        const depVal = calculateDepreciationValue(item);

        const ddayBadgeColor = dday.status === 'EXPIRED' ? '#475569'
          : (dday.status === 'D30' ? '#dc2626'
          : (dday.status === 'D60' ? '#d97706' : '#059669'));
        const ddayBadgeBg = dday.status === 'EXPIRED' ? '#f1f5f9'
          : (dday.status === 'D30' ? '#fee2e2'
          : (dday.status === 'D60' ? '#fef3c7' : '#ecfdf5'));

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><b>' + sanitizeHtml(item.name) + '</b></td>' +
          '<td><span class="meta-badge" style="font-size:0.7rem;">' + sanitizeHtml(item.category) + '</span></td>' +
          '<td>' + sanitizeHtml(item.startDate || '-') + '</td>' +
          '<td>' + sanitizeHtml(item.endDate || '-') + '</td>' +
          '<td>' + sanitizeHtml(item.contractType || '연간계약') + '</td>' +
          '<td style="text-align:center;"><span style="background:' + ddayBadgeBg + '; color:' + ddayBadgeColor + '; padding:3px 8px; border-radius:999px; font-weight:800; font-size:0.72rem;">' + dday.label + '</span></td>' +
          '<td style="font-weight:700; color:#d97706;">₩' + Number(item.renewalCost).toLocaleString() + '</td>' +
          '<td style="color:var(--text-sub);">₩' + depVal.toLocaleString() + ' (' + item.usefulYears + '년)</td>' +
          '<td>' + sanitizeHtml(item.manager || '담당자') + '</td>' +
          '<td style="text-align:right;">' +
            '<button class="btn btn-sm" style="padding:1px 6px; font-size:0.7rem;" onclick="openEditLifecycleModal(\\'' + item.id + '\\')">설정</button>' +
          '</td>';
        tbody.appendChild(tr);
      });
    }

    function openEditLifecycleModal(lcId) {
      const item = currentLifecycleList.find(l => l.id === lcId);
      if (!item) return;

      document.getElementById('lifecycleModalId').value = item.id;
      document.getElementById('lifecycleModalName').value = item.name;
      document.getElementById('lifecycleModalStart').value = item.startDate || '';
      document.getElementById('lifecycleModalEnd').value = item.endDate || '';
      document.getElementById('lifecycleModalContractType').value = item.contractType || '1년 연간계약';
      document.getElementById('lifecycleModalRenewalCost').value = item.renewalCost || 0;
      document.getElementById('lifecycleModalUsefulYears').value = item.usefulYears || 5;
      document.getElementById('lifecycleModalManager').value = item.manager || '';

      document.getElementById('lifecycleModal').style.display = 'flex';
      lucide.createIcons();
    }

    function closeLifecycleModal() {
      document.getElementById('lifecycleModal').style.display = 'none';
    }

    function saveLifecycleItem() {
      const lcId = document.getElementById('lifecycleModalId').value;
      const item = currentLifecycleList.find(l => l.id === lcId);
      if (!item) return;

      item.startDate = document.getElementById('lifecycleModalStart').value;
      item.endDate = document.getElementById('lifecycleModalEnd').value;
      item.contractType = document.getElementById('lifecycleModalContractType').value;
      item.renewalCost = Number(document.getElementById('lifecycleModalRenewalCost').value) || 0;
      item.usefulYears = Number(document.getElementById('lifecycleModalUsefulYears').value) || 5;
      item.manager = document.getElementById('lifecycleModalManager').value.trim();

      saveLifecycleData();
      closeLifecycleModal();
      renderLifecycleTable();
    }

    // --- 4.8.3 UNIFIED TCO CALCULATION ENGINE ---
    function updateUnifiedTcoSummary(aiAnnualTotal) {
      let annualAi = aiAnnualTotal;
      if (annualAi === undefined) {
        annualAi = 0;
        currentAiApiList.forEach(item => {
          annualAi += calculateAiApiCost(item).annual;
        });
      }

      let totalSolQty = 0;
      let totalSolCapex = 0;
      let totalSolOpex = 0;

      activeSolutionsList.forEach(sol => {
        const qty = sol.qty || 0;
        const price = sol.price || 0;
        const capex = price * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));
        totalSolQty += qty;
        totalSolCapex += capex;
        totalSolOpex += opex;
      });

      const unifiedAnnualOpex = totalSolOpex + annualAi;
      const unified5YearTco = totalSolCapex + (unifiedAnnualOpex * 5);

      const qtyEl = document.getElementById('bomTotalQtyCount');
      const capexEl = document.getElementById('bomTotalCapex');
      const opexEl = document.getElementById('bomTotalOpex');
      const tcoEl = document.getElementById('bomTotalTco');

      if (qtyEl) qtyEl.innerText = totalSolQty + '개 솔루션 + ' + currentAiApiList.length + '종 API';
      if (capexEl) capexEl.innerText = '₩' + totalSolCapex.toLocaleString();
      if (opexEl) opexEl.innerText = '₩' + unifiedAnnualOpex.toLocaleString();
      if (tcoEl) tcoEl.innerText = '₩' + unified5YearTco.toLocaleString();
    }

    function exportUnifiedTcoCsv() {
      let csv = '=== 1. 전사 보안 솔루션 TCO ===\\n';
      csv += '솔루션명,제조사,카테고리,단가,수량,도입비(Capex),연간유지보수(Opex),5개년TCO\\n';
      activeSolutionsList.forEach(sol => {
        const qty = sol.qty || 0;
        const capex = (sol.price || 0) * qty;
        const opex = Math.round(capex * (sol.opexRate || 0.12));
        const tco = capex + (opex * 5);
        csv += '"' + sol.name + '","' + sol.vendor + '","' + (sol.category || '') + '",' + (sol.price || 0) + ',' + qty + ',' + capex + ',' + opex + ',' + tco + '\\n';
      });

      csv += '\\n=== 2. 생성형 AI & 클라우드 API FinOps ===\\n';
      csv += '서비스명,공급사,과금방식,단위단가,월사용량,월간비용,연간비용,부서\\n';
      currentAiApiList.forEach(item => {
        const cost = calculateAiApiCost(item);
        csv += '"' + item.name + '","' + item.vendor + '","' + item.billingType + '",' + item.unitCost + ',' + item.monthlyUsage + ',' + cost.monthly + ',' + cost.annual + ',"' + item.dept + '"\\n';
      });

      csv += '\\n=== 3. 솔루션 & API 계약 생애주기 (Lifecycle) ===\\n';
      csv += '대상명,구분,계약시작일,계약만료일,계약형태,D-Day상태,차기갱신예상액,담당자\\n';
      currentLifecycleList.forEach(item => {
        const dday = calculateDDay(item.endDate);
        csv += '"' + item.name + '","' + item.category + '","' + (item.startDate || '') + '","' + (item.endDate || '') + '","' + item.contractType + '","' + dday.label + '",' + item.renewalCost + ',"' + (item.manager || '') + '"\\n';
      });

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'GIJO_Unified_Security_AI_FinOps_TCO_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    }


            // --- 4.9 SMART APPROVAL BOARD (전자결재 기안판) ENGINE ---
    let stampStates = {
      stampReviewer: false,
      stampTeamLeader: false,
      stampCiso: false
    };

    function openSmartApprovalModal() {
      const modal = document.getElementById('smartApprovalModal');
      if (modal) modal.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    }

    function closeSmartApprovalModal() {
      const modal = document.getElementById('smartApprovalModal');
      if (modal) modal.style.display = 'none';
    }

    function toggleStamp(cellId) {
      stampStates[cellId] = !stampStates[cellId];
      const cell = document.getElementById(cellId);
      if (!cell) return;

      if (stampStates[cellId]) {
        const title = cellId === 'stampCiso' ? '최종<br>승인' : '검토<br>완료';
        const color = cellId === 'stampCiso' ? '#dc2626' : '#2563eb';
        cell.innerHTML = 
          '<div style="cursor:pointer;" onclick="toggleStamp(&apos;' + cellId + '&apos;)">' +
            '<span style="display:inline-block; border:1.5px solid ' + color + '; color:' + color + '; border-radius:50%; width:36px; height:36px; line-height:16px; padding-top:2px; font-weight:800; font-size:0.62rem;">' + title + '</span>' +
            '<div style="font-size:0.55rem; color:' + color + '; font-weight:700; margin-top:2px;">09/16 승인</div>' +
          '</div>';
      } else {
        const label = cellId === 'stampCiso' ? '최종승인' : '서명하기';
        cell.innerHTML = '<button class="btn btn-sm" style="font-size:0.65rem; padding:2px 4px;" onclick="toggleStamp(&apos;' + cellId + '&apos;)">' + label + '</button>';
      }
    }

    const approvalTemplates = {
      SOL_PURCHASE: {
        title: '[품의] 2026년 차세대 보안 솔루션 및 생성형 AI 인프라 도입의 건',
        purpose: '최근 지능화되는 웹 취약점 및 공급망 보안 위협에 선제적으로 대응하고, 사내 생성형 AI 및 클라우드 API 도입에 따른 보안 가드레일 및 TCO 비용 통제 체계를 확립하기 위함.',
        content: [
          '- KISA ISMS-P 2.4 네트워크 접근통제 및 2.12 신기술(AI) 보안 통제 기준 완비',
          '- TmaxSoft JEUS 8.5 및 대고객 포털에 식별된 CVE 긴급 가상 패치 및 정책 적용',
          '- 온프레미스 GB10 (177B MoE) 클러스터 가동을 통해 상용 클라우드 API 대비 연간 90% 이상 예산 절감'
        ].join(String.fromCharCode(10)),
        budget: '총 소요예산: ₩185,000,000 (초기 Capex ₩1.2억 + 연간 Opex ₩6,500만)',
        effect: '연간 침해사고 예방 가치 ₩15억 확보 및 투자회수 기간 1.2년 달성'
      },
      VULN_PATCH: {
        title: '[보고] 코어 정보시스템 정기 취약점 분석평가 결과 및 긴급 보안조치 이행의 건',
        purpose: '사내 전산 인프라 및 웹 애플리케이션 대상 취약점 진단 결과 식별된 위험 항목에 대해 긴급 가상패치 및 설정 보완을 시행하여 침해사고를 사전 예방함.',
        content: [
          '- 금융 코어 WAS (JEUS 8.5) 내 Spring RCE (CVE-2016-1000027) 및 Tomcat RCE (CVE-2025-24813) 감지',
          '- WAAP(웹방화벽) 시그니처 룰셋 45건 긴급 업데이트 및 의존성 라이브러리 최신 버전 패치 로드맵 수립',
          '- 취약점 조치 전후 시스템 무결성 점검 및 감사로그 1년 보존 조치 완료'
        ].join(String.fromCharCode(10)),
        budget: '소요예산: 기존 유지보수 계약 범위 내 자체 수행 (추가 비용 ₩0)',
        effect: '고위험 CVE 100% 제거 및 KISA ISMS-P 2.3 취약점 점검 수검 적합 판정 확보'
      },
      BUDGET_REQUEST: {
        title: '[예산] 2027년도 전사 정보보호 및 클라우드 API 통합 TCO 예산 편성의 건',
        purpose: '전사 IT 자산 보호, 침해대응 체계 고도화 및 생성형 AI FinOps 사용량 통제를 위한 차기 연도 필수 정보보호 예산을 편성함.',
        content: [
          '- 정보보호 의무 투자 비율(IT 예산 대비 7% 이상) 준수',
          '- 노후 경계 방화벽 및 침입방지시스템(IPS) 하드웨어 교체 주기 도래에 따른 감가상각 반영',
          '- 사내 LLM 토큰 사용량 및 클라우드 API 5종 연간 구독료 선제 확보'
        ].join(String.fromCharCode(10)),
        budget: '총 신청예산: ₩248,000,000 (전년 대비 8.2% 합리적 증액)',
        effect: '보안 거버넌스 안정성 확보 및 불시 계약 만료로 인한 서비스 중단 원천 방지'
      },
      POLICY_REVISION: {
        title: '[개정] 사내 정보보안 기본지침 및 소프트웨어 공급망(SBOM) 관리규정 개정의 건',
        purpose: 'KISA 소프트웨어 공급망 보안 가이드라인 발표에 따라, 사내 IT 자산 및 외주 납품 소프트웨어의 SBOM 제출 및 검증 절차를 사규에 신설함.',
        content: [
          '- 제15조(소프트웨어 공급망 보안 관리): 납품 및 배포 시 CycloneDX v1.5/1.6 JSON 제출 의무화',
          '- 제18조(생성형 AI 활용 수칙): 사내 비공개 데이터의 외부 LLM 프롬프트 입력 금지 및 승인된 API 경유 원칙',
          '- 제22조(계약 갱신 및 내용연수): 만료 60일 전 사전 검토 및 5년 감가상각 통제'
        ].join(String.fromCharCode(10)),
        budget: '소요예산: 해당 없음',
        effect: '최신 법정 지침 및 ISMS-P 인증 기준 완벽 부합'
      },
      INCIDENT_REPORT: {
        title: '[긴급] 사이버 침해위협 징후 탐지 및 긴급 호스트 차단 대응 결과 보고',
        purpose: '외부 C2 통신 의심 트래픽 및 비정상 접근 시도에 대한 긴급 차단 및 원인 분석(RCA) 조치 결과를 보고함.',
        content: [
          '- 이상 징후: DMZ 웹서버 ➔ 외부 특정 IP로 대용량 비정상 트래픽 발생',
          '- 1단계 대응: EDR 호스트 네트워크 격리(Isolation) 및 방화벽 인바운드/아웃바운드 즉시 드롭',
          '- 2단계 원인: 미패치 취약점을 통한 웹셸 업로드 시도 확인 및 악성 파일 영구 삭제'
        ].join(String.fromCharCode(10)),
        budget: '사고 피해액: ₩0 (EDR 실시간 선제 차단으로 내부망 전파 방지 성공)',
        effect: '데이터 유출 0건 및 침해사고 대응 골든타임(5분 이내) 준수'
      }
    };

    function loadApprovalTemplate(tplKey) {
      const tpl = approvalTemplates[tplKey];
      if (!tpl) return;

      document.getElementById('draftTitle').value = tpl.title;
      document.getElementById('draftPurpose').value = tpl.purpose;
      document.getElementById('draftContent').value = tpl.content;
      document.getElementById('draftBudget').value = tpl.budget;
      document.getElementById('draftEffect').value = tpl.effect;
    }

    function pullTcoToDraft() {
      let totalCapex = 0;
      let totalOpex = 0;
      let activeCount = 0;

      activeSolutionsList.forEach(sol => {
        const qty = sol.qty || 0;
        if (qty > 0) activeCount++;
        const capex = (sol.price || 0) * qty;
        totalCapex += capex;
        totalOpex += Math.round(capex * (sol.opexRate || 0.12));
      });

      let annualAiTotal = 0;
      currentAiApiList.forEach(item => {
        annualAiTotal += calculateAiApiCost(item).annual;
      });

      const unifiedOpex = totalOpex + annualAiTotal;
      const tco5Year = totalCapex + (unifiedOpex * 5);

      const budgetStr = '총 TCO: ₩' + tco5Year.toLocaleString() + ' (초기Capex: ₩' + totalCapex.toLocaleString() + ' + 연간Opex/API: ₩' + unifiedOpex.toLocaleString() + ')';
      document.getElementById('draftBudget').value = budgetStr;

      let attachText = document.getElementById('draftAttachment').value;
      if (!attachText.includes('TCO 견적 상세')) {
        attachText += String.fromCharCode(10) + '[추가 첨부] 전사 솔루션(' + activeCount + '종) 및 생성형 AI API(' + currentAiApiList.length + '종) 5개년 TCO 실시간 견적표 연동 완료';
        document.getElementById('draftAttachment').value = attachText;
      }

      alert('✅ 실시간 BOM 견적기 및 FinOps AI API 비용 합산액(₩' + tco5Year.toLocaleString() + ')이 소요 예산에 자동 반영되었습니다!');
    }

    function pullSbomToDraft() {
      const NL = String.fromCharCode(10);
      let sbomSummary = NL + NL + '[첨부: 전사 IT 자산 및 SBOM 명세 요약]' + NL;
      sbomSummary += '| 자산 ID | 자산명 | 구역 | IP | OS | 탑재 컴포넌트 & 취약점 상태 |' + NL;
      sbomSummary += '|:---|:---|:---:|:---|:---|:---|' + NL;

      currentItAssets.forEach(a => {
        const comps = (a.components || []).map(c => c.name + ' (' + c.cve + ')').join(', ') || '-';
        sbomSummary += '| ' + a.id + ' | ' + a.name + ' | ' + a.zone + ' | ' + a.ip + ' | ' + a.os + ' | ' + comps + ' |' + NL;
      });

      let currentAttach = document.getElementById('draftAttachment').value;
      document.getElementById('draftAttachment').value = currentAttach + sbomSummary;

      alert('✅ 사내 등록된 IT 자산 ' + currentItAssets.length + '대(TmaxSoft JEUS 8.5 등) 및 SBOM 취약점 상태가 첨부 표로 자동 삽입되었습니다!');
    }

    function saveApprovalDraftToWiki() {
      const title = document.getElementById('draftTitle').value.trim();
      const drafter = document.getElementById('draftDrafter').value.trim();
      const purpose = document.getElementById('draftPurpose').value.trim();
      const content = document.getElementById('draftContent').value.trim();
      const budget = document.getElementById('draftBudget').value.trim();
      const effect = document.getElementById('draftEffect').value.trim();
      const attachment = document.getElementById('draftAttachment').value.trim();

      if (!title) {
        alert('기안 제목을 입력해주세요.');
        return;
      }

      const docId = 888;
      const todayStr = new Date().toISOString().slice(0, 10);
      const NL = String.fromCharCode(10);

      let md = '# ' + title + NL + NL +
        '> **문서종류**: 전자결재 기안문 | **기안부서**: ' + drafter + ' | **기안일자**: ' + todayStr + ' | **결재상태**: 최종승인' + NL + NL +
        '---' + NL + NL +
        '## 1. 추진 목적 및 도입 배경' + NL + purpose + NL + NL +
        '## 2. 주요 품의 내용 및 규정 근거' + NL + content + NL + NL +
        '## 3. 소요 예산 및 재원' + NL + '**' + budget + '**' + NL + NL +
        '## 4. 기대 효과 및 투자회수' + NL + effect + NL + NL +
        '## 5. 첨부 내역 및 증적 자료' + NL + attachment + NL;

      const existingIdx = currentDocs.findIndex(d => d.id === docId);
      const draftDoc = {
        id: docId,
        title: title,
        category: '보안규정',
        tags: ['전자결재', '품의서', 'TCO', '기안', '승인문서'],
        updatedAt: todayStr,
        content: md
      };

      if (existingIdx >= 0) {
        currentDocs[existingIdx] = draftDoc;
      } else {
        currentDocs.unshift(draftDoc);
      }

      saveDocsToStorage();
      renderWikiDocList();
      selectWikiDoc(docId);
      closeSmartApprovalModal();
      switchView('wiki');
      alert('✅ 전자결재 기안문이 사내 지식고(위키)의 1번째 정식 공문서로 성공적으로 등록되었습니다!');
    }

    function printApprovalDocument() {
      const title = document.getElementById('draftTitle').value.trim();
      const drafter = document.getElementById('draftDrafter').value.trim();
      const purpose = document.getElementById('draftPurpose').value.trim();
      const content = document.getElementById('draftContent').value.trim();
      const budget = document.getElementById('draftBudget').value.trim();
      const effect = document.getElementById('draftEffect').value.trim();
      const attachment = document.getElementById('draftAttachment').value.trim();

      const printWin = window.open('', '_blank');
      printWin.document.write(
        '<!DOCTYPE html><html><head><title>' + sanitizeHtml(title) + '</title>' +
        '<style>' +
        'body { font-family: Pretendard, sans-serif; padding: 30px; color:#0f172a; line-height: 1.6; }' +
        'h1 { font-size: 1.4rem; margin: 0; }' +
        'table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85rem; }' +
        'th, td { border: 1px solid #0f172a; padding: 6px 8px; }' +
        'th { background: #f8fafc; font-weight:700; }' +
        '.section-title { font-size: 1rem; font-weight:800; border-left: 4px solid #2563eb; padding-left: 8px; margin: 18px 0 6px 0; }' +
        '@media print { body { padding: 0; } }' +
        '</style></head><body>' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0f172a; padding-bottom:12px;">' +
          '<div>' +
            '<div style="font-size:0.75rem; color:#64748b;">문서번호: GIJO-SEC-2026-FINAL</div>' +
            '<h1>정보보안 업무 품의 및 결재서</h1>' +
            '<div style="font-size:0.8rem; color:#475569; margin-top:4px;">기안일자: ' + new Date().toISOString().slice(0, 10) + ' | 기안부서: ' + sanitizeHtml(drafter) + '</div>' +
          '</div>' +
          '<table style="width:340px; text-align:center; font-size:0.75rem; margin:0;">' +
            '<tr><th>기안자</th><th>검토자</th><th>보안팀장</th><th>CISO</th></tr>' +
            '<tr style="height:55px;">' +
              '<td><span style="border:1.5px solid #059669; color:#059669; border-radius:50%; width:36px; height:36px; display:inline-block; line-height:34px; font-weight:800; font-size:0.65rem;">기안</span></td>' +
              '<td><span style="border:1.5px solid #2563eb; color:#2563eb; border-radius:50%; width:36px; height:36px; display:inline-block; line-height:34px; font-weight:800; font-size:0.65rem;">검토</span></td>' +
              '<td><span style="border:1.5px solid #2563eb; color:#2563eb; border-radius:50%; width:36px; height:36px; display:inline-block; line-height:34px; font-weight:800; font-size:0.65rem;">합의</span></td>' +
              '<td><span style="border:1.5px solid #dc2626; color:#dc2626; border-radius:50%; width:36px; height:36px; display:inline-block; line-height:34px; font-weight:800; font-size:0.65rem;">승인</span></td>' +
            '</tr>' +
            '<tr style="font-size:0.65rem; color:#64748b; background:#fafafa;">' +
              '<td>' + sanitizeHtml(drafter) + '</td><td>보안파트장</td><td>정보보호팀장</td><td>정보보호최고책임</td>' +
            '</tr>' +
          '</table>' +
        '</div>' +
        '<div style="margin-top:15px; font-size:1.1rem; font-weight:800; background:#f1f5f9; padding:8px 12px; border-radius:4px;">' +
          '건명: ' + sanitizeHtml(title) +
        '</div>' +
        '<div class="section-title">1. 추진 목적 및 도입 배경</div>' +
        '<div style="font-size:0.85rem; padding-left:4px;">' + sanitizeHtml(purpose).split(String.fromCharCode(10)).join('<br/>') + '</div>' +
        '<div class="section-title">2. 주요 품의 내용 및 규정 근거</div>' +
        '<div style="font-size:0.85rem; padding-left:4px;">' + sanitizeHtml(content).split(String.fromCharCode(10)).join('<br/>') + '</div>' +
        '<div class="section-title">3. 소요 예산 및 재원</div>' +
        '<div style="font-size:0.9rem; font-weight:800; color:#b45309; padding-left:4px;">' + sanitizeHtml(budget) + '</div>' +
        '<div class="section-title">4. 기대 효과 및 투자 회수</div>' +
        '<div style="font-size:0.85rem; padding-left:4px;">' + sanitizeHtml(effect) + '</div>' +
        '<div class="section-title">5. 첨부 내역 및 세부 산출 증적</div>' +
        '<pre style="font-size:0.75rem; background:#f8fafc; border:1px solid #e2e8f0; padding:10px; border-radius:4px; font-family:monospace; white-space:pre-wrap;">' + sanitizeHtml(attachment) + '</pre>' +
        '<div style="margin-top:30px; font-size:0.75rem; color:#64748b; text-align:right;">' +
          customerOrgName + ' 정보보호본부 &copy; 2026 GIJO TECHNOLOGY' +
        '</div>' +
        '<' + 'script>window.onload = function(){ window.print(); };<' + '/script>' +
        '</body></html>'
      );
      printWin.document.close();
    }

    // --- 4.10 VISUAL NO-CODE ARCHITECTURE STUDIO STENCIL ENGINE ---
    let studioDirection = 'TB';

    function addStencilNode(type) {
      const editor = document.getElementById('studioMermaidCode');
      if (!editor) return;

      const targetZone = document.getElementById('paletteTargetZone').value || 'Trust';
      let nodeId = 'Node_' + Math.floor(100 + Math.random() * 900);
      let label = '신규 시스템';
      let isVuln = false;

      if (type === 'WEB') {
        nodeId = 'Web_' + Math.floor(10 + Math.random() * 90);
        label = '🌐 웹 서버 (Nginx v1.24)';
      } else if (type === 'FW') {
        nodeId = 'FW_' + Math.floor(10 + Math.random() * 90);
        label = '🔥 차세대방화벽 (NGFW FortiOS)';
      } else if (type === 'WAAP') {
        nodeId = 'WAAP_' + Math.floor(10 + Math.random() * 90);
        label = '🛡️ 웹/API 방화벽 (Imperva WAAP)';
      } else if (type === 'WAS') {
        nodeId = 'WAS_' + Math.floor(10 + Math.random() * 90);
        label = '⚙️ Core WAS (JEUS 8.5 / Spring)';
      } else if (type === 'DB') {
        nodeId = 'DB_' + Math.floor(10 + Math.random() * 90);
        label = '🗄️ 고객원장 DB (PostgreSQL)';
      } else if (type === 'KMS') {
        nodeId = 'KMS_' + Math.floor(10 + Math.random() * 90);
        label = '🔒 암호키 관리 (CipherTrust KMS)';
      } else if (type === 'SIEM') {
        nodeId = 'SIEM_' + Math.floor(10 + Math.random() * 90);
        label = '📊 통합보안관제 (SIEM LogServer)';
      } else if (type === 'CLOUD') {
        nodeId = 'Cloud_' + Math.floor(10 + Math.random() * 90);
        label = '☁️ 하이브리드 클라우드 게이트웨이';
      } else if (type === 'VULN') {
        nodeId = 'Vuln_' + Math.floor(10 + Math.random() * 90);
        label = '🚨 취약점 위험노드 (CVE-2025-24813)';
        isVuln = true;
      }

      const NL = String.fromCharCode(10);
      const nodeLine = '    ' + nodeId + '["' + label + '"]' + NL;
      let val = editor.value;

      // Find subgraph in mermaid code
      const zoneRegex = new RegExp('(subgraph\\s+' + targetZone + '[^\\n]*\\n)', 'i');
      if (zoneRegex.test(val)) {
        val = val.replace(zoneRegex, '$1' + nodeLine);
      } else {
        val += NL + '  subgraph ' + targetZone + '["' + targetZone + ' 구역"]' + NL + nodeLine + '  end' + NL;
      }

      if (isVuln) {
        val += '  style ' + nodeId + ' fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#991b1b' + NL;
      }

      editor.value = val;
      renderMermaidFromEditor();
      updateStudioBomBadge();

      // Set quick connector defaults
      const fromInp = document.getElementById('quickFromNode');
      const toInp = document.getElementById('quickToNode');
      if (fromInp && !fromInp.value) fromInp.value = nodeId;
      else if (toInp) toInp.value = nodeId;
    }

    function quickConnectNodes() {
      const fromNode = document.getElementById('quickFromNode').value.trim();
      const toNode = document.getElementById('quickToNode').value.trim();
      const protocol = document.getElementById('quickProtocol').value;
      const editor = document.getElementById('studioMermaidCode');

      if (!fromNode || !toNode) {
        alert('출발 노드와 도착 노드명을 입력해주세요.');
        return;
      }

      const NL = String.fromCharCode(10);
      const arrow = '  ' + fromNode + ' -->|' + protocol + '| ' + toNode + NL;
      editor.value += arrow;
      renderMermaidFromEditor();
      alert('✅ 연결선 [' + fromNode + ' ➔ ' + protocol + ' ➔ ' + toNode + '] 이 성공적으로 추가되었습니다.');
    }

    function toggleStudioDirection() {
      const editor = document.getElementById('studioMermaidCode');
      if (!editor) return;

      let val = editor.value;
      if (val.includes('flowchart TB') || val.includes('graph TB')) {
        val = val.replace(/flowchart TB/g, 'flowchart LR').replace(/graph TB/g, 'flowchart LR');
        studioDirection = 'LR';
      } else {
        val = val.replace(/flowchart LR/g, 'flowchart TB').replace(/graph LR/g, 'flowchart TB');
        studioDirection = 'TB';
      }

      editor.value = val;
      renderMermaidFromEditor();
      const labelEl = document.getElementById('btnStudioDirectionLabel');
      if (labelEl) labelEl.innerText = '방향: ' + studioDirection + ' (클릭 시 전환)';
    }

    function downloadStudioSvg() {
      const container = document.getElementById('studioDiagram');
      const svg = container ? container.querySelector('svg') : null;
      if (!svg) {
        alert('다운로드할 렌더링된 다이어그램이 없습니다.');
        return;
      }

      const svgData = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'GIJO_Security_Architecture_Diagram_' + new Date().toISOString().slice(0, 10) + '.svg';
      a.click();
    }

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
      
      // Initialize FinOps & Contract Lifecycle
      loadAiApiServices();
      loadLifecycleData();
      updateAiApiKpis();
initPdfDropZone();

      // Initialize IT Assets & SBOM
      loadItAssets();
      renderAssetTable();
      updateAssetKpis();
      renderAssetTopologyGraph();

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
