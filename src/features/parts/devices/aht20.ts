/**
 * AHT20 temperature and humidity sensor: an I2C breakout that reports
 * temperature and relative humidity as raw counts.
 *
 * The model speaks the register protocol rather than offering a "what are the
 * conditions" call, because the protocol is the exercise. A sketch starts a
 * measurement by writing the trigger register, reads the raw counts out of
 * the data registers, and converts them with the datasheet formula.
 *
 * The raw counts are the chip's answer to a question about the air, so the
 * model answers them from the air the operator has dialled in: a sketch that
 * applies the datasheet's conversion reads back what the operator set,
 * which is the only way the two halves of the exercise can be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const AHT20_ADDRESS = 0x38;

/** The temperature of the air the chip is sitting in, in degrees Celsius. */
export const AHT20_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -40,
  max: 85,
  step: 0.01,
  unit: '°C',
  defaultValue: 25,
};

/** The relative humidity of that air, in percent. */
export const AHT20_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

/** The data start: the trigger writes here, the answer is read from here. */
const DATA_MSB = 0x71;

/** Status bits: calibration enabled, no measurement busy. */
const STATUS_READY = 0x18;

/** Twenty-bit range of the AHT20 converter. */
const FULL_SCALE = 0x100000;

/**
 * The raw humidity count for a given relative humidity, twenty bits.
 *
 * The full twenty-bit span is the reading: a sketch that decodes it with the
 * datasheet's `value * 100 / 2^20` gets the percent the operator dialled in.
 * Pre-shifting here would make the same sketch read a sixteenth of it.
 */
function rawHumidityFor(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.round((clamped / 100) * FULL_SCALE);
}

/** The raw temperature count for a given temperature, twenty bits. */
function rawTemperatureFor(celsius: number): number {
  const clamped = Math.max(-40, Math.min(85, celsius));
  return Math.round(((clamped + 50) / 200) * FULL_SCALE);
}

export class Aht20 implements I2cDevice {
  readonly address = AHT20_ADDRESS;
  onBus = false;

  /** The temperature of that air, in degrees Celsius. */
  private celsius = 25;
  /** The relative humidity of that air, in percent. */
  private humidity = 50;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the air the operator has described. */
  private stale = true;
  /** Where the air is. */
  private world: (() => { readonly celsius: number; readonly humidity: number }) | null = null;

  /** The raw temperature count the converter holds, left-aligned twenty bits. */
  private rawTemperature = 0;
  /** The raw humidity count the converter holds, left-aligned twenty bits. */
  private rawHumidity = 0;

  /** Points the chip at the air the bench is in. */
  setConditionsSource(read: () => { readonly celsius: number; readonly humidity: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** Recomputes the counts the converter holds from the air conditions. */
  private recompute(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (conditions.celsius === this.celsius && conditions.humidity === this.humidity && !this.stale) {
      return;
    }
    this.celsius = conditions.celsius;
    this.humidity = conditions.humidity;

    // The counts are the twenty-bit readings themselves; the data registers
    // place them across three bytes. Shifting them left here would push the top
    // nibble out of the register.
    this.rawHumidity = rawHumidityFor(this.humidity);
    this.rawTemperature = rawTemperatureFor(this.celsius);
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    /*
     * Writing to the trigger register begins a measurement. Anything else is
     * acknowledged and discarded, which is what the chip does.
     */
    return true;
  }

  read(count: number): readonly number[] {
    this.recompute();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      out.push(this.register(this.pointer + index));
    }
    return out;
  }

  /** The byte at a register address, zero for the addresses that hold none. */
  private register(address: number): number {
    if (address === DATA_MSB) return STATUS_READY;
    // Humidity is three bytes from DATA_MSB + 1, temperature three from
    // DATA_MSB + 4. The ranges are disjoint: overlapping them at +3 answered
    // the temperature's first byte as the humidity's last, which made the
    // reading come back at half scale.
    if (address >= DATA_MSB + 1 && address <= DATA_MSB + 3) {
      return this.humidityByte(address - DATA_MSB - 1);
    }
    if (address >= DATA_MSB + 4 && address <= DATA_MSB + 6) {
      return this.temperatureByte(address - DATA_MSB - 4);
    }
    return 0;
  }

  /** The humidity bytes: twenty bits, most significant first. */
  private humidityByte(index: number): number {
    if (index === 0) return (this.rawHumidity >> 16) & 0xff;
    if (index === 1) return (this.rawHumidity >> 8) & 0xff;
    return this.rawHumidity & 0xff;
  }

  /** The temperature bytes: twenty bits, most significant first. */
  private temperatureByte(index: number): number {
    if (index === 0) return (this.rawTemperature >> 16) & 0xff;
    if (index === 1) return (this.rawTemperature >> 8) & 0xff;
    return this.rawTemperature & 0xff;
  }
}
