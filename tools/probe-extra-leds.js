// Probe for key LEDs beyond the 13 known entries of cmd 0x27:
// writes 20 entries — 0-12 black, 13=RED, 14=GREEN, 15=BLUE, 16-19 WHITE.
// RAM-only. Usage: node tools/probe-extra-leds.js
const HID = require('node-hid');

const PACKET = 1024;
function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  return sum;
}
const info = HID.devices().find(
  (d) => d.vendorId === 0x3710 && d.productId === 0x2507 && d.usagePage === 0xff12
);
const dev = new HID.HID(info.path);

function paint() {
  const payload = Buffer.alloc(20 * 4);
  payload[13 * 4] = 255; // 13 RED
  payload[14 * 4 + 1] = 255; // 14 GREEN
  payload[15 * 4 + 2] = 255; // 15 BLUE
  for (let i = 16; i < 20; i++) {
    payload[i * 4] = 255;
    payload[i * 4 + 1] = 255;
    payload[i * 4 + 2] = 255; // 16-19 WHITE
  }
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(payload.length + 4, 4);
  buf[6] = 0x27;
  payload.copy(buf, 8);
  buf.writeUInt16LE(checksum(buf, 8 + payload.length), 2);
  dev.write(buf);
}

// Also read back to see how many entries the device reports now.
dev.on('data', (data) => {
  const b = Buffer.from(data);
  if (b[0] !== 0x22 || b[6] !== 0x27) return;
  const len = b.readUInt16LE(4);
  console.log(`readback len=${len} payload=${b.slice(8, 8 + Math.min(len - 4, 96)).toString('hex')}`);
});

console.log('painting 20 entries: 13=RED 14=GREEN 15=BLUE 16-19=WHITE (15s)');
paint();
const t = setInterval(paint, 500);
setTimeout(() => {
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(4, 4);
  buf[6] = 0x27;
  buf.writeUInt16LE(checksum(buf, 8), 2);
  dev.write(buf);
}, 2000);
setTimeout(() => {
  clearInterval(t);
  dev.close();
  process.exit(0);
}, 15000);
