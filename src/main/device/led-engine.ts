import { ClaudeState, KeyId, KeyRoles, StateStyle } from '../../shared/types';
import { Rgb, XpadProtocol } from './protocol';

const BACKLIGHT_COUNT = 10;
const KEY_COUNT = 3;
const FPS = 30;
const KEY_ORDER: KeyId[] = ['left', 'center', 'right'];

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const APPROVE_GREEN: Rgb = { r: 0, g: 255, b: 0 };
const REJECT_RED: Rgb = { r: 255, g: 0, b: 0 };
const DICTATION_GLOW: Rgb = { r: 0x8c, g: 0xb4, b: 0xff }; // neutral blue-white

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return BLACK;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function scale(c: Rgb, f: number): Rgb {
  const clamped = Math.max(0, Math.min(1, f));
  return {
    r: c.r * clamped,
    g: c.g * clamped,
    b: c.b * clamped,
  };
}

/**
 * LEDs are linear emitters while our colors are sRGB-ish: without gamma, dim
 * values glow far too bright (a 15% tail reads as "on") and mixed colors wash
 * out (#dc2626 turns pink). Applied once, at the final output step.
 */
const GAMMA = 2.2;

function gammaCorrect(c: Rgb): Rgb {
  return {
    r: Math.round(255 * Math.pow(Math.max(0, c.r) / 255, GAMMA)),
    g: Math.round(255 * Math.pow(Math.max(0, c.g) / 255, GAMMA)),
    b: Math.round(255 * Math.pow(Math.max(0, c.b) / 255, GAMMA)),
  };
}

/**
 * The 13 LEDs as a physical ring: backlight strip left -> right, then key
 * LEDs right -> center -> left, closing the loop back at the strip's start.
 */
const RING_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 11, 10];

/** Pre-gamma level that lands at ~5% output after gamma (0.05 would round to 0). */
const ORBIT_BASE = Math.pow(0.05, 1 / GAMMA);

/**
 * Renders the current Claude state as LED animation frames at 30 Hz and hands
 * them to the protocol layer.
 *
 *  - scan:  a bright dot with a trailing fade sweeping left -> right (working)
 *  - pulse: smooth sine breathing (done)
 *  - flash: hard 2 Hz on/off (attention)
 *  - steady / off
 */
export class LedEngine {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private state: ClaudeState = 'idle';
  private styles: Record<ClaudeState, StateStyle>;
  private keyRoles: KeyRoles = {};
  private overlay: 'orbit' | null = null;
  private brightness = 1;

  constructor(
    private protocol: XpadProtocol,
    styles: Record<ClaudeState, StateStyle>
  ) {
    this.styles = styles;
  }

  setStyles(styles: Record<ClaudeState, StateStyle>): void {
    this.styles = styles;
  }

  setKeyRoles(roles: KeyRoles): void {
    this.keyRoles = roles;
  }

  /** Driven by the LCD engine's active animation (e.g. 'building' -> orbit). */
  setOverlay(overlay: 'orbit' | null): void {
    this.overlay = overlay;
  }

  setBrightness(brightness: number): void {
    this.brightness = Math.max(0, Math.min(1, brightness));
  }

  setState(state: ClaudeState): void {
    if (state === this.state) return;
    this.state = state;
    this.startedAt = Date.now();
    this.renderFrame();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.renderFrame(), 1000 / FPS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private renderFrame(): void {
    const style = this.styles[this.state];
    const t = (Date.now() - this.startedAt) / 1000;
    const color = hexToRgb(style.color);

    if (this.overlay === 'orbit' && this.state === 'working') {
      this.renderOrbit(t, color);
      return;
    }

    let backlight: Rgb[];
    let brightness = 1;

    switch (style.effect) {
      case 'off':
        backlight = Array(BACKLIGHT_COUNT).fill(BLACK);
        brightness = 0;
        break;
      case 'steady':
        backlight = Array(BACKLIGHT_COUNT).fill(color);
        break;
      case 'pulse': {
        brightness = 0.02 + 0.98 * (0.5 + 0.5 * Math.sin(t * Math.PI)); // ~0.5 Hz breathe
        backlight = Array(BACKLIGHT_COUNT).fill(scale(color, brightness));
        break;
      }
      case 'flash': {
        brightness = Math.floor(t * 4) % 2 === 0 ? 1 : 0; // 2 Hz
        backlight = Array(BACKLIGHT_COUNT).fill(scale(color, brightness));
        break;
      }
      case 'scan': {
        // Dot sweeping left -> right with a fading tail. No wrap: the dot and
        // its tail run off the right edge, then the sweep restarts at left.
        const speed = 12; // LEDs per second
        const span = BACKLIGHT_COUNT + 4; // let the tail fully exit
        const pos = (t * speed) % span;
        backlight = Array.from({ length: BACKLIGHT_COUNT }, (_, i) => {
          const dist = pos - i;
          if (dist < 0) return BLACK; // nothing ahead of the dot
          const f = Math.max(0, 1 - dist / 4);
          return scale(color, f * f);
        });
        // Keys glow softly while scanning (post-gamma this is a faint tint).
        brightness = 0.25;
        break;
      }
    }

    const keys = this.renderKeys(style, color, brightness);
    this.protocol.setLeds(
      backlight.map((c) => this.output(c)),
      keys.map((c) => this.output(c))
    );
  }

  /** Final output step: global brightness, then gamma. */
  private output(c: Rgb): Rgb {
    return gammaCorrect(this.brightness === 1 ? c : scale(c, this.brightness));
  }

  /**
   * 'building' overlay: every LED holds a ~5% base glow while a full-bright
   * dot with a short tail orbits the RING_ORDER loop.
   */
  private renderOrbit(t: number, color: Rgb): void {
    const speed = 8; // ring positions per second (~1.6 s per lap)
    const n = RING_ORDER.length;
    const pos = (t * speed) % n;
    const levels = new Array<number>(n).fill(ORBIT_BASE);
    for (let slot = 0; slot < n; slot++) {
      const dist = (pos - slot + n) % n; // how far this LED trails the dot
      if (dist < 2) {
        const f = (1 - dist / 2) ** 2;
        levels[RING_ORDER[slot]] = Math.max(ORBIT_BASE, f);
      }
    }
    const all = levels.map((f) => this.output(scale(color, f)));
    this.protocol.setLeds(all.slice(0, BACKLIGHT_COUNT), all.slice(BACKLIGHT_COUNT));
  }

  /**
   * Key LEDs are role-aware:
   *  - attention: approve key solid green, reject key solid red (steady while
   *    the strip flashes), dictation key dark
   *  - idle: dictation key glows blue-white so it's findable, rest dark
   *  - other states: keys follow the effect brightness/color
   */
  private renderKeys(style: StateStyle, color: Rgb, brightness: number): Rgb[] {
    if (this.state === 'attention') {
      return KEY_ORDER.map((keyId) => {
        if (keyId === this.keyRoles.approve) return APPROVE_GREEN;
        if (keyId === this.keyRoles.reject) return REJECT_RED;
        return BLACK;
      });
    }
    if (this.state === 'idle') {
      return KEY_ORDER.map((keyId) =>
        keyId === this.keyRoles.dictation ? DICTATION_GLOW : BLACK
      );
    }
    return Array(KEY_COUNT).fill(
      style.effect === 'off' ? BLACK : scale(color, brightness)
    );
  }
}
