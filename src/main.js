'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { detect, targetForFolder } = require('./core/detect');
const pack = require('./core/pack');
const { installTarget } = require('./core/install');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 660,
    minWidth: 640,
    minHeight: 560,
    title: 'CobbleAsia Installer',
    backgroundColor: '#0f1420',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // Links open in the player's browser, never inside the installer.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);

ipcMain.handle('detect', () => detect());

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your launcher or game folder',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return targetForFolder(r.filePaths[0]);
});

ipcMain.handle('pack-info', async () => {
  const info = await pack.latestVersion();
  return { version: info.version };
});

ipcMain.handle('open-folder', (_e, dir) => shell.openPath(dir));

ipcMain.handle('install', async (_e, targets) => {
  send('progress', { text: 'Checking for the newest Cobble Asia pack…', pct: 2 });
  const info = await pack.latestVersion();
  const p = await pack.loadPack(info);
  send('progress', { text: `Pack ${p.version}: downloading mods…`, pct: 5 });
  const cache = await pack.ensureMods(p, (done, total, name) => {
    send('progress', { text: `Downloading mods ${done}/${total}: ${name}`, pct: 5 + Math.round((done / total) * 80) });
  });

  const needsFabric = targets.some((t) => t.kind !== 'instance');
  const fabric = needsFabric ? await pack.fabricProfile(p.minecraft, p.loader) : null;

  let icon;
  try {
    icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'server-icon.png')).toString('base64');
  } catch {
    icon = undefined;
  }

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    send('progress', { text: `Installing into ${t.name}…`, pct: 85 + Math.round(((i + 1) / targets.length) * 14) });
    try {
      const r = installTarget(t, p, cache, fabric, { icon });
      results.push({ target: t, ok: true, ...r });
    } catch (e) {
      results.push({ target: t, ok: false, error: e.message });
    }
  }
  send('progress', { text: 'Done', pct: 100 });
  return { version: p.version, loader: p.loader, minecraft: p.minecraft, fabricId: fabric && fabric.id, results };
});
