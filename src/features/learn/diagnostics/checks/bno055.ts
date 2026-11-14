/* ------------------------------------------------------------------ *
 * bno055 on uno: the raw counts follow the heading, pitch and roll knobs.
 *
 * The chip answers with raw signed counts over I2C. The check converts
 * them back with the scale the model uses and compares with the knobs.
 * ------------------------------------------------------------------ */

import { BNO055_HEADING_KNOB, BNO055_PITCH_KNOB, BNO055_ROLL_KNOB } from '@/features/parts';
import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function bno055Checks(build: GalleryBuild): CheckDef[] {
  const sensor = build.circuit.parts?.find((part) => part.type === 'bno055-imu')?.id;
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
        const headingMatch = /heading ([\d]+)/.exec(log);
        const pitchMatch = /pitch ([-\d]+)/.exec(log);
        const rollMatch = /roll ([-\d]+)/.exec(log);
        if (headingMatch === null || pitchMatch === null || rollMatch === null) {
          return verdict(name, started, 'fail', 'the sketch did not report raw counts');
        }
        const heading = Number(headingMatch[1]) / 16;
        const pitch = Number(pitchMatch[1]) / 16;
        const roll = Number(rollMatch[1]) / 16;
        const expectedHeading = knob(sensor, BNO055_HEADING_KNOB.id);
        const expectedPitch = knob(sensor, BNO055_PITCH_KNOB.id);
        const expectedRoll = knob(sensor, BNO055_ROLL_KNOB.id);
        if (Math.abs(heading - expectedHeading) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read heading ${heading} and the knob is at ${expectedHeading}`,
          );
        }
        if (Math.abs(pitch - expectedPitch) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read pitch ${pitch} and the knob is at ${expectedPitch}`,
          );
        }
        if (Math.abs(roll - expectedRoll) > 5) {
          return verdict(
            name,
            started,
            'fail',
            `the sketch read roll ${roll} and the knob is at ${expectedRoll}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
