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
  /** True when a device was selected and saw at least one byte. */
  readonly acknowledged: boolean;
  /** Simulated microseconds the transfer consumed on the bus. */
  readonly micros: number;
}

/**
 * A single SPI bus.
 *
 * `deliver` receives each byte with the state of the D/C pin, which is what
 * tells a display whether the byte is a command or data.
 */
export class SpiBus {
  private selected = false;
  private sawByte = false;

  private readonly deliver: (
    byte: number,
    dataSelect: boolean,
    chipSelected: boolean,
  ) => boolean;

  constructor(
    deliver: (byte: number, dataSelect: boolean, chipSelected: boolean) => boolean,
  ) {
    this.deliver = deliver;
  }
  /** Pulls chip-select low and begins a transfer. */
  begin(): void {
    this.selected = true;
    this.sawByte = false;
  }

  /** Sends one byte, returning the value read back on MISO. */
  transfer(byte: number, dataSelect: boolean): number {
    if (!this.selected) return 0;
    if (this.deliver(byte & 0xff, dataSelect, true)) this.sawByte = true;
    return 0;
  }

  /**
   * Pulls chip-select high and ends the transfer.
   *
   * The boundary matters: it is what tells a display its command sequence has
   * finished, so raising chip-select halfway through one aborts the command.
   */
  end(): SpiTransfer {
    const transfer: SpiTransfer = {
      acknowledged: this.sawByte,
      micros: this.sawByte ? MICROS_PER_BYTE : 0,
    };
    this.selected = false;
    this.sawByte = false;
    return transfer;
  }

  get inTransaction(): boolean {
    return this.selected;
  }
}