const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Updater } = require('./updater');

const updater = new Updater();

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#05070b',
    title: 'Riftline',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  updater.win = win;
  // Check for a new version a few seconds after start, then every 30 minutes
  win.webContents.once('did-finish-load', () => { setTimeout(() => updater.check(), 3000); });
  setInterval(() => { if (['idle', 'current', 'error'].includes(updater.state.status)) updater.check(); }, 30 * 60 * 1000);
  win.setMenuBarVisibility(false);

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

// Keep the GPU on the fast path for WebGL
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
// Share real local addresses with peers (instead of mDNS names) so players on the same network,
// or two copies on one PC, can connect directly even when the router can't loop traffic back.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

app.whenReady().then(createWindow);
app.on('before-quit', () => updater.installOnQuit());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('update-state', () => updater.state);
ipcMain.handle('update-install', () => updater.install());
ipcMain.handle('update-check', () => updater.check());
