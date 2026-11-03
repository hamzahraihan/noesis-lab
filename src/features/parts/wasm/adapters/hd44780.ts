/**
 * HD44780 adapter for the differential harness.
 *
 * C++: part_create_lcd(part_id, cols, rows) → HD44780Context
 * TS:  Lcd1602 class from devices/lcd1602.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Lcd1602 } from '@/features/parts/devices/lcd1602';

export const hd44780Adapter: PartAdapter = {
  kind: 'hd44780',
  labels: Array.from({ length: 80 }, (_, i) => `char${i}`).concat(['rows', 'cols']),

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, cols, rows] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_lcd(part_id, cols, rows);
    } else {
      return new Lcd1602(cols, rows);
    }
  },

  apply(_instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(_instance, stimulus.name, stimulus.value);
      }
    } else {
      const dev = _instance as Lcd1602;
      if (stimulus.kind === 'knob') {
        if (stimulus.name === 'data') {
          dev.receive(true, stimulus.value);
        } else if (stimulus.name === 'write_char') {
          dev.receive(true, stimulus.value);
        } else if (stimulus.name === 'clear') {
          dev.receive(false, 0x01);
        } else if (stimulus.name === 'function_set') {
          dev.receive(false, 0x20 | (stimulus.value & 0x0F));
        } else if (stimulus.name === 'display_on') {
          dev.receive(false, 0x08 | (stimulus.value & 0x07));
        } else if (stimulus.name === 'entry_mode') {
          dev.receive(false, 0x04 | (stimulus.value & 0x03));
        }
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('HD44780: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Lcd1602;
      const text = dev.text();
      const chars: number[] = [];
      for (let i = 0; i < 80; i++) {
        chars.push(i < text.length ? text.charCodeAt(i) : 32);
      }
      return chars.concat([dev.rows, dev.columns]);
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    const chars: number[] = [];
    for (let i = 0; i < 80; i++) {
      chars.push(snap.lcd_chars[i]);
    }
    return chars.concat([snap.lcd_rows, snap.lcd_cols]);
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};