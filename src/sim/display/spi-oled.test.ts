import { describe, expect, it } from 'vitest';
import { columnX, railRowY, stripRowY, breadboardDefinition } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import { ssd1306SpiDefinition } from './part';
import { Ssd1306 } from './ssd1306';
import { Simulation } from '../../ui/simulation';
import { renderedSizeMm, wokwiPartFor } from '../../ui/wokwi';

describe('SPI OLED definition', () => {
  it('exposes the eight-pin SPI header', () => {
    const def = ssd1306SpiDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['VCC', 'GND', 'CS', 'RESET', 'DC', 'MOSI', 'SCK', 'VIN']);
    expect([def.widthMm, def.heightMm]).toEqual([39.69, 30.69]);
  });
});

describe('SSD1306 over SPI', () => {
  it('routes D/C-selected bytes to commands and data', () => {
    const panel = new Ssd1306();
    panel.receiveSpi(0xaf, false, true);
    expect(panel.lit).toBe(true);
    panel.receiveSpi(0xb0, false, true);
    panel.receiveSpi(0x00, false, true);
    panel.receiveSpi(0x10, false, true);
    panel.receiveSpi(0xff, true, true);
    expect(panel.isLit(0, 0)).toBe(true);
  });

  it('ignores bytes arriving deselected', () => {
    const panel = new Ssd1306();
    panel.receiveSpi(0xaf, false, false);
    expect(panel.lit).toBe(false);
  });
});

const BREADBOARD_ORIGIN_X = 230;
const SPI_COLUMN = 33;

const holeX = (column: number) => BREADBOARD_ORIGIN_X + columnX(column);
const holeY = (row: number) => stripRowY(row);

/** ESP32 VSPI pins to the OLED's silkscreen labels. */
const SPI_LINKS: ReadonlyArray<[string, string]> = [
  ['R_D5', 'CS'],
  ['R_D15', 'DC'],
  ['R_D18', 'SCK'],
  ['R_D23', 'MOSI'],
];

function spiOledBench(options: { omitSignal?: string } = {}): Simulation {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  void board;
  simulation.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);
  const oled = simulation.addPart(ssd1306SpiDefinition(), BREADBOARD_ORIGIN_X + 55, 120);

  const pinAt = (id: string) => {
    const part = simulation.bench.parts[0];
    const pin = part.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`no pin ${id}`);
    return { x: part.x + pin.x, y: part.y + pin.y };
  };
  const oledPin = (id: string) => {
    const pin = oled.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`OLED has no pin ${id}`);
    return { x: oled.x + pin.x, y: oled.y + pin.y };
  };
  const at = (x: number, y: number) => ({ id: -1, x, y });

  SPI_LINKS.forEach(([boardPin, signal], index) => {
    if (signal === options.omitSignal) return;
    const column = SPI_COLUMN + index * 2;
    const from = pinAt(boardPin);
    simulation.routeWire(at(from.x, from.y), at(holeX(column), holeY(8)));
    const to = oledPin(signal);
    simulation.routeWire(at(holeX(column), holeY(8)), at(to.x, to.y));
  });

  const railY = railRowY(2);
  const vcc = oledPin('VCC');
  const gnd = oledPin('GND');
  simulation.routeWire(at(holeX(SPI_COLUMN), railY), at(vcc.x, vcc.y));
  simulation.routeWire(at(holeX(SPI_COLUMN + 2), railY), at(gnd.x, gnd.y));

  return simulation;
}

function run(simulation: Simulation, source: string, ms: number): void {
  simulation.loadFirmware(source);
  simulation.start();
  let guard = 0;
  while (simulation.engine.timeMs < ms && guard++ < 4000) simulation.tick(0.01);
}

const SKETCH = `
void setup() {
  SPI.begin();
  SPI.beginTransaction();
  SPI.transfer(0xAE, 0);
  SPI.transfer(0xAF, 0);
  SPI.transfer(0xB0, 0);
  SPI.transfer(0x00, 0);
  SPI.transfer(0x10, 0);
  SPI.end();
  SPI.beginTransaction();
  for (int i = 0; i < 8; i++) { SPI.transfer(0xFF, 1); }
  SPI.end();
}
void loop() {
  delay(500);
}
`;

function spiOledOf(simulation: Simulation): Ssd1306 {
  const part = simulation.bench.parts.find(
    (candidate) =>
      candidate.definition.component.kind === 'display' &&
      candidate.definition.component.controller === 'ssd1306-spi',
  )!;
  return simulation.engine.displayController(part.id) as Ssd1306;
}

describe('SPI OLED on the bench', () => {
  it('lights from D/C-selected commands and data', () => {
    const simulation = spiOledBench();
    run(simulation, SKETCH, 200);
    const oled = spiOledOf(simulation);
    expect(oled.lit).toBe(true);
    expect(oled.isLit(0, 0)).toBe(true);
  });

  it('stays dark when chip-select is missing', () => {
    const simulation = spiOledBench({ omitSignal: 'CS' });
    run(simulation, SKETCH, 200);
    expect(spiOledOf(simulation).lit).toBe(false);
  });

  it('selection box matches the module artwork', () => {
    const drawn = renderedSizeMm(ssd1306SpiDefinition());
    expect(drawn.widthMm).toBe(39.69);
    expect(drawn.heightMm).toBe(30.69);
    expect(wokwiPartFor(ssd1306SpiDefinition())?.tag).toBe('wokwi-ssd1306');
  });
});
