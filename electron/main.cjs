// electron\main.cjs

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#1f1f1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('files:open', async (_e, opts = {}) => {
  const res = await dialog.showOpenDialog({
    title: 'Select files',
    properties: ['openFile', 'multiSelections'],
    filters: opts.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (res.canceled) return [];
  return res.filePaths;
});

ipcMain.handle('files:saveAs', async (_e, opts = {}) => {
  const res = await dialog.showSaveDialog({
    title: opts.title || 'Save output',
    defaultPath: opts.defaultPath || 'translation.cleaned.xml',
    filters: opts.filters || [{ name: 'XML', extensions: ['xml'] }],
  });
  return { canceled: res.canceled, filePath: res.filePath || null };
});

ipcMain.handle('files:writeText', async (_e, { filePath, text }) => {
  if (!filePath) throw new Error('No filePath provided');
  await fs.writeFile(filePath, text, 'utf8');
  return { ok: true };
});
