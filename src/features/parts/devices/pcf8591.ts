/**
 * PCF8591 ADC/DAC: a four-channel eight-bit converter on the I2C bus.
 *
 * The model speaks the register protocol rather than offering a "read channel"
 * call, because the protocol is the exercise. A sketch writes a control byte
 * that selects the channel and the auto-increment mode, then reads bytes back.
 * The first byte read after a write is a dummy (the conversion in progress),
 * and subsequent bytes are the channel readings. Writing a byte to the DAC
 * data register sets the analog output.
 *
 * The four channel voltages are the operator's knobs, read when the chip
 * reports rather than pushed in on a tick.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const PCF8591_ADDRESS = 0x48;

/** Channel 0 voltage. */
export const PCF8591_CH0_KNOB: KnobSpec = {
  id: 'ch0',
  label: 'Channel 0',
  min: 0,
  max: 5,
  step: 0.02,
  unit: 'V',
  defaultValue: 1.25,
};

/** Channel 1 voltage. */
export const PCF8591_CH1_KNOB: KnobSpec = {
  id: 'ch1',
  label: 'Channel 1',
  min: 0,
  max: 5,
  step: 0.02,
  unit: 'V',
  defaultValue: 2.5,
};

/** Channel 2 voltage. */
export const PCF8591_CH2_KNOB: KnobSpec = {
  id: 'ch2',
  label: 'Channel 2',
  min: 0,
  max: 5,
  step: 0.02,
  unit: 'V',
  defaultValue: 3.75,
};

/** Channel 3 voltage. */
export const PCF8591_CH3_KNOB: KnobSpec = {
  id: 'ch3',
  label: 'Channel 3',
  min: 0,
  max: 5,
  step: 0.02,
  unit: 'V',
  defaultValue: 0,
};

/** The DAC output voltage. */
export const PCF8591_DAC_KNOB: KnobSpec = {
  id: 'dac',
  label: 'DAC output',
  min: 0,
  max: 5,
  step: 0.02,
  unit: 'V',
  defaultValue: 0,
};

export class Pcf8591 implements I2cDevice {
  readonly address = PCF8591_ADDRESS;
  onBus = false;

  /** The four channel voltages. */
  private channels = [1.25, 2.5, 3.75, 0];
  /** Whether auto-increment is enabled. */
  private autoIncrement = false;
  /** The current channel being read. */
  private currentChannel = 0;
  /** Whether the next read is the dummy byte. */
  private dummyPending = true;

  private world: (() => number[]) | null = null;

  setChannelsSource(read: () => number[]): void {
    this.world = read;
  }

  private conditions(): void {
    if (this.world === null) return;
    this.channels = this.world();
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // First byte after address is the control byte.
      this.autoIncrement = (byte & 0x04) !== 0;
      this.currentChannel = byte & 0x03;
      this.dummyPending = true;
      return true;
    }
    // Subsequent bytes are DAC data (if D/A enable bit is set).
    // The DAC output is acknowledged; the value is not tracked for reads.
    return true;
  }

  read(count: number): readonly number[] {
    this.conditions();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      if (this.dummyPending) {
        out.push(0); // dummy byte
        this.dummyPending = false;
        continue;
      }
      const ch = this.currentChannel;
      const voltage = this.channels[ch] ?? 0;
      const count = Math.round((voltage / 5) * 255);
      out.push(Math.min(255, Math.max(0, count)));
      if (this.autoIncrement) {
        this.currentChannel = (this.currentChannel + 1) & 0x03;
      }
    }
    return out;
  }
}
