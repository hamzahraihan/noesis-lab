/**
 * MCP9808 temperature sensor: ±0.25 °C accuracy at 0.0625 °C resolution on
 * the I2C bus, answering at 0x18 by default.
 *
 * The model speaks the register protocol rather than offering a temperature
 * call, because the protocol is the exercise. A sketch points at the
 * temperature register (0x05) and reads two bytes most significant first.
 * The temperature is a signed thirteen-bit count left-justified across the
 * top thirteen bits: bit 15 is the sign, bits 14-3 hold the count in
 * sixteenths of a degree, and the low three bits are reserved. Shifting the
 * word down three bits gives the count.
 *
 * The temperature itself is the operator's knob, read when the chip reports
 * rather than pushed in on a tick: a knob turned between two reads is seen by
 * the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const MCP9808_ADDRESS = 0x18;

/** The temperature of the air the chip is sitting in, in degrees Celsius. */
export const MCP9808_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -55,
  max: 125,
  step: 0.0625,
  unit: '°C',
  defaultValue: 25,
};

/** How much one count of the thirteen-bit temperature word means. */
const DEGREES_PER_COUNT = 0.0625;

/** The temperature register the sketch points at before reading. */
const TEMPERATURE = 0x05;

export class Mcp9808 implements I2cDevice {
  readonly address = MCP9808_ADDRESS;
  onBus = false;

  /**
   * The writable registers, indexed the way the pointer names them.
   *
   * Temperature is read-only and has no entry; its slot is computed from the
   * world every time a sketch reads it.
   */
  private readonly registers: number[] = new Array(8).fill(0);
  /** Where the next written byte lands, and where the next read starts. */
  private pointer = TEMPERATURE;
  /** Which byte of the pointed register the next write names. */
  private byteIndex = 0;
  /** The temperature the chip reports when the operator has not dialled one. */
  private celsius = 25;
  /**
   * Where the temperature is.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => number) | null = null;

  /** Points the thermometer at the air the bench is in. */
  setTemperatureSource(read: () => number): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0x07;
      this.byteIndex = 0;
      return true;
    }
    /*
     * Temperature is read-only. A write to it is acknowledged and discarded,
     * which is what the chip does rather than refusing the transmission.
     */
    if (this.pointer === TEMPERATURE) return true;

    const current = this.registers[this.pointer]!;
    const value =
      this.byteIndex === 0
        ? ((byte & 0xff) << 8) | (current & 0xff)
        : (current & 0xff00) | (byte & 0xff);
    this.registers[this.pointer] = value & 0xffff;
    this.byteIndex = Math.min(1, this.byteIndex + 1);
    return true;
  }

  read(count: number): readonly number[] {
    const bytes = this.registerBytes(this.pointer);
    return Array.from({ length: Math.max(0, count) }, (_, index) =>
      index < bytes.length ? bytes[index]! : bytes.at(-1)!,
    );
  }

  /** The two bytes of a register, most significant first. */
  private registerBytes(register: number): readonly number[] {
    const word = register === TEMPERATURE ? this.temperatureWord() : this.registers[register]!;
    return [(word >> 8) & 0xff, word & 0xff];
  }

  /**
   * The temperature in the chip's thirteen-bit frame.
   *
   * The count is signed, so a below-zero reading is two's complement, and it
   * is left-justified: the three low bits of the word are reserved, so the
   * count sits in bits 14-3 with the sign at bit 15.
   */
  private temperatureWord(): number {
    const celsius = this.world?.() ?? this.celsius;
    const counts = Math.min(4095, Math.max(-4096, Math.round(celsius / DEGREES_PER_COUNT)));
    return (counts << 3) & 0xffff;
  }
}
