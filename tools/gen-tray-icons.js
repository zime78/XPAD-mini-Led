// Generates tray icons (a filled circle per Claude state) into assets/tray/.
// Usage: node tools/gen-tray-icons.js
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const STATES = {
  idle: [0x6b, 0x72, 0x80],
  working: [0x25, 0x63, 0xeb],
  attention: [0xdc, 0x26, 0x26],
  done: [0x16, 0xa3, 0x4a],
};

const outDir = path.join(__dirname, '..', 'assets', 'tray');
fs.mkdirSync(outDir, { recursive: true });

function circlePng(size, [r, g, b]) {
  const png = new PNG({ width: size, height: size });
  const c = size / 2;
  const radius = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      // 1px anti-aliased edge
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  return PNG.sync.write(png);
}

for (const [state, color] of Object.entries(STATES)) {
  fs.writeFileSync(path.join(outDir, `${state}.png`), circlePng(16, color));
  fs.writeFileSync(path.join(outDir, `${state}@2x.png`), circlePng(32, color));
}
console.log(`Wrote ${Object.keys(STATES).length * 2} icons to ${outDir}`);
