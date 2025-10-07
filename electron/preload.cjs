// electron\preload.cjs

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  openFiles: (opts) => ipcRenderer.invoke('files:open', opts), // optional for future use
  saveAs: (opts) => ipcRenderer.invoke('files:saveAs', opts),  // { canceled, filePath }
  writeTextFile: (filePath, text) => ipcRenderer.invoke('files:writeText', { filePath, text }),
});
