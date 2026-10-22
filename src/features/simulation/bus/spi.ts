/**
 * SPI bus model.
 *
 * As with I2C, transfers are modelled at transaction level but *timed* at
 * transaction level: a byte costs its eight bit periods at the bus clock, and
 * the VM waits out that time. Pushing a full 320x240 frame is over a hundred
 * milliseconds of real bus time, and pretending otherwise would make SPI
 * look faster than it can ever be.
 *
 * The bus also owns framing, because framing is a bus concern: a transfer runs
 * from the chip-select going low to it going back high. That boundary is what
 * tells a device its command sequence has ended, and toggling chip-select in the
 * middle of one is a mistake this model has to be able to reproduce.
 */

/** Conservative SPI clock for the TFT modules on the bench. */
export const SPI_CLOCK_HZ = 8_000_000;

/** Eight bit periods per byte. */
const MICROS_PER_BYTE = (1_000_000 * 8) / SPI_CLOCK_HZ;

export interface SpiTransfer {
  /** The bytes sent between the chip-select going low and high. */
  readonly bytes: readonly SpiByte[];
  /** True when a device was selected and saw at least one byte. */
  readonly acknowledged: boolean;
  /** Simulated microseconds the transfer consumed on the bus. */
  readonly micros: number;
}

/**
 * One byte on the wire.
 *
 * The D/C state travels with it because on this bench that state is the only
 * thing distinguishing a display's command from its pixel data.
 */
export interface SpiByte {
  readonly value: number;
  /** True when the D/C pin was high: data rather than a command. */
  readonly data: boolean;
}

/**
 * A single SPI bus.
 *
 * `deliver` receives each byte with the state of the D/C pin, which is what
 * tells a display whether the byte is a command or data, and answers with the
 * byte the device shifted back out on MISO -- or null when nothing on the bus
 * heard the byte at all. A display has no MISO line to speak on and answers
 * zero; a register device answers what it holds.
 */
export class SpiBus {
  private selected = false;
  private sawByte = false;
  private payload: SpiByte[] = [];

  private readonly deliver: (
    byte: number,
    dataSelect: boolean,
    chipSelected: boolean,
  ) => number | null;
  private readonly onEnd: (() => void) | undefined;

  constructor(
    deliver: (byte: number, dataSelect: boolean, chipSelected: boolean) => number | null,
    onEnd?: () => void,
  ) {
    this.deliver = deliver;
    this.onEnd = onEnd;
  }
  /** Pulls chip-select low and begins a transfer. */
  begin(): void {
    this.selected = true;
    this.sawByte = false;
    this.payload = [];
  }

  /**
   * Sends one byte, returning the value read back on MISO.
   *
   * `chipSelected` is false once chip-select has risen: the byte still goes
   * out, but the device is told that the command it was in the middle of has
   * been abandoned -- which is what a real controller sees.
   */
  transfer(byte: number, dataSelect: boolean, chipSelected = true): number {
    if (!this.selected) return 0;
    this.payload.push({ value: byte & 0xff, data: dataSelect });
    const answer = this.deliver(byte & 0xff, dataSelect, chipSelected);
    if (answer !== null) this.sawByte = true;
    return answer ?? 0;
  }

  /**
   * Pulls chip-select high and ends the transfer.
   *
   * The boundary matters: it is what tells a display its command sequence has
   * finished, so raising chip-select halfway through one aborts the command.
   */
  end(): SpiTransfer {
    const transfer: SpiTransfer = {
      bytes: [...this.payload],
      acknowledged: this.sawByte,
      micros: this.sawByte ? this.payload.length * MICROS_PER_BYTE : 0,
    };
    this.selected = false;
    this.sawByte = false;
    this.payload = [];
    this.onEnd?.();
    return transfer;
  }

  get inTransaction(): boolean {
    return this.selected;
  }
}
