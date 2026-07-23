import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultKeyboardSettings } from '../../shared/types';
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
      reportWriteHealth: (ok: boolean) => void;
    };
    device.bulk = bulk;
    device.connected = true;
    device.reportWriteHealth = () => {};
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

describe('XpadProtocol.selectProfile', () => {
  it('SystemInfo RAM 값만 바꾸고 readback으로 선택 프로필을 검증한다', async () => {
    const bulk = new FakeBulk(1);
    const device = new EventEmitter() as EventEmitter & {
      bulk: FakeBulk;
      connected: boolean;
      reportWriteHealth: (ok: boolean) => void;
    };
    device.bulk = bulk;
    device.connected = true;
    device.reportWriteHealth = () => {};
    const protocol = new XpadProtocol(device as unknown as XpadDevice);

    device.emit('connect');
    await vi.waitFor(() => expect(protocol.ready).toBe(true));
    const selected = await protocol.selectProfile(5);

    expect(selected).toBe(5);
    expect(protocol.activeProfileId).toBe(5);
    expect(bulk.profileIndex).toBe(4);
    expect(bulk.writtenSelections).toEqual([4]);
    expect(bulk.saveCommandSeen).toBe(false);
  });
});

describe('XpadProtocol.configureKeyboardAppMappings', () => {
  it('P2~P5 원본 12개를 먼저 백업하고 앱 슬롯만 F16~F18로 매핑한 뒤 복원한다', async () => {
    const bulk = new FakeBulk(2);
    const protocol = connectedProtocol(bulk);
    await vi.waitFor(() => expect(protocol.ready).toBe(true));
    const settings = createDefaultKeyboardSettings();
    settings.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'Discord',
      appPath: '/Applications/Discord.app',
    };
    settings.profiles[5].assignments.right = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };

    const applied = await protocol.configureKeyboardAppMappings(settings);

    expect(bulk.firstKeyWriteReadCount).toBe(12);
    expect(bulk.keyWrites.map(({ profileIndex, index }) => [profileIndex, index])).toEqual([
      [1, 0],
      [4, 2],
    ]);
    expect(keyUsage(bulk.entry(1, 0))).toBe(0x6b);
    expect(keyUsage(bulk.entry(4, 2))).toBe(0x6d);
    expect(bulk.keyReads.some(({ profileIndex }) => profileIndex === 0)).toBe(false);
    expect(bulk.profileIndex).toBe(2);
    expect(bulk.saveCommandSeen).toBe(false);

    await protocol.restoreKeyboardAppMappings(applied.backup);

    expect(keyUsage(bulk.entry(1, 0))).toBe(0x07);
    expect(keyUsage(bulk.entry(4, 2))).toBe(0x12);
    expect(bulk.profileIndex).toBe(2);
  });

  it('중간 쓰기 실패 시 이미 변경한 키를 역순 원복하고 원래 프로필로 돌아간다', async () => {
    const bulk = new FakeBulk(3);
    const protocol = connectedProtocol(bulk);
    await vi.waitFor(() => expect(protocol.ready).toBe(true));
    const settings = createDefaultKeyboardSettings();
    settings.profiles[2].assignments.left = {
      type: 'launch-app',
      appName: 'Discord',
      appPath: '/Applications/Discord.app',
    };
    settings.profiles[3].assignments.center = {
      type: 'launch-app',
      appName: 'Finder',
      appPath: '/System/Library/CoreServices/Finder.app',
    };
    bulk.failKeyWrite = { profileIndex: 2, index: 1 };

    await expect(protocol.configureKeyboardAppMappings(settings)).rejects.toThrow(
      'KeyInfo 1 쓰기에 실패했습니다.'
    );

    expect(keyUsage(bulk.entry(1, 0))).toBe(0x07);
    expect(keyUsage(bulk.entry(2, 1))).toBe(0x0b);
    expect(bulk.profileIndex).toBe(3);
    expect(bulk.saveCommandSeen).toBe(false);
  });
});

class FakeBulk extends EventEmitter {
  writtenSelections: number[] = [];
  saveCommandSeen = false;
  keyReads: Array<{ profileIndex: number; index: number }> = [];
  keyWrites: Array<{ profileIndex: number; index: number }> = [];
  firstKeyWriteReadCount: number | null = null;
  failKeyWrite: { profileIndex: number; index: number } | null = null;
  private entries = new Map<string, Buffer>();

  constructor(public profileIndex: number) {
    super();
    for (let profile = 0; profile < 5; profile++) {
      for (let index = 0; index < 3; index++) {
        this.entries.set(`${profile}:${index}`, makeKeyInfo(profile * 3 + index + 0x04));
      }
    }
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
      this.keyReads.push({ profileIndex: this.profileIndex, index });
      this.respond(command, index, this.entry(this.profileIndex, index));
      return;
    }
    if (command === 0x10 && payloadLength === KEY_INFO_SIZE) {
      if (
        this.failKeyWrite?.profileIndex === this.profileIndex &&
        this.failKeyWrite.index === index
      ) {
        this.failKeyWrite = null;
        throw new Error('injected KeyInfo write failure');
      }
      this.firstKeyWriteReadCount ??= this.keyReads.length;
      this.keyWrites.push({ profileIndex: this.profileIndex, index });
      this.entries.set(
        `${this.profileIndex}:${index}`,
        Buffer.from(packet.subarray(8, 8 + KEY_INFO_SIZE))
      );
    }
  }

  entry(profileIndex: number, index: number): Buffer {
    return Buffer.from(this.entries.get(`${profileIndex}:${index}`)!);
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

function connectedProtocol(bulk: FakeBulk): XpadProtocol {
  const device = new EventEmitter() as EventEmitter & {
    bulk: FakeBulk;
    connected: boolean;
    reportWriteHealth: (ok: boolean) => void;
  };
  device.bulk = bulk;
  device.connected = true;
  device.reportWriteHealth = () => {};
  const protocol = new XpadProtocol(device as unknown as XpadDevice);
  device.emit('connect');
  return protocol;
}

function keyUsage(entry: Buffer): number {
  return entry[KEY_ACTION_OFFSET + 1];
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
