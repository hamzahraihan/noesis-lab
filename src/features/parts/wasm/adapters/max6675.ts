/**
 * MAX6675 adapter for the differential harness.
 *
 * C++: part_create_thermocouple(part_id) → MAX6675Context (SPI read-only)
 * TS:  Max6675 class from devices/max6675.ts
 */
import { Max6675 } from '@/features/parts/devices/max6675';
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

let max6675WasmCsState = false;

export const max6675Adapter: PartAdapter = {
  kind: 'max6675',
  labels: ['temp_quarter_deg'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_thermocouple(part_id);
    } else {
      return new Max6675();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'spi-transfer') {
        const cs = stimulus.cs;
        if (cs && !max6675WasmCsState) {
          module.spi_bus_begin();
        }
        if (cs) {
          module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, 1);
        } else if (max6675WasmCsState) {
          module.spi_bus_end();
        }
        max6675WasmCsState = cs;
      } else if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, 'probe', stimulus.value);
      }
    } else {
      const dev = instance as Max6675;
      if (stimulus.kind === 'spi-transfer') {
        if (stimulus.cs) {
          dev.receive();
        } else {
          dev.endTransaction();
        }
      } else if (stimulus.kind === 'knob' && stimulus.name === 'probe') {
        dev.setTemperature(stimulus.value);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('MAX6675: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Max6675 & { raw?: number };
      // Max6675 keeps the quarter-degree reading private; access via
      // ref-SPI readback — the engine pattern for this part.
      return [(dev as unknown as { raw: number }).raw ?? 0];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.thermocouple_temp_quarter_deg];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    max6675WasmCsState = false;
    if (module) {
      module.bus_reset();
      module.spi_bus_init(0, 0, 0, 0);
    } else {
      (_instance as Max6675).endTransaction();
    }
  },
};
