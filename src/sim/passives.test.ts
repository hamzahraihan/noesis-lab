import { describe, expect, it } from 'vitest';
import { ledDefinition } from '@/features/parts';
import { DIODE_PROFILES } from '@/features/simulation';
import { SNAP_DISTANCE_MM } from '@/features/simulation';
import { WOKWI_PARTS, wokwiPartFor } from '../ui/wokwi';

/**
 * The LED's pins must sit under the Wokwi lamp's own legs.
 *
 * Wires route to the definition pins while the eye reads the element's leads;
 * any gap between the two reads as a wire floating beside the part. The
 * element states its leads in CSS pixels (`pinInfo` in
 * `led-element.js`: anode x = 25, cathode x = 15, both y = 42, in a
 * 40 x 50 body), so the definition repeats them here in millimetres at
 * 96 px per inch. If the library moves its legs, these fail and say where.
 */
describe('LED pins land on the Wokwi legs', () => {
  const definition = ledDefinition(DIODE_PROFILES.green, 'Green');
  const PX_TO_MM = 25.4 / 96;

  it('renders with the Wokwi lamp', () => {
    expect(wokwiPartFor(definition)).toBe(WOKWI_PARTS.led);
  });

  it('declares the same box the element draws', () => {
    expect(definition.widthMm).toBeCloseTo(WOKWI_PARTS.led.sizeMm.w, 3);
    expect(definition.heightMm).toBeCloseTo(WOKWI_PARTS.led.sizeMm.h, 3);
  });

  it('puts each pin under its leg', () => {
    const pins = Object.fromEntries(definition.pins.map((pin) => [pin.id, pin]));
    // A hundredth of a millimetre is far below a pixel at working zoom.
    const toleranceMm = 0.01;
    const close = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThan(toleranceMm);

    close(pins.anode.x, 25 * PX_TO_MM);
    close(pins.anode.y, 42 * PX_TO_MM);
    close(pins.cathode.x, 15 * PX_TO_MM);
    close(pins.cathode.y, 42 * PX_TO_MM);
  });

  it('straddles adjacent breadboard holes within snap', () => {
    const [anode, cathode] = [
      definition.pins.find((pin) => pin.id === 'anode')!,
      definition.pins.find((pin) => pin.id === 'cathode')!,
    ];
    const span = Math.hypot(anode.x - cathode.x, anode.y - cathode.y);

    // 2.64 mm against a 2.54 mm pitch: one leg lands exact, the other
    // 0.1 mm off, and the bench joins contacts inside 0.4 mm.
    expect(Math.abs(span - 2.54)).toBeLessThan(SNAP_DISTANCE_MM);
  });
});
