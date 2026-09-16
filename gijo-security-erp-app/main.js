const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    title: "GIJO WIKI - 보안 솔루션 통합 ERP & 스마트 아키텍처 스튜디오",
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  const sendCommand = (cmd, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:command', { cmd, payload });
    }
  };

  const menuTemplate = [
    {
      label: '파일 (File)',
      submenu: [
        { label: '📚 GIJO WIKI (내문서·로컬LLM)', accelerator: 'CmdOrCtrl+1', click: () => sendCommand('view-wiki') },
        { label: '🏗️ 스마트 아키텍처 Pro 스튜디오', accelerator: 'CmdOrCtrl+2', click: () => sendCommand('view-studio') },
        { label: '📊 ERP 솔루션 포털', accelerator: 'CmdOrCtrl+3', click: () => sendCommand('view-portal') },
        { label: '💰 실시간 TCO & BOM', accelerator: 'CmdOrCtrl+4', click: () => sendCommand('view-bom') },
        { label: '🛡️ ISMS-P 진단기', accelerator: 'CmdOrCtrl+5', click: () => sendCommand('view-audit') },
        { type: 'separator' },
        { label: '💾 전체 프로젝트 백업 (JSON)', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('backup-all') },
        { type: 'separator' },
        { label: '종료 (Exit)', role: 'quit' }
      ]
    },
    {
      label: '편집 (Edit)',
      submenu: [
        { label: '실행 취소', role: 'undo' },
        { label: '다시 실행', role: 'redo' },
        { type: 'separator' },
        { label: '잘라내기', role: 'cut' },
        { label: '복사', role: 'copy' },
        { label: '붙여넣기', role: 'paste' },
        { label: '모두 선택', role: 'selectAll' }
      ]
    },
    {
      label: '보기 (View)',
      submenu: [
        { label: '새로고침', role: 'reload' },
        { label: '강제 새로고침', role: 'forceReload' },
        { type: 'separator' },
        { label: '실제 크기', role: 'resetZoom' },
        { label: '확대', role: 'zoomIn' },
        { label: '축소', role: 'zoomOut' },
        { type: 'separator' },
        { label: '전체 화면 토글', role: 'togglefullscreen' },
        { label: '개발자 도구 (DevTools)', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
      ]
    },
    {
      label: '도움말 (Help)',
      submenu: [
        {
          label: 'GIJO 기술지원 저장소',
          click: async () => {
            await shell.openExternal('https://github.com/gijotour/gijo-solution');
          }
        },
        { type: 'separator' },
        {
          label: '버전 정보 (About)',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'GIJO WIKI Suite Pro',
              message: 'GIJO WIKI - 통합 보안 ERP & 스마트 아키텍처 스튜디오 & 로컬 LLM 위키',
              detail: '버전: v5.0.0 Pro (Desktop Standalone Edition)\n제조사: (주)GIJO TECHNOLOGY\nAGY Architecture & GB10 On-Premise Engine Powered'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:saveJson', async (event, { defaultName, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'GIJO_WIKI_Backup.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});