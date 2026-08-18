// RAM-only 0x25 full-frame write benchmark. Save/flash 없음.
// Usage: node tools/bench-lcd-fps.js [seconds=4] [paced|max]
const HID = require('node-hid');

const VID = 0x3710;
const PID = 0x2507;
const WIDTH = 240;
const HEIGHT = 135;
const PACKET = 1024;
const CHUNK = PACKET - 12;
const FRAME_BYTES = WIDTH * HEIGHT * 2;
const seconds = Math.max(1, Number(process.argv[2] ?? 4));
const paced = (process.argv[3] ?? 'paced') !== 'max';

const info = HID.devices().find(
  (device) =>
    device.vendorId === VID &&
    device.productId === PID &&
    device.usagePage === 0xff12 &&
    device.usage === 0x02
);
if (!info?.path) {
  console.error('vendor bulk collection not found');
  process.exit(1);
}

const dev = new HID.HID(info.path);
const frame = Buffer.alloc(FRAME_BYTES, 0);

function checksum(buf, usedLen) {
  let sum = 0;
  for (let offset = 0; offset < usedLen; offset += 2) {
    sum = (sum + buf.readUInt16LE(offset)) & 0xffff;
  }
  return sum;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendFrame() {
  let sent = 0;
  for (let offset = 0; offset < frame.length; offset += CHUNK) {
    const length = Math.min(CHUNK, frame.length - offset);
    const buf = Buffer.alloc(PACKET);
    buf[0] = 0x22;
    buf[1] = 0x04;
    buf.writeUInt16LE(length + 8, 4);
    buf[6] = 0x25;
    buf[7] = 0;
    buf.writeUInt32LE(offset, 8);
    frame.copy(buf, 12, offset, offset + length);
    buf.writeUInt16LE(checksum(buf, length + 12), 2);
    dev.write(buf);
    sent += 1;
    if (paced && sent % 6 === 0) await delay(4);
  }
}

async function main() {
  console.log(
    `[lcd-bench] start seconds=${seconds} mode=${paced ? 'paced(app 6/4ms)' : 'max'} chunks=${Math.ceil(FRAME_BYTES / CHUNK)}`
  );
  const started = Date.now();
  let frames = 0;
  let windowStarted = started;
  let windowFrames = 0;
  while (Date.now() - started < seconds * 1000) {
    frame.writeUInt16LE(frames & 0xffff, 0);
    await sendFrame();
    frames += 1;
    windowFrames += 1;
    const elapsed = Date.now() - windowStarted;
    if (elapsed >= 1000) {
      console.log(
        `[lcd-bench] window=${(elapsed / 1000).toFixed(1)}s hidFps=${(windowFrames / (elapsed / 1000)).toFixed(1)}`
      );
      windowStarted = Date.now();
      windowFrames = 0;
    }
  }
  const totalSec = (Date.now() - started) / 1000;
  console.log(`[lcd-bench] done frames=${frames} hidFpsAvg=${(frames / totalSec).toFixed(1)}`);
  dev.close();
}

main().catch((error) => {
  console.error('[lcd-bench] failed', error);
  try {
    dev.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
