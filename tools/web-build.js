// Builds the browser version of Riftline (for Chromebooks and anyone who doesn't want to install)
// into the Camel Studios website repo, where GitHub Pages serves it at camells1.github.io/play/riftline/.
// Usage: node tools/web-build.js [targetDir]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || 'D:/Projects/Camells1.github.io/play/riftline');
const { version } = require('../package.json');

// Same files the desktop app ships (minus Electron)
const copy = [
  'index.html', 'src3d', 'vendor', 'assets/icon.png', 'assets/logo.png',
  'node_modules/three/build/three.module.js', 'node_modules/peerjs/dist/peerjs.min.js'
];

fs.rmSync(target, { recursive: true, force: true });
for (const rel of copy) {
  const from = path.join(root, rel), to = path.join(target, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

// Installable on ChromeOS / Chrome ("Install app"): web app manifest
fs.writeFileSync(path.join(target, 'manifest.webmanifest'), JSON.stringify({
  name: 'Riftline', short_name: 'Riftline', description: 'Tactical 3D shooter by Camel Studios',
  start_url: './', scope: './', display: 'fullscreen', orientation: 'landscape',
  background_color: '#0b0e14', theme_color: '#0b0e14',
  icons: [{ src: 'assets/icon.png', sizes: '256x256', type: 'image/png', purpose: 'any' }]
}, null, 2));
const index = path.join(target, 'index.html');
let html = fs.readFileSync(index, 'utf8');
html = html.replace('<link rel="icon"', '<link rel="manifest" href="manifest.webmanifest" />\n  <link rel="icon"');
fs.writeFileSync(index, html);
fs.writeFileSync(path.join(target, 'version.txt'), version + '\n');

let files = 0, bytes = 0;
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; } } })(target);
console.log(`web build v${version}: ${files} files, ${(bytes / 1048576).toFixed(1)} MB -> ${target}`);
