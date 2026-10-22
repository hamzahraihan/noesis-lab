import { describe, expect, it } from 'vitest';
import { arduinoUnoR3, max7219Definition } from '@/features/parts';
import { Max7219 } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

/**
 * A bench with the matrix wired to the Uno's SPI block.
 *
 * Data in lands on MOSI (D11) and the clock on SCK (D13); chip select is an
 * ordinary pin the sketch drives, as it is on a real module.
 */
function matrixBench() {
  const simulation = new Simulation(arduinoUnoR3());
  const board = simulation.addPart(arduinoUnoR3(), 0, 0);
  const matrix = simulation.addPart(max7219Definition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(matrix, 'DIN'), pin(board, 'J1_D11'));
  simulation.routeWire(pin(matrix, 'CLK'), pin(board, 'J1_D13'));
  simulation.routeWire(pin(matrix, 'CS'), pin(board, 'J1_D10'));
  return { simulation, matrix };
}

/** Drives the bench long enough for the sketch's setup to have run. */
function settle(simulation: Simulation): void {
  simulation.start();
  for (let i = 0; i < 20; i++) simulation.tick(0.05);
}

const SKETCH = `
void setup() {
  // Wake the chip, then turn it up: the intensity register is its only
  // brightness control, and it powers up at the dimmest setting.
  SPI.begin();
  SPI.transfer(0x0C);
  SPI.transfer(0x01);
  SPI.end();
  SPI.begin();
  SPI.transfer(0x0A);
  SPI.transfer(0x0F);
  SPI.end();
  // DIGIT0 is the first column; bit 0 of its register is the top row.
  SPI.begin();
  SPI.transfer(0x01);
  SPI.transfer(0b00000011);
  SPI.end();
}

void loop() { delay(1000); }
`;

describe('the MAX7219 matrix on a bench', () => {
  it('lights the register bits a sketch writes over SPI', () => {
    const { simulation, matrix } = matrixBench();
    simulation.loadFirmware(SKETCH);
    settle(simulation);

    const controller = simulation.engine.displayController(matrix.id);
    expect(controller).toBeInstanceOf(Max7219);
    const glass = controller as Max7219;
    expect(glass.lit).toBe(true);
    expect(glass.isLit(0, 0)).toBe(true);
    expect(glass.isLit(0, 1)).toBe(true);
    // The third bit of DIGIT0 was never set, and no other column was written.
    expect(glass.isLit(0, 2)).toBe(false);
    expect(glass.isLit(1, 0)).toBe(false);
    expect(glass.brightness).toBe(1);
  });

  it('holds a frame until chip-select rises', () => {
    const { simulation, matrix } = matrixBench();
    simulation.loadFirmware(`
void setup() {
  SPI.begin();
  SPI.transfer(0x0C);
  SPI.transfer(0x01);
  SPI.end();
  // Two bytes that are a whole frame, and no chip-select rise to latch it.
  SPI.begin();
  SPI.transfer(0x01);
  SPI.transfer(0xFF);
}

void loop() { delay(1000); }
`);
    settle(simulation);

    const glass = simulation.engine.displayController(matrix.id) as Max7219;
    expect(glass.lit).toBe(true);
    expect(glass.isLit(0, 0)).toBe(false);
  });

  it('hears nothing when its clock is not on the bus', () => {
    const simulation = new Simulation(arduinoUnoR3());
    const board = simulation.addPart(arduinoUnoR3(), 0, 0);
    const matrix = simulation.addPart(max7219Definition(), 200, 0);
    const pin = (part: PartInstance, pinId: string) => {
      const found = part.definition.pins.find((p) => p.id === pinId)!;
      return { id: -1, x: part.x + found.x, y: part.y + found.y };
    };
    simulation.routeWire(pin(matrix, 'DIN'), pin(board, 'J1_D11'));
    // The clock lands on a plain output, so the module never sees a clock.
    simulation.routeWire(pin(matrix, 'CLK'), pin(board, 'J1_D5'));
    simulation.routeWire(pin(matrix, 'CS'), pin(board, 'J1_D10'));

    simulation.loadFirmware(SKETCH);
    settle(simulation);

    const glass = simulation.engine.displayController(matrix.id) as Max7219;
    expect(glass.lit).toBe(false);
    expect(glass.isLit(0, 0)).toBe(false);
  });
});
