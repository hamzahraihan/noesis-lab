import { describe, expect, it } from 'vitest';
import { resolveAngleInclude } from './resolve';

const toolchain = new Set(['Servo.h', 'Wire.h', 'Arduino.h']);
const slots = [{ id: 'mine', name: 'MyLib', files: [{ path: 'MyLib.h', content: '' }] }];
const declared = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [{ name: 'main.ino', content: '' }],
  libraries: [
    { name: 'Servo', source: 'provided' },
    { name: 'custom:mine', source: 'custom' },
  ],
} as const;

describe('angle include resolution', () => {
  it('prefers custom slots, then provided, then toolchain', () => {
    const ctx = { project: declared, slots, toolchainHeaders: toolchain };
    expect(resolveAngleInclude('MyLib.h', ctx)).toEqual({ kind: 'custom-slot', slot: slots[0] });
    expect(resolveAngleInclude('Servo.h', ctx)).toEqual({ kind: 'provided', library: 'Servo' });
    expect(resolveAngleInclude('Wire.h', ctx)).toEqual({ kind: 'toolchain' });
    expect(resolveAngleInclude('Nope.h', ctx)).toEqual({ kind: 'unknown' });
  });

  it('is case-sensitive and lets custom slots shadow provided names', () => {
    const shadowing = {
      ...declared,
      libraries: [{ name: 'custom:servo', source: 'custom' }] as const,
    };
    const ctx = {
      project: shadowing,
      slots: [{ id: 'servo', name: 'Servo', files: [{ path: 'Servo.h', content: '' }] }],
      toolchainHeaders: toolchain,
    };
    expect(resolveAngleInclude('Servo.h', ctx).kind).toBe('custom-slot');
    expect(resolveAngleInclude('servo.h', ctx)).toEqual({ kind: 'unknown' });
  });

  it('leaves undeclared-but-bundled headers to the toolchain', () => {
    const ctx = {
      project: { ...declared, libraries: [] as const },
      slots: [],
      toolchainHeaders: toolchain,
    };
    expect(resolveAngleInclude('Wire.h', ctx)).toEqual({ kind: 'toolchain' });
  });

  it('resolves installed index headers ahead of the toolchain bundle', () => {
    const indexed = {
      ...declared,
      libraries: [{ name: 'Servo', source: 'index', version: '5.0.0' }] as const,
    };
    const ctx = {
      project: indexed,
      slots: [],
      toolchainHeaders: toolchain,
      indexInstalled: new Map([['Servo', { headers: ['Servo.h'] as const }]]),
    };
    expect(resolveAngleInclude('Servo.h', ctx)).toEqual({ kind: 'index', library: 'Servo' });
    expect(resolveAngleInclude('Wire.h', ctx)).toEqual({ kind: 'toolchain' });
  });
});
