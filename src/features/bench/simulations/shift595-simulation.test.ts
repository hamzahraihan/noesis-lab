import { describe, expect, it } from 'vitest';
import { arduinoUnoR3, shift595Definition } from '@/features/parts';
import { DIODE_PROFILES, ledDefinition, resistorDefinition } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

/**
 * A bench with the shift register wired to the Uno's SPI block, and an LED on
 * one of its outputs.
 *
 * The Uno's hardware SPI sits on D10 (chip select), D9 (data/command), D13
 * (clock) and D11 (MOSI), so the register's clock and data in land on the bus
 * and the latch is an ordinary pin the sketch drives.
 */
function shiftBench() {
  const simulation = new Simulation(arduinoUnoR3());
  const board = simulation.addPart(arduinoUnoR3(), 0, 0);
  const register = simulation.addPart(shift595Definition(), 200, 0);
  const led = simulation.addPart(ledDefinition(DIODE_PROFILES.red, 'Red'), 300, 0);
  const resistor = simulation.addPart(resistorDefinition(220), 320, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(register, 'SRCLK'), pin(board, 'J1_D13'));
  simulation.routeWire(pin(register, 'SER'), pin(board, 'J1_D11'));
  simulation.routeWire(pin(register, 'RCLK'), pin(board, 'J1_D2'));
  simulation.routeWire(pin(register, 'OE'), pin(board, 'J1_D3'));
  simulation.routeWire(pin(register, 'VCC'), pin(board, 'J2_5V'));
  simulation.routeWire(pin(register, 'GND'), pin(board, 'J1_GND'));
  simulation.routeWire(pin(led, 'anode'), pin(register, 'Q7'));
  simulation.routeWire(pin(led, 'cathode'), pin(resistor, 'a'));
  simulation.routeWire(pin(resistor, 'b'), pin(board, 'J1_GND'));
  return { simulation, register, led };
}

const SKETCH = `
#define LATCH 2
#define OE 3

void setup() {
  pinMode(LATCH, OUTPUT);
  pinMode(OE, OUTPUT);
  digitalWrite(OE, HIGH);
  SPI.begin();
  digitalWrite(LATCH, LOW);
  // The chip's shift register moves toward Q7, so the bit that is set here --
  // the first one sent -- lands on Q7.
  SPI.transfer(0b10000000);
  digitalWrite(LATCH, HIGH);
}

void loop() { delay(1000); }
`;

describe('the shift register on a bench', () => {
  it('lights an LED from a byte shifted in over SPI', () => {
    const { simulation, led } = shiftBench();
    simulation.loadFirmware(SKETCH);
    simulation.start();
    for (let i = 0; i < 20; i++) simulation.tick(0.05);

    const netlist = simulation.engine.currentNetlist;
    const anode = netlist.pinNode.get(`${led.id}:anode`)!;
    const cathode = netlist.pinNode.get(`${led.id}:cathode`)!;
    const across = simulation.engine.voltageOfNet(anode) - simulation.engine.voltageOfNet(cathode);
    // The bit that was shifted in is on the outputs, and the LED is across it.
    expect(across).toBeGreaterThan(1);
  });

  it('leaves the outputs dark when the sketch shifts nothing', () => {
    const { simulation, led } = shiftBench();
    simulation.loadFirmware(
      `
void setup() {
  pinMode(2, OUTPUT);
  pinMode(3, OUTPUT);
  digitalWrite(3, HIGH);
  SPI.begin();
}

void loop() { delay(1000); }
`,
    );
    simulation.start();
    for (let i = 0; i < 20; i++) simulation.tick(0.05);

    const netlist = simulation.engine.currentNetlist;
    const anode = netlist.pinNode.get(`${led.id}:anode`)!;
    const cathode = netlist.pinNode.get(`${led.id}:cathode`)!;
    expect(simulation.engine.voltageOfNet(anode) - simulation.engine.voltageOfNet(cathode)).toBeLessThan(0.5);
  });
});
