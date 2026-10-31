/**
 * ADS1115 adapter for the differential harness.
 *
 * C++: part_create_adc(part_id, address, 4) → ADS1115Context
 * TS:  new Ads1115()
 */
import { Ads1115 } from '@/features/parts/devices/ads1115';
import type { PartAdapter } from './probe';
import type { PartsModule } from './parts-module';
import type { Stimulus } from './probe';
import type { PartStateSnapshot } from './parts-module';

declare module '@/features/parts/devices/ads1115' {
  interface Ads1115 {
    readonly configReg: number;
    readonly conversionReg: number;
    readonly pointerReg: number;
    readonly conversionReadyFlag: number;
  }
}

Object.defineProperty(Ads1115.prototype, 'configReg', { get() { return (this as any).readWord(0x01); } });
Object.defineProperty(Ads1115.prototype, 'conversionReg', { get() { return (this as any).readWord(0x00); } });
Object.defineProperty(Ads1115.prototype, 'pointerReg', { get() { return (this as any).pointer; } });
Object.defineProperty(Ads1115.prototype, 'conversionReadyFlag', { get() { return (this as any).byteIndex === 0 ? 1 : 0; } });

export const ads1115Adapter: PartAdapter = {
  kind: 'ads1115',
  labels: ['config', 'conversion', 'conversion_ready'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address, channels] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_adc(part_id, address, channels);
    } else {
      return new Ads1115();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      const handle = instance as number;
      if (stimulus.kind === 'i2c-write') {
        module.i2c_bus_begin_transmission(stimulus.address);
        stimulus.bytes.forEach((byte) => module.i2c_bus_write(byte));
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) module.i2c_bus_read();
      } else if (stimulus.kind === 'knob') {
        const knobMap: Record<string, string> = { a0: 'ain0', a1: 'ain1', a2: 'ain2', a3: 'ain3' };
        const knobName = knobMap[stimulus.name];
        if (knobName) {
          module.part_set_knob(handle, knobName, stimulus.value);
        }
      }
    } else {
      const dev = instance as Ads1115;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte, idx) => dev.receive(byte, idx === 0));
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      } else if (stimulus.kind === 'knob') {
        // For TS oracle, set the channel voltage directly
        const channelMap: Record<string, number> = { a0: 0, a1: 1, a2: 2, a3: 3 };
        const ch = channelMap[stimulus.name];
        if (ch !== undefined) {
          // Access private channels array via reflection
          (dev as any).channels[ch] = stimulus.value;
          (dev as any).conditions();
          (dev as any).refresh();
        }
      }
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      // Wasm path - now uses snapshotToScalars via probe
      throw new Error('ADS1115: wasm path should use snapshotToScalars');
    } else {
      const dev = instance as Ads1115;
      return [dev.configReg, dev.conversionReg, dev.conversionReadyFlag];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    // ADS1115: config, conversion, conversion_ready
    return [
      snap.ads1115_config,
      snap.ads1115_conversion,
      snap.ads1115_conversion_ready ? 1 : 0,
    ];
  },

  reset(instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};