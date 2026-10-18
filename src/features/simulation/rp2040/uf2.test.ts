import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeUf2 } from './uf2';

function block(addr: number, payload: Uint8Array, blockNo: number, total: number): Uint8Array {
  const out = new Uint8Array(512);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x0a324655, true);
  view.setUint32(4, 0x9e5d5157, true);
  view.setUint32(8, 0x00002000, true); // familyID present
  view.setUint32(12, addr, true);
  view.setUint32(16, payload.length, true);
  view.setUint32(20, blockNo, true);
  view.setUint32(24, total, true);
  view.setUint32(28, 0xe48bff56, true); // RP2040 family
  out.set(payload, 32);
  view.setUint32(508, 0x0ab16f30, true);
  return out;
}

describe('uf2 decoder', () => {
  it('assembles blocks into a contiguous image with its base address', () => {
    const first = new Uint8Array([1, 2, 3, 4]);
    const second = new Uint8Array([5, 6]);
    const file = new Uint8Array(1024);
    file.set(block(0x10000000, first, 0, 2), 0);
    file.set(block(0x10000004, second, 1, 2), 512);
    const image = decodeUf2(file);
    expect(image.baseAddress).toBe(0x10000000);
    expect(Array.from(image.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('places out-of-order blocks at their addresses', () => {
    const file = new Uint8Array(1024);
    file.set(block(0x10000004, new Uint8Array([5, 6]), 1, 2), 0);
    file.set(block(0x10000000, new Uint8Array([1, 2, 3, 4]), 0, 2), 512);
    const image = decodeUf2(file);
    expect(image.baseAddress).toBe(0x10000000);
    expect(Array.from(image.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects a payload larger than a block can carry', () => {
    expect(() => decodeUf2(block(0x10000000, new Uint8Array(477), 0, 1))).toThrow(/UF2/);
  });

  it('rejects a corrupt block and a partial block', () => {
    const good = block(0x10000000, new Uint8Array([9]), 0, 1);
    const corrupt = good.slice();
    corrupt[0] = 0;
    expect(() => decodeUf2(corrupt)).toThrow(/UF2/);
    expect(() => decodeUf2(good.slice(0, 100))).toThrow(/UF2/);
  });

  it('decodes the pinned MicroPython artifact', () => {
    const file = readFileSync(
      'src/features/simulation/rp2040/firmware/RPI_PICO-20260824-v1.29.0.uf2',
    );
    const image = decodeUf2(file);
    expect(image.baseAddress).toBe(0x10000000);
    expect(image.data.length).toBe(340480);
  });
});
