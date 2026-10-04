import { describe, expect, it } from 'vitest';
import { clampChannel, ledRingDefinition, neopixelDefinition, neopixelMatrixDefinition, pixelCount } from './pixels';

describe('pixel definitions', () => {
  it('exposes the single, matrix, and ring pins', () => {
    expect(neopixelDefinition().pins.map((p) => p.id)).toEqual(['VDD', 'DOUT', 'VSS', 'DIN']);
    expect(neopixelMatrixDefinition().pins.map((p) => p.id)).toEqual(['GND', 'VCC', 'DIN', 'DOUT']);
    expect(ledRingDefinition().pins.map((p) => p.id)).toEqual(['GND', 'VCC', 'DIN', 'DOUT']);
    expect([pixelCount(neopixelDefinition()), pixelCount(neopixelMatrixDefinition()), pixelCount(ledRingDefinition())]).toEqual([1, 64, 16]);
  });
});

describe('channel clamp', () => {
  it('rounds and clamps to 0-255', () => {
    expect(clampChannel(300)).toBe(255);
    expect(clampChannel(-4)).toBe(0);
    expect(clampChannel(12.7)).toBe(13);
  });
});
