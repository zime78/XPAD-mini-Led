import type {
  KeyboardAction,
  KeyboardKeyCode,
  KeyboardSlot,
} from '../../shared/types';

export const KEY_INFO_SIZE = 56;
export const KEY_OUTPUT_TYPE_OFFSET = 16;
export const KEY_ACTION_OFFSET = 20;
export const KEY_OUTPUT_KEYBOARD = 0;
export const KEY_OUTPUT_EXTENDED = 3;

const KEYBOARD_USAGE_BY_CODE = new Map<KeyboardKeyCode, number>();
const KEYBOARD_CODE_BY_USAGE = new Map<number, KeyboardKeyCode>();

for (let offset = 0; offset < 26; offset++) {
  addUsage(`Key${String.fromCharCode(65 + offset)}` as KeyboardKeyCode, 0x04 + offset);
}
for (let digit = 1; digit <= 9; digit++) {
  addUsage(`Digit${digit}` as KeyboardKeyCode, 0x1d + digit);
}
addUsage('Digit0', 0x27);

const SIMPLE_USAGES: Array<[KeyboardKeyCode, number]> = [
  ['Enter', 0x28],
  ['Escape', 0x29],
  ['Backspace', 0x2a],
  ['Tab', 0x2b],
  ['Space', 0x2c],
  ['Minus', 0x2d],
  ['Equal', 0x2e],
  ['BracketLeft', 0x2f],
  ['BracketRight', 0x30],
  ['Backslash', 0x31],
  ['Semicolon', 0x33],
  ['Quote', 0x34],
  ['Backquote', 0x35],
  ['Comma', 0x36],
  ['Period', 0x37],
  ['Slash', 0x38],
  ['CapsLock', 0x39],
  ['Home', 0x4a],
  ['PageUp', 0x4b],
  ['Delete', 0x4c],
  ['End', 0x4d],
  ['PageDown', 0x4e],
  ['ArrowRight', 0x4f],
  ['ArrowLeft', 0x50],
  ['ArrowDown', 0x51],
  ['ArrowUp', 0x52],
];
for (const [code, usage] of SIMPLE_USAGES) addUsage(code, usage);
for (let fn = 1; fn <= 12; fn++) addUsage(`F${fn}` as KeyboardKeyCode, 0x39 + fn);
for (let fn = 13; fn <= 24; fn++) addUsage(`F${fn}` as KeyboardKeyCode, 0x5b + fn);

const MEDIA_ACTIONS = new Map<number, KeyboardKeyCode>([
  [14, 'MediaTrackPrevious'],
  [12, 'MediaPlayPause'],
  [15, 'MediaTrackNext'],
]);

export const SLOT_KEY_INFO_INDEX: Record<KeyboardSlot, number> = {
  left: 0,
  center: 1,
  right: 2,
};

export const SLOT_SHORTCUT_KEY: Record<KeyboardSlot, KeyboardKeyCode> = {
  left: 'F16',
  center: 'F17',
  right: 'F18',
};

export function decodeKeyboardAction(entry: Buffer): KeyboardAction {
  if (entry.length !== KEY_INFO_SIZE) {
    return { type: 'unsupported', description: `알 수 없는 KeyInfo ${entry.length}바이트` };
  }

  const outputType = entry.readUInt32LE(KEY_OUTPUT_TYPE_OFFSET);
  const action = entry.subarray(KEY_ACTION_OFFSET, KEY_ACTION_OFFSET + 4);
  if (outputType === KEY_OUTPUT_KEYBOARD) {
    const modifier = action[0];
    const usage = action[1];
    const keyCode = KEYBOARD_CODE_BY_USAGE.get(usage);
    if (modifier === 0 && action[2] === 0 && action[3] === 0 && keyCode) {
      return { type: 'key', keyCode };
    }
    return {
      type: 'unsupported',
      description: `미지원 키 조합 (modifier=0x${modifier.toString(16)}, usage=0x${usage.toString(16)})`,
    };
  }

  if (outputType === KEY_OUTPUT_EXTENDED) {
    const keyCode = MEDIA_ACTIONS.get(action[0]);
    if (keyCode && action[1] === 0 && action[2] === 0 && action[3] === 0) {
      return { type: 'key', keyCode };
    }
  }

  return {
    type: 'unsupported',
    description: `미지원 장치 동작 (output=${outputType}, action=${action.toString('hex')})`,
  };
}

export function keyboardUsageForCode(keyCode: KeyboardKeyCode): number | null {
  return KEYBOARD_USAGE_BY_CODE.get(keyCode) ?? null;
}

function addUsage(code: KeyboardKeyCode, usage: number): void {
  KEYBOARD_USAGE_BY_CODE.set(code, usage);
  KEYBOARD_CODE_BY_USAGE.set(usage, code);
}
