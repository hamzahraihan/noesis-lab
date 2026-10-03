/**
 * MPU-6050 six-axis accelerometer and gyroscope, on the carrier board it is
 * sold on with a four-pin I2C header.
 *
 * Six axes, sixteen bits each, little-endian and two's complement, packed into
 * one fourteen-byte block a sketch reads in a single transfer. The other half
 * of driving the part is the power register: out of reset the chip is asleep
 * and every axis reads zero, so a sketch that never wakes it has a sensor that
 * is perfectly wired and reports nothing at all.
 *
 * The DS1307 answers at the same 0x68, because the address is fixed on both
 * chips. Only one of them can be on a bus at a time, and the bench does not
 * detect the clash: a write goes to every part that answers the address, and a
 * read is answered by whichever of them the engine reaches first.
 */
import { type I2cDevice } from './device';

/** The address the part silkscreens, and the only one it answers to. */
export const MPU6050_ADDRESS = 0x68;

/** ACCEL_CONFIG, whose bits 4:3 choose the accelerometer's full-scale range. */
const ACCEL_CONFIG = 0x1c;

/** The fourteen bytes of measurements, from the first accel byte to the last gyro byte. */
const ACCEL_XOUT = 0x3b;
const ACCEL_YOUT = 0x3d;
const ACCEL_ZOUT = 0x3f;
const TEMP_OUT = 0x41;
const GYRO_XOUT = 0x43;
const GYRO_YOUT = 0x45;
const GYRO_ZOUT = 0x47;
const SENSOR_START = ACCEL_XOUT;
const SENSOR_END = GYRO_ZOUT + 1;

/** PWR_MGMT_1: the clock source, and the three ways the chip can be put to sleep. */
const PWR_MGMT_1 = 0x6b;
/** PWR_MGMT_2: the low-power control, which decides which converter survives it. */
const PWR_MGMT_2 = 0x6c;
/** WHO_AM_I, which reads back the part number and cannot be written. */
const WHO_AM_I = 0x75;

/** The register file, 0x00 to 0x7F, of which the datasheet defines a handful. */
const REGISTER_COUNT = 0x80;

/** What WHO_AM_I holds, so a sketch can tell an MPU-6050 from an MPU-6500. */
const WHO_AM_I_VALUE = 0x68;

/** PWR_MGMT_1's bits, in datasheet order. */
const PWR_SLEEP = 0x80;
const PWR_STANDBY = 0x60;
const PWR_CLOCK_SELECT = 0x07;

/** PWR_MGMT_2's low-power control: the mode itself, and the accelerometer in it. */
const LOW_POWER_ENABLE = 0x40;
const LOW_POWER_ACCELEROMETER = 0x20;

/**
 * Counts one g is worth, by the full-scale range in ACCEL_CONFIG bits 4:3, in
 * datasheet order: ±2 g, ±4 g, ±8 g, ±16 g.
 */
const ACCEL_COUNTS_PER_G: readonly number[] = [16384, 8192, 4096, 2048];

/**
 * The die's own temperature, in counts.
 *
 * The datasheet's formula is °C = TEMP_OUT / 333 - 21, so a bench sitting at
 * room temperature reads (21 + 25) * 333 = 15318. The die is that warm whether
 * or not the axes are converting, which is why the temperature answers on a
 * sleeping part while the six axes do not.
 */
const ROOM_TEMPERATURE_COUNTS = 15_318;

export class Mpu6050 implements I2cDevice {
  readonly address = MPU6050_ADDRESS;
  onBus = false;

  private readonly registers = new Uint8Array(REGISTER_COUNT);
  /** Where the next written byte lands, and where the next read starts. */
  private pointer = ACCEL_XOUT;

  constructor() {
    this.registers[WHO_AM_I] = WHO_AM_I_VALUE;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte;
      return true;
    }
    // WHO_AM_I is the one register a sketch cannot write: the part holds its
    // part number whatever the bus sends it.
    if (this.pointer !== WHO_AM_I && this.pointer < REGISTER_COUNT) {
      this.registers[this.pointer] = byte;
    }
    this.pointer = (this.pointer + 1) & 0xff;
    return true;
  }

  read(count: number): readonly number[] {
    // Only the measurement block moves on its own, and only a read that lands
    // in it is worth the fourteen stores.
    if (this.pointer < SENSOR_END && this.pointer + count > SENSOR_START) this.measure();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      const register = this.pointer + index;
      // Every register the datasheet leaves undefined reads as zero, and so
      // does an address past the end of the space: the bus cannot report that
      // there is nothing there.
      out.push(register < REGISTER_COUNT ? this.registers[register] : 0);
    }
    return out;
  }

  /**
   * Whether the accelerometer and the gyroscope are converting at all.
   *
   * PWR_MGMT_1 decides it three ways: SLEEP stops the converters outright,
   * STBY holds them in standby, and with CLKSEL left at 000 and STBY at 00 the
   * part is in standby whatever SLEEP says. A part nobody has woken is in that
   * last state, so every axis reads zero until a sketch writes something other
   * than a zero to PWR_MGMT_1.
   */
  private get converting(): boolean {
    const power = this.registers[PWR_MGMT_1];
    if ((power & PWR_SLEEP) !== 0) return false;
    if ((power & PWR_STANDBY) !== 0) return false;
    if ((power & PWR_CLOCK_SELECT) === 0) return false;
    // In low power the accelerometer runs only when it is asked to, and the
    // gyros stop with the main converter. They read zero either way, because
    // nothing on this bench turns the part over.
    const control = this.registers[PWR_MGMT_2];
    return (control & LOW_POWER_ENABLE) === 0 || (control & LOW_POWER_ACCELEROMETER) !== 0;
  }

  /** Refreshes the measurement block, the only part of the file that moves alone. */
  private measure(): void {
    const awake = this.converting;
    // The part is lying flat on the bench, so gravity is along its own z axis
    // and the gyros are not turning.
    this.writeAxis(ACCEL_XOUT, 0);
    this.writeAxis(ACCEL_YOUT, 0);
    this.writeAxis(ACCEL_ZOUT, awake ? this.countsPerG() : 0);
    /*
     * The temperature channel runs off its own converter, so it keeps reading
     * a plausible room temperature even with everything else asleep -- which is
     * exactly what the chip does, and the reason "is it awake?" is not a
     * question every register answers the same way.
     */
    this.writeAxis(TEMP_OUT, awake ? ROOM_TEMPERATURE_COUNTS : 0);
    this.writeAxis(GYRO_XOUT, 0);
    this.writeAxis(GYRO_YOUT, 0);
    this.writeAxis(GYRO_ZOUT, 0);
  }

  private countsPerG(): number {
    return ACCEL_COUNTS_PER_G[(this.registers[ACCEL_CONFIG] >> 3) & 0x03];
  }

  /** Stores one measurement low byte first, which is the order a sketch reads it in. */
  private writeAxis(register: number, value: number): void {
    this.registers[register] = value & 0xff;
    this.registers[register + 1] = (value >> 8) & 0xff;
  }
}
