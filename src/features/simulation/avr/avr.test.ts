import { describe, expect, it } from 'vitest';
import { UNO_GPIO_MAP, UNO_CLOCK_HZ, cyclesPerMs } from './backend';

describe('avr seam', () => {
  it('maps every Uno digital gpio to its port bit', () => {
    expect(UNO_GPIO_MAP).toHaveLength(20);
    expect(UNO_GPIO_MAP.find((m) => m.gpio === 13)).toEqual({ port: 'B', bit: 5, gpio: 13 });
    expect(UNO_GPIO_MAP.find((m) => m.gpio === 0)).toEqual({ port: 'D', bit: 0, gpio: 0 });
    expect(UNO_GPIO_MAP.find((m) => m.gpio === 14)).toEqual({ port: 'C', bit: 0, gpio: 14 });
  });

  it('derives cycles per ms from the board clock', () => {
    expect(UNO_CLOCK_HZ).toBe(16_000_000);
    expect(cyclesPerMs(UNO_CLOCK_HZ)).toBe(16_000);
  });
});
