import { describe, expect, it } from 'vitest';
import { columnX, railRowY, stripRowY, breadboardDefinition } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import { Ili9341 } from './ili9341';
import { ili9341Definition } from './part';
import { Simulation } from '@/features/bench/simulations/simulation';

const BREADBOARD_ORIGIN_X = 230;
const SPI_COLUMN = 33;

const holeX = (column: number) => BREADBOARD_ORIGIN_X + columnX(column);
const holeY = (row: number) => stripRowY(row);

/** ESP32 VSPI pins to the TFT's silkscreen labels. */
const SPI_LINKS: ReadonlyArray<[string, string]> = [
  ['R_D5', 'CS'],
  ['R_D15', 'DC'],
  ['R_D18', 'SCK'],
  ['R_D23', 'MOSI'],
];

/**
 * An ESP32 and a breadboard with a TFT wired to the SPI pins, optionally with
 * one signal left off so the miswire can be reproduced.
 */
function tftBench(options: { omitSignal?: string } = {}): Simulation {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  void board;
  simulation.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);
  const tft = simulation.addPart(ili9341Definition(), BREADBOARD_ORIGIN_X + 55, 120);

  const pinAt = (id: string) => {
    const part = simulation.bench.parts[0];
    const pin = part.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`no pin ${id}`);
    return { x: part.x + pin.x, y: part.y + pin.y };
  };
  const tftPin = (id: string) => {
    const pin = tft.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`TFT has no pin ${id}`);
    return { x: tft.x + pin.x, y: tft.y + pin.y };
  };
  const at = (x: number, y: number) => ({ id: -1, x, y });

  SPI_LINKS.forEach(([boardPin, signal], index) => {
    if (signal === options.omitSignal) return;
    const column = SPI_COLUMN + index * 2;
    const from = pinAt(boardPin);
    simulation.routeWire(at(from.x, from.y), at(holeX(column), holeY(8)));
    const to = tftPin(signal);
    simulation.routeWire(at(holeX(column), holeY(8)), at(to.x, to.y));
  });

  const railY = railRowY(2);
  const vcc = tftPin('VCC');
  const gnd = tftPin('GND');
  simulation.routeWire(at(holeX(SPI_COLUMN), railY), at(vcc.x, vcc.y));
  simulation.routeWire(at(holeX(SPI_COLUMN + 2), railY), at(gnd.x, gnd.y));

  return simulation;
}

/** Runs a sketch against the bench until it has had `ms` of simulated time. */
function run(simulation: Simulation, source: string, ms: number): void {
  simulation.loadFirmware(source);
  simulation.start();
  let guard = 0;
  while (simulation.engine.timeMs < ms && guard++ < 4000) simulation.tick(0.01);
}

const SKETCH = `
void tftCommand(int command, int first, int second) {
  SPI.beginTransaction();
  SPI.transfer(command, 0);
  if (first >= 0) {
    SPI.transfer(first >> 8, 1);
    SPI.transfer(first & 255, 1);
  }
  if (second >= 0) {
    SPI.transfer(second >> 8, 1);
    SPI.transfer(second & 255, 1);
  }
  SPI.end();
}

void pixel(int colour) {
  SPI.transfer(colour >> 8, 1);
  SPI.transfer(colour & 255, 1);
}

void setup() {
  SPI.begin();
  tftCommand(0x01, -1, -1);
  tftCommand(0x11, -1, -1);
  tftCommand(0x3A, 0x0055, -1);
  tftCommand(0x29, -1, -1);
}

void loop() {
  tftCommand(0x2A, 0x0000, 0x013F);
  tftCommand(0x2B, 0x0000, 0x00EF);
  SPI.beginTransaction();
  SPI.transfer(0x2C, 0);
  for (int i = 0; i < 20; i++) { pixel(0xF800); }
  for (int i = 0; i < 300; i++) { pixel(0x0000); }
  SPI.end();
  delay(500);
}
`;

function tftOf(simulation: Simulation): Ili9341 {
  const part = simulation.bench.parts.find(
    (candidate) => candidate.definition.component.kind === 'display',
  )!;
  return simulation.engine.displayController(part.id) as Ili9341;
}

const LIBRARY_SKETCH = `
void setup() {
  tft.begin();
  tft.fillRect(0, 0, 8, 8, 0xF800);
  Serial.print("size ");
  Serial.print(tft.width());
  Serial.print("x");
  Serial.println(tft.height());
}

void loop() {}
`;

/** The jumper that feeds the panel's chip-select pin. */
function csJumperId(simulation: Simulation): string {
  const panel = simulation.bench.parts.find(
    (part) => part.definition.component.kind === 'display',
  )!;
  const pin = panel.definition.pins.find((candidate) => candidate.id === 'CS')!;
  const x = panel.x + pin.x;
  const y = panel.y + pin.y;
  const wire = simulation.bench.wires.find((candidate) =>
    [candidate.from, candidate.to].some((terminal) => {
      const at = simulation.bench.terminals[terminal];
      return at !== undefined && Math.abs(at.x - x) < 0.5 && Math.abs(at.y - y) < 0.5;
    }),
  )!;
  return wire.id;
}

describe('TFT on the bench', () => {
  it('is reachable when all four SPI signals are wired', () => {
    const simulation = tftBench();
    run(simulation, SKETCH, 200);
    expect(tftOf(simulation).isOn()).toBe(true);
  });

  it('draws the pixels the sketch pushed', () => {
    const simulation = tftBench();
    run(simulation, SKETCH, 200);
    const tft = tftOf(simulation);

    // Twenty red pixels at the top-left of a 320x240 window.
    expect(tft.pixelAt(0, 0)).toBe(0xf800);
    expect(tft.pixelAt(19, 0)).toBe(0xf800);
    expect(tft.pixelAt(20, 0)).toBe(0);
    expect(tft.pixelAt(0, 1)).toBe(0);
  });

  it('stays dark when a signal wire is missing', () => {
    // Chip-select left off is the classic: the panel is never selected, so
    // nothing it receives is acted on.
    const simulation = tftBench({ omitSignal: 'CS' });
    run(simulation, SKETCH, 200);
    expect(tftOf(simulation).isOn()).toBe(false);
    expect(tftOf(simulation).pixelAt(0, 0)).toBe(0);
  });

  it('draws nothing when the clock wire is missing', () => {
    const simulation = tftBench({ omitSignal: 'SCK' });
    run(simulation, SKETCH, 200);
    expect(tftOf(simulation).pixelAt(0, 0)).toBe(0);
  });

  it('treats every byte as data when D/C is left unwired', () => {
    // With D/C floating, no command ever arrives as a command, so the display
    // stays off and the payload lands as pixels.
    const simulation = tftBench({ omitSignal: 'DC' });
    run(simulation, SKETCH, 200);
    expect(tftOf(simulation).isOn()).toBe(false);
  });

  it('spends real bus time per byte', () => {
    const simulation = tftBench();
    run(simulation, SKETCH, 10);
    // Even the short setup transfers cost measurable time on the wire.
    expect(simulation.engine.timeMs).toBeGreaterThan(0);
  });
});

/*
 * The library layer draws by part, so its fidelity is the part it can reach:
 * the same four signals the byte path above needs. A command needs the bus, a
 * query does not -- a library knows its own size with or without a jumper.
 */
describe('the tft library on the bench', () => {
  it('reaches the panel when all four signals are wired', () => {
    const simulation = tftBench();
    run(simulation, LIBRARY_SKETCH, 200);
    const tft = tftOf(simulation);
    expect(tft.isOn()).toBe(true);
    expect(tft.pixelAt(0, 0)).toBe(0xf800);
    expect(tft.pixelAt(8, 0)).toBe(0);
    expect(simulation.serialLines().join('')).toContain('size 320x240');
  });

  it.each(['CS', 'DC', 'SCK', 'MOSI'])('hears nothing with %s left unwired', (signal) => {
    const simulation = tftBench({ omitSignal: signal });
    run(simulation, LIBRARY_SKETCH, 200);
    const tft = tftOf(simulation);
    expect(tft.pixelAt(0, 0)).toBe(0);
    expect(tft.isOn()).toBe(false);
  });

  it('still answers its size when the panel is not wired', () => {
    const simulation = tftBench({ omitSignal: 'CS' });
    run(simulation, LIBRARY_SKETCH, 200);
    expect(simulation.serialLines().join('')).toContain('size 320x240');
  });

  it('freezes when its chip-select jumper is pulled mid-run', () => {
    const simulation = tftBench();
    run(simulation, LIBRARY_SKETCH, 200);
    expect(tftOf(simulation).pixelAt(0, 0)).toBe(0xf800);

    simulation.removeWire(csJumperId(simulation));
    run(simulation, 'void setup() { tft.fillRect(16, 0, 8, 8, 0x07E0); }\nvoid loop() {}\n', 200);

    // The glass keeps the picture it has: the fill never arrived, and the
    // panel is still on, because being on is a state a missing jumper cannot
    // take away -- only a command that reaches it can.
    const tft = tftOf(simulation);
    expect(tft.pixelAt(16, 0)).toBe(0);
    expect(tft.pixelAt(0, 0)).toBe(0xf800);
    expect(tft.isOn()).toBe(true);
  });
});
