/* ------------------------------------------------------------------ *
 * mcp4725 on uno: the voltage the board reads is the voltage the sketch
 * wrote.
 *
 * The converter is the one part that makes a level rather than measuring
 * one, so the check reads it twice: the analog pin the board counts, and
 * the output itself.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef, GalleryBuild } from './shared';

export function mcp4725Checks(build: GalleryBuild): CheckDef[] {
  const converter = build.circuit.parts?.find((part) => part.type === 'mcp4725')?.id;
  return [
    {
      name: 'the voltage the board reads is the voltage the sketch wrote',
      run: (sim) => {
        const started = performance.now();
        const name = 'the voltage the board reads is the voltage the sketch wrote';
        const read = sim.partVolts;
        if (read === undefined || converter === undefined) {
          return verdict(name, started, 'skip', 'the bench cannot read the output');
        }
        let first = 0;
        let last = 0;
        for (let frame = 0; frame < 60; frame++) {
          sim.tick(0.05);
          const volts = read(converter, 'AOUT');
          if (frame === 0) first = volts;
          last = volts;
        }
        // The sketch walks the output up a ramp, so it has to have moved.
        if (Math.abs(last - first) < 0.2) {
          return verdict(name, started, 'fail', 'the output never moved');
        }
        // And the board has to have read the voltage the code asks for.
        const matches = [...sim.serialText().matchAll(/code (\d+) reads (\d+)/g)];
        if (matches.length === 0) {
          return verdict(name, started, 'fail', 'the sketch did not report a reading');
        }
        const reported = matches[matches.length - 1]!;
        const code = Number(reported[1]);
        const counts = Number(reported[2]);
        // The board counts in ten bits over the range the converter holds,
        // so the two numbers have to agree.
        const expected = (code / 4095) * 1023;
        if (Math.abs(counts - expected) > 24) {
          return verdict(
            name,
            started,
            'fail',
            `the board read ${counts} and the code was ${code}`,
          );
        }
        return verdict(name, started, 'pass');
      },
    },
  ];
}
