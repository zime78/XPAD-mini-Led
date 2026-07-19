// Test per-LED write via cmd 0x27: write a color pattern, read back to verify.
// RAM-only (no Save cmd) — replug resets everything.
// Usage: node tools/test-leds.js [rr gg bb]  (default red)
const HID = require('node-hid');

const VID = 0x3710;
const PID = 0x2507;
const PACKET = 1024;
const LED_COUNT = 13;

const r = parseInt(process.argv[2] ?? 'ff', 16);
const g = parseInt(process.argv[3] ?? '00', 16);
const b = parseInt(process.argv[4] ?? '00', 16);

function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  return sum;
}

const info = HID.devices().find(
  (d) => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff12
);
const dev = new HID.HID(info.path);

function buildPacket(cmd, payload) {
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(payload.length + 4, 4);
  buf[6] = cmd;
  buf[7] = 0;
  payload.copy(buf, 8);
  const used = 8 + payload.length + (payload.length % 2);
  buf.writeUInt16LE(checksum(buf, used), 2);
  return buf;
}

const responses = [];
dev.on('data', (data) => {
  const buf = Buffer.from(data);
  if (buf[0] !== 0x22 || buf[6] !== 0x27) return;
  const len = buf.readUInt16LE(4);
  responses.push(buf.slice(8, 8 + Math.max(0, len - 4)).toString('hex'));
});

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  // Write pattern: assume [R,G,B,0] per LED
  const payload = Buffer.alloc(LED_COUNT * 4);
  for (let i = 0; i < LED_COUNT; i++) {
    payload[i * 4] = r;
    payload[i * 4 + 1] = g;
    payload[i * 4 + 2] = b;
    payload[i * 4 + 3] = 0;
  }
  console.log(`write 0x27: ${LED_COUNT} LEDs = #${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
  dev.write(buildPacket(0x27, payload));
  await sleep(150);
  // Read back
  dev.write(buildPacket(0x27, Buffer.alloc(0)));
  await sleep(400);
  console.log('readback:', responses[responses.length - 1] ?? '(none)');
  dev.close();
  process.exit(0);
}

main();
