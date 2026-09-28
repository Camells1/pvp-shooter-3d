// Auto-update from GitHub Releases. No server needed: the release assets are the update feed.
// Installed copies download the new Setup and reinstall silently into the same folder;
// portable copies download the new portable exe next to the old one and switch to it.
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'Camells1/riftline';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

class Updater {
  constructor() {
    this.state = { status: 'idle', version: app.getVersion() };
    this.win = null;
    this.file = null;
    this.portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  }

  send() { try { this.win?.webContents.send('update-state', this.state); } catch (_) {} }
  set(s) { Object.assign(this.state, s); this.send(); }

  async check() {
    if (!app.isPackaged) return;
    try {
      this.set({ status: 'checking' });
      // Follow the "latest release" link instead of the GitHub API (the API is rate limited per network)
      const res = await fetch(RELEASES, { headers: { 'User-Agent': 'Riftline-Updater' } });
      const m = /\/releases\/tag\/v?(\d+\.\d+\.\d+)/.exec(res.url);
      if (!res.ok || !m) throw new Error('Could not read the latest release (' + res.status + ')');
      const latest = m[1];
      // RIFTLINE_UPDATE_TEST=1 pretends to be an old version (for testing the update path)
      const current = process.env.RIFTLINE_UPDATE_TEST ? '0.0.0' : app.getVersion();
      if (!newer(latest, current)) { this.set({ status: 'current' }); return; }
      const name = `Riftline-${this.portable ? 'Portable' : 'Setup'}-${latest}.exe`;
      const asset = { name, browser_download_url: `https://github.com/${REPO}/releases/download/v${latest}/${name}` };
      await this.download(asset, latest);
    } catch (e) {
      this.set({ status: 'error', error: String(e.message || e) });
    }
  }

  async download(asset, latest) {
    const dir = this.portable ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : app.getPath('temp');
    const out = path.join(dir, asset.name);
    const part = out + '.part';
    this.set({ status: 'downloading', latest, progress: 0 });
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Riftline-Updater' } });
    if (!res.ok || !res.body) throw new Error('Download failed (' + res.status + ')');
    const total = +res.headers.get('content-length') || 0;
    const ws = fs.createWriteStream(part);
    let got = 0, lastSent = 0;
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!ws.write(chunk)) await new Promise(r => ws.once('drain', r));
      if (total && got - lastSent > total / 50) { lastSent = got; this.set({ progress: got / total }); }
    }
    await new Promise((r, j) => ws.end(err => (err ? j(err) : r())));
    if (total && fs.statSync(part).size !== total) throw new Error('Download was incomplete');
    if (fs.statSync(part).size < 1e6) throw new Error('Download is not an installer');
    fs.renameSync(part, out);
    this.file = out;
    this.set({ status: 'ready', latest, progress: 1 });
  }

  // Closing the game with an update waiting installs it quietly (installed copies only)
  installOnQuit() {
    if (this.done || this.portable || this.state.status !== 'ready' || !this.file) return;
    this.done = true;
    const dir = path.dirname(process.execPath);
    spawn(this.file, ['/S', '--updated', `/D=${dir}`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, argv0: `"${this.file}"` }).unref();
  }

  // Restart into the new version
  install() {
    this.done = true;
    if (this.state.status !== 'ready' || !this.file) { shell.openExternal(RELEASES); return; }
    if (this.portable) {
      const old = process.env.PORTABLE_EXECUTABLE_FILE;
      spawn(this.file, [], { detached: true, stdio: 'ignore' }).unref();
      // Remove the old portable exe once it has closed, so friends don't open the wrong one
      if (/Riftline-Portable-[\d.]+\.exe$/i.test(old) && path.resolve(old) !== path.resolve(this.file)) {
        spawn('cmd.exe', ['/c', `ping 127.0.0.1 -n 6 > nul & del "${old}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
    } else {
      // Silent reinstall into this same folder, then launch the new version once the installer is done.
      // cmd waits for the installer (start /wait) and then starts the game; NSIS wants /D= last and unquoted.
      const dir = path.dirname(process.execPath), exe = path.join(dir, path.basename(process.execPath));
      const line = `start "" /wait "${this.file}" /S --updated /D=${dir}&& start "" "${exe}"`;
      spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    }
    app.quit();
  }
}

module.exports = { Updater, RELEASES };
