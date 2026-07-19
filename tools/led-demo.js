// LED mapping demo: light each index 0..12 in white one at a time, then run a
// blue KITT scan for 5 seconds. Watch the pad to learn the physical order.
// Usage: node tools/led-demo.js
const HID = require('node-hid');

const VID = 0x3710;
const PID = 0x2507;
const PACKET = 1024;
const LED_COUNT = 13;

function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  return sum;
}

const info = HID.devices().find(
  (d) => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff12
);
const dev = new HID.HID(info.path);

function setLeds(colors) {
  const payload = Buffer.alloc(LED_COUNT * 4);
  colors.forEach((c, i) => {
    payload[i * 4] = c[0];
    payload[i * 4 + 1] = c[1];
    payload[i * 4 + 2] = c[2];
  });
  const buf = Buffer.alloc(PACKET);
  buf[0] = 0x22;
  buf[1] = 0x04;
  buf.writeUInt16LE(payload.length + 4, 4);
  buf[6] = 0x27;
  buf[7] = 0;
  payload.copy(buf, 8);
  buf.writeUInt16LE(checksum(buf, 8 + payload.length), 2);
  dev.write(buf);
}

const BLACK = [0, 0, 0];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Index sweep: watch which LED lights up for each index...');
  for (let i = 0; i < LED_COUNT; i++) {
    const colors = Array(LED_COUNT).fill(BLACK);
    colors[i] = [255, 255, 255];
    setLeds(colors);
    console.log(`  index ${i}`);
    await sleep(400);
  }

  console.log('Blue KITT scan for 5s...');
  const start = Date.now();
  const timer = setInterval(() => {
    const t = (Date.now() - start) / 1000;
    const pos = (t * 10) % LED_COUNT;
    const colors = [];
    for (let i = 0; i < LED_COUNT; i++) {
      let dist = pos - i;
      if (dist < 0) dist += LED_COUNT;
      const f = Math.max(0, 1 - dist / 4);
      colors.push([0, Math.round(60 * f * f), Math.round(255 * f * f)]);
    }
    setLeds(colors);
  }, 33);

  await sleep(5000);
  clearInterval(timer);
  setLeds(Array(LED_COUNT).fill(BLACK));
  await sleep(100);
  dev.close();
  console.log('Done. LEDs left dark (replug or profile switch restores defaults).');
  process.exit(0);
}

main();
