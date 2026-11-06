/**
 * Scripted I2C slave adapter for the differential harness.
 *
 * C++: part_create_scripted(part_id, address) → ScriptedContext (I2C device)
 * TS:  ScriptedOracle (mirrors C++ register file; TS has no standalone device class)
 *
 * Adapter parity note: the TS ScriptedI2cDevice (devices/scripted.ts) delegates
 * read/write to a script-provided slave. For the differential harness the
 * local ScriptedOracle stores written bytes in a register file and returns
 * them on read, mirroring a script that echoes its registers — the same model
 * the C++ ScriptedContext implements.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

const NUM_REGS = 256;

class ScriptedOracle {
  reg_ptr = 0;
  regs = new Uint8Array(NUM_REGS);
}

export const scriptedAdapter: PartAdapter = {
  kind: 'scripted',
  labels: [
    'scripted_reg_ptr',
    'scripted_reg_0', 'scripted_reg_1', 'scripted_reg_2', 'scripted_reg_3',
    'scripted_reg_4', 'scripted_reg_5', 'scripted_reg_6', 'scripted_reg_7',
  ],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address] = factoryArgs as [number, number];
    if (module) {
      return module.part_create_scripted(part_id, address);
    } else {
      return new ScriptedOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'i2c-write') {
        module.i2c_bus_begin_transmission(stimulus.address);
        stimulus.bytes.forEach((byte: number) => {
          module.i2c_bus_write(byte);
        });
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) {
          module.i2c_bus_read();
        }
      } else if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as ScriptedOracle;
      if (stimulus.kind === 'i2c-write') {
        // First byte of a write transaction is the register pointer (control
        // byte); subsequent bytes write to that register — mirroring the
        // C++ I2C bus which calls receive with is_control=true for byte 0.
        stimulus.bytes.forEach((byte: number, idx: number) => {
          if (idx === 0) {
            oracle.reg_ptr = byte & 0xff;
          } else {
            oracle.regs[oracle.reg_ptr] = byte;
          }
        });
      } else if (stimulus.kind === 'i2c-read') {
        // Read doesn't change state; the register file holds the data
      } else if (stimulus.kind === 'knob') {
        if (stimulus.name === 'reg_ptr') {
          oracle.reg_ptr = Math.round(stimulus.value) & 0xff;
        } else {
          const m = /^reg_([0-7])$/.exec(stimulus.name);
          if (m) {
            const reg = parseInt(m[1], 10);
            oracle.regs[reg] = Math.round(stimulus.value) & 0xff;
          }
        }
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as ScriptedOracle;
    return [
      oracle.reg_ptr,
      oracle.regs[0], oracle.regs[1], oracle.regs[2], oracle.regs[3],
      oracle.regs[4], oracle.regs[5], oracle.regs[6], oracle.regs[7],
    ];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.scripted_reg_ptr,
      snap.scripted_reg_0, snap.scripted_reg_1, snap.scripted_reg_2,
      snap.scripted_reg_3, snap.scripted_reg_4, snap.scripted_reg_5,
      snap.scripted_reg_6, snap.scripted_reg_7,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
