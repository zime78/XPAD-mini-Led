// Hunt for the key LED command (RAM-only, no Save):
//  - cmd 0x26: rewrite the config block read earlier with color -> ORANGE
//  - cmd 0x1D: write 3 entries RED / GREEN / BLUE
// Then read both back. Watch the pad: orange keys => 0x26; R/G/B keys => 0x1D.
// Usage: node tools/probe-key-leds.js
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

function packet(cmd, payload) {
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(payload.length + 4, 4);
  buf[6] = cmd;
  payload.copy(buf, 8);
  buf.writeUInt16LE(checksum(buf, 8 + payload.length + (payload.length % 2)), 2);
  return buf;
}

dev.on('data', (data) => {
  const b = Buffer.from(data);
  if (b[0] !== 0x22) return;
  const len = b.readUInt16LE(4);
  console.log(
    `resp cmd=0x${b[6].toString(16)} len=${len} payload=${b.slice(8, 8 + Math.min(Math.max(len - 4, 0), 64)).toString('hex')}`
  );
});

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // 0x26 payload exactly as read earlier, with leading color -> ORANGE ff8000
  const cfg = Buffer.from(
    'ffffff0101003232ff00ffffffff00ff0000ffff00ff00ffff0000ffffff00ffffff00ffffff00ff0000000096729672',
    'hex'
  );
  cfg[0] = 0xff;
  cfg[1] = 0x80;
  cfg[2] = 0x00;
  console.log('write 0x26 with ORANGE color...');
  dev.write(packet(0x26, cfg));
  await sleep(300);

  // 0x1D: 3 entries RGB0: RED GREEN BLUE (then read back)
  const kd = Buffer.alloc(12);
  kd[0] = 255; // entry0 RED
  kd[5] = 255; // entry1 GREEN
  kd[10] = 255; // entry2 BLUE
  console.log('write 0x1d with RED/GREEN/BLUE...');
  dev.write(packet(0x1d, kd));
  await sleep(300);

  console.log('read 0x26 and 0x1d back...');
  dev.write(packet(0x26, Buffer.alloc(0)));
  await sleep(300);
  dev.write(packet(0x1d, Buffer.alloc(0)));
  await sleep(500);

  dev.close();
  process.exit(0);
}

main();
