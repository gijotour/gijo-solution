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
    title: "GIJO TECHNOLOGY 보안 솔루션 통합 ERP & 스마트 스튜디오",
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Custom Desktop Native Menu
  const sendCommand = (cmd, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:command', { cmd, payload });
    }
  };

  const menuTemplate = [
    {
      label: '파일 (File)',
      submenu: [
        { label: '🛡️ 솔루션 카탈로그', accelerator: 'CmdOrCtrl+1', click: () => sendCommand('view-catalog') },
        { label: '📐 아키텍처 스튜디오', accelerator: 'CmdOrCtrl+2', click: () => sendCommand('view-studio') },
        { label: '💼 딜 & 견적 산출', accelerator: 'CmdOrCtrl+3', click: () => sendCommand('view-dealquote') },
        { label: '🔑 라이선스 & MA 관리', accelerator: 'CmdOrCtrl+4', click: () => sendCommand('view-licensema') },
        { label: '🏢 고객/제조사/파트너 360', accelerator: 'CmdOrCtrl+5', click: () => sendCommand('view-companycrm') },
        { label: '📝 스마트 MD 스튜디오', accelerator: 'CmdOrCtrl+6', click: () => sendCommand('view-mdstudio') },
        { type: 'separator' },
        { label: '💾 전체 데이터 백업 (JSON)', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('backup-all') },
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
          label: 'GIJO 기술지원 웹사이트',
          click: async () => {
            await shell.openExternal('https://github.com/gijotour');
          }
        },
        { type: 'separator' },
        {
          label: '버전 정보 (About)',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'GIJO Security ERP Suite',
              message: 'GIJO TECHNOLOGY 보안 솔루션 통합 ERP & 스마트 스튜디오',
              detail: '버전: v4.5.0 (Electron Desktop Standalone Edition)\n제조사: (주)GIJO TECHNOLOGY\nAGY & GB10 On-Premise Engine Powered'
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

// IPC Handlers
ipcMain.handle('dialog:saveJson', async (event, { defaultName, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'GIJO_Backup.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});