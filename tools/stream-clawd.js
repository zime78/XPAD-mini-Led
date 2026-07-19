// Stream a Clawd animation to the XPAD Mini's LCD via Sayo v2 cmd 0x25.
// Usage: node tools/stream-clawd.js [anim] [seconds]
const fs = require('node:fs');
const path = require('node:path');
const HID = require('node-hid');
const { PNG } = require('pngjs');

const VID = 0x3710;
const PID = 0x2507;
const WIDTH = 240;
const HEIGHT = 135; // firmware-reported panel size

const anim = process.argv[2] ?? 'happy';
const seconds = Number(process.argv[3] ?? 5);

// Load frames, convert RGBA (240x136 source; drop last row) -> RGB565 LE
const dir = path.join(__dirname, '..', 'assets', 'clawd', anim);
const frames = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .sort((a, b) => parseInt(a) - parseInt(b))
  .map((f) => {
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
    const out = Buffer.alloc(WIDTH * HEIGHT * 2);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const si = (y * png.width + x) << 2;
        const r = png.data[si] >> 3;
        const g = png.data[si + 1] >> 2;
        const b = png.data[si + 2] >> 3;
        out.writeUInt16LE((r << 11) | (g << 5) | b, (y * WIDTH + x) * 2);
      }
    }
    return out;
  });
console.log(`Loaded ${frames.length} frames of "${anim}"`);

const info = HID.devices().find(
  (d) => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff12
);
if (!info) {
  console.error('Fast vendor collection not found');
  process.exit(1);
}
const dev = new HID.HID(info.path);
const PACKET = 1024;
const CHUNK = PACKET - 12;

function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  return sum;
}

function sendFrame(rgb565) {
  for (let off = 0; off < rgb565.length; off += CHUNK) {
    const n = Math.min(CHUNK, rgb565.length - off);
    const buf = Buffer.alloc(PACKET);
    buf[0] = 0x22;
    buf[1] = 0x04; // ApplicationEcho
    buf.writeUInt16LE(n + 4 + 4, 4); // len = payload(offset4 + pixels) + 4
    buf[6] = 0x25;
    buf[7] = 0;
    buf.writeUInt32LE(off, 8);
    rgb565.copy(buf, 12, off, off + n);
    buf.writeUInt16LE(checksum(buf, n + 12), 2);
    dev.write(buf);
  }
}

const fps = { sleeping: 4, working: 8, alert: 6, happy: 6, approve: 8, reject: 8, dictation: 6 }[anim] ?? 6;
let i = 0;
console.log(`Streaming at ${fps}fps for ${seconds}s...`);
const timer = setInterval(() => {
  try {
    sendFrame(frames[i % frames.length]);
    i++;
  } catch (err) {
    console.error('write failed:', err.message);
    clearInterval(timer);
    process.exit(2);
  }
}, 1000 / fps);

setTimeout(() => {
  clearInterval(timer);
  dev.close();
  console.log(`Done: streamed ${i} frames.`);
  process.exit(0);
}, seconds * 1000);
