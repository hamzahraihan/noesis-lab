/* ------------------------------------------------------------------ *
 * apds9960 on uno: the proximity, ambient and gesture follow the knobs.
 *
 * The chip answers with raw counts over I2C. The check converts them back
 * with the scale the model uses and compares with the knobs.
 * ------------------------------------------------------------------ */

import { APDS9960_PROXIMITY_KNOB, APDS9960_AMBIENT_KNOB, APDS9960_GESTURE_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function apds9960Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'apds9960-gesture')?.id;
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
        const proximityMatch = /proximity ([\d]+)/.exec(log);
        const ambientMatch = /ambient ([\d]+)/.exec(log);
        const gestureMatch = /gesture ([\d]+)/.exec(log);
        if (proximityMatch === null || ambientMatch === null || gestureMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const proximity = Number(proximityMatch[1]);
        const ambient = Number(ambientMatch[1]) / 16;
        const gesture = Number(gestureMatch[1]);
        const expectedProximity = knob(sensor, APDS9960_PROXIMITY_KNOB.id);
        const expectedAmbient = knob(sensor, APDS9960_AMBIENT_KNOB.id);
        const expectedGesture = knob(sensor, APDS9960_GESTURE_KNOB.id);
        if (Math.abs(proximity - expectedProximity) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read proximity ${proximity} and the knob is at ${expectedProximity}`,
          );
        }
        if (Math.abs(ambient - expectedAmbient) > 20) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read ambient ${ambient} and the knob is at ${expectedAmbient}`,
          );
        }
        if (gesture !== expectedGesture) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read gesture ${gesture} and the knob is at ${expectedGesture}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
