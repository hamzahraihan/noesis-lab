import { describe, expect, it } from 'vitest';
import { avrAvailableFor } from './avr-mode';

describe('avr mode availability', () => {
  it('is available on the Uno', () => {
    expect(avrAvailableFor('uno')).toEqual({ ok: true });
  });

  it('is refused elsewhere with a reason', () => {
    expect(avrAvailableFor('mega')).toEqual({ ok: false, reason: expect.any(String) });
  });
});
