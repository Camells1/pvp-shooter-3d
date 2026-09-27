// Renders the Riftline logo + app icon to PNGs using an offscreen Electron window.
// Usage: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const MARK = `
  <polygon points="4,140 38,140 96,0 62,0" fill="#ff3d5a"/>
  <polygon points="52,140 86,140 126,44 92,44" fill="#ff3d5a"/>
  <polygon points="98,30 132,30 144,0 110,0" fill="#f5f0e8"/>`;

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect x="8" y="8" width="240" height="240" rx="52" fill="#0f1116"/>
  <rect x="8" y="8" width="240" height="240" rx="52" fill="none" stroke="#ff3d5a" stroke-opacity="0.35" stroke-width="4"/>
  <g transform="translate(56 58)">${MARK}</g>
</svg>`;

const LOGO = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.svg'), 'utf8');

const render = (svg, w, h) => `new Promise(res => {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; c.getContext('2d').drawImage(img, 0, 0, ${w}, ${h}); res(c.toDataURL('image/png')); };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(${JSON.stringify(svg)})));
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  await win.loadURL('about:blank');
  const out = [['icon.png', ICON, 256, 256], ['logo.png', LOGO, 1280, 400]];
  for (const [name, svg, w, h] of out) {
    const url = await win.webContents.executeJavaScript(render(svg, w, h));
    const file = path.join(__dirname, '..', 'assets', name);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', file);
  }
  app.quit();
});
