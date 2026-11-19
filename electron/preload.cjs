const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('typeSub', {
  getRuntime: () => ipcRenderer.invoke('runtime-info'),
  downloadSpeechModel: () => ipcRenderer.invoke('speech-model-download'),
  startRecognition: (sampleRate) => ipcRenderer.invoke('speech-start', sampleRate),
  sendSpeechAudio: (id, samples) => ipcRenderer.send('speech-audio', id, samples),
  stopRecognition: (id) => ipcRenderer.invoke('speech-stop', id),
  saveConfig: (settings) => ipcRenderer.invoke('set-config', settings),
  saveAiConfig: (settings) => ipcRenderer.invoke('set-ai-config', settings),
  submitCaption: (text, options) => ipcRenderer.invoke('submit-caption', { text, ...options }),
  setCaptionVisible: (visible) => ipcRenderer.invoke('set-caption-visible', visible),
  copyText: (value) => clipboard.writeText(String(value)),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  requestAdmin: () => ipcRenderer.invoke('request-admin'),
  onSpeech: (callback) => ipcRenderer.on('speech-event', (_event, data) => callback(data)),
  onEngineFrame: (callback) => ipcRenderer.on('engine-frame', (_event, data) => callback(data)),
  onElevationResult: (callback) => ipcRenderer.on('elevation-result', (_event, data) => callback(data)),
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_event, action) => callback(action))
});
