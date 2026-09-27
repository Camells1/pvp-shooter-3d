// Renders the app icon to assets/icon.png using an offscreen Electron window.
// Usage: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const draw = `(() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const rr = (X, Y, W, H, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); };
  const bg = x.createLinearGradient(0, 0, 256, 256); bg.addColorStop(0, '#0b1420'); bg.addColorStop(1, '#1a0a1c');
  rr(8, 8, 240, 240, 48); x.fillStyle = bg; x.fill();
  x.lineWidth = 6; const bd = x.createLinearGradient(0, 0, 256, 256); bd.addColorStop(0, '#2ff5ff'); bd.addColorStop(1, '#ff3fb0'); x.strokeStyle = bd; x.stroke();
  x.shadowColor = '#2ff5ff'; x.shadowBlur = 18; x.strokeStyle = '#2ff5ff'; x.lineWidth = 10;
  x.beginPath(); x.arc(128, 118, 62, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 9;
  for (const [a, b, c2, d] of [[128, 36, 128, 78], [128, 158, 128, 200], [46, 118, 88, 118], [168, 118, 210, 118]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke(); }
  x.shadowColor = '#ff3fb0'; x.fillStyle = '#ff3fb0'; x.beginPath(); x.arc(128, 118, 10, 0, Math.PI * 2); x.fill();
  x.shadowBlur = 0; x.fillStyle = '#ffffff'; x.font = '800 44px Bahnschrift, Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillText('PVP 3D', 128, 236);
  return c.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('about:blank');
  const url = await win.webContents.executeJavaScript(draw);
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', out);
  app.quit();
});
