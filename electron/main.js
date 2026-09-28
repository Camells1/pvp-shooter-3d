const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
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

// ---- Account login: opens the Riftline account page (GitHub Pages + Firebase) in a small window.
// When the player signs in, the page sets #rl-auth=<json> and we hand that to the game.
const ACCOUNT_URL = 'https://camells1.github.io/account/';
const AUTH_PARTITION = 'persist:riftline-auth';
let loginWin = null;
ipcMain.handle('auth-open', event => new Promise(resolve => {
  if (loginWin) { loginWin.focus(); return resolve(null); }
  const parent = BrowserWindow.fromWebContents(event.sender);
  loginWin = new BrowserWindow({
    width: 480, height: 760, parent, modal: true, resizable: false, minimizable: false, title: 'Riftline Account',
    backgroundColor: '#07090e', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { partition: AUTH_PARTITION, contextIsolation: true, nodeIntegration: false }
  });
  let done = false;
  const finish = data => { if (done) return; done = true; resolve(data); if (loginWin && !loginWin.isDestroyed()) loginWin.close(); };
  const check = (_e, url) => {
    const m = /#rl-auth=(.+)$/.exec(url || '');
    if (!m) return;
    try { finish(JSON.parse(decodeURIComponent(m[1]))); } catch (_) { finish(null); }
  };
  loginWin.webContents.on('did-navigate-in-page', check);
  loginWin.webContents.on('did-navigate', check);
  // Links that leave the account page (downloads, docs) open in the normal browser
  loginWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  loginWin.on('closed', () => { loginWin = null; finish(null); });
  loginWin.loadURL(ACCOUNT_URL + '?app=riftline');
}));
// Sign out also forgets the account page's own saved session
ipcMain.handle('auth-logout', async () => { try { await session.fromPartition(AUTH_PARTITION).clearStorageData(); } catch (_) {} return true; });
ipcMain.handle('update-state', () => updater.state);
ipcMain.handle('update-install', () => updater.install());
ipcMain.handle('update-check', () => updater.check());
