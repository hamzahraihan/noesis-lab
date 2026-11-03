/**
 * MAX7219 adapter for the differential harness.
 *
 * C++: part_create_7segment(part_id, 8) → MAX7219Context (registered as DISPLAY_7SEG)
 * TS:  Max7219 class from display/max7219.ts
 *
 * Note: Max7219 class has private fields for config. The TS oracle uses
 * `restore()` for snapshots. We expose config via the `flags` in restore.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Max7219, MAX7219_COLUMNS } from '@/features/parts/display/max7219';

// Flag bits from max7219.ts (MAX7219_FLAG_LIT = 1, MAX7219_INTENSITY_SHIFT = 8)
const MAX7219_FLAG_LIT = 1;
const MAX7219_INTENSITY_SHIFT = 8;

function decodeFlags(flags: number) {
  return {
    shutdown: (flags & MAX7219_FLAG_LIT) === 0,
    intensity: (flags >> MAX7219_INTENSITY_SHIFT) & 0x0f,
    // scan_limit, decode_mode, display_test are not in flags (power-up defaults)
    scanLimit: MAX7219_COLUMNS - 1,
    decodeMode: 0,
    displayTest: false,
  };
}

export const max7219Adapter: PartAdapter = {
  kind: 'max7219',
  labels: ['digit0', 'digit1', 'digit2', 'digit3', 'digit4', 'digit5', 'digit6', 'digit7',
           'decode_mode', 'intensity', 'scan_limit', 'shutdown', 'display_test'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_7segment(part_id, 8);
    } else {
      return new Max7219();
    }
  },

  apply(_instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'spi-transfer') {
        module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, stimulus.cs ? 1 : 0);
      }
    } else {
      const dev = _instance as Max7219;
      if (stimulus.kind === 'spi-transfer') {
        dev.receive(stimulus.byte, stimulus.dc, stimulus.cs);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('MAX7219: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Max7219;
      const cols = dev.frame();
      const digits = Array.from({ length: 8 }, (_, i) => cols[i] ?? 0);
      const flags = dev.lit ? MAX7219_FLAG_LIT : 0; // simplified
      const config = decodeFlags(flags);
      return [
        digits[0], digits[1], digits[2], digits[3],
        digits[4], digits[5], digits[6], digits[7],
        config.decodeMode, config.intensity, config.scanLimit,
        config.shutdown ? 1 : 0, config.displayTest ? 1 : 0,
      ];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.seven_seg_digits[0], snap.seven_seg_digits[1], snap.seven_seg_digits[2], snap.seven_seg_digits[3],
      snap.seven_seg_digits[4], snap.seven_seg_digits[5], snap.seven_seg_digits[6], snap.seven_seg_digits[7],
      snap.max7219_decode_mode, snap.max7219_intensity, snap.max7219_scan_limit,
      snap.max7219_shutdown ? 1 : 0, snap.max7219_display_test ? 1 : 0,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
      module.spi_bus_init(0, 0, 0, 0);
    }
  },
};