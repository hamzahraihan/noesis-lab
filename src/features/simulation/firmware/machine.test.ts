import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

/**
 * The `machine` surface, run through the VM.
 *
 * MicroPython is the language the RP2040 boards' firmware speaks, so this is
 * the other half of `gpiozero.test.ts`: the same VM, the same pins, the
 * spelling Cypress and the Pico's own docs use. The host is a stub for the
 * same reason -- what is being pinned down is what the firmware asked the
 * hardware to do.
 */
interface Host {
  readonly services: FirmwareServices;
  readonly writes: ReadonlyArray<{ pin: number; level: number }>;
  readonly analogWrites: ReadonlyArray<{ pin: number; value: number }>;
  readonly modes: ReadonlyArray<{ pin: number; mode: number }>;
  readonly serial: string[];
  readonly bus: string[];
  /** Bytes a `readfrom*` call should answer with, in order. */
  readonly reply: number[];
  readonly inputs: Map<number, number>;
  readonly analog: Map<number, number>;
}

function host(): Host {
  const writes: { pin: number; level: number }[] = [];
  const analogWrites: { pin: number; value: number }[] = [];
  const modes: { pin: number; mode: number }[] = [];
  const serial: string[] = [];
  const bus: string[] = [];
  const reply: number[] = [];
  const inputs = new Map<number, number>();
  const analog = new Map<number, number>();

  return {
    writes,
    analogWrites,
    modes,
    serial,
    bus,
    reply,
    inputs,
    analog,
    services: {
      nowMs: () => 0,
      pinMode: (pin: number, mode: number) => modes.push({ pin, mode }),
      digitalWrite: (pin: number, level: number) => writes.push({ pin, level }),
      digitalRead: (pin: number) => inputs.get(pin) ?? 0,
      analogWrite: (pin: number, value: number) => analogWrites.push({ pin, value }),
      analogRead: (pin: number) => analog.get(pin) ?? 0,
      adcFullScale: 4095,
      serialBegin: () => {},
      serialWrite: (text: string) => serial.push(text),
      wire: {
        begin: (sda: number, scl: number) => bus.push(`begin ${sda} ${scl}`),
        beginTransmission: (address: number) => bus.push(`start ${address}`),
        write: (value: number) => {
          bus.push(`write ${value}`);
          return 1;
        },
        endTransmission: () => {
          bus.push('end');
          return 0;
        },
        requestFrom: (address: number, count: number) => {
          bus.push(`request ${address} ${count}`);
          return count;
        },
        read: () => reply.shift() ?? 0,
        available: () => reply.length,
      },
      spi: {} as never,
    } as unknown as FirmwareServices,
  };
}

function run(source: string, target: Host, turnsAfter = 60): { serial: string; steps: number } {
  const runner = new FirmwareRunner(source, target.services, 'python');
  for (let step = 0; step < turnsAfter; step++) {
    const wait = runner.step();
    if (wait === null) return { serial: runner.output.join(''), steps: step };
  }
  return { serial: runner.output.join(''), steps: turnsAfter };
}

describe('machine.Pin', () => {
  it('drives and reads the pin a program named', () => {
    const target = host();
    run(
      [
        'from machine import Pin',
        'led = Pin(2, Pin.OUT)',
        'led.value(1)',
        'led.value(0)',
        'led.on()',
        'led.off()',
      ].join('\n'),
      target,
    );

    expect(target.writes).toEqual([
      { pin: 2, level: 1 },
      { pin: 2, level: 0 },
      { pin: 2, level: 1 },
      { pin: 2, level: 0 },
    ]);
    expect(target.modes).toEqual([{ pin: 2, mode: 1 }]);
  });

  it('settles an input without a pull, and reports what the line reads', () => {
    const target = host();
    target.inputs.set(4, 1);
    run('from machine import Pin\nbutton = Pin(4)\nprint(button.value())\n', target);

    // PIN_INPUT is 0: MicroPython's default, unlike gpiozero's pulled-up one.
    expect(target.modes).toEqual([{ pin: 4, mode: 0 }]);
    expect(target.serial).toEqual(['1\n']);
  });

  it('pulls an input up when the constructor asks for it', () => {
    const target = host();
    run('from machine import Pin\nbutton = Pin(4, Pin.IN, Pin.PULL_UP)\n', target);

    expect(target.modes).toEqual([{ pin: 4, mode: 2 }]);
  });

  it('accepts the qualified spelling, module and all', () => {
    const target = host();
    run('import machine\nled = machine.Pin(5, machine.Pin.OUT)\nled.value(1)\n', target);

    expect(target.writes).toEqual([{ pin: 5, level: 1 }]);
  });
});

describe('machine.ADC', () => {
  it('answers read_u16 in sixteen-bit counts, whatever the board converts in', () => {
    const target = host();
    target.analog.set(26, 2048);
    run('from machine import ADC, Pin\nprobe = ADC(Pin(26))\nprint(probe.read_u16())\n', target);

    // 2048/4095 of the sixteen-bit scale, the same proportion the board converted.
    expect(target.serial).toEqual(['32776\n']);
  });

  it('takes the channel number as well as a Pin', () => {
    const target = host();
    target.analog.set(27, 1024);
    run('from machine import ADC\nprobe = ADC(27)\nprint(probe.read())\n', target);

    expect(target.serial).toEqual(['1024\n']);
  });
});

describe('machine.PWM', () => {
  it('scales a sixteen-bit duty onto the pin', () => {
    const target = host();
    run('from machine import PWM, Pin\nled = PWM(Pin(2))\nled.duty_u16(32768)\n', target);

    expect(target.analogWrites).toEqual([{ pin: 2, value: 128 }]);
    expect(target.modes).toEqual([{ pin: 2, mode: 1 }]);
  });
});

describe('machine.I2C', () => {
  it('writes a register the datasheet way', () => {
    const target = host();
    run('from machine import I2C\ni2c = I2C(0)\ni2c.writeto_mem(0x68, 0, 30)\n', target);

    expect(target.bus).toEqual(['start 104', 'write 0', 'write 30', 'end']);
  });

  it('reads bytes back and lets the program index them', () => {
    const target = host();
    target.reply.push(0x12, 0x34);
    run(
      ['from machine import I2C', 'i2c = I2C(0)', 'data = i2c.readfrom_mem(0x68, 0, 2)', 'print(data[0])', 'print(data[1])'].join(
        '\n',
      ),
      target,
    );

    expect(target.bus).toEqual(['start 104', 'write 0', 'end', 'request 104 2']);
    expect(target.serial).toEqual(['18\n', '52\n']);
  });
});
