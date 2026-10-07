/**
 * I2C bus model.
 *
 * Transfers are modelled at the transaction level rather than edge by edge, but
 * they are *timed* at the transaction level too: a write costs its bytes at the
 * bus clock rate, and the VM really waits out that time. That is enough for the
 * lesson to survive -- an SDA and SCL that are not wired to the display mean the
 * bytes go nowhere and the screen stays blank -- without emulating edge timing
 * nobody watching a breadboard would notice.
 *
 * The bus only moves bytes. What a device does with them, including the SSD1306
 * control-byte convention, belongs to the device model.
 */

/** Bus speed in hertz. The SSD1306 modules on the bench run in fast mode. */
export const I2C_CLOCK_HZ = 400_000;

/** One byte costs nine bit periods: eight data bits plus an acknowledge. */
const MICROS_PER_BYTE = (1_000_000 * 9) / I2C_CLOCK_HZ;

/** Fixed cost of the start and stop conditions bracketing a transfer. */
const TRANSACTION_OVERHEAD_US = 6;

export interface I2CTransaction {
  /** Seven-bit device address the transfer went to. */
  readonly address: number;
  /** The bytes written, in order, after the address. */
  readonly bytes: readonly number[];
  /** False when no device acknowledged the address. */
  readonly acknowledged: boolean;
  /** Simulated microseconds the transfer consumed on the bus. */
  readonly micros: number;
}

/**
 * A single I2C bus.
 *
 * `deliver` hands each payload byte to whatever device claims the address and
 * reports whether that device exists. It is injected rather than looked up so
 * the bench can decide which display is on this bus by wiring, not by name.
 */
export class I2CBus {
  private transmitting = false;
  /** Address of the transfer in progress, set by `beginTransmission`. */
  private address = 0;
  private payload: number[] = [];

  /** The address a `requestFrom` is aimed at, and what is left of its answer. */
  private readBuffer: number[] = [];

  private readonly deliver: (
    address: number,
    byte: number,
    isControlPosition: boolean,
  ) => boolean;

  /** Asks the device at an address for `count` bytes, from its current pointer. */
  private readonly reader: (address: number, count: number) => readonly number[];

  /**
   * @param deliver Hands each payload byte to the device that claims the
   *   address. `isControlPosition` is true for the first byte of a transaction,
   *   which matters: on an SSD1306 that position is always a control byte, so a
   *   legitimate `0x00` command argument would otherwise be mistaken for one.
   */
  constructor(
    deliver: (address: number, byte: number, isControlPosition: boolean) => boolean,
    reader: (address: number, count: number) => readonly number[],
  ) {
    this.deliver = deliver;
    this.reader = reader;
  }

  /**
   * Brings the bus up, optionally moving it onto particular pins.
   *
   * The pin numbers are accepted for signature compatibility with `Wire.begin`;
   * which nets the bus actually reaches is decided by the engine from the
   * board's own I2C pins, so a sketch that moves the bus to different pins
   * finds nothing there -- exactly as on hardware.
   */
  begin(_sda: number, _scl: number): void {
    this.transmitting = false;
    this.payload = [];
    this.readBuffer = [];
  }

  /**
   * Points the device's read pointer at a register and asks for `count` bytes.
   *
   * Returns how many are waiting, which is what `Wire.available()` reports and
 * what a sketch loops on.
   */
  requestFrom(address: number, count: number): number {
    this.readBuffer = [...this.reader(address & 0x7f, Math.max(0, Math.floor(count)))];
    return this.readBuffer.length;
  }

  /** One byte of the last request, or -1 once they are spent. */
  read(): number {
    return this.readBuffer.length > 0 ? (this.readBuffer.shift() as number) : -1;
  }

  /** Bytes of the last request still unread. */
  available(): number {
    return this.readBuffer.length;
  }

  beginTransmission(target: number): void {
    this.transmitting = true;
    this.address = target & 0x7f;
    this.payload = [];
  }

  /** Returns the usual Arduino `1` so sketches can chain or ignore it. */
  write(value: number): number {
    if (this.transmitting) this.payload.push(value & 0xff);
    return 1;
  }

  endTransmission(): I2CTransaction {
    if (!this.transmitting) {
      return { address: 0, bytes: [], acknowledged: false, micros: 0 };
    }
    this.transmitting = false;

    let acknowledged = false;
    this.payload.forEach((byte, index) => {
      if (this.deliver(this.address, byte, index === 0)) acknowledged = true;
    });

    return {
      address: this.address,
      bytes: [...this.payload],
      acknowledged,
      micros: this.payload.length * MICROS_PER_BYTE + TRANSACTION_OVERHEAD_US,
    };
  }
}