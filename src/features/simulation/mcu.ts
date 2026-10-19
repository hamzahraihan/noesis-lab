/**
 * Microcontroller pin state: what firmware has asked each pin to do.
 *
 * This layer knows nothing about voltages. It records intent -- direction,
 * duty cycle -- and the engine turns that intent into circuit elements. Keeping
 * the split clean is what lets the same pin model serve a UI inspector, the
 * firmware VM, and the solver without any of them knowing about the others.
 */

import type { BoardPin, BoardSpec, PartDefinition } from '@/features/parts';

export type PinDirection = 'input' | 'output' | 'inputPullUp';

export interface PinConfiguration {
  readonly direction: PinDirection;
  /** True once analogWrite has put the pin into PWM mode. */
  readonly pwm: boolean;
  /** Output level as a 0..1 duty cycle; 0 or 1 for plain digital writes. */
  readonly duty: number;
}

/**
 * Internal pull-up resistance brought out by `INPUT_PULLUP`.
 *
 * Datasheets put the ESP32's internal pull-up between 45 kOhm and range into
 * the megaohms. The slow end is the honest one: it is why an internal pull-up
 * is fine for reading a switch but not for driving anything.
 */
export const INTERNAL_PULLUP_OHMS = 45_000;

/**
 * Input impedance presented by an unconnected GPIO.
 *
 * A CMOS input is high-impedance and leaks only picoamps, which is exactly why
 * a floating pin wanders. Modelling that leakage explicitly is what lets an
 * unwired input read erratically instead of quietly sitting at 0 V, and it is
 * also why any real pull-down resistor swamps it.
 */
export const INPUT_IMPEDANCE_OHMS = 1e12;

/**
 * Voltage a floating input wanders between, as a fraction of the supply.
 *
 * Two incommensurate sine terms so the pattern does not visibly repeat while
 * still being a pure function of simulated time -- tests need a drifting pin to
 * drift reproducibly.
 */
export function floatingInputFraction(timeMs: number): number {
  return 0.5 + 0.5 * Math.sin(timeMs / 370) * Math.sin(timeMs / 91);
}
/**
 * Where each board's I2C peripheral sits out of the box, as SDA then SCL.
 *
 * Keyed by board id rather than derived, because the answer is a property of
 * the board rather than of the chip: the Mega and the ESP32 both use pin 21,
 * for SCL on one and for SDA on the other.
 */
const I2C_PINS: Readonly<Record<string, readonly number[]>> = {
  esp32: [21, 22],
  uno: [18, 19],
  nano: [18, 19],
  mega: [20, 21],
  rp2040: [26, 27],
  pico: [0, 1],
  /*
   * A single-board computer's I2C is the pair its bus sits on by default: data
   * on GPIO2 and clock on GPIO3, which are physical pins 3 and 5. Those two
   * carry a fixed pull-up on the board, which is why a Pi needs no external
   * resistors for the bus the way an Uno does.
   */
  'raspberry-pi-4': [2, 3],
};

/**
 * Where each board's SPI peripheral sits, as [chipSelect, clock, mosi], with
 * the data-select line the bench's TFT happens to be wired to in between.
 *
 * The Mega's hardware SPI is the 50-53 block rather than the 10-13 a sketch
 * ported from an Uno names, so a sketch that hard-codes 10/11/12/13 behaves
 * differently there -- which is true of the real board, and the reason the
 * table is per board rather than shared.
 */
const SPI_PINS: Readonly<Record<string, readonly number[]>> = {
  esp32: [5, 15, 18, 23],
  uno: [10, 9, 13, 11],
  nano: [10, 9, 13, 11],
  mega: [53, 9, 52, 51],
  rp2040: [10, 9, 13, 11],
  pico: [17, 20, 18, 19],
  /*
   * The Pi's SPI0, in the same shape as the rows above: chip-select, the
   * data/command line, the clock, and MOSI.
   *
   * CE0 is GPIO8, the clock is GPIO11 and MOSI is GPIO10 -- the block the
   * Foundation documents for SPI0. The data/command line is GPIO24, which is
   * worth noticing: it is not a hardware pin at all, it is an ordinary GPIO the
   * program drives by hand, exactly as the Uno's D9 is. Only the other three
   * come out of the peripheral.
   */
  'raspberry-pi-4': [8, 24, 11, 10],
};

export class McuRuntime {
  readonly definition: PartDefinition;
  readonly board: BoardSpec;

  private readonly pinIdByGpio = new Map<number, string>();
  private readonly boardPinById = new Map<string, BoardPin>();
  private readonly configurations = new Map<string, PinConfiguration>();
  /** Simulated time each pin's PWM phase was last restarted at. */
  private readonly pwmEpochMs = new Map<string, number>();
  /**
   * Bumped on every pin-intent mutation, so the solver can tell a redundant
   * re-solve (same intents, same instant) from one that must run.
   *
   * Guarded by equality: a write that changes nothing (the AVR bridge syncs
   * all twenty GPIOs on every port change) must not count as a mutation, or
   * the dedupe never hits.
   */
  private mutationCount = 0;

  /** Mutations so far; compared by the engine against the last solve. */
  get revision(): number {
    return this.mutationCount;
  }

  constructor(definition: PartDefinition) {
    if (definition.component.kind !== 'mcu') {
      throw new Error(`${definition.id} is not a microcontroller board`);
    }
    this.definition = definition;
    this.board = definition.component.board;

    for (const pin of definition.boardPins ?? []) {
      this.boardPinById.set(pin.id, pin);
      if (pin.gpio !== undefined) this.pinIdByGpio.set(pin.gpio, pin.id);
    }
  }

  /** Every pin firmware is allowed to name, mapped to its board pin. */
  pins(): readonly BoardPin[] {
    return this.definition.boardPins ?? [];
  }

  /**
   * Pins this board's default I2C peripheral sits on.

   * The engine uses these to decide which nets carry the bus. `Wire.begin`
   * may move them, but these are what the board's silkscreen implies out of
   * the box, so a sketch that never calls begin still has a bus to miss.
   */
  get i2cPins(): readonly number[] {
    return I2C_PINS[this.board.id] ?? [];
  }

  /**
   * Pins the board's default SPI peripheral sits on, as
   * [chipSelect, dataSelect, clock, mosi].
   *
   * These are the pins the engine treats as carrying SPI, so a display wired to
   * anything else simply never sees the bus -- which is the failure worth being
   * able to reproduce. `dataSelect` is the one the bench's own TFT is wired to,
   * not a peripheral pin: the D/C line is whichever pin the sketch chose.
   */
  get spiPins(): readonly number[] {
    return SPI_PINS[this.board.id] ?? [];
  }

  boardPin(pinId: string): BoardPin | undefined {
    return this.boardPinById.get(pinId);
  }

  pinIdForGpio(gpio: number): string | undefined {
    return this.pinIdByGpio.get(gpio);
  }

  gpioForPinId(pinId: string): number | undefined {
    return this.boardPinById.get(pinId)?.gpio;
  }

  /**
   * Sets a pin's direction.
   *
   * Pins with no output driver stay inputs whatever firmware asks for. Silently
   * ignoring the request is the honest outcome -- the same thing that happens on
   * real silicon, where GPIO34-39 simply have no driver to route to.
   */
  setDirection(gpio: number, direction: PinDirection): void {
    const pinId = this.pinIdByGpio.get(gpio);
    if (pinId === undefined) return;

    const pin = this.boardPinById.get(pinId)!;
    if (pin.role === 'power' || pin.role === 'ground') return;
    if (direction === 'output' && pin.canDrive === false) return;

    const existing = this.configurations.get(pinId);
    const next: PinConfiguration = {
      direction,
      pwm: direction === 'output' ? (existing?.pwm ?? false) : false,
      duty: direction === 'output' ? (existing?.duty ?? 0) : 0,
    };
    if (
      existing?.direction === next.direction &&
      existing.pwm === next.pwm &&
      existing.duty === next.duty
    )
      return;
    this.configurations.set(pinId, next);
    this.mutationCount++;
  }

  writeDigital(gpio: number, high: boolean, timeMs: number): void {
    const pinId = this.pinIdByGpio.get(gpio);
    if (pinId === undefined) return;
    const pin = this.boardPinById.get(pinId)!;
    if (pin.role === 'power' || pin.role === 'ground') return;
    if (pin.canDrive === false) return;

    const existing = this.configurations.get(pinId);
    if (existing?.direction === 'output' && existing.pwm) {
      // Writing HIGH/LOW to a PWM pin overrides the duty outright, which is
      // what the real PWM peripheral does when the duty register is assigned.
      if (existing.duty === (high ? 1 : 0)) return;
      this.configurations.set(pinId, { direction: 'output', pwm: false, duty: high ? 1 : 0 });
      this.mutationCount++;
      return;
    }
    if (existing?.direction === 'output' && !existing.pwm && existing.duty === (high ? 1 : 0))
      return;
    this.configurations.set(pinId, { direction: 'output', pwm: false, duty: high ? 1 : 0 });
    this.mutationCount++;
    if (existing?.pwm) this.pwmEpochMs.set(pinId, timeMs);
  }

  /** Sets a PWM duty from an Arduino `analogWrite` value of 0..255. */
  writeAnalog(gpio: number, value: number, timeMs: number): void {
    const pinId = this.pinIdByGpio.get(gpio);
    if (pinId === undefined) return;
    const pin = this.boardPinById.get(pinId)!;
    if (pin.role === 'power' || pin.role === 'ground') return;
    if (pin.canDrive === false) return;

    const clamped = Math.min(255, Math.max(0, value));
    const wasPwm = this.configurations.get(pinId)?.pwm ?? false;
    const duty = clamped / 255;
    const existing = this.configurations.get(pinId);
    if (existing?.direction === 'output' && existing.pwm && existing.duty === duty) return;
    this.configurations.set(pinId, {
      direction: 'output',
      pwm: true,
      duty,
    });
    this.mutationCount++;
    // Restart the phase on the rising edge of PWM so a fresh duty does not
    // inherit the middle of the previous period.
    if (!wasPwm) this.pwmEpochMs.set(pinId, timeMs);
  }

  /** Instantaneous output level of a pin at `timeMs`, accounting for PWM phase. */
  levelOf(pinId: string, timeMs: number): number {
    const configuration = this.configurations.get(pinId);
    if (!configuration || configuration.direction !== 'output') return 0;

    if (!configuration.pwm) return configuration.duty;

    const periodMs = 1000 / this.board.pwmHz;
    const epoch = this.pwmEpochMs.get(pinId) ?? 0;
    const phase = ((((timeMs - epoch) / periodMs) % 1) + 1) % 1;
    return phase < configuration.duty ? 1 : 0;
  }

  configurationOf(pinId: string): PinConfiguration {
    return this.configurations.get(pinId) ?? { direction: 'input', pwm: false, duty: 0 };
  }

  /** Resets every pin to a floating input, as a board would come out of reset. */
  reset(): void {
    this.configurations.clear();
    this.pwmEpochMs.clear();
    this.mutationCount++;
  }
}
