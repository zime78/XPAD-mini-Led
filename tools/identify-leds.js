// Lights index 10 RED, 11 GREEN, 12 BLUE simultaneously (strip 0-9 dark)
// and holds for 20s so the physical positions can be identified.
// Usage: node tools/identify-leds.js
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

function setLeds() {
  const payload = Buffer.alloc(13 * 4);
  payload[10 * 4] = 255; // index 10: RED
  payload[11 * 4 + 1] = 255; // index 11: GREEN
  payload[12 * 4 + 2] = 255; // index 12: BLUE
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(payload.length + 4, 4);
  buf[6] = 0x27;
  payload.copy(buf, 8);
  buf.writeUInt16LE(checksum(buf, 8 + payload.length), 2);
  dev.write(buf);
}

console.log('index 10 = RED, index 11 = GREEN, index 12 = BLUE (holding 20s)');
setLeds();
const t = setInterval(setLeds, 500); // keep repainting in case firmware redraws
setTimeout(() => {
  clearInterval(t);
  dev.close();
  process.exit(0);
}, 20000);
