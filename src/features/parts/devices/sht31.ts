/**
 * SHT31 temperature and humidity sensor: two measurements behind one I2C
 * address, each word protected by a CRC.
 *
 * The model speaks the chip's command protocol rather than offering a
 * temperature and a humidity call, because the protocol is the exercise. A
 * sketch sends a sixteen-bit command to start a measurement, waits for it, and
 * reads six bytes: temperature MSB, temperature LSB, CRC, humidity MSB,
 * humidity LSB, CRC. A sketch that does not check the two CRC bytes has no way
 * to tell a real reading from the all-ones frame the chip returns before a
 * command has arrived, which is the mistake worth being able to make.
 *
 * The two conversions are the datasheet's linear maps over the full sixteen-bit
 * range, and the heater adds about a degree to the temperature the way the real
 * one is meant to clear condensation off the die.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const SHT31_ADDRESS = 0x44;

/** The temperature of the air the chip is sitting in, in degrees Celsius. */
export const SHT31_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -40,
  max: 125,
  step: 0.1,
  unit: '°C',
  defaultValue: 21,
};

/** The relative humidity of that air, as a percentage. */
export const SHT31_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 45,
};

/** The CRC-8 the datasheet specifies: polynomial 0x31, initial value 0xFF. */
export function sht31Crc8(bytes: readonly number[]): number {
  let crc = 0xff;
  for (const byte of bytes) {
    crc ^= byte & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/** The single-shot commands, at each repeatability and clock-stretch setting. */
const SINGLE_SHOT = new Set([0x2400, 0x240b, 0x2416, 0x2c06, 0x2c0d, 0x2c10]);
const SOFT_RESET = 0x2737;
const HEATER_ON = 0x30a2;
const HEATER_OFF = 0x306d;

/** The heater warms the die by roughly this much, in degrees Celsius. */
const HEATER_DEGREES = 1;

export class Sht31 implements I2cDevice {
  readonly address = SHT31_ADDRESS;
  onBus = false;

  /** The high byte of a command whose second byte has not arrived yet. */
  private commandHigh: number | null = null;
  /** The last conversion, held until another command asks for one. */
  private measurement: { readonly temperature: number; readonly humidity: number } | null = null;
  /** Whether the on-die heater is warming the sensor. */
  private heater = false;
  /** The air the chip reports when the operator has not dialled any. */
  private celsius = 21;
  private humidity = 45;
  /**
   * Where the air is.
   *
   * A measurement samples the world when the command arrives, rather than
   * being pushed in on a tick: a knob turned after the command is not seen
   * until the next one, which is exactly how the chip behaves.
   */
  private world: (() => { readonly celsius: number; readonly humidity: number }) | null = null;

  /** Points the sensor at the air the bench is in. */
  setConditionsSource(read: () => { readonly celsius: number; readonly humidity: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition || this.commandHigh === null) {
      this.commandHigh = byte & 0xff;
      return true;
    }
    const command = (this.commandHigh << 8) | (byte & 0xff);
    this.commandHigh = null;
    this.execute(command);
    return true;
  }

  read(count: number): readonly number[] {
    const bytes =
      this.measurement === null
        ? [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
        : this.frame(this.measurement.temperature, this.measurement.humidity);
    return Array.from({ length: Math.max(0, count) }, (_, index) =>
      index < bytes.length ? bytes[index]! : bytes.at(-1)!,
    );
  }

  /** Runs a sixteen-bit command, in the chip's own command table. */
  private execute(command: number): void {
    if (SINGLE_SHOT.has(command)) {
      this.measure();
      return;
    }
    if (command === SOFT_RESET) {
      this.measurement = null;
      this.heater = false;
      this.commandHigh = null;
      return;
    }
    if (command === HEATER_ON) {
      this.heater = true;
      return;
    }
    if (command === HEATER_OFF) {
      this.heater = false;
      return;
    }
    // An unknown command is acknowledged and changes nothing.
  }

  /** Samples the air and converts both measurements at command time. */
  private measure(): void {
    if (this.world !== null) {
      const conditions = this.world();
      this.celsius = conditions.celsius;
      this.humidity = conditions.humidity;
    }
    const celsius = this.celsius + (this.heater ? HEATER_DEGREES : 0);
    this.measurement = {
      temperature: rawTemperature(celsius),
      humidity: rawHumidity(this.humidity),
    };
  }

  /** The six-byte frame a read returns, CRC bytes included. */
  private frame(temperature: number, humidity: number): readonly number[] {
    const temperatureBytes = [(temperature >> 8) & 0xff, temperature & 0xff];
    const humidityBytes = [(humidity >> 8) & 0xff, humidity & 0xff];
    return [
      ...temperatureBytes,
      sht31Crc8(temperatureBytes),
      ...humidityBytes,
      sht31Crc8(humidityBytes),
    ];
  }
}

/** The datasheet's temperature conversion, as a raw word. */
function rawTemperature(celsius: number): number {
  return clampWord(Math.round(((celsius + 45) * 0xffff) / 175));
}

/** The datasheet's relative-humidity conversion, as a raw word. */
function rawHumidity(percent: number): number {
  return clampWord(Math.round((percent * 0xffff) / 100));
}

function clampWord(value: number): number {
  return Math.min(0xffff, Math.max(0, value));
}
