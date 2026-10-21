import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

/**
 * The gpiozero surface, run through the VM.
 *
 * `python.test.ts` covers the grammar; this covers what a program does once it
 * has parsed. The host is a stub rather than the circuit solver because the
 * contract being pinned down here is "what did the firmware ask the hardware to
 * do" -- which pin, which level, how long it waited -- and a stub is where that
 * is legible without also asserting the solver's behaviour all over again.
 */
interface Host {
  readonly services: FirmwareServices;
  readonly writes: ReadonlyArray<{ pin: number; level: number }>;
  readonly analog: ReadonlyArray<{ pin: number; value: number }>;
  readonly modes: ReadonlyArray<{ pin: number; mode: number }>;
  readonly serial: string[];
  /** What each pin currently reads as; a pin not listed reads high. */
  readonly inputs: Map<number, number>;
}

function host(): Host {
  const writes: { pin: number; level: number }[] = [];
  const analog: { pin: number; value: number }[] = [];
  const modes: { pin: number; mode: number }[] = [];
  const serial: string[] = [];
  const inputs = new Map<number, number>();

  return {
    writes,
    analog,
    modes,
    serial,
    inputs,
    services: {
      nowMs: () => 0,
      pinMode: (pin: number, mode: number) => modes.push({ pin, mode }),
      digitalWrite: (pin: number, level: number) => writes.push({ pin, level }),
      digitalRead: (pin: number) => inputs.get(pin) ?? 1,
      analogWrite: (pin: number, value: number) => analog.push({ pin, value }),
      analogRead: () => 0,
      serialBegin: () => {},
      serialWrite: (text: string) => serial.push(text),
      wire: {} as never,
      spi: {} as never,
    } as unknown as FirmwareServices,
  };
}

interface Run {
  /** How long the program asked to wait on each step, in milliseconds. */
  readonly waits: number[];
  readonly serial: string;
  readonly steps: number;
}

/** Runs to completion, or until `turnsAfter` steps have happened. */
function run(source: string, target: Host, turnsAfter = 40): Run {
  const runner = new FirmwareRunner(source, target.services, 'python');
  const waits: number[] = [];
  for (let step = 0; step < turnsAfter; step++) {
    const wait = runner.step();
    if (wait === null) return { waits, serial: runner.output.join(''), steps: step };
    waits.push(wait);
  }
  return { waits, serial: runner.output.join(''), steps: turnsAfter };
}

describe('a device is what the program named it', () => {
  it('drives the pin behind a name the programmer chose', () => {
    // This is the whole reason devices are tracked rather than guessed from the
    // name: in C the VM dispatches `Serial` and `Wire` by name, but in Python
    // `amber` is as good a name for an LED as `led` is.
    const target = host();
    run('from gpiozero import LED\nlamp = LED(17)\nlamp.on()\n', target);

    expect(target.writes).toEqual([{ pin: 17, level: 1 }]);
  });

  it('settles a constructor as an output and a button as an input', () => {
    const target = host();
    run('from gpiozero import LED, Button\nlamp = LED(17)\nswitch = Button(2)\n', target);

    // PIN_OUTPUT is 1 and PIN_INPUT is 0; asserting the numbers would pin the
    // wire format rather than the intent, so the pair is compared.
    expect(target.modes).toHaveLength(2);
    expect(target.modes[0].mode).not.toBe(target.modes[1].mode);
  });

  it('says a device constructor is not a value', () => {
    // `x = LED(17)` leaves no number behind, so reading `LED` cannot yield
    // one: the bench says what the name holds rather than handing over a
    // zero that reads like a pin number.
    const target = host();
    expect(() =>
      run('from gpiozero import LED\nlamp = LED(17)\nprint(LED)\n', target),
    ).toThrow(/'LED' is a device, not a value/);
  });
});

describe('driving a device', () => {
  it('turns an LED on and off', () => {
    const target = host();
    run('from gpiozero import LED\nlamp = LED(17)\nlamp.on()\nlamp.off()\n', target);

    expect(target.writes).toEqual([
      { pin: 17, level: 1 },
      { pin: 17, level: 0 },
    ]);
  });

  it('toggles by reading the line, not by remembering the last write', () => {
    // A wire can pull a pin away from what was asked for. A toggle that kept
    // its own copy of the last level would flip the wrong way round.
    const target = host();
    target.inputs.set(17, 1);
    run('from gpiozero import LED\nlamp = LED(17)\nlamp.toggle()\n', target);

    // The line reads high, so a toggle has to drive it low.
    expect(target.writes).toEqual([{ pin: 17, level: 0 }]);
  });

  it('writes a PWM value as a fraction', () => {
    const target = host();
    run(
      'from gpiozero import PWMOutputDevice\nlamp = PWMOutputDevice(18)\nlamp.value = 0.5\n',
      target,
    );

    expect(target.analog).toEqual([{ pin: 18, value: 0.5 }]);
  });

  it('refuses to drive a button', () => {
    // gpiozero will not let you write to an input, and neither does this.
    const target = host();
    run('from gpiozero import Button\nswitch = Button(2)\nswitch.on()\n', target);

    expect(target.writes).toEqual([]);
  });
});

describe('reading a device', () => {
  it('reads a button as pressed when its line is pulled low', () => {
    // gpiozero's button is active low: the pin is pulled up and a press pulls
    // it down. Reading the line the other way round would invert every button.
    const pressed = host();
    pressed.inputs.set(2, 0);
    const idle = host();
    idle.inputs.set(2, 1);

    const readout = `from gpiozero import Button
switch = Button(2)
print(switch.is_pressed)
`;
    expect(run(readout, pressed).serial).toBe('1\n');
    expect(run(readout, idle).serial).toBe('0\n');
  });

  it('waits for a press instead of passing straight over it', () => {
    const target = host();
    target.inputs.set(2, 1);
    const runner = new FirmwareRunner(
      'from gpiozero import Button\nswitch = Button(2)\nswitch.wait_for_press()\nprint("pressed")\n',
      target.services,
      'python',
    );

    // Still high, so the program is polling and has printed nothing.
    expect(runner.step()).toBeGreaterThan(0);
    expect(runner.output).toEqual([]);

    // The line goes low: the next poll returns and the program carries on.
    target.inputs.set(2, 0);
    for (let step = 0; step < 5; step++) {
      if (runner.step() === null) break;
    }
    expect(runner.output).toEqual(['pressed\n']);
  });
});

describe('the Python runtime', () => {
  it('writes through print, one line per call', () => {
    const target = host();
    run('print("hello")\nprint(42)\n', target);

    expect(target.serial).toEqual(['hello\n', '42\n']);
  });

  it('waits in seconds where delay waits in milliseconds', () => {
    const target = host();
    const result = run('import time\ntime.sleep(0.5)\n', target);

    // Half a second. Reading 0.5 as half a millisecond would make every
    // gpiozero blink five hundred times too fast, and nothing would say so.
    expect(result.waits[0]).toBe(500);
  });

  it('renders an f-string from values, not from source text', () => {
    const target = host();
    run('n = 3\nprint(f"blink {n} of {n * 2}")\n', target);

    expect(target.serial).toEqual(['blink 3 of 6\n']);
  });

  it('joins a string with a number the way print would write it', () => {
    const target = host();
    run('print("pin " + str(17))\n', target);

    expect(target.serial).toEqual(['pin 17\n']);
  });

  it('runs the module body and nothing else', () => {
    // Python has no setup/loop. Calling a function the programmer happened to
    // name `setup` would invent an entry point they never wrote.
    const target = host();
    run('from gpiozero import LED\ndef setup():\n    LED(99).on()\n', target);

    expect(target.writes).toEqual([]);
  });

  it('reports a Python syntax error rather than failing silently', () => {
    expect(
      () => new FirmwareRunner('for i in range(3)\n    print(i)\n', host().services, 'python'),
    ).toThrow(/line 2/);
  });
});
