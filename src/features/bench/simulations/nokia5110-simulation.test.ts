import { describe, expect, it } from 'vitest';
import { arduinoUnoR3, nokia5110Definition } from '@/features/parts';
import { Pcd8544 } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

/**
 * A bench with the Nokia panel on the Uno's SPI block.
 *
 * Data in and clock are the bus's wires, chip select and data/command are
 * ordinary pins, and reset is a pin the sketch pulses. The module's header
 * names them CE, DIN and CLK; the definition uses the controller's own names
 * so the bus gate can read them.
 */
function nokiaBench() {
  const simulation = new Simulation(arduinoUnoR3());
  const board = simulation.addPart(arduinoUnoR3(), 0, 0);
  const panel = simulation.addPart(nokia5110Definition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(panel, 'SCK'), pin(board, 'J1_D13'));
  simulation.routeWire(pin(panel, 'MOSI'), pin(board, 'J1_D11'));
  simulation.routeWire(pin(panel, 'CS'), pin(board, 'J1_D10'));
  simulation.routeWire(pin(panel, 'DC'), pin(board, 'J1_D9'));
  simulation.routeWire(pin(panel, 'RESET'), pin(board, 'J1_D8'));
  return { simulation, panel };
}

/** Drives the bench long enough for the sketch's setup to have run. */
function settle(simulation: Simulation): void {
  simulation.start();
  for (let i = 0; i < 20; i++) simulation.tick(0.05);
}

const SKETCH = `
#define CS 10
#define DC 9

void command(byte value) {
  // On this bench the data/command line travels with the byte.
  SPI.transfer(value, 0);
}

void setup() {
  pinMode(CS, OUTPUT);
  pinMode(DC, OUTPUT);
  pinMode(8, OUTPUT);
  digitalWrite(8, LOW);
  delay(1);
  digitalWrite(8, HIGH);
  SPI.begin();
  command(0x21);       // extended instruction set
  command(0xBF);       // contrast
  command(0x20);       // back to the basic set
  command(0x0C);       // display on
  command(0x80 | 5);   // X = 5
  command(0x40 | 2);   // Y = 2
  SPI.transfer(0b00000101);
  SPI.end();
}

void loop() { delay(1000); }
`;

describe('the Nokia 5110 on a bench', () => {
  it('shows the bits a sketch writes to an addressed column', () => {
    const { simulation, panel } = nokiaBench();
    simulation.loadFirmware(SKETCH);
    settle(simulation);

    const controller = simulation.engine.displayController(panel.id);
    expect(controller).toBeInstanceOf(Pcd8544);
    const glass = controller as Pcd8544;
    expect(glass.lit).toBe(true);
    expect(glass.isLit(5, 16)).toBe(true);
    expect(glass.isLit(5, 17)).toBe(false);
    expect(glass.isLit(5, 18)).toBe(true);
    expect(glass.brightness).toBeCloseTo(0x3f / 0x7f);
  });

  it('reads a command as data when the sketch does not say which it is', () => {
    const { simulation, panel } = nokiaBench();
    // The same bytes with the port's default: data, not commands. Nothing the
    // panel understands, so it stays blanked.
    simulation.loadFirmware(`
void setup() {
  pinMode(10, OUTPUT);
  pinMode(9, OUTPUT);
  SPI.begin();
  SPI.transfer(0x21);
  SPI.transfer(0xBF);
  SPI.transfer(0x20);
  SPI.transfer(0x0C);
}

void loop() { delay(1000); }
`);
    settle(simulation);

    const glass = simulation.engine.displayController(panel.id) as Pcd8544;
    expect(glass.lit).toBe(false);
    expect(glass.isLit(0, 0)).toBe(false);
  });

  it('hears nothing when data and command land on a plain pin', () => {
    const simulation = new Simulation(arduinoUnoR3());
    const board = simulation.addPart(arduinoUnoR3(), 0, 0);
    const panel = simulation.addPart(nokia5110Definition(), 200, 0);
    const pin = (part: PartInstance, pinId: string) => {
      const found = part.definition.pins.find((p) => p.id === pinId)!;
      return { id: -1, x: part.x + found.x, y: part.y + found.y };
    };
    simulation.routeWire(pin(panel, 'SCK'), pin(board, 'J1_D13'));
    simulation.routeWire(pin(panel, 'MOSI'), pin(board, 'J1_D11'));
    simulation.routeWire(pin(panel, 'CS'), pin(board, 'J1_D10'));
    // D/C on D7, which is not one of the board's SPI pins.
    simulation.routeWire(pin(panel, 'DC'), pin(board, 'J1_D7'));
    simulation.routeWire(pin(panel, 'RESET'), pin(board, 'J1_D8'));

    simulation.loadFirmware(SKETCH);
    settle(simulation);

    const glass = simulation.engine.displayController(panel.id) as Pcd8544;
    expect(glass.lit).toBe(false);
  });
});
