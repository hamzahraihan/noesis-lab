/**
 * Encoder adapter for the differential harness.
 *
 * C++: part_create_encoder(part_id) → EncoderContext
 * TS:  encoder.ts quadrature logic (local EncoderOracle; encoder.ts exports
 *      only the definition and quadrature helpers, not a runtime device class)
 *
 * Adapter parity note: encoder.ts exports `encoderDefinition()`,
 * `DETENT_KNOB`, `QUADRATURE`, and `quadratureAt()` but no runtime device
 * class with a pin-level interface. The local EncoderOracle mirrors the C++
 * quadrature computation exactly, which is what the gate compares.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

const QUADRATURE: ReadonlyArray<readonly [clk: boolean, dt: boolean]> = [
  [true, true],   // detent 0: CLK=1, DT=1 (idle high)
  [false, true],  // detent 1: CLK=0, DT=1 (DT fell first = CW)
  [false, false], // detent 2: CLK=0, DT=0
  [true, false],  // detent 3: CLK=1, DT=0 (CLK rose first = CCW)
];

function quadratureAt(detent: number): [boolean, boolean] {
  const idx = (((Math.round(detent) % 4) + 4) % 4);
  return [QUADRATURE[idx][0], QUADRATURE[idx][1]];
}

class EncoderOracle {
  detent = 0;
  sw_level = true;  // SW push-button (active low, idle high)

  update_quadrature(): [boolean, boolean] {
    return quadratureAt(this.detent);
  }
}

export const encoderAdapter: PartAdapter = {
  kind: 'encoder',
  labels: ['encoder_detent', 'encoder_clk', 'encoder_dt', 'encoder_sw'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_encoder(part_id);
    } else {
      return new EncoderOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      } else if (stimulus.kind === 'pin') {
        module.part_set_pin_level(instance as number, stimulus.index, stimulus.high ? 1 : 0);
      }
    } else {
      const oracle = instance as EncoderOracle;
      if (stimulus.kind === 'knob' && stimulus.name === 'detent') {
        oracle.detent = Math.round(stimulus.value);
      } else if (stimulus.kind === 'pin' && stimulus.index === 2) {
        // Pin 2 = SW (push button, active low)
        oracle.sw_level = stimulus.high;
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as EncoderOracle;
    const [clk, dt] = oracle.update_quadrature();
    return [
      oracle.detent,
      clk ? 1 : 0,
      dt ? 1 : 0,
      oracle.sw_level ? 1 : 0,
    ];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.encoder_detent,
      snap.encoder_clk,
      snap.encoder_dt,
      snap.encoder_sw,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
