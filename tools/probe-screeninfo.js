// Safe read-only probe: send Sayo v2 ScreenInfo (cmd 0x02) to the XPAD Mini
// and parse the response. Verifies protocol framing against the real device.
// Usage: node tools/probe-screeninfo.js
const HID = require('node-hid');

const VID = 0x3710;
const PID = 0x2507;

function checksum(buf, usedLen) {
  let sum = 0;
  for (let i = 0; i < usedLen; i += 2) {
    sum = (sum + buf.readUInt16LE(i)) & 0xffff;
  }
  return sum;
}

const devices = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const fast = devices.find((d) => d.usagePage === 0xff12);
const slow = devices.find((d) => d.usagePage === 0xff11);
const info = fast ?? slow;
if (!info) {
  console.error('No vendor collection found');
  process.exit(1);
}
const packetSize = info.usagePage === 0xff12 ? 1024 : 64;
const reportId = info.usagePage === 0xff12 ? 0x22 : 0x21;
console.log(
  `Using usagePage 0x${info.usagePage.toString(16)} packet=${packetSize} reportId=0x${reportId.toString(16)}`
);

const dev = new HID.HID(info.path, { nonExclusive: true });

// Build ScreenInfo request: header only, no payload.
const buf = Buffer.alloc(packetSize);
buf[0] = reportId;
buf[1] = 0x04; // echo (ApplicationEcho, mirrored in response)
// len = payload(0) + 4
buf.writeUInt16LE(4, 4);
buf[6] = 0x02; // cmd: ScreenInfo
buf[7] = 0; // index
buf.writeUInt16LE(checksum(buf, 8), 2);

console.log('req head:', buf.slice(0, 12).toString('hex'));

const timeout = setTimeout(() => {
  console.error('No response within 2s');
  dev.close();
  process.exit(2);
}, 2000);

dev.on('data', (data) => {
  // node-hid strips nothing on Windows: data[0] is report id
  console.log('resp head:', Buffer.from(data.slice(0, 16)).toString('hex'));
  const echo = data[1];
  const cmd = data[6];
  if (echo !== 0x04 || cmd !== 0x02) {
    console.log('(unrelated packet, waiting...)');
    return;
  }
  clearTimeout(timeout);
  const width = data.readUInt16LE(8);
  const height = data.readUInt16LE(10);
  const refresh = data[12];
  const vid = data.readUInt16LE(20);
  const pid = data.readUInt16LE(22);
  console.log(`ScreenInfo: ${width}x${height} @${refresh}Hz vid=0x${vid.toString(16)} pid=0x${pid.toString(16)}`);
  dev.close();
  process.exit(0);
});
dev.on('error', (err) => {
  console.error('HID error', err);
  process.exit(3);
});

dev.write(buf);
