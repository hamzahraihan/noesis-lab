/**
 * MCP4725: a converter that produces a voltage instead of measuring one.
 *
 * The bench can read analog levels -- the ADS1115 counts them, the
 * barometer reports one -- but it had nothing that could *make* one. This
 * is that: the sketch writes twelve bits over the I2C bus and the chip
 * holds a voltage on its output, somewhere between the ground and the
 * supply, in steps of the supply over four thousand and ninety-five.
 *
 * The chip is a DAC with a nonvolatile register behind it, so the output
 * survives a power cycle. The bench does not model the memory: the output
 * is what the sketch last asked for, and a bench that starts again starts
 * the converter at zero.
 *
 * The write has two shapes, and the chip tells them apart by a bit rather
 * than by how many bytes arrive: a fast write is the two data bytes, and a
 * multi-byte write starts with a command byte that says what the write is
 * for. The bench accepts both, because a sketch that sets the gain or
 * powers the output down would otherwise be talking past the model.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers on, with the address pin low. */
export const MCP4725_ADDRESS = 0x60;

/** How many bits the code is, and how far it counts. */
export const MCP4725_RESOLUTION = 12;
export const MCP4725_MAX_CODE = (1 << MCP4725_RESOLUTION) - 1;

/**
 * The output stage, in ohms.
 *
 * The datasheet has the output impedance at a kilohm, and that is what
 * stands between the chip's amplifier and whatever the sketch attaches to
 * it.
 */
export const MCP4725_OUTPUT_OHMS = 1000;

/**
 * The write command that says "this is for the DAC's input register".
 *
 * The DAC register is a command type, a power-down pair and twelve bits of
 * data, and the command bits sit at the top of the first byte: C1 set means
 * the byte is a command, and two more bytes of data follow it. A fast write
 * is the same thing with the command bits clear, and the top four bits of
 * the code in the bottom of the first byte.
 */
const MULTI_WRITE = 0x40;

export class Mcp4725 implements I2cDevice {
  readonly address = MCP4725_ADDRESS;
  onBus = false;

  /** The code the chip is holding. */
  private code = 0;
  /** Power-down bits (normally 0 = active). */
  private powerDown = 0;
  /** The bytes of the write in flight. */
  private bytes: number[] = [];
  /** Whether the write in flight began with a command byte. */
  private commanded = false;

  /**
   * One written byte.
   *
   * The first byte of a write is either the top of the data or a command
   * that says what the data is for, and the chip tells them apart by the
   * command bits rather than by how many bytes arrive.
   */
  receive(byte: number, _isControlPosition: boolean): boolean {
    if (this.bytes.length === 0) {
      this.commanded = (byte & MULTI_WRITE) !== 0;
      this.bytes.push(byte);
      return true;
    }
    this.bytes.push(byte);
    if (this.commanded) {
      // The command byte, then the top four bits of the code and the rest.
      if (this.bytes.length === 3) {
        this.code = ((this.bytes[1] & 0xf0) >> 4) * 256 + this.bytes[2]!;
        this.bytes = [];
      }
      return true;
    }
    // A fast write: the command bits and the top four bits of the code in
    // the first byte, and the other eight in the second.
    if (this.bytes.length === 2) {
      this.code = (this.bytes[0] & 0x0f) * 256 + this.bytes[1]!;
      this.bytes = [];
    }
    return true;
  }

  /**
   * A read, in the datasheet's Read-command frame.
   *
   * Figure 6-3 of the datasheet: the device streams the DAC register and
   * EEPROM contents. The first three bytes modelled here are the status byte
   * (RDY/BSY = 1, POR = 0, power-down bits) and the two DAC data bytes. The
   * chip repeats the frame if asked for more, so any count beyond three
   * repeats from the start.
   */
  read(count: number): readonly number[] {
    const frame = [
      (this.code >> 4) & 0xff,
      ((this.code << 4) & 0xff) | ((this.powerDown & 0x03) << 1) | 0x01,
      0x00,
    ];
    return Array.from({ length: Math.max(0, count) }, (_, index) => frame[index % 3]);
  }

  /**
   * The voltage on the output, in volts.
   *
   * The chip's reference is the supply, so the output runs from the ground
   * to the supply in four thousand and ninety-five steps.
   */
  output(supply: number): number {
    return (supply * this.code) / MCP4725_MAX_CODE;
  }
}

/**
 * The module as it is sold: a small board with the chip on it, the two bus
 * wires, the supply and the output.
 */
export function mcp4725Definition(): PartDefinition {
  return {
    id: 'mcp4725',
    name: 'DAC converter (MCP4725)',
    category: 'output',
    widthMm: 20.32,
    heightMm: 17.78,
    component: { kind: 'dac' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
      { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
      { id: 'SDA', label: 'SDA', x: 7.62, y: 4.0 },
      { id: 'SCL', label: 'SCL', x: 10.16, y: 4.0 },
      { id: 'AOUT', label: 'AOUT', x: 12.70, y: 4.0 },
    ],
    bodyColour: '#0f172a',
    legendColour: '#e2e8f0',
  };
}
