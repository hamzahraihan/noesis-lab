import { describe, expect, it } from 'vitest';
import { I2CMode } from 'rp2040js';
import { attachRp2040I2cBridge, type Rp2040I2cPeripheral, type Rp2040I2cSink } from './i2c';

/**
 * The peripheral side of the bridge, recorded rather than emulated.
 *
 * The bridge's job is the handshake between `RPI2C`'s callbacks and the
 * engine's sink; a real machine only adds the register writes that lead to
 * the same calls, and the committed firmware's odd timing is the integration
 * test's business (see the browser smoke in the handoff).
 */
class FakePeripheral implements Rp2040I2cPeripheral {
  readonly calls: string[] = [];

  onStart = (_repeated: boolean): void => {};
  onConnect = (_address: number, _mode: I2CMode): void => {};
  onWriteByte = (_value: number): void => {};
  onReadByte = (_ack: boolean): void => {};
  onStop = (): void => {};

  completeStart(): void {
    this.calls.push('start');
  }
  completeConnect(ack: boolean): void {
    this.calls.push(`connect:${ack}`);
  }
  completeWrite(ack: boolean): void {
    this.calls.push(`write:${ack}`);
  }
  completeRead(value: number): void {
    this.calls.push(`read:${value}`);
  }
  completeStop(): void {
    this.calls.push('stop');
  }
}

function fakeSink(): {
  sink: Rp2040I2cSink;
  writes: { address: number; byte: number; isFirst: boolean }[];
  reads: { address: number; index: number }[];
  writeEnds: () => number;
} {
  const writes: { address: number; byte: number; isFirst: boolean }[] = [];
  const reads: { address: number; index: number }[] = [];
  let writeEnds = 0;
  return {
    sink: {
      writeByte: (address, byte, isFirst) => {
        writes.push({ address, byte, isFirst });
        return true;
      },
      readByte: (address, index) => {
        reads.push({ address, index });
        return 0x10 + index;
      },
      writeEnd: () => {
        writeEnds += 1;
      },
    },
    writes,
    reads,
    writeEnds: () => writeEnds,
  };
}

describe('rp2040 i2c bridge', () => {
  it('turns a write phase into one engine transaction per byte', () => {
    const peripheral = new FakePeripheral();
    const { sink, writes, writeEnds } = fakeSink();
    attachRp2040I2cBridge(peripheral, sink);

    peripheral.onStart(false);
    peripheral.onConnect(0x68, I2CMode.Write);
    peripheral.onWriteByte(0x00);
    peripheral.onWriteByte(0xaf);
    peripheral.onStop();

    expect(writes).toEqual([
      { address: 0x68, byte: 0x00, isFirst: true },
      { address: 0x68, byte: 0xaf, isFirst: false },
    ]);
    expect(writeEnds()).toBe(1);
    expect(peripheral.calls).toEqual([
      'start',
      'connect:true',
      'write:true',
      'write:true',
      'stop',
    ]);
  });

  it('keeps a register read on the write phase the device acknowledged', () => {
    const peripheral = new FakePeripheral();
    const { sink, reads, writeEnds } = fakeSink();
    attachRp2040I2cBridge(peripheral, sink);

    // Repeated start: the pointer write and the read are one transaction,
    // which is how `readfrom_mem` reaches a register.
    peripheral.onStart(false);
    peripheral.onConnect(0x68, I2CMode.Write);
    peripheral.onWriteByte(0x00);
    peripheral.onStart(true);
    peripheral.onConnect(0x68, I2CMode.Read);
    peripheral.onReadByte(true);
    peripheral.onReadByte(false);
    peripheral.onStop();

    expect(reads).toEqual([
      { address: 0x68, index: 0 },
      { address: 0x68, index: 1 },
    ]);
    // A read does not close a write transaction; only the write phase does.
    expect(writeEnds()).toBe(0);
    expect(peripheral.calls).toEqual([
      'start',
      'connect:true',
      'write:true',
      'start',
      'connect:true',
      'read:16',
      'read:17',
      'stop',
    ]);
  });
});
