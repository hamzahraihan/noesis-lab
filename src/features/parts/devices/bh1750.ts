/**
 * BH1750 light sensor: the small I2C breakout that reports ambient light as a
 * sixteen-bit count.
 *
 * The model speaks the chip's command protocol rather than offering a lux
 * value, because the protocol is the exercise. A sketch powers the chip on,
 * tells it whether to measure once or continuously and at which resolution,
 * and then reads two bytes most significant first. The count is the raw
 * measurement; the sketch divides by the resolution's factor to get lux.
 *
 * The light itself is the operator's knob, read when the chip measures rather
 * than pushed in on a tick: a lamp turned up between two reads is seen by the
 * very next continuous conversion.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const BH1750_ADDRESS = 0x23;

/** The light falling on the chip, in lux. */
export const BH1750_LIGHT_KNOB: KnobSpec = {
  id: 'light',
  label: 'Light',
  min: 0,
  max: 10_000,
  step: 1,
  unit: 'lx',
  defaultValue: 250,
};

/** The three measurement resolutions the chip offers. */
export type Bh1750Resolution = 'high' | 'high2' | 'low';

/**
 * Counts per lux at each resolution.
 *
 * The datasheet's conversion is `lux = count / 1.2` in the two high-resolution
 * modes; mode two takes twice as many counts for the same light, so its scale
 * is 2.4. The low-resolution mode keeps the 1.2 scale and resolves only to the
 * nearest four lux, which is the trade it makes for a faster conversion.
 */
const COUNTS_PER_LUX: Readonly<Record<Bh1750Resolution, number>> = {
  high: 1.2,
  high2: 2.4,
  low: 1.2,
};

/** The commands the chip implements, all one byte wide. */
const POWER_DOWN = 0x00;
const POWER_ON = 0x01;
const RESET = 0x07;
const CONTINUOUS_HIGH = 0x10;
const CONTINUOUS_HIGH2 = 0x11;
const CONTINUOUS_LOW = 0x13;
const ONE_SHOT_HIGH = 0x20;
const ONE_SHOT_HIGH2 = 0x21;
const ONE_SHOT_LOW = 0x23;

type MeasurementMode = 'down' | 'continuous' | 'one-shot';

export class Bh1750 implements I2cDevice {
  readonly address = BH1750_ADDRESS;
  onBus = false;

  /** Whether the chip's oscillator is powered. */
  private powered = false;
  /** What the last command told the chip to do. */
  private mode: MeasurementMode = 'down';
  /** The resolution of the current measurement. */
  private resolution: Bh1750Resolution = 'high';
  /** The last measurement's raw count, which the data register holds. */
  private counts = 0;
  /**
   * Where the light is.
   *
   * The chip measures the world rather than being told about it, so a knob
   * turned between two reads is seen by the very next conversion.
   */
  private world: (() => number) | null = null;

  /** Points the chip at the light the bench is in. */
  setLightSource(read: () => number): void {
    this.world = read;
  }

  receive(byte: number, _isControlPosition: boolean): boolean {
    /*
     * Every byte is a command: the chip has no register pointer and no data
     * writes. A sketch that sends a command in one transaction and another in
     * the next is doing exactly what the part expects.
     */
    this.execute(byte & 0xff);
    return true;
  }

  read(count: number): readonly number[] {
    if (this.mode === 'continuous' && this.powered) this.measure();
    const bytes = [(this.counts >> 8) & 0xff, this.counts & 0xff];
    return Array.from({ length: Math.max(0, count) }, (_, index) =>
      index < bytes.length ? bytes[index]! : bytes.at(-1)!,
    );
  }

  /** Runs a one-byte command, in the chip's own command table. */
  private execute(command: number): void {
    switch (command) {
      case POWER_ON:
        this.powered = true;
        this.mode = 'down';
        return;
      case POWER_DOWN:
        this.powered = false;
        this.mode = 'down';
        return;
      case RESET:
        this.counts = 0;
        this.mode = 'down';
        this.powered = false;
        return;
      case CONTINUOUS_HIGH:
        this.startContinuous('high');
        return;
      case CONTINUOUS_HIGH2:
        this.startContinuous('high2');
        return;
      case CONTINUOUS_LOW:
        this.startContinuous('low');
        return;
      case ONE_SHOT_HIGH:
        this.startOneShot('high');
        return;
      case ONE_SHOT_HIGH2:
        this.startOneShot('high2');
        return;
      case ONE_SHOT_LOW:
        this.startOneShot('low');
        return;
      default:
        // An unknown command is acknowledged and changes nothing.
        return;
    }
  }

  private startContinuous(resolution: Bh1750Resolution): void {
    this.powered = true;
    this.mode = 'continuous';
    this.resolution = resolution;
    this.measure();
  }

  private startOneShot(resolution: Bh1750Resolution): void {
    this.powered = true;
    this.mode = 'one-shot';
    this.resolution = resolution;
    this.measure();
    /*
     * A one-shot returns to power-down on its own after converting, but the
     * data register keeps the result: that is what makes the command useful
     * to a sketch that waits and then reads.
     */
    this.powered = false;
  }

  /** Converts the current light level into the chip's raw count. */
  private measure(): void {
    const measured = this.world?.() ?? 0;
    // The low-resolution mode's four-lux step is the whole of its trade: the
    // conversion is the same, but the light is quantised before it is counted.
    const lux = this.resolution === 'low' ? Math.round(measured / 4) * 4 : measured;
    const raw = Math.round(lux * COUNTS_PER_LUX[this.resolution]);
    this.counts = Math.min(0xffff, Math.max(0, raw));
  }
}
