/* ------------------------------------------------------------------ *
 * a4988 on uno: a pulse moves the motor, and the shaft agrees with the
 * count the sketch reported.
 *
 * The driver does the phase sequence, so the check does not look at the
 * windings: it looks at where the shaft ended up, which is the thing the
 * sketch asked for.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function a4988Checks(build: GalleryBuild): CheckDef[] {
  const motor = build.circuit.parts?.find((part) => part.type === 'stepper-motor')?.id;
  const supply = build.circuit.parts?.find((part) => part.type === 'power-supply')?.id;
  return [
    {
      name: 'the driver turns the motor one step per pulse',
      run: (sim) => {
        const started = performance.now();
        const name = 'the driver turns the motor one step per pulse';
        const angle = sim.stepperAngle;
        if (angle === undefined || motor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a motor');
        }
        /*
         * The shaft is watched across the whole run, not sampled at the end.
         *
         * The sketch sends twenty pulses one way and twenty back, and its `steps`
         * counter nets the two out -- so the log reads 0 while the shaft has been
         * to 135 degrees and back. What the driver promises is travel, so the
         * check measures how far the shaft got from where it started.
         */
        let peak = 0;
        for (let frame = 0; frame < 120; frame++) {
          sim.tick(0.05);
          peak = Math.max(peak, Math.abs(angle(motor)));
        }
        if (peak === 0) {
          return verdict(name, started, 'fail', 'the motor never moved');
        }
        /*
         * The log's `steps` counter nets the two directions out, so the last
         * line reads near zero whatever the shaft did. The count the driver was
         * asked for is the *largest* one the log carried, which is how far the
         * sketch sent it one way before reversing.
         */
        const steps = [...sim.serialText().matchAll(/step (-?\d+)/g)].map((m) =>
          Math.abs(Number(m[1])),
        );
        const oneWay = steps.length > 0 ? Math.max(...steps) : 0;
        if (oneWay === 0) {
          return verdict(name, started, 'fail', 'the sketch did not report a step');
        }
        const expected = Math.min(oneWay, 20) * 7.5;
        if (Math.abs(peak - expected) > 15) {
          return verdict(
            name,
            started,
            'fail',
            `the shaft reached ${peak} degrees, not the ${expected} of ${oneWay} steps`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
    {
      name: 'the motor runs on the supply, not on the board',
      run: (sim) => {
        const started = performance.now();
        const name = 'the motor runs on the supply, not on the board';
        const read = sim.partVolts;
        const knob = sim.knob;
        if (
          read === undefined ||
          knob === undefined ||
          motor === undefined ||
          supply === undefined
        ) {
          return verdict(name, started, 'skip', 'the bench cannot read the windings');
        }
        // The windings are driven in one direction at a time, so the reading
        // is a peak rather than a value.
        let peak = 0;
        for (let frame = 0; frame < 30; frame++) {
          sim.tick(0.05);
          peak = Math.max(peak, Math.abs(read(motor, 'A+') - read(motor, 'A-')));
        }
        const volts = knob(supply, 'volts');
        if (Math.abs(peak - volts) > 0.5) {
          return verdict(
            name,
            started,
            'fail',
            `the windings saw ${peak} volts and the supply is at ${volts}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
