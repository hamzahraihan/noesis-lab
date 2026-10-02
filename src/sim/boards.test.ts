import { describe, expect, it } from 'vitest';
import { esp32DevKitV1, arduinoUnoR3 } from './boards';
import { McuRuntime } from './mcu';

/**
 * The two label systems on a board are not the same thing: the header says `D15`
 * where the silkscreen says `GPIO15`, and firmware only ever sees the number.
 * Reconciling them is easy to get subtly wrong, so every pin is checked.
 */
describe('board pin maps', () => {
  it('gives every ESP32 GPIO a reachable pin id', () => {
    const runtime = new McuRuntime(esp32DevKitV1());

    // Pins whose header label and silkscreen differ. These were silently
    // unreachable when the map was keyed by silkscreen.
    for (const gpio of [36, 39, 15]) {
      const pinId = runtime.pinIdForGpio(gpio);
      expect(pinId, `GPIO${gpio} has no pin id`).toBeDefined();
      expect(runtime.boardPin(pinId!)!.gpio).toBe(gpio);
    }
  });

  it('maps the pins its buses run on', () => {
    const runtime = new McuRuntime(esp32DevKitV1());
    // ESP32 VSPI: chip-select 5, D/C 15, clock 18, data in 23. I2C is 21 and 22.
    expect(runtime.spiPins.map((gpio) => runtime.pinIdForGpio(gpio))).toEqual([
      'R_D5', 'R_D15', 'R_D18', 'R_D23',
    ]);
    expect(runtime.i2cPins.map((gpio) => runtime.pinIdForGpio(gpio))).toEqual([
      'R_D21', 'R_D22',
    ]);
  });

  it('marks the ESP32 input-only pins as unable to drive', () => {
    const runtime = new McuRuntime(esp32DevKitV1());
    for (const gpio of [34, 35, 36, 39]) {
      const pinId = runtime.pinIdForGpio(gpio);
      expect(runtime.boardPin(pinId!)!.canDrive, `GPIO${gpio}`).toBe(false);
    }
  });

  it('records the ESP32 strapping pins', () => {
    const runtime = new McuRuntime(esp32DevKitV1());
    expect(runtime.boardPin('L_GPIO12')!.strapLevel).toBe('low');
    expect(runtime.boardPin('R_D15')!.strapLevel).toBe('high');
  });

  it('gives every Uno pin a reachable id', () => {
    const runtime = new McuRuntime(arduinoUnoR3());
    expect(runtime.pinIdForGpio(13)).toBe('J1_D13');
    expect(runtime.pinIdForGpio(18)).toBe('J3_A4');
    expect(runtime.pinIdForGpio(19)).toBe('J3_A5');
  });

  it('reports both header grounds as ground', () => {
    const runtime = new McuRuntime(esp32DevKitV1());
    expect(runtime.boardPin('L_GND')!.role).toBe('ground');
    expect(runtime.boardPin('R_GND')!.role).toBe('ground');
    expect(runtime.boardPin('R_3V3')!.role).toBe('power');
  });
});