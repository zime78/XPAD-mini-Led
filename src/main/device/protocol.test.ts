import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { XpadDevice } from './hid';
import {
  KEY_ACTION_OFFSET,
  KEY_INFO_SIZE,
  KEY_OUTPUT_KEYBOARD,
  KEY_OUTPUT_TYPE_OFFSET,
} from './keyboard-profile-codec';
import { XpadProtocol } from './protocol';

describe('XpadProtocol.readKeyboardProfiles', () => {
  it('P1은 고정하고 P2~P5 실제 키를 읽은 뒤 조회 전 활성 프로필로 복원한다', async () => {
    const bulk = new FakeBulk(2);
    const device = new EventEmitter() as EventEmitter & {
      bulk: FakeBulk;
      connected: boolean;
    };
    device.bulk = bulk;
    device.connected = true;
    const protocol = new XpadProtocol(device as unknown as XpadDevice);

    device.emit('connect');
    await vi.waitFor(() => expect(protocol.ready).toBe(true));
    const snapshot = await protocol.readKeyboardProfiles();

    expect(snapshot.activeProfileId).toBe(3);
    expect(snapshot.profiles[1].assignments.left).toEqual({
      type: 'key',
      keyCode: 'MediaTrackPrevious',
    });
    expect(snapshot.profiles[5].assignments.right).toEqual({ type: 'key', keyCode: 'KeyO' });
    expect(bulk.profileIndex).toBe(2);
    expect(bulk.writtenSelections).toEqual([1, 2, 3, 4, 2]);
    expect(bulk.saveCommandSeen).toBe(false);
  });
});

class FakeBulk extends EventEmitter {
  writtenSelections: number[] = [];
  saveCommandSeen = false;

  constructor(public profileIndex: number) {
    super();
  }

  write(value: Buffer): void {
    const packet = Buffer.from(value);
    const command = packet[6];
    const index = packet[7];
    const payloadLength = packet.readUInt16LE(4) - 4;
    if (command === 0x0d) this.saveCommandSeen = true;

    if (command === 0x02 && payloadLength === 44) {
      this.profileIndex = packet[8 + 5] & 0x0f;
      this.writtenSelections.push(this.profileIndex);
      return;
    }
    if (command === 0x02 && payloadLength === 0) {
      this.respond(command, index, makeSystemInfo(this.profileIndex));
      return;
    }
    if (command === 0x10 && payloadLength === 0) {
      this.respond(command, index, makeKeyInfo(this.profileIndex * 3 + index + 0x04));
    }
  }

  private respond(command: number, index: number, payload: Buffer): void {
    const packet = Buffer.alloc(1024);
    packet[0] = 0x22;
    packet.writeUInt16LE(payload.length + 4, 4);
    packet[6] = command;
    packet[7] = index;
    payload.copy(packet, 8);
    queueMicrotask(() => this.emit('data', packet));
  }
}

function makeSystemInfo(profileIndex: number): Buffer {
  const info = Buffer.alloc(44);
  info.writeUInt16LE(240, 0);
  info.writeUInt16LE(135, 2);
  info[4] = 60;
  info[5] = 0x50 | profileIndex;
  return info;
}

function makeKeyInfo(usage: number): Buffer {
  const entry = Buffer.alloc(KEY_INFO_SIZE);
  entry.writeUInt32LE(KEY_OUTPUT_KEYBOARD, KEY_OUTPUT_TYPE_OFFSET);
  entry[KEY_ACTION_OFFSET + 1] = usage;
  return entry;
}
