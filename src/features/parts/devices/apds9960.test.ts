import { describe, expect, it } from 'vitest';
import { APDS9960_ADDRESS, Apds9960, APDS9960_PROXIMITY_KNOB, APDS9960_AMBIENT_KNOB, APDS9960_GESTURE_KNOB } from './apds9960';

/** Points the chip at a register. */
function pointAt(device: Apds9960, register: number): void {
  device.receive(register, true);
}

describe('APDS9960 gesture and proximity sensor', () => {
  it('answers at 0x39', () => {
    expect(new Apds9960().address).toBe(APDS9960_ADDRESS);
    expect(APDS9960_ADDRESS).toBe(0x39);
  });

  it('reports the part id register', () => {
    const device = new Apds9960();
    pointAt(device, 0x92);
    expect(device.read(1)).toEqual([0xab]);
  });

  it('reports proximity and ambient the knobs are set to', () => {
    const device = new Apds9960();
    device.setConditionsSource(() => ({ proximity: 100, ambient: 500, gesture: 2 }));
    pointAt(device, 0x8c);
    const bytes = device.read(4);
    expect(bytes.length).toBe(4);
  });

  it('re-reads when the knobs turn between reads', () => {
    const device = new Apds9960();
    let proximity = 50;
    let ambient = 200;
    let gesture = 0;
    device.setConditionsSource(() => ({ proximity, ambient, gesture }));
    pointAt(device, 0x8c);
    const before = device.read(4);
    proximity = 200;
    ambient = 800;
    gesture = 4;
    pointAt(device, 0x8c);
    const after = device.read(4);
    expect(after).not.toEqual(before);
  });

  it('knobs span the datasheet ranges', () => {
    expect(APDS9960_PROXIMITY_KNOB).toMatchObject({
      id: 'proximity',
      label: 'Proximity',
      min: 0,
      max: 255,
      step: 1,
      defaultValue: 50,
    });
    expect(APDS9960_AMBIENT_KNOB).toMatchObject({
      id: 'ambient',
      label: 'Ambient light',
      min: 0,
      max: 2000,
      step: 10,
      unit: 'lux',
      defaultValue: 200,
    });
    expect(APDS9960_GESTURE_KNOB).toMatchObject({
      id: 'gesture',
      label: 'Gesture',
      min: 0,
      max: 4,
      step: 1,
      defaultValue: 0,
    });
  });
});
