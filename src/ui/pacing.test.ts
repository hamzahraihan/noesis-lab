import { describe, expect, it } from 'vitest';
import { Simulation } from '@/features/bench/simulation';
import { esp32DevKitV1 } from '@/features/parts';

/**
 * Frame pacing is where blocking firmware is most easily broken.
 *
 * A frame only gets a slice of simulated time, so a naive loop resumes the
 * sketch the moment the frame runs out -- which silently turns every `delay`
 * into "delay divided by the frame budget" and makes a blink flicker.
 */

const BLINK = `
void setup() { pinMode(2, OUTPUT); }
void loop() {
  digitalWrite(2, HIGH);
  delay(400);
  digitalWrite(2, LOW);
  delay(400);
}
`;

/** Drives the sketch through the real frame loop, recording pin transitions. */
function observe(durationMs: number, frameSeconds: number) {
  // The engine finds the board through the bench, so an empty bench would leave
  // every pin unplaced and the reading stuck at zero.
  const simulation = new Simulation(esp32DevKitV1());
  simulation.addPart(esp32DevKitV1(), 0, 0);
  simulation.loadFirmware(BLINK);
  simulation.start();
  const net = simulation.engine.netOfMcuPin('R_D2');
  const edges: number[] = [];
  let previous = simulation.engine.voltageOfNet(net);

  let guard = 0;
  while (simulation.engine.timeMs < durationMs && guard++ < 20_000) {
    simulation.tick(frameSeconds);
    const volts = simulation.engine.voltageOfNet(net);
    if ((volts > 1.65) !== (previous > 1.65)) edges.push(simulation.engine.timeMs);
    previous = volts;
  }

  return { edges, finalTime: simulation.engine.timeMs, finalVolts: previous };
}


describe('frame pacing', () => {
  it('keeps a blocking delay blocking across frame boundaries', () => {
    // Each frame only gets ~16 ms of simulated time. A 400 ms delay must still
    // hold the pin for the whole 400 ms rather than resuming the sketch early.
    const { edges } = observe(2000, 0.016);

    // Two full blink cycles in two seconds, so four edges 400 ms apart.
    expect(edges.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i] - edges[i - 1]).toBeGreaterThan(350);
      expect(edges[i] - edges[i - 1]).toBeLessThan(450);
    }
  });
  it('holds the pin steady while its delay is still owed', () => {
    // Well inside the first 400 ms delay: the pin went high before the wait
    // started and must still be there at the end of it.
    const { edges, finalVolts } = observe(200, 0.016);
    expect(finalVolts).toBeGreaterThan(3.0);
    expect(edges.length).toBe(1);
  });


  it('advances simulated time at roughly the wall-clock rate', () => {
    const { finalTime } = observe(1000, 0.016);
    expect(finalTime).toBeGreaterThan(950);
    expect(finalTime).toBeLessThan(1050);
  });

  it('gives the same answer at any frame rate', () => {
    // A 20 ms frame and a 4 ms frame must both produce the same 400 ms cadence;
    // only the number of frames spent getting there should differ.
    for (const frame of [0.004, 0.02, 0.05]) {
      const { edges } = observe(1600, frame);
      expect(edges.length).toBeGreaterThanOrEqual(3);
      expect(edges[1] - edges[0]).toBeGreaterThan(350);
      expect(edges[1] - edges[0]).toBeLessThan(450);
    }
  });
});