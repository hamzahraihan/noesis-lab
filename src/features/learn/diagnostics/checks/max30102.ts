/* ------------------------------------------------------------------ *
 * max30102 on uno: the raw counts follow the heart-rate and SpO2 knobs.
 *
 * The chip answers with raw infrared and red counts over I2C. The check
 * converts them back with the scale the model uses and compares with knobs.
 * ------------------------------------------------------------------ */

import { MAX30102_HEART_RATE_KNOB, MAX30102_SPO2_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function max30102Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'max30102-pulse')?.id;
  return [
    {
      name: 'the raw counts follow the knobs',
      run: (sim) => {
        const started = performance.now();
        const name = 'the raw counts follow the knobs';
        const knob = sim.knob;
        if (knob === undefined || sensor === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read sensor knobs');
        }
        for (let frame = 0; frame < 30; frame++) sim.tick(0.05);
        const log = sim.serialText();
        const irMatch = /ir ([\d]+)/.exec(log);
        const redMatch = /red ([\d]+)/.exec(log);
        if (irMatch === null || redMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const heartRate = Number(irMatch[1]) / 16;
        const spo2 = Number(redMatch[1]) / 16;
        const expectedHeartRate = knob(sensor, MAX30102_HEART_RATE_KNOB.id);
        const expectedSpo2 = knob(sensor, MAX30102_SPO2_KNOB.id);
        if (Math.abs(heartRate - expectedHeartRate) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read heart rate ${heartRate} and the knob is at ${expectedHeartRate}`,
          );
        }
        if (Math.abs(spo2 - expectedSpo2) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read SpO2 ${spo2} and the knob is at ${expectedSpo2}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
