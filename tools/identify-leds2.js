// Definitive grouping test: indexes 0-6 dim WHITE, 7=RED, 8=GREEN, 9=BLUE,
// 10-12 OFF. If the three keys show R/G/B, keys are indexes 7-9.
// Usage: node tools/identify-leds2.js
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
  const payload = Buffer.alloc(13 * 4);
  for (let i = 0; i <= 6; i++) {
    payload[i * 4] = 30;
    payload[i * 4 + 1] = 30;
    payload[i * 4 + 2] = 30; // dim white
  }
  payload[7 * 4] = 255; // 7 RED
  payload[8 * 4 + 1] = 255; // 8 GREEN
  payload[9 * 4 + 2] = 255; // 9 BLUE
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(payload.length + 4, 4);
  buf[6] = 0x27;
  payload.copy(buf, 8);
  buf.writeUInt16LE(checksum(buf, 8 + payload.length), 2);
  dev.write(buf);
}

console.log('0-6 dim white | 7 RED | 8 GREEN | 9 BLUE | 10-12 off (30s)');
paint();
const t = setInterval(paint, 500);
setTimeout(() => {
  clearInterval(t);
  dev.close();
  process.exit(0);
}, 30000);
