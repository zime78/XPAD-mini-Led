// Enumerate all HID interfaces of the Pulsar Lab XPAD Mini (VID 0x3710, PID 0x2507).
// Usage: node tools/hid-enum.js [--all]
const HID = require('node-hid');

const VID = 0x3710;
const PID = 0x2507;

const all = process.argv.includes('--all');
const devices = HID.devices().filter(
  (d) => all || (d.vendorId === VID && d.productId === PID)
);

if (devices.length === 0) {
  console.log('No matching HID devices found.');
  process.exit(1);
}

for (const d of devices.sort((a, b) => (a.path > b.path ? 1 : -1))) {
  console.log(
    [
      `vid=0x${d.vendorId.toString(16).padStart(4, '0')}`,
      `pid=0x${d.productId.toString(16).padStart(4, '0')}`,
      `usagePage=0x${(d.usagePage ?? 0).toString(16).padStart(4, '0')}`,
      `usage=0x${(d.usage ?? 0).toString(16).padStart(2, '0')}`,
      `interface=${d.interface}`,
      `product="${d.product}"`,
      `mfr="${d.manufacturer}"`,
    ].join(' ')
  );
  console.log(`  path=${d.path}`);
}
