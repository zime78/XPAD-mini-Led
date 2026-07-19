// Generates the app icon (Clawd portrait, 512x512, transparent bg) into build/icon.png.
// electron-builder converts it to .ico/.icns as needed.
// Usage: node tools/gen-app-icon.js
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const S = 512;
const png = new PNG({ width: S, height: S });

const C = {
  body: [0xd9, 0x77, 0x57],
  bodyDark: [0xb2, 0x5b, 0x3e],
  bodyLight: [0xe8, 0x92, 0x6f],
  eye: [0x22, 0x1d, 0x1b],
  white: [0xff, 0xff, 0xff],
};

function set(x, y, rgb, a = 1) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) << 2;
  const prevA = png.data[i + 3] / 255;
  const outA = a + prevA * (1 - a);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    png.data[i + c] = Math.round(
      (rgb[c] * a + png.data[i + c] * prevA * (1 - a)) / outA
    );
  }
  png.data[i + 3] = Math.round(outA * 255);
}

function ellipse(cx, cy, rx, ry, rgb, a = 1) {
  for (let y = Math.floor(cy - ry) - 1; y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= cx + rx + 1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        // soft edge
        const edge = Math.min(1, (1 - Math.sqrt(d)) * Math.max(rx, ry) * 0.5);
        set(x, y, rgb, a * Math.min(1, edge));
      }
    }
  }
}

function circle(cx, cy, r, rgb, a = 1) {
  ellipse(cx, cy, r, r, rgb, a);
}

function line(x0, y0, x1, y1, t, rgb) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    circle(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, t / 2, rgb);
  }
}

function arc(cx, cy, r, a0, a1, t, rgb) {
  const steps = Math.ceil(Math.abs(a1 - a0) * r);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, t / 2, rgb);
  }
}

const cx = 256;
const cy = 270;

// claws raised on both sides
for (const dir of [-1, 1]) {
  line(cx + dir * 150, cy - 20, cx + dir * 195, cy - 90, 40, C.bodyDark);
  circle(cx + dir * 200, cy - 105, 62, C.body);
  ellipse(cx + dir * 200, cy - 155, 30, 34, [0, 0, 0], 0); // placeholder no-op
  // notch opening upward
  const nx = cx + dir * 200;
  const ny = cy - 105 - 50;
  for (let y = ny - 36; y < ny + 36; y++)
    for (let x = nx - 36; x < nx + 36; x++) {
      const d = Math.hypot(x - nx, y - ny);
      if (d < 34) {
        const i = (y * S + x) << 2;
        png.data[i + 3] = 0;
      }
    }
}

// legs
for (const dir of [-1, 1]) {
  for (let i = 0; i < 3; i++) {
    const lx = cx + dir * (150 - i * 42);
    line(lx, cy + 80, lx + dir * 14, cy + 160, 26, C.bodyDark);
  }
}

// body
ellipse(cx, cy, 165, 125, C.bodyDark);
ellipse(cx, cy, 156, 116, C.body);
ellipse(cx, cy + 48, 116, 58, C.bodyLight, 0.5);

// eyes
for (const dir of [-1, 1]) {
  ellipse(cx + dir * 58, cy - 28, 23, 28, C.eye);
  circle(cx + dir * 58 + 8, cy - 36, 8, C.white);
}

// smile
arc(cx, cy + 26, 26, 0.2 * Math.PI, 0.8 * Math.PI, 11, C.eye);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), PNG.sync.write(png));
console.log('build/icon.png written');
