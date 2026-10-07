/**
 * Handheld IR remote: twenty keys behind no pins at all.
 *
 * The part is battery-powered and pinless (`pins: []`) -- it reaches a
 * sketch through the air, not through copper. Holding any key (the whole
 * part is momentary, like a button) transmits its NEC code; the engine
 * holds the transmission briefly past release for the decode window.
 * Carrier bursts are deliberately not modeled.
 */

import type { KnobSpec, PartDefinition } from '@/sim/catalog';

/** NEC code behind one remote key, in the element's key order. */
export interface RemoteKey {
  readonly name: string;
  readonly code: number;
}

/** The element's 20 keys: function row, digits, and stragglers. */
export const NEC_CODES: ReadonlyArray<RemoteKey> = [
  { name: 'power', code: 0xa2 },
  { name: 'menu', code: 0xe2 },
  { name: 'test', code: 0x22 },
  { name: 'plus', code: 0x02 },
  { name: 'back', code: 0xc2 },
  { name: 'prev', code: 0xe0 },
  { name: 'play', code: 0xa8 },
  { name: 'next', code: 0x90 },
  { name: '0', code: 0x68 },
  { name: 'minus', code: 0x98 },
  { name: 'c', code: 0xb0 },
  { name: '1', code: 0x30 },
  { name: '2', code: 0x18 },
  { name: '3', code: 0x7a },
  { name: '4', code: 0x10 },
  { name: '5', code: 0x38 },
  { name: '6', code: 0x5a },
  { name: '7', code: 0x42 },
  { name: '8', code: 0x4a },
  { name: '9', code: 0x52 },
];

/** Which key the held remote is sending, by table index. */
export const REMOTE_KEY_KNOB: KnobSpec = {
  id: 'key',
  label: 'Key',
  min: 0,
  max: NEC_CODES.length - 1,
  step: 1,
  defaultValue: 0,
};

/** How long past release a transmission stays live, for the decode window. */
export const IR_RELEASE_MS = 200;

export function remoteDefinition(): PartDefinition {
  return {
    id: 'ir-remote',
    name: 'IR Remote',
    category: 'input',
    widthMm: 40,
    heightMm: 83.653,
    component: { kind: 'ir-remote' },
    pins: [],
    knobs: [REMOTE_KEY_KNOB],
    momentary: true,
    bodyColour: '#1b1d21',
    legendColour: '#e8e8e8',
  };
}
