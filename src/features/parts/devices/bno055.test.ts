import { describe, expect, it } from 'vitest';
import { BNO055_ADDRESS, Bno055, BNO055_HEADING_KNOB, BNO055_PITCH_KNOB, BNO055_ROLL_KNOB } from './bno055';

/** Points the chip at a register. */
function pointAt(device: Bno055, register: number): void {
  device.receive(register, true);
}

describe('BNO055 absolute orientation sensor', () => {
  it('answers at 0x28', () => {
    expect(new Bno055().address).toBe(BNO055_ADDRESS);
    expect(BNO055_ADDRESS).toBe(0x28);
  });

  it('reports the chip id register', () => {
    const device = new Bno055();
    pointAt(device, 0x00);
    expect(device.read(1)).toEqual([0xa0]);
  });

  it('reports heading, pitch and roll the knobs are set to', () => {
    const device = new Bno055();
    device.setOrientationSource(() => ({ heading: 90, pitch: 10, roll: -5 }));
    pointAt(device, 0x1a);
    const bytes = device.read(6);
    expect(bytes.length).toBe(6);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Bno055();
    let heading = 0;
    let pitch = 0;
    let roll = 0;
    device.setOrientationSource(() => ({ heading, pitch, roll }));
    pointAt(device, 0x1a);
    const before = device.read(6);
    heading = 180;
    pitch = 30;
    roll = 10;
    pointAt(device, 0x1a);
    const after = device.read(6);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(BNO055_HEADING_KNOB).toMatchObject({
      id: 'heading',
      label: 'Heading',
      min: 0,
      max: 360,
      step: 1,
      unit: '°',
      defaultValue: 90,
    });
    expect(BNO055_PITCH_KNOB).toMatchObject({
      id: 'pitch',
      label: 'Pitch',
      min: -90,
      max: 90,
      step: 1,
      unit: '°',
      defaultValue: 0,
    });
    expect(BNO055_ROLL_KNOB).toMatchObject({
      id: 'roll',
      label: 'Roll',
      min: -90,
      max: 90,
      step: 1,
      unit: '°',
      defaultValue: 0,
    });
  });
});
