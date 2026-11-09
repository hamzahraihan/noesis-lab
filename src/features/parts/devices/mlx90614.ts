/**
 * MLX90614 IR temperature sensor: a non-contact thermometer on the I2C bus.
 *
 * The model speaks the register protocol rather than offering a temperature
 * call, because the protocol is the exercise. A sketch writes the register
 * address (0x06 for ambient, 0x07 for object) and reads three bytes: low
 * byte, high byte, and PEC. The temperature is a signed sixteen-bit count
 * scaled by 0.02 °C, offset by 273.15: °C = raw * 0.02 - 273.15.
 *
 * The two temperatures are the operator's knobs, read when the chip reports
 * rather than pushed in on a tick: a knob turned between two reads is seen by
 * the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const MLX90614_ADDRESS = 0x5a;

/** The ambient temperature of the air around the chip, in degrees Celsius. */
export const MLX90614_AMBIENT_KNOB: KnobSpec = {
  id: 'ambient',
  label: 'Ambient temperature',
  min: -40,
  max: 125,
  step: 0.1,
  unit: '°C',
  defaultValue: 21,
};

/** The temperature of the object the sensor is pointed at, in degrees Celsius. */
export const MLX90614_OBJECT_KNOB: KnobSpec = {
  id: 'object',
  label: 'Object temperature',
  min: -70,
  max: 380,
  step: 0.1,
  unit: '°C',
  defaultValue: 30,
};

/** The register addresses the chip names. */
const AMBIENT = 0x06;
const OBJECT = 0x07;

/** The temperature in the chip's sixteen-bit frame. */
function temperatureWord(celsius: number): number {
  return Math.min(0xffff, Math.max(0, Math.round((celsius + 273.15) / 0.02)));
}

export class Mlx90614 implements I2cDevice {
  readonly address = MLX90614_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = AMBIENT;
  /** The ambient temperature the chip reports when the operator has not dialled one. */
  private ambient = 21;
  /** The object temperature the chip reports when the operator has not dialled one. */
  private object = 30;
  /**
   * Where the temperatures are.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => { readonly ambient: number; readonly object: number }) | null = null;

  /** Points the thermometer at the air and object the bench is in. */
  setConditionsSource(read: () => { readonly ambient: number; readonly object: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    // Data writes are acknowledged and discarded.
    return true;
  }

  read(count: number): readonly number[] {
    const word =
      this.pointer === OBJECT
        ? temperatureWord(this.world?.().object ?? this.object)
        : temperatureWord(this.world?.().ambient ?? this.ambient);
    const bytes = [word & 0xff, (word >> 8) & 0xff, 0x00];
    return Array.from({ length: Math.max(0, count) }, (_, index) =>
      index < bytes.length ? bytes[index]! : bytes.at(-1)!,
    );
  }
}
