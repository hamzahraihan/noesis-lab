import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { esp32DevKitV1, type Ili9341 } from '@/features/parts';
import { NET_LATENCY_MS, NET_LOCAL_IP } from '@/features/simulation';
import { buildFor, galleryById } from '@/features/learn';

/**
 * The bench network, driven by a real sketch.
 *
 * The unit tests beside the network pin what it answers; these pin that a
 * sketch can *reach* it -- that `WiFi.begin`/`status`/`localIP` and `net.get`/
 * `read`/`failed` are wired to it at all, that a request which never arrives is
 * reported rather than waited on forever, and that the shipped project works
 * end to end.
 */

/** Joins, reports its address, and fetches the clock from the network. */
const CLOCK_SKETCH = `
void setup() {
  Serial.begin(115200);
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) { delay(20); }
  Serial.print("ip ");
  Serial.println(WiFi.localIP());

  while (net.get("http://api.noesis/time") == 0) { delay(20); }
  Serial.print("time ");
  Serial.println(net.read());
}

void loop() { delay(500); }
`;

/** Asks a name the network does not answer for. */
const NOWHERE_SKETCH = `
void setup() {
  Serial.begin(115200);
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) { delay(20); }
  while (net.get("http://nowhere.noesis/hello") == 0) { delay(20); }
  if (net.failed()) { Serial.println("failed"); } else { Serial.println(net.read()); }
}

void loop() { delay(500); }
`;

/** Joins a network with the wrong password, and says so rather than spinning. */
const WRONG_PASSWORD_SKETCH = `
void setup() {
  Serial.begin(115200);
  WiFi.begin("noesis-bench", "wrong");
  delay(200);
  Serial.print("status ");
  Serial.println(WiFi.status());
}

void loop() { delay(500); }
`;

function run(source: string, until: (serial: string) => boolean, frames = 400): Simulation {
  const simulation = new Simulation(esp32DevKitV1());
  simulation.loadFirmware(source);
  simulation.start();
  for (let frame = 0; frame < frames; frame++) {
    simulation.tick(0.05);
    if (until(simulation.serialLines().join(''))) break;
  }
  return simulation;
}

describe('a sketch on the bench network', () => {
  it('joins, reports its address, and reads what it asked for', () => {
    const simulation = run(CLOCK_SKETCH, (serial) => serial.includes('time '));
    expect(simulation.firmwareError).toBeNull();
    const serial = simulation.serialLines().join('');
    expect(serial).toContain(`ip ${NET_LOCAL_IP}`);
    /*
     * The clock is the bench's: anchored, and advanced by simulated time, so
     * the same sketch prints the same answer twice. Twelve is the anchor's
     * hour; the request lands well inside the first second of it.
     */
    expect(serial).toMatch(/time 2026-10-17T12:00:0\dZ/);
  });

  it('takes the network a latency to answer, so the sketch waits', () => {
    const simulation = new Simulation(esp32DevKitV1());
    simulation.loadFirmware(CLOCK_SKETCH);
    simulation.start();
    // Twenty milliseconds of a join that takes thirty-five: the sketch is
    // inside `while (WiFi.status() != WL_CONNECTED)` and has nothing to print.
    for (let i = 0; i < 2; i++) simulation.tick(0.01);
    expect(simulation.serialLines().join(''), 'no address before the join lands').not.toContain('ip ');

    for (let i = 0; i < 400; i++) {
      simulation.tick(0.05);
      if (simulation.serialLines().join('').includes('time ')) break;
    }
    expect(simulation.serialLines().join('')).toContain('time ');
    expect(NET_LATENCY_MS).toBeGreaterThan(0);
  });

  it('reports a name it cannot reach, rather than waiting for it', () => {
    const simulation = run(NOWHERE_SKETCH, (serial) => serial.includes('failed'));
    expect(simulation.firmwareError).toBeNull();
    expect(simulation.serialLines().join('')).toContain('failed');
  });

  it('reports a refused join instead of connecting to it', () => {
    const simulation = run(WRONG_PASSWORD_SKETCH, (serial) => serial.includes('status '));
    expect(simulation.firmwareError).toBeNull();
    // 4 is WL_CONNECT_FAILED: the network refused the password, and the sketch
    // could read that rather than looping for a connection that never comes.
    expect(simulation.serialLines().join('')).toContain('status 4');
  });

  /*
   * The failure mode this seam has to avoid: an unjoined board asking for a url
   * must still be *settled*, because a sketch's poll loop that never ends is a
   * frozen program rather than a slow one.
   */
  it('settles a request made with no connection', () => {
    const simulation = run(
      `
void setup() {
  Serial.begin(115200);
  while (net.get("http://api.noesis/time") == 0) { delay(20); }
  Serial.println("settled");
}

void loop() { delay(500); }
`,
      (serial) => serial.includes('settled'),
      200,
    );
    expect(simulation.serialLines().join('')).toContain('settled');
  });

  /*
   * The shipped project, end to end: the circuit as a document, the sketch as
   * the gallery carries it, the answer on the panel. This is what makes the
   * capability a feature rather than an API -- a reader can open it, press Run
   * and see the time come from somewhere other than the board.
   */
  it('runs the shipped network-clock project', () => {
    const build = buildFor(galleryById('net-clock')!, 'esp32')!;
    const simulation = new Simulation(esp32DevKitV1());
    expect(simulation.loadCircuit(build.circuit)).toEqual([]);
    simulation.loadFirmware(build.sketch);
    simulation.start();
    for (let frame = 0; frame < 200; frame++) {
      simulation.tick(0.05);
      if (/2026-10-17T12:00:0\dZ/.test(simulation.serialLines().join(''))) break;
    }

    expect(simulation.firmwareError).toBeNull();
    const serial = simulation.serialLines().join('');
    expect(serial).toContain(`joined ${NET_LOCAL_IP}`);
    expect(serial).toMatch(/2026-10-17T12:00:0\dZ/);

    // The time reached the glass, not just the serial port: the panel was
    // cleared to black and the fetched clock drawn onto it.
    const panel = [...simulation.displayControllers().values()][0] as Ili9341;
    expect(panel.isOn(), 'the panel was told to light').toBe(true);
    let drawn = false;
    for (let y = 120; y < 160 && !drawn; y++) {
      for (let x = 20; x < 300 && !drawn; x++) {
        if (panel.pixelAt(x, y) !== 0) drawn = true;
      }
    }
    expect(drawn, 'the fetched time was drawn').toBe(true);
  });
});
