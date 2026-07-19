// While the firmware rainbow animates, read every supported v2 command twice
// (400ms apart) and report which payload bytes changed — live LED color
// buffers will show up as changing bytes. Read-only.
// Usage: node tools/sweep-diff.js
const HID = require('node-hid');

const CMDS = [0x01, 0x03, 0x05, 0x0e, 0x10, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a,
  0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x26, 0x27, 0x28, 0x2a];

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

function readPacket(cmd) {
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(4, 4);
  buf[6] = cmd;
  buf.writeUInt16LE(checksum(buf, 8), 2);
  return buf;
}

let pending = null;
dev.on('data', (data) => {
  const b = Buffer.from(data);
  if (b[0] !== 0x22) return;
  if (pending) {
    const p = pending;
    pending = null;
    p(b);
  }
});

function request(cmd) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending = null;
      resolve(null);
    }, 800);
    pending = (b) => {
      clearTimeout(t);
      resolve(b);
    };
    dev.write(readPacket(cmd));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const cmd of CMDS) {
    const a = await request(cmd);
    await sleep(400);
    const b = await request(cmd);
    if (!a || !b) {
      console.log(`0x${cmd.toString(16)}: (no response)`);
      continue;
    }
    const lenA = a.readUInt16LE(4);
    const status = lenA > 1024 ? ` status=0x${(lenA >> 8).toString(16)}` : '';
    const payloadLen = Math.min(Math.max(lenA - 4, 0), 1012);
    let changed = [];
    for (let i = 0; i < payloadLen; i++) {
      if (a[8 + i] !== b[8 + i]) changed.push(i);
    }
    if (changed.length > 0) {
      const lo = changed[0];
      const hi = changed[changed.length - 1];
      console.log(
        `0x${cmd.toString(16)}: len=${payloadLen}${status} CHANGED ${changed.length} bytes @[${lo}..${hi}]`
      );
      console.log(`   A: ${a.slice(8 + lo, 8 + Math.min(hi + 1, lo + 48)).toString('hex')}`);
      console.log(`   B: ${b.slice(8 + lo, 8 + Math.min(hi + 1, lo + 48)).toString('hex')}`);
    } else {
      console.log(`0x${cmd.toString(16)}: len=${payloadLen}${status} static`);
    }
  }
  dev.close();
  process.exit(0);
}

main();
