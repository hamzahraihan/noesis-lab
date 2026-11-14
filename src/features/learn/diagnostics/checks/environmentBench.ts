/* ------------------------------------------------------------------ *
 * environment-bench on uno: three sensors on one pair of wires.
 *
 * Mirrors `runs the environment bench live: three sensors on one bus` --
 * the light count, the thermometer's signed word and the humidity sensor's
 * two CRC-protected words all have to read back at their knob defaults.
 * ------------------------------------------------------------------ */

import { verdict } from './shared';
import type { CheckDef } from './shared';

export const environmentBenchChecks: CheckDef[] = [
  {
    name: 'reads the light, the thermometer and the humidity sensor',
    run: (sim) => {
      const started = performance.now();
      const name = 'reads the light, the thermometer and the humidity sensor';
      for (let frame = 0; frame < 60; frame++) sim.tick(0.05);
      const text = sim.serialText();
      if (!text.includes('light 250 lx')) {
        return verdict(name, started, 'fail', 'no light reading on the serial');
      }
      if (!text.includes('tmp102 21.00 C')) {
        return verdict(name, started, 'fail', 'no TMP102 reading on the serial');
      }
      if (!text.includes('sht31 21.00 C')) {
        return verdict(name, started, 'fail', 'no SHT31 temperature on the serial');
      }
      if (!text.includes('humidity 45.0 %')) {
        return verdict(name, started, 'fail', 'no humidity reading on the serial');
      }
      // The sketch checks both CRCs itself; a frame the bench got wrong would
      // print "crc bad" rather than a reading.
      if (!text.includes('crc ok')) {
        return verdict(name, started, 'fail', 'the SHT31 frame failed its CRC');
      }
      return verdict(name, started, 'pass');
    },
  },
];
