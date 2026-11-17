const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('typeSub', {
  getRuntime: () => ipcRenderer.invoke('runtime-info'),
  installComponent: (id) => ipcRenderer.invoke('install-component', id),
  uninstallComponent: (id) => ipcRenderer.invoke('uninstall-component', id),
  saveConfig: (settings) => ipcRenderer.invoke('set-config', settings),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  requestAdmin: () => ipcRenderer.invoke('request-admin'),
  engineCommand: (command, payload = '') => ipcRenderer.invoke('engine-command', { command, payload }),
  sendCameraFrame: (pixels) => ipcRenderer.send('camera-frame', pixels),
  onCameraReady: (callback) => ipcRenderer.on('camera-ready', callback),
  onRuntime: (callback) => ipcRenderer.on('runtime', (_event, data) => callback(data)),
  onProgress: (callback) => ipcRenderer.on('component-progress', (_event, data) => callback(data)),
  onEngineFrame: (callback) => ipcRenderer.on('engine-frame', (_event, data) => callback(data)),
  onElevationResult: (callback) => ipcRenderer.on('elevation-result', (_event, data) => callback(data)),
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_event, action) => callback(action))
});
