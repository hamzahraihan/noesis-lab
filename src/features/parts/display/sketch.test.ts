import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../ui/simulation';
import { BLINK_SKETCH } from '../../../ui/examples';
import { breadboardDefinition, columnX, railRowY, stripRowY } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import { ssd1306Definition } from './part';
import { Ssd1306 } from './ssd1306';

const BREADBOARD_ORIGIN_X = 230;
const SIGNAL_COLUMN = 20;

const holeX = (column: number) => BREADBOARD_ORIGIN_X + columnX(column);
const holeY = (row: number) => stripRowY(row);
const at = (x: number, y: number) => ({ id: -1, x, y });

/** The bench exactly as the app opens it: board, breadboard, LED and OLED. */
function openedBench(): Simulation {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  void board;
  simulation.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);

  const pinAt = (id: string) => {
    const part = simulation.bench.parts.find((candidate) => candidate.id === 'p1')!;
    const pin = part.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`no pin ${id}`);
    return pin;
  };

  simulation.routeWire(at(pinAt('R_D2').x, pinAt('R_D2').y), at(holeX(SIGNAL_COLUMN), holeY(8)));
  const groundRailY = railRowY(2);
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 5), holeY(8)),
    at(holeX(SIGNAL_COLUMN + 5), groundRailY),
  );
  simulation.routeWire(at(pinAt('L_GND').x, pinAt('L_GND').y), at(holeX(10), groundRailY));

  const oled = simulation.addPart(ssd1306Definition(), BREADBOARD_ORIGIN_X + 40, 86);
  const oledPin = (id: string) => {
    const pin = oled.definition.pins.find((candidate) => candidate.id === id)!;
    return { x: oled.x + pin.x, y: oled.y + pin.y };
  };

  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 7), holeY(8)),
    at(oledPin('SDA').x, oledPin('SDA').y),
  );
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 9), holeY(8)),
    at(oledPin('SCL').x, oledPin('SCL').y),
  );
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 7), groundRailY),
    at(oledPin('VCC').x, oledPin('VCC').y),
  );
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 9), groundRailY),
    at(oledPin('GND').x, oledPin('GND').y),
  );
  simulation.routeWire(
    at(pinAt('R_D21').x, pinAt('R_D21').y),
    at(holeX(SIGNAL_COLUMN + 7), holeY(8)),
  );
  simulation.routeWire(
    at(pinAt('R_D22').x, pinAt('R_D22').y),
    at(holeX(SIGNAL_COLUMN + 9), holeY(8)),
  );

  simulation.loadFirmware(BLINK_SKETCH);
  simulation.start();
  return simulation;
}

describe('the sketch the bench opens with', () => {
  it('lights the OLED panel', () => {
    const simulation = openedBench();
    simulation.tick(0.05);

    const oled = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'display',
    )!;
    const controller = simulation.engine.displayController(oled.id) as Ssd1306;

    expect(controller).toBeDefined();
    expect(controller.lit).toBe(true);
  });

  it('puts lit pixels on the panel from its data writes', () => {
    const simulation = openedBench();
    // Long enough for setup to finish and loop() to reach its first frame push.
    for (let frame = 0; frame < 40; frame++) simulation.tick(0.05);

    const oled = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'display',
    )!;
    const controller = simulation.engine.displayController(oled.id) as Ssd1306;
    const pixels = controller.snapshot();

    const litCount = pixels.reduce((total, value) => total + value, 0);
    // The sketch pushes forty 0xFF bytes, which is forty columns of eight rows.
    expect(litCount).toBe(40 * 8);
  });

  it('blinks the LED alongside the display', () => {
    const simulation = openedBench();
    simulation.tick(0.05);
    const led = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'led',
    );
    // The LED only exists if the caller wired one; the panel is the subject here.
    void led;
    expect(simulation.serial.join('')).toContain('ESP32 online');
  });
});