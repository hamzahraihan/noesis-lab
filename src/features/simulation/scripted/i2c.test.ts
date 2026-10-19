import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamicState, esp32DevKitV1, type PartDefinition } from '@/features/parts';
import { BenchBuilder } from '../bench';
import { I2CBus } from '../bus/i2c';
import { Engine } from '../engine';
import { McuRuntime } from '../mcu';
import { createScriptedRuntime, type ScriptedRuntime } from './runtime';
import { createScriptedI2c } from './i2c';
import { clearReportedFaults } from './diagnostics';

/**
 * A scripted slave on a bench, asked by the real bus.
 *
 * This is the leg the spec asks for and the one the unit tests cannot give: the
 * script, the runtime, the host, the device, the address gate and the wiring all
 * have to agree before a byte comes back.
 */
const BOARD_ORIGIN_X = 0;

function slave(script: string, id = 'scripted-slave'): PartDefinition {
  return {
    id,
    name: 'Scripted slave',
    category: 'input',
    widthMm: 30,
    heightMm: 12,
    bodyColour: '#5b6b4a',
    legendColour: '#f2f2ee',
    component: { kind: 'scripted', bus: 'i2c', address: 0x50 },
    script,
    pins: [
      { id: 'SDA', label: 'SDA', x: 0, y: 6 },
      { id: 'SCL', label: 'SCL', x: 10, y: 6 },
      { id: 'VCC', label: 'VCC', x: 20, y: 6 },
      { id: 'GND', label: 'GND', x: 30, y: 6, net: 'GND' },
    ],
  };
}

/** The bench shape `devices.test.ts` uses: the bus exists where the board's pins are. */
function scriptedBench(definition: PartDefinition) {
  const builder = new BenchBuilder();
  const esp32 = builder.addPart(esp32DevKitV1(), BOARD_ORIGIN_X, 0);
  const part = builder.addPart(definition, 120, 40);

  const headerPin = (pin: string) => {
    const terminal = builder.build().terminals[part.terminals[pin]];
    return { x: terminal.x, y: terminal.y };
  };
  const boardPin = (id: string) => esp32.definition.pins.find((pin) => pin.id === id)!;
  const wire = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    builder.addWire(from.x, from.y, to.x, to.y);

  wire(headerPin('SDA'), boardPin('R_D21'));
  wire(headerPin('SCL'), boardPin('R_D22'));
  wire(headerPin('VCC'), boardPin('R_3V3'));
  wire(headerPin('GND'), boardPin('L_GND'));

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu, dynamicState: new DynamicState() });
  engine.rebuild();
  const bus = new I2CBus(
    (address, byte, isControl) => engine.writeI2C(address, byte, isControl),
    (address, count) => engine.requestI2C(address, count),
  );
  return { bus, engine, part, parts: () => builder.build().parts };
}

describe('a scripted slave on the I2C bus', () => {
  let runtime: ScriptedRuntime | null = null;

  afterEach(() => {
    runtime?.dispose();
    runtime = null;
    clearReportedFaults();
    vi.restoreAllMocks();
  });

  it('answers the register the pointer was left on', async () => {
    runtime = await createScriptedRuntime();
    const { bus, engine, parts } = scriptedBench(
      slave('({ i2c: { read: ({ register }) => [register, 0x42] } })'),
    );
    engine.setScriptedI2c(createScriptedI2c(runtime, parts));

    bus.beginTransmission(0x50);
    bus.write(0x02);
    expect(bus.endTransmission().acknowledged).toBe(true);

    expect(bus.requestFrom(0x50, 1)).toBe(1);
    expect(bus.read()).toBe(0x02);
  });

  it('lets a write change what the next read answers', async () => {
    runtime = await createScriptedRuntime();
    const { bus, engine, parts } = scriptedBench(
      slave(
        '(() => { const registers = {}; return { i2c: {' +
          ' read: ({ register }) => [registers[register] ?? 0],' +
          ' write: ({ register, bytes }) => { registers[register] = bytes[0] ?? 0; },' +
          ' } }; })()',
      ),
    );
    engine.setScriptedI2c(createScriptedI2c(runtime, parts));

    bus.beginTransmission(0x50);
    bus.write(0x02);
    bus.write(0x5a);
    expect(bus.endTransmission().acknowledged).toBe(true);

    expect(bus.requestFrom(0x50, 1)).toBe(1);
    expect(bus.read()).toBe(0x5a);
  });

  it('NACKs a device that faulted, and says so once', async () => {
    runtime = await createScriptedRuntime();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { bus, engine, parts } = scriptedBench(
      slave('({ i2c: { read: () => { throw new Error("not that register"); } } })'),
    );
    engine.setScriptedI2c(createScriptedI2c(runtime, parts));

    expect(bus.requestFrom(0x50, 1)).toBe(0);
    // The latch: a second question does not re-run the script, and does not
    // repeat the same line in the log.
    expect(bus.requestFrom(0x50, 1)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('not that register');
  });

  it('stays silent when the part is not wired onto the bus', async () => {
    runtime = await createScriptedRuntime();
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), BOARD_ORIGIN_X, 0);
    builder.addPart(slave('({ i2c: { read: () => [0x77] } })'), 120, 40);

    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu, dynamicState: new DynamicState() });
    engine.rebuild();
    engine.setScriptedI2c(createScriptedI2c(runtime, () => builder.build().parts));

    // Nothing says where the part's lines go, so the address answers nobody --
    // the same failure a sensor on the wrong pins has, which is the point.
    expect(engine.requestI2C(0x50, 1)).toEqual([]);
  });
});
