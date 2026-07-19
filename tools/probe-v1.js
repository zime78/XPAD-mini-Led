// Probe the Sayo API v1 channel (usagePage 0xFF00, report 0x02) — read-only.
// Usage: node tools/probe-v1.js <cmdHex> [count]
// e.g.:  node tools/probe-v1.js 00      (MetaInfo)
//        node tools/probe-v1.js 10 4    (Light, ids 0..3)
const HID = require('node-hid');

const cmd = parseInt(process.argv[2] ?? '00', 16);
const count = parseInt(process.argv[3] ?? '1', 10);

const info = HID.devices().find(
  (d) => d.vendorId === 0x3710 && d.productId === 0x2507 && d.usagePage === 0xff00
);
if (!info) {
  console.error('v1 channel (0xFF00) not found');
  process.exit(1);
}
const dev = new HID.HID(info.path);

function readBuffer(id) {
  // [cmd, size=2, method=0(read), id] + checksum = (sum + 2) % 256
  const data = [cmd, 2, 0, id];
  const sum = (data.reduce((a, b) => a + b, 0) + 2) % 256;
  return Buffer.from([0x02, ...data, sum]); // leading report id for node-hid
}

let id = 0;
dev.on('data', (data) => {
  const b = Buffer.from(data);
  console.log(`resp id=${id}: status=0x${b[0].toString(16)} bytes=${b.slice(0, 40).toString('hex')}`);
  id++;
  if (id < count && b[0] !== 0xff && b[0] !== 0x03) {
    dev.write(readBuffer(id));
  } else {
    dev.close();
    process.exit(0);
  }
});

console.log(`v1 read cmd=0x${cmd.toString(16)}`);
dev.write(readBuffer(0));
setTimeout(() => {
  console.log('(timeout)');
  dev.close();
  process.exit(2);
}, 3000);
