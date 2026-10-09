import type { CPU } from 'avr8js';

/** Serial TX: shim writes one byte per char. SRAM-safe (ATmega328P SRAM starts 0x100). */
export const SERIAL_TX_ADDR = 0x1f0;
/** Millis base: four consecutive LE bytes assemble millis() as LE32. */
export const MILLIS_ADDR = 0x1f1;

export interface MmioSink {
  serialWrite(text: string): void;
  millis(): number;
}

/** Traps shim-core MMIO writes/reads. Malformed use is counted by the caller (Task 8). */
export function attachMmioTrap(cpu: CPU, sink: MmioSink): void {
  cpu.writeHooks[SERIAL_TX_ADDR] = (value) => {
    sink.serialWrite(String.fromCharCode(value & 0xff));
  };
  for (let i = 0; i < 4; i++) {
    const addr = MILLIS_ADDR + i;
    cpu.readHooks[addr] = () => (sink.millis() >>> (8 * i)) & 0xff;
  }
}
