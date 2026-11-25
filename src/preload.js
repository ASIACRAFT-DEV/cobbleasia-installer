'use strict';
// The only things the window can ask the installer to do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  detect: () => ipcRenderer.invoke('detect'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  packInfo: () => ipcRenderer.invoke('pack-info'),
  install: (targets) => ipcRenderer.invoke('install', targets),
  openFolder: (dir) => ipcRenderer.invoke('open-folder', dir),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, data) => fn(data)),
});
