/* ------------------------------------------------------------------ *
 * instrument-bench on uno: three bus instruments on one pair of wires.
 *
 * Mirrors `runs the instrument bench live: three instruments on one bus` --
 * the sketch reads for a second before its first line, so the bench is run
 * for longer than that, and the numbers it prints are the ones the operator
 * dialled in.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const instrumentBenchChecks: CheckDef[] = [
  {
    name: 'reads the barometer, the monitor and the converter',
    run: (sim) => {
      const started = performance.now();
      const name = 'reads the barometer, the monitor and the converter';
      for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
      const text = sim.serialText();
      // The barometer's own counts, compensated in the sketch.
      if (!text.includes('barometer 1013 hPa')) {
        return verdict(name, started, 'fail', 'no barometer line on the serial');
      }
      if (!text.includes('temperature 20.0 C')) {
        return verdict(name, started, 'fail', 'no temperature on the serial');
      }
      // The monitor's registers, read over the bus.
      if (!text.includes('monitor 100 mA')) {
        return verdict(name, started, 'fail', 'no current on the serial');
      }
      if (!text.includes('power 500 mW')) {
        return verdict(name, started, 'fail', 'no power on the serial');
      }
      // The converter, pointed at channel zero.
      if (!text.includes('converter 0 counts')) {
        return verdict(name, started, 'fail', 'no converter counts on the serial');
      }
      return verdict(name, started, 'pass');
    },
  },
];
