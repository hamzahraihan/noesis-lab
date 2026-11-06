/**
 * NeoPixel adapter for the differential harness.
 *
 * C++: part_create_neopixel(part_id, count) → NeoPixelContext
 * TS:  NeoPixelOracle (mirrors C++ pixel buffer; pixels.ts has no runtime class)
 *
 * Adapter parity note: pixels.ts exports clampChannel(), pixelCount() and the
 * part definitions, but no runtime device class. The local NeoPixelOracle
 * mirrors the C++ NeoPixelContext pixel buffer exactly, which is what the
 * gate compares.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

const MAX_PIXELS = 8;

class NeoPixelOracle {
  pixel_count = 0;
  pixels = new Uint8Array(MAX_PIXELS * 3); // R, G, B per pixel

  set_pixel(index: number, r: number, g: number, b: number): void {
    if (index < 0 || index >= MAX_PIXELS) return;
    const base = index * 3;
    if (r >= 0) this.pixels[base] = clampChannel(r);
    if (g >= 0) this.pixels[base + 1] = clampChannel(g);
    if (b >= 0) this.pixels[base + 2] = clampChannel(b);
    if (index + 1 > this.pixel_count) this.pixel_count = index + 1;
  }
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? 255 : 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

export const neopixelAdapter: PartAdapter = {
  kind: 'neopixel',
  labels: [
    'neopixel_count',
    'neopixel_pixel0_r', 'neopixel_pixel0_g', 'neopixel_pixel0_b',
    'neopixel_pixel1_r', 'neopixel_pixel1_g', 'neopixel_pixel1_b',
    'neopixel_pixel2_r', 'neopixel_pixel2_g', 'neopixel_pixel2_b',
    'neopixel_pixel3_r', 'neopixel_pixel3_g', 'neopixel_pixel3_b',
  ],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, count] = factoryArgs as [number, number];
    if (module) {
      return module.part_create_neopixel(part_id, count);
    } else {
      const oracle = new NeoPixelOracle();
      oracle.pixel_count = Math.min(Math.max(count, 0), MAX_PIXELS);
      return oracle;
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as NeoPixelOracle;
      if (stimulus.kind === 'knob') {
        // Knob names: "pixel0_r", "pixel0_g", "pixel0_b", ..., "pixel3_b"
        const m = /^pixel([0-3])_([rgb])$/.exec(stimulus.name);
        if (m) {
          const pixel = parseInt(m[1], 10);
          const channel = m[2];
          const v = clampChannel(stimulus.value);
          if (channel === 'r') oracle.set_pixel(pixel, v, -1, -1);
          else if (channel === 'g') oracle.set_pixel(pixel, -1, v, -1);
          else if (channel === 'b') oracle.set_pixel(pixel, -1, -1, v);
        }
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as NeoPixelOracle;
    return [
      oracle.pixel_count,
      oracle.pixels[0], oracle.pixels[1], oracle.pixels[2],
      oracle.pixels[3], oracle.pixels[4], oracle.pixels[5],
      oracle.pixels[6], oracle.pixels[7], oracle.pixels[8],
      oracle.pixels[9], oracle.pixels[10], oracle.pixels[11],
    ];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.neopixel_count,
      snap.neopixel_pixel0_r, snap.neopixel_pixel0_g, snap.neopixel_pixel0_b,
      snap.neopixel_pixel1_r, snap.neopixel_pixel1_g, snap.neopixel_pixel1_b,
      snap.neopixel_pixel2_r, snap.neopixel_pixel2_g, snap.neopixel_pixel2_b,
      snap.neopixel_pixel3_r, snap.neopixel_pixel3_g, snap.neopixel_pixel3_b,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
