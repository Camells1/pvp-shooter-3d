const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Auto-update: state = { status: idle|checking|current|downloading|ready|manual|error, version, latest, progress }
  updateState: () => ipcRenderer.invoke('update-state'),
  onUpdate: cb => ipcRenderer.on('update-state', (_, s) => cb(s)),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  // Accounts: opens the sign-in window; resolves with { refreshToken, uid, email, name, tag, stay } or null
  openLogin: () => ipcRenderer.invoke('auth-open'),
  logout: () => ipcRenderer.invoke('auth-logout')
});
