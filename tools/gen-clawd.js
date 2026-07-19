// Generates Clawd (crab mascot) animation frames for the XPAD Mini's 240x136 LCD.
//
// Output:
//   assets/clawd/<anim>/<n>.png   - individual frames
//   assets/clawd/<anim>.gif       - animated GIF (uploadable as device screensaver)
//   assets/clawd/contact-sheet.png- all frames side by side for eyeballing
//
// Usage: node tools/gen-clawd.js
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const W = 240;
const H = 135; // panel is 240x135 (firmware-reported), not the marketed 136
const SS = 2; // supersample factor

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  bg: [0x10, 0x13, 0x19],
  bgGlow: [0x18, 0x1d, 0x28],
  floor: [0x0a, 0x0c, 0x10],
  body: [0xd9, 0x77, 0x57],
  bodyDark: [0xb2, 0x5b, 0x3e],
  bodyLight: [0xe8, 0x92, 0x6f],
  eye: [0x22, 0x1d, 0x1b],
  eyeLid: [0xb2, 0x5b, 0x3e],
  white: [0xff, 0xff, 0xff],
  zzz: [0x93, 0xa3, 0xb8],
  spark: [0xff, 0xd1, 0x66],
  alert: [0xef, 0x44, 0x44],
  green: [0x4a, 0xde, 0x80],
  blue: [0x60, 0xa5, 0xfa],
  mic: [0xcb, 0xd5, 0xe1],
  micDark: [0x64, 0x74, 0x8b],
  key: [0x2b, 0x33, 0x44],
  keyTop: [0x3c, 0x47, 0x5e],
};

// ---------------------------------------------------------------------------
// Tiny rasterizer (supersampled)
// ---------------------------------------------------------------------------
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Float64Array(w * h * 3);
  }

  set(x, y, rgb, alpha = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = this.data[i] * (1 - alpha) + rgb[0] * alpha;
    this.data[i + 1] = this.data[i + 1] * (1 - alpha) + rgb[1] * alpha;
    this.data[i + 2] = this.data[i + 2] * (1 - alpha) + rgb[2] * alpha;
  }

  fill(rgb) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.set(x, y, rgb);
  }

  /** Filled ellipse, optionally rotated (radians). */
  ellipse(cx, cy, rx, ry, rgb, rot = 0, alpha = 1) {
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const bound = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - bound); y <= cy + bound; y++) {
      for (let x = Math.floor(cx - bound); x <= cx + bound; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = dx * cos - dy * sin;
        const v = dx * sin + dy * cos;
        if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) {
          this.set(x, y, rgb, alpha);
        }
      }
    }
  }

  circle(cx, cy, r, rgb, alpha = 1) {
    this.ellipse(cx, cy, r, r, rgb, 0, alpha);
  }

  /** Thick line segment with round caps. */
  line(x0, y0, x1, y1, thickness, rgb, alpha = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + dx * t, y0 + dy * t, thickness / 2, rgb, alpha);
    }
  }

  /** Arc of a circle (for smiles): from a0 to a1 radians. */
  arc(cx, cy, r, a0, a1, thickness, rgb, alpha = 1) {
    const steps = Math.ceil(Math.abs(a1 - a0) * r * 2);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      this.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, thickness / 2, rgb, alpha);
    }
  }

  roundRect(x, y, w, h, r, rgb, alpha = 1) {
    for (let yy = Math.floor(y); yy < y + h; yy++) {
      for (let xx = Math.floor(x); xx < x + w; xx++) {
        const px = xx + 0.5;
        const py = yy + 0.5;
        const qx = Math.max(x + r - px, px - (x + w - r), 0);
        const qy = Math.max(y + r - py, py - (y + h - r), 0);
        if (Math.hypot(qx, qy) <= r) this.set(xx, yy, rgb, alpha);
      }
    }
  }

  /** Downsample SS x SS supersampled canvas into a PNG buffer. */
  toPngBuffer() {
    const w = this.w / SS;
    const h = this.h / SS;
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0,
          g = 0,
          b = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const i = ((y * SS + sy) * this.w + x * SS + sx) * 3;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
          }
        }
        const n = SS * SS;
        const o = (y * w + x) << 2;
        png.data[o] = Math.round(r / n);
        png.data[o + 1] = Math.round(g / n);
        png.data[o + 2] = Math.round(b / n);
        png.data[o + 3] = 255;
      }
    }
    return PNG.sync.write(png);
  }
}

// ---------------------------------------------------------------------------
// Clawd
// ---------------------------------------------------------------------------
/**
 * Draw one Clawd scene. All coordinates are in LCD pixels (240x136); the
 * canvas is supersampled so everything is multiplied by SS.
 *
 * pose options:
 *   bob         vertical body offset (px)
 *   eyes        'open' | 'closed' | 'wide' | 'happy' | 'focused'
 *   mouth       'none' | 'smile' | 'o' | 'flat'
 *   clawL/clawR { raise: px up, spread: px out, open: bool }
 *   legsPhase   0..1 wiggle phase
 *   extras      draw callback for scene-specific props, receives (cv, s, cx, cy)
 */
function drawClawd(cv, pose) {
  const s = SS;
  const cx = 120 * s;
  const groundY = 108 * s;
  const bob = (pose.bob ?? 0) * s;
  const cy = groundY - 34 * s + bob; // body center

  // background
  cv.fill(C.bg);
  // soft radial glow behind Clawd
  for (let i = 6; i >= 1; i--) {
    cv.circle(cx, cy + 6 * s, (26 + i * 7) * s, C.bgGlow, 0.12);
  }
  // floor shadow
  cv.ellipse(cx, groundY + 6 * s, 46 * s, 7 * s, C.floor, 0, 0.9);

  const clawL = { raise: 0, spread: 0, open: false, ...(pose.clawL ?? {}) };
  const clawR = { raise: 0, spread: 0, open: false, ...(pose.clawR ?? {}) };

  // legs (3 per side)
  const legPhase = pose.legsPhase ?? 0;
  for (let i = 0; i < 3; i++) {
    const wig = Math.sin((legPhase + i * 0.3) * Math.PI * 2) * 1.5 * s;
    const lx = cx - (30 - i * 9) * s;
    const rx = cx + (30 - i * 9) * s;
    const ly = groundY - 2 * s;
    cv.line(lx + 4 * s, cy + 18 * s, lx + wig, ly, 5 * s, C.bodyDark);
    cv.line(rx - 4 * s, cy + 18 * s, rx - wig, ly, 5 * s, C.bodyDark);
  }

  // arms + claws
  const drawClaw = (side, cfg) => {
    const dir = side === 'l' ? -1 : 1;
    const armRootX = cx + dir * 30 * s;
    const armRootY = cy + 4 * s;
    // crossed=true swings the claw to the opposite side, crossing the arms
    const clawX = cx + (cfg.crossed ? -dir : dir) * (44 + cfg.spread) * s;
    const clawY = cy - cfg.raise * s + 6 * s;
    cv.line(armRootX, armRootY, clawX, clawY, 7 * s, C.bodyDark);
    // pincer: big circle with a wedge notch cut out
    const r = 11 * s;
    if (cfg.crossed) {
      // claws drawn on top of the body: rim + lighter fill so they stand out
      cv.circle(clawX, clawY, r + 1.5 * s, C.bodyDark);
      cv.circle(clawX, clawY, r, C.bodyLight);
    } else {
      cv.circle(clawX, clawY, r, C.body);
    }
    const notchAngle = cfg.raise > 8 ? -Math.PI / 2 : dir > 0 ? 0 : Math.PI;
    const openAmount = cfg.open ? 0.55 : 0.3;
    const notchColor = cfg.crossed ? C.bodyDark : C.bg;
    cv.ellipse(
      clawX + Math.cos(notchAngle) * r * 0.8,
      clawY + Math.sin(notchAngle) * r * 0.8,
      r * openAmount,
      r * openAmount,
      notchColor
    );
  };
  const clawsFront = pose.clawsFront ?? false;
  if (!clawsFront) {
    drawClaw('l', clawL);
    drawClaw('r', clawR);
  }
  const drawFrontClaws = () => {
    if (!clawsFront) return;
    drawClaw('l', clawL);
    drawClaw('r', clawR);
  };

  // body: wide rounded blob
  cv.ellipse(cx, cy, 34 * s, 26 * s, C.bodyDark); // outline-ish rim
  cv.ellipse(cx, cy, 32 * s, 24 * s, C.body);
  cv.ellipse(cx, cy + 10 * s, 24 * s, 12 * s, C.bodyLight, 0, 0.5); // belly

  // eyes
  const eyeY = cy - 6 * s;
  const eyeDX = 12 * s;
  switch (pose.eyes ?? 'open') {
    case 'open':
      for (const dir of [-1, 1]) {
        cv.ellipse(cx + dir * eyeDX, eyeY, 4.5 * s, 5.5 * s, C.eye);
        cv.circle(cx + dir * eyeDX + 1.5 * s, eyeY - 1.5 * s, 1.5 * s, C.white);
      }
      break;
    case 'wide':
      for (const dir of [-1, 1]) {
        cv.ellipse(cx + dir * eyeDX, eyeY, 6 * s, 7 * s, C.white);
        cv.ellipse(cx + dir * eyeDX, eyeY, 3.5 * s, 4.5 * s, C.eye);
        cv.circle(cx + dir * eyeDX + 1.2 * s, eyeY - 1.2 * s, 1.2 * s, C.white);
      }
      break;
    case 'closed':
      for (const dir of [-1, 1]) {
        cv.arc(cx + dir * eyeDX, eyeY - 1 * s, 4.5 * s, 0.15 * Math.PI, 0.85 * Math.PI, 2.2 * s, C.eye);
      }
      break;
    case 'happy':
      for (const dir of [-1, 1]) {
        cv.arc(cx + dir * eyeDX, eyeY + 1.5 * s, 4.5 * s, 1.15 * Math.PI, 1.85 * Math.PI, 2.2 * s, C.eye);
      }
      break;
    case 'focused':
      for (const dir of [-1, 1]) {
        cv.ellipse(cx + dir * eyeDX, eyeY + 1 * s, 4.5 * s, 3.5 * s, C.eye);
        cv.roundRect(cx + dir * eyeDX - 4.5 * s, eyeY - 4 * s, 9 * s, 3 * s, 1 * s, C.body); // lid
        cv.circle(cx + dir * eyeDX + 1.3 * s, eyeY, 1.2 * s, C.white);
      }
      break;
  }

  // mouth
  const mouthY = cy + 6 * s;
  switch (pose.mouth ?? 'none') {
    case 'smile':
      cv.arc(cx, mouthY - 1 * s, 5 * s, 0.2 * Math.PI, 0.8 * Math.PI, 2 * s, C.eye);
      break;
    case 'o':
      cv.ellipse(cx, mouthY + 1 * s, 3 * s, 3.5 * s, C.eye);
      break;
    case 'flat':
      cv.line(cx - 4 * s, mouthY, cx + 4 * s, mouthY, 2 * s, C.eye);
      break;
  }

  drawFrontClaws();
  pose.extras?.(cv, s, cx, cy);
}

// ---------------------------------------------------------------------------
// Extras (scene props)
// ---------------------------------------------------------------------------
function zzz(count, t) {
  return (cv, s, cx, cy) => {
    for (let i = 0; i < count; i++) {
      const phase = (t + i / count) % 1;
      const x = cx + 42 * s + i * 3 * s + phase * 8 * s;
      const y = cy - 30 * s - phase * 22 * s;
      const size = (3 + i * 1.5 + phase * 2) * s;
      const a = 0.9 - phase * 0.6;
      // draw a "Z": top bar, diagonal, bottom bar
      cv.line(x - size, y - size, x + size, y - size, 1.6 * s, C.zzz, a);
      cv.line(x + size, y - size, x - size, y + size, 1.6 * s, C.zzz, a);
      cv.line(x - size, y + size, x + size, y + size, 1.6 * s, C.zzz, a);
    }
  };
}

function keyboardProp(pressSide) {
  return (cv, s, cx, cy) => {
    const kbY = cy + 34 * s;
    cv.roundRect(cx - 34 * s, kbY, 68 * s, 12 * s, 3 * s, C.key);
    for (let i = 0; i < 6; i++) {
      const pressed =
        (pressSide === 'l' && i === 1) || (pressSide === 'r' && i === 4);
      cv.roundRect(
        cx - 30 * s + i * 10.5 * s,
        kbY + 2 * s + (pressed ? 1.5 * s : 0),
        8 * s,
        5 * s,
        1.5 * s,
        pressed ? C.blue : C.keyTop
      );
    }
  };
}

function sparkles(t, color = C.spark) {
  return (cv, s, cx, cy) => {
    const spots = [
      [-52, -34], [50, -40], [-40, -52], [44, -18], [0, -56], [-58, -10],
    ];
    spots.forEach(([dx, dy], i) => {
      const phase = (t * 2 + i / spots.length) % 1;
      const a = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const r = (1 + a * 1.8) * s;
      const x = cx + dx * s;
      const y = cy + dy * s;
      cv.line(x - r * 2, y, x + r * 2, y, 1.2 * s, color, a);
      cv.line(x, y - r * 2, x, y + r * 2, 1.2 * s, color, a);
    });
  };
}

function exclamation(bounce) {
  return (cv, s, cx, cy) => {
    const x = cx + 48 * s;
    const y = cy - 44 * s - bounce * s;
    cv.roundRect(x - 3 * s, y - 12 * s, 6 * s, 16 * s, 3 * s, C.alert);
    cv.circle(x, y + 10 * s, 3.2 * s, C.alert);
  };
}

function checkmark() {
  return (cv, s, cx, cy) => {
    const x = cx + 50 * s;
    const y = cy - 46 * s;
    cv.line(x - 8 * s, y, x - 2 * s, y + 7 * s, 3.5 * s, C.green);
    cv.line(x - 2 * s, y + 7 * s, x + 10 * s, y - 8 * s, 3.5 * s, C.green);
  };
}

function bigX() {
  return (cv, s, cx, cy) => {
    const x = cx + 52 * s;
    const y = cy - 44 * s;
    cv.line(x - 8 * s, y - 8 * s, x + 8 * s, y + 8 * s, 3.5 * s, C.alert);
    cv.line(x + 8 * s, y - 8 * s, x - 8 * s, y + 8 * s, 3.5 * s, C.alert);
  };
}

function micProp() {
  return (cv, s, cx, cy) => {
    // mic held up by the right claw
    const x = cx + 52 * s;
    const y = cy - 24 * s;
    cv.roundRect(x - 2.5 * s, y, 5 * s, 16 * s, 2 * s, C.micDark);
    cv.ellipse(x, y - 4 * s, 7 * s, 9 * s, C.mic);
    // grill lines
    cv.line(x - 5 * s, y - 6 * s, x + 5 * s, y - 6 * s, 1 * s, C.micDark, 0.7);
    cv.line(x - 6 * s, y - 3 * s, x + 6 * s, y - 3 * s, 1 * s, C.micDark, 0.7);
  };
}

function soundWaves(t) {
  return (cv, s, cx, cy) => {
    const x = cx + 52 * s;
    const y = cy - 30 * s;
    for (let i = 0; i < 3; i++) {
      const phase = (t + i / 3) % 1;
      const r = (12 + phase * 14) * s;
      const a = (1 - phase) * 0.6;
      cv.arc(x, y, r, -0.45 * Math.PI, 0.1 * Math.PI, 1.4 * s, C.blue, a);
    }
  };
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------
const ANIMATIONS = {
  // Screensaver / idle: slow breathing, closed eyes, floating Zs
  sleeping: {
    fps: 4,
    frames: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const t = i / 8;
      return {
        bob: Math.sin(t * Math.PI * 2) * 1.5 + 1,
        eyes: 'closed',
        mouth: 'none',
        clawL: { raise: -4, spread: -6 },
        clawR: { raise: -4, spread: -6 },
        legsPhase: 0,
        extras: zzz(3, t),
      };
    }),
  },

  // Agent working: focused eyes, claws typing on a keyboard
  working: {
    fps: 8,
    frames: [0, 1, 2, 3].map((i) => ({
      bob: i % 2 === 0 ? 0 : -1,
      eyes: 'focused',
      mouth: 'flat',
      clawL: { raise: i % 2 === 0 ? -14 : -20, spread: -10, open: true },
      clawR: { raise: i % 2 === 0 ? -20 : -14, spread: -10, open: true },
      legsPhase: i / 4,
      extras: keyboardProp(i % 2 === 0 ? 'l' : 'r'),
    })),
  },

  // Needs attention: wide eyes, waving claws, bouncing exclamation mark
  alert: {
    fps: 6,
    frames: [0, 1, 2, 3].map((i) => ({
      bob: i % 2 === 0 ? -3 : 0,
      eyes: 'wide',
      mouth: 'o',
      clawL: { raise: i % 2 === 0 ? 16 : 10, spread: 4, open: true },
      clawR: { raise: i % 2 === 0 ? 10 : 16, spread: 4, open: true },
      legsPhase: i / 4,
      extras: exclamation(i % 2 === 0 ? 4 : 0),
    })),
  },

  // Done: happy bounce with sparkles
  happy: {
    fps: 6,
    frames: [0, 1, 2, 3, 4, 5].map((i) => {
      const t = i / 6;
      return {
        bob: -Math.abs(Math.sin(t * Math.PI * 2)) * 5,
        eyes: 'happy',
        mouth: 'smile',
        clawL: { raise: 14, spread: 2, open: true },
        clawR: { raise: 14, spread: 2, open: true },
        legsPhase: t,
        extras: (cv, s, cx, cy) => {
          sparkles(t)(cv, s, cx, cy);
          checkmark()(cv, s, cx, cy);
        },
      };
    }),
  },

  // Approve key press: one claw raised high, wink-ish happy face
  approve: {
    fps: 8,
    frames: [0, 1, 2, 3].map((i) => ({
      bob: i === 1 ? -4 : 0,
      eyes: 'happy',
      mouth: 'smile',
      clawL: { raise: -6, spread: -4 },
      clawR: { raise: i % 2 === 0 ? 22 : 18, spread: 6, open: true },
      legsPhase: i / 4,
      extras: checkmark(),
    })),
  },

  // Reject key press: claws crossed into an X in front, flat look
  reject: {
    fps: 8,
    frames: [0, 1].map((i) => ({
      bob: i === 0 ? 0 : -1,
      eyes: 'focused',
      mouth: 'none',
      clawsFront: true,
      clawL: { raise: i === 0 ? -2 : 0, spread: -30, crossed: true },
      clawR: { raise: i === 0 ? -2 : 0, spread: -30, crossed: true },
      legsPhase: 0,
      extras: bigX(),
    })),
  },

  // Dictation: holding a mic, sound waves
  dictation: {
    fps: 6,
    frames: [0, 1, 2, 3].map((i) => {
      const t = i / 4;
      return {
        bob: i % 2 === 0 ? 0 : -1,
        eyes: 'open',
        mouth: 'o',
        clawL: { raise: -6, spread: -4 },
        clawR: { raise: 16, spread: 8, open: true },
        legsPhase: t,
        extras: (cv, s, cx, cy) => {
          micProp()(cv, s, cx, cy);
          soundWaves(t)(cv, s, cx, cy);
        },
      };
    }),
  },
};

// ---------------------------------------------------------------------------
// Render everything
// ---------------------------------------------------------------------------
const outRoot = path.join(__dirname, '..', 'assets', 'clawd');
fs.mkdirSync(outRoot, { recursive: true });

const allFrames = []; // for contact sheet
for (const [name, anim] of Object.entries(ANIMATIONS)) {
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });

  const gif = GIFEncoder();
  anim.frames.forEach((pose, i) => {
    const cv = new Canvas(W * SS, H * SS);
    drawClawd(cv, pose);
    const pngBuf = cv.toPngBuffer();
    fs.writeFileSync(path.join(dir, `${i}.png`), pngBuf);

    // GIF frame from the downsampled RGBA data
    const png = PNG.sync.read(pngBuf);
    const rgba = new Uint8Array(png.data);
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, W, H, { palette, delay: Math.round(1000 / anim.fps) });

    allFrames.push({ name, index: i, png });
  });
  gif.finish();
  fs.writeFileSync(path.join(outRoot, `${name}.gif`), gif.bytes());
  console.log(`${name}: ${anim.frames.length} frames @ ${anim.fps}fps`);
}

// contact sheet: one row per animation
{
  const cols = Math.max(...Object.values(ANIMATIONS).map((a) => a.frames.length));
  const rows = Object.keys(ANIMATIONS).length;
  const pad = 4;
  const sheet = new PNG({
    width: cols * (W + pad) + pad,
    height: rows * (H + pad) + pad,
  });
  sheet.data.fill(30);
  let row = 0;
  for (const name of Object.keys(ANIMATIONS)) {
    const frames = allFrames.filter((f) => f.name === name);
    frames.forEach((f, col) => {
      const ox = pad + col * (W + pad);
      const oy = pad + row * (H + pad);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const src = (y * W + x) << 2;
          const dst = ((oy + y) * sheet.width + ox + x) << 2;
          sheet.data[dst] = f.png.data[src];
          sheet.data[dst + 1] = f.png.data[src + 1];
          sheet.data[dst + 2] = f.png.data[src + 2];
          sheet.data[dst + 3] = 255;
        }
      }
    });
    row++;
  }
  fs.writeFileSync(path.join(outRoot, 'contact-sheet.png'), PNG.sync.write(sheet));
  console.log('contact-sheet.png written');
}
