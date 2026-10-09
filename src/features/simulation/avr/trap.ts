import type { CPU } from 'avr8js';

/** Serial TX: shim writes one byte per char. SRAM-safe (ATmega328P SRAM starts 0x100). */
export const SERIAL_TX_ADDR = 0x1f0;
/** Millis base: four consecutive LE bytes assemble millis() as LE32. */
export const MILLIS_ADDR = 0x1f1;
/** Wire TX framer: address, count, then bytes → one i2cWrite call. */
export const WIRE_TX_ADDR = 0x1f5;
/** Wire RX: address, count → i2cRead staged; reads pop staged bytes. */
export const WIRE_RX_ADDR = 0x1f9;

export interface MmioI2cSink {
  i2cWrite(address: number, bytes: number[]): void;
  i2cRead(address: number, count: number): number[];
}

export type MmioSink = {
  serialWrite(text: string): void;
  millis(): number;
} & MmioI2cSink;

/** Traps shim-core MMIO writes/reads. Malformed use is counted by the caller (Task 8). */
export function attachMmioTrap(cpu: CPU, sink: MmioSink): void {
  cpu.writeHooks[SERIAL_TX_ADDR] = (value) => {
    sink.serialWrite(String.fromCharCode(value & 0xff));
  };
  for (let i = 0; i < 4; i++) {
    const addr = MILLIS_ADDR + i;
    cpu.readHooks[addr] = () => (sink.millis() >>> (8 * i)) & 0xff;
  }
  type TxState = 'idle' | 'haveAddress' | 'haveCount';
  let txState: TxState = 'idle';
  let txAddress = 0;
  let txRemaining = 0;
  const txBytes: number[] = [];
  cpu.writeHooks[WIRE_TX_ADDR] = (value) => {
    const byte = value & 0xff;
    if (txState === 'idle') {
      txAddress = byte;
      txState = 'haveAddress';
      return;
    }
    if (txState === 'haveAddress') {
      txRemaining = byte;
      txBytes.length = 0;
      txState = 'haveCount';
      if (txRemaining === 0) {
        sink.i2cWrite(txAddress, []);
        txState = 'idle';
      }
      return;
    }
    txBytes.push(byte);
    txRemaining -= 1;
    if (txRemaining <= 0) {
      sink.i2cWrite(txAddress, [...txBytes]);
      txState = 'idle';
    }
  };
  let rxStaged: number[] = [];
  let rxState: 'idle' | 'haveAddress' = 'idle';
  let rxAddress = 0;
  cpu.writeHooks[WIRE_RX_ADDR] = (value) => {
    const byte = value & 0xff;
    if (rxState === 'idle') {
      rxAddress = byte;
      rxState = 'haveAddress';
      return;
    }
    rxStaged = sink.i2cRead(rxAddress, byte);
    rxState = 'idle';
  };
  cpu.readHooks[WIRE_RX_ADDR] = () => rxStaged.shift() ?? 0x00;
}
