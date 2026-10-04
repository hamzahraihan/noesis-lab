import { describe, expect, it } from 'vitest';
import { NEC_CODES, REMOTE_KEY_KNOB, remoteDefinition } from './remote';

describe('remote definition', () => {
  it('is pinless with a 20-key table', () => {
    const def = remoteDefinition();
    expect(def.pins).toEqual([]);
    expect(NEC_CODES).toHaveLength(20);
    expect(NEC_CODES[0]).toEqual({ name: 'power', code: 0xa2 });
    expect(def.knobs).toEqual([REMOTE_KEY_KNOB]);
  });
});
