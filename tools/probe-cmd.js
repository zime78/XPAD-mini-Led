// Generic read-probe: send a Sayo v2 command with given payload bytes and dump
// every response received within a window. READ ONLY — never writes settings.
// Usage: node tools/probe-cmd.js <cmdHex> [payloadHexBytes...]
// e.g.:  node tools/probe-cmd.js 11
//        node tools/probe-cmd.js 11 00
const HID = require('node-hid');

const VID = 0x3710;
const PID = 0x2507;
const PACKET = 1024;

const cmd = parseInt(process.argv[2], 16);
const payload = process.argv.slice(3).map((h) => parseInt(h, 16));
if (Number.isNaN(cmd)) {
  console.error('usage: node tools/probe-cmd.js <cmdHex> [payloadHex...]');
  process.exit(1);
}

function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  return sum;
}

const info = HID.devices().find(
  (d) => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff12
);
const dev = new HID.HID(info.path);

const buf = Buffer.alloc(PACKET);
buf[0] = 0x22;
buf[1] = 0x04;
buf.writeUInt16LE(payload.length + 4, 4);
buf[6] = cmd;
buf[7] = 0;
Buffer.from(payload).copy(buf, 8);
const used = 8 + payload.length + ((payload.length % 2) ? 1 : 0);
buf.writeUInt16LE(checksum(buf, used), 2);

console.log('req:', buf.slice(0, Math.max(12, used)).toString('hex'));

let count = 0;
dev.on('data', (data) => {
  const b = Buffer.from(data);
  if (b[0] !== 0x22) return;
  count++;
  const len = b.readUInt16LE(4);
  const rcmd = b[6];
  const idx = b[7];
  console.log(
    `resp #${count}: cmd=0x${rcmd.toString(16)} idx=${idx} len=${len} payload=${b
      .slice(8, Math.min(8 + Math.max(0, len - 4), 120))
      .toString('hex')}`
  );
});

dev.write(buf);
setTimeout(() => {
  console.log(`total responses: ${count}`);
  dev.close();
  process.exit(0);
}, 1200);
