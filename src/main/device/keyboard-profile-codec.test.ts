import { describe, expect, it } from 'vitest';
import type { KeyboardKeyCode } from '../../shared/types';
import {
  decodeKeyboardAction,
  KEY_ACTION_OFFSET,
  KEY_INFO_SIZE,
  KEY_OUTPUT_EXTENDED,
  KEY_OUTPUT_KEYBOARD,
  KEY_OUTPUT_TYPE_OFFSET,
  keyboardUsageForCode,
} from './keyboard-profile-codec';

describe('keyboard-profile-codec', () => {
  it.each([
    ['KeyA', 0x04],
    ['Digit0', 0x27],
    ['F16', 0x6b],
    ['ArrowLeft', 0x50],
  ] as Array<[KeyboardKeyCode, number]>)('%s HID usage를 실제 키 동작으로 해석한다', (keyCode, usage) => {
    const entry = makeEntry(KEY_OUTPUT_KEYBOARD, [0, usage, 0, 0]);
    expect(keyboardUsageForCode(keyCode)).toBe(usage);
    expect(decodeKeyboardAction(entry)).toEqual({ type: 'key', keyCode });
  });

  it.each([
    [14, 'MediaTrackPrevious'],
    [12, 'MediaPlayPause'],
    [15, 'MediaTrackNext'],
  ] as Array<[number, KeyboardKeyCode]>)('extended action %d를 미디어 키로 해석한다', (action, keyCode) => {
    expect(decodeKeyboardAction(makeEntry(KEY_OUTPUT_EXTENDED, [action, 0, 0, 0]))).toEqual({
      type: 'key',
      keyCode,
    });
  });

  it('수정키 조합은 임의 키로 추정하지 않고 미지원 동작으로 표시한다', () => {
    expect(decodeKeyboardAction(makeEntry(KEY_OUTPUT_KEYBOARD, [1, 0x04, 0, 0]))).toEqual({
      type: 'unsupported',
      description: '미지원 키 조합 (modifier=0x1, usage=0x4)',
    });
  });
});

function makeEntry(outputType: number, action: number[]): Buffer {
  const entry = Buffer.alloc(KEY_INFO_SIZE);
  entry.writeUInt32LE(outputType, KEY_OUTPUT_TYPE_OFFSET);
  Buffer.from(action).copy(entry, KEY_ACTION_OFFSET);
  return entry;
}
