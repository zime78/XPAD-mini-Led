// Verify LCD streaming: write a Clawd frame via cmd 0x25, then read the
// framebuffer back and save it as a PNG for inspection.
// Usage: node tools/readback.js
const fs = require('node:fs');
const path = require('node:path');
const HID = require('node-hid');
const { PNG } = require('pngjs');

const VID = 0x3710;
const PID = 0x2507;
const WIDTH = 240;
const HEIGHT = 135;
const FB_BYTES = WIDTH * HEIGHT * 2;
const PACKET = 1024;
const CHUNK = PACKET - 12;

function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  return sum;
}

const info = HID.devices().find(
  (d) => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff12
);
const dev = new HID.HID(info.path);

// Load one frame (happy/0) as RGB565
const png = PNG.sync.read(
  fs.readFileSync(path.join(__dirname, '..', 'assets', 'clawd', 'happy', '0.png'))
);
const frame = Buffer.alloc(FB_BYTES);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const si = (y * png.width + x) << 2;
    const v =
      ((png.data[si] >> 3) << 11) | ((png.data[si + 1] >> 2) << 5) | (png.data[si + 2] >> 3);
    frame.writeUInt16LE(v, (y * WIDTH + x) * 2);
  }
}

function writeChunk(off) {
  const n = Math.min(CHUNK, FB_BYTES - off);
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(n + 8, 4);
  buf[6] = 0x25;
  buf[7] = 0;
  buf.writeUInt32LE(off, 8);
  frame.copy(buf, 12, off, off + n);
  buf.writeUInt16LE(checksum(buf, n + 12), 2);
  dev.write(buf);
}

function requestRead(off) {
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(8, 4); // len: offset payload (4) + 4
  buf[6] = 0x25;
  buf[7] = 0;
  buf.writeUInt32LE(off, 8);
  buf.writeUInt16LE(checksum(buf, 12), 2);
  dev.write(buf);
}

const fb = Buffer.alloc(FB_BYTES);
const got = new Set();

dev.on('data', (data) => {
  const buf = Buffer.from(data);
  if (buf[0] !== 0x22 || buf[6] !== 0x25) return;
  const off = buf.readUInt32LE(8);
  if (off % CHUNK !== 0 || off >= FB_BYTES) return;
  const n = Math.min(CHUNK, FB_BYTES - off);
  buf.copy(fb, off, 12, 12 + n);
  got.add(off);
});

async function main() {
  // Write the full frame
  for (let off = 0; off < FB_BYTES; off += CHUNK) writeChunk(off);
  await new Promise((r) => setTimeout(r, 100));
  // Read it back
  for (let off = 0; off < FB_BYTES; off += CHUNK) requestRead(off);
  await new Promise((r) => setTimeout(r, 800));

  const total = Math.ceil(FB_BYTES / CHUNK);
  console.log(`chunks received: ${got.size}/${total}`);

  const out = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const v = fb.readUInt16LE(i * 2);
    out.data[i * 4] = ((v >> 11) & 0x1f) << 3;
    out.data[i * 4 + 1] = ((v >> 5) & 0x3f) << 2;
    out.data[i * 4 + 2] = (v & 0x1f) << 3;
    out.data[i * 4 + 3] = 255;
  }
  const outPath = path.join(__dirname, '..', 're', 'readback.png');
  fs.writeFileSync(outPath, PNG.sync.write(out));
  console.log('saved', outPath);
  dev.close();
  process.exit(0);
}

main();
