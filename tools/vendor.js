// Copies the three.js addons the game uses into vendor/three-addons.
// (electron-builder strips any "examples" folder from node_modules, which is where they live.)
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm');
const dst = path.join(__dirname, '..', 'vendor', 'three-addons');
const dirs = ['postprocessing', 'shaders', 'geometries', 'environments'];

fs.rmSync(dst, { recursive: true, force: true });
for (const d of dirs) fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true });
console.log('vendored three addons:', dirs.join(', '));
