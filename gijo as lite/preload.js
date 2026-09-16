const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  onAppCommand: (callback) => ipcRenderer.on('app:command', (event, data) => callback(data)),
  saveJsonFile: (defaultName, content) => ipcRenderer.invoke('dialog:saveJson', { defaultName, content })
});