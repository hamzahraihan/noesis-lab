/**
 * 74HC595 shift register: the eight outputs you get when the board runs out
 * of pins.
 *
 * The chip is a serial-in, parallel-out register. Data is clocked in one bit
 * at a time, and a separate latch line copies the shifted byte to the eight
 * outputs -- so a sketch can shift a byte in while the outputs still hold the
 * last one, and swap them over in one go. That is the whole trick, and it is
 * why a part with one pin can light eight.
 *
 * The model keeps the three states the chip really has: the byte being
 * shifted in, the byte the outputs are holding, and whether the outputs are
 * enabled at all -- the enable line is active low, so pulling it down turns
 * the outputs into high-impedance rather than driving them.
 */
import { type SpiDevice } from './device';
import type { PartDefinition, PinSpec } from '../catalog';

/** How many outputs the chip has. */
export const SHIFT595_OUTPUTS = 8;

/**
 * The output stage, in ohms.
 *
 * The chip's outputs are weak: the datasheet has them at four milliamps with
 * a hundred millivolts across them, which is about a thousand ohms of
 * output impedance. An LED through that is dimmer than the same LED on a
 * board's pin, and that is the chip's answer rather than a fault.
 */
export const SHIFT595_OUTPUT_OHMS = 1000;

/**
 * The module's header, in two rows of seven.
 *
 * The chip's own pins, in the order a breakout board carries them: the
 * enable, the clock, the data in and the latch down one side, the eight
 * outputs and the supply down the other.
 */
const SHIFT595_PINS: ReadonlyArray<readonly [id: string, label: string]> = [
  ['OE', 'OE'],
  ['SRCLK', 'SRCLK'],
  ['SER', 'SER'],
  ['RCLK', 'RCLK'],
  ['Q0', 'Q0'],
  ['Q1', 'Q1'],
  ['Q2', 'Q2'],
  ['Q3', 'Q3'],
  ['Q4', 'Q4'],
  ['Q5', 'Q5'],
  ['Q6', 'Q6'],
  ['Q7', 'Q7'],
  ['VCC', 'VCC'],
  ['GND', 'GND'],
];

export class Shift595 implements SpiDevice {
  /** The byte being shifted in, most significant bit first. */
  private shift = 0;
  /** The byte the outputs are holding. */
  private latched = 0;
  /** Whether the outputs are driving at all; the enable line is active low. */
  private enabled = true;

  /**
   * One byte out to the chip.
   *
   * The chip's shift register moves toward Q7, so the first bit to arrive ends
   * up on Q7 and the last on Q0 -- which is the gotcha every sketch that
   * lights a chain in order has to know. A byte arrives most significant bit
   * first, the way Arduino's `shiftOut` sends it, so `shiftOut(0x01)` lights
   * Q0 and `shiftOut(0x80)` lights Q7.
   */
  receive(byte: number, _dataSelect: boolean, chipSelected: boolean): void {
    if (!chipSelected) return;
    // A byte is eight clock edges, and the most significant bit goes first.
    for (let edge = 0; edge < 8; edge++) {
      const arriving = (byte & 0x80) !== 0;
      this.shift = ((this.shift << 1) | (arriving ? 1 : 0)) & 0xff;
      byte = (byte << 1) & 0xff;
    }
  }

  /**
   * The latch line's level.
   *
   * The chip copies the shift register to the outputs when the latch line
   * rises, and the sketch that writes it the documented way -- latch low, the
   * eight bits in, latch high -- is latched by the line being high. The
   * outputs therefore take the byte that was shifted in, and hold it until the
   * next time.
   */
  setLatchLevel(high: boolean): void {
    if (!high) return;
    this.latched = this.shift;
  }

  /**
   * The level an output is driving.
   *
   * False when the outputs are disabled: the chip's enable line is active
   * low, and with the outputs disabled they float rather than drive.
   */
  output(index: number): boolean {
    if (!this.enabled) return false;
    return ((this.latched >> index) & 1) === 1;
  }

  /** Sets the enable line's level, active low as the chip is. */
  setEnableLevel(low: boolean): void {
    this.enabled = !low;
  }
}

/**
 * The 74HC595 as the breakout board it is sold on.
 *
 * The board is drawn by the bench, like the other instruments it has no
 * element for: a small board with the chip in the middle and the header
 * along one edge.
 */
export function shift595Definition(): PartDefinition {
  const pins: PinSpec[] = [];
  const pitch = 2.54;
  SHIFT595_PINS.forEach(([id, label], index) => {
    const column = index % 7;
    const row = Math.floor(index / 7);
    pins.push({
      id,
      label,
      x: 2.54 + column * pitch,
      // The header sits along the bottom of the board, so the chip has the
      // middle of the board to itself.
      y: 12.7 + row * pitch,
      net: id === 'GND' ? 'GND' : id === 'VCC' ? '5V' : undefined,
    });
  });

  return {
    id: 'shift595',
    name: '74HC595 Shift Register',
    category: 'output',
    widthMm: 25.4,
    heightMm: 20.32,
    component: {
      kind: 'shift-register',
      // The clock and the data in are the bus's own wires; the latch is a
      // plain output the sketch drives, because on the chip they are separate.
      spi: { clock: 'SRCLK', dataIn: 'SER' },
      latch: 'RCLK',
      enable: 'OE',
    },
    pins,
    bodyColour: '#14532d',
    legendColour: '#e8f5e9',
  };
}
