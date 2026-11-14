/* ------------------------------------------------------------------ *
 * microstep on uno: sixteen pulses are one full step, and the winding
 * spends part of the cycle between the rails.
 *
 * The driver's translator still does the phase sequence; what changes is
 * the resolution and the average the bridge presents to the winding.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function microstepChecks(build: GalleryBuild): CheckDef[] {
  const motor = build.circuit.parts?.find((part) => part.type === 'stepper-motor')?.id;
  const supply = build.circuit.parts?.find((part) => part.type === 'power-supply')?.id;
  return [
    {
      name: 'sixteen microsteps turn the motor one full step',
      run: (sim) => {
        const started = performance.now();
        const name = 'sixteen microsteps turn the motor one full step';
        const angle = sim.stepperAngle;
        if (angle === undefined || motor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read a motor');
        }
        let peak = 0;
        let reported = false;
        for (let frame = 0; frame < 200; frame++) {
          sim.tick(0.05);
          peak = Math.max(peak, angle(motor));
          if (sim.serialText().includes('microstep 16')) {
            reported = true;
            break;
          }
        }
        if (!reported) {
          return verdict(name, started, 'fail', 'the sketch did not report the forward sixteen');
        }
        if (Math.abs(peak - 7.5) > 0.6) {
          return verdict(
            name,
            started,
            'fail',
            `the shaft peaked at ${peak} degrees, not the 7.5 of one full step`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
    {
      name: 'a microstep drives the winding below the supply',
      run: (sim) => {
        const started = performance.now();
        const name = 'a microstep drives the winding below the supply';
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
        const volts = knob(supply, 'volts');
        let fractional = false;
        for (let frame = 0; frame < 200; frame++) {
          sim.tick(0.05);
          const across = Math.abs(read(motor, 'A+') - read(motor, 'A-'));
          if (across > volts * 0.1 && across < volts * 0.9) {
            fractional = true;
            break;
          }
        }
        if (!fractional) {
          return verdict(name, started, 'fail', 'the winding stayed at a rail, not between them');
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
