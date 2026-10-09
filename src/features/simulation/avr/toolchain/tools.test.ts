import { describe, expect, it } from 'vitest';
import { avrAsArgsFor, cc1plusArgsFor, linkerArgsFor } from './tools';

describe('toolchain flag builders', () => {
  it('substitutes TU slots into the mirrored cc1plus flags', () => {
    const args = cc1plusArgsFor('/build/Foo.cpp', 'Foo.cpp', '/build/Foo.s');
    expect(args).toContain('/build/Foo.cpp');
    expect(args).toContain('/build/Foo.s');
    expect(args.some((flag) => flag.includes('<tu'))).toBe(false);
    expect(args.slice(-2)).toEqual(['-I', '/build/include']);
  });

  it('builds the avr-as argv around the unit assembly', () => {
    expect(avrAsArgsFor('/build/Foo.s', '/build/Foo.o')).toEqual([
      '-mmcu=atmega328p',
      '-o',
      '/build/Foo.o',
      '/build/Foo.s',
    ]);
  });

  it('orders link inputs firmware-first with slot shadowing', () => {
    const args = linkerArgsFor(
      ['/build/HorangFirmware.o', '/build/MyLib.o', '/build/prebuilt-0.o'],
      ['/objects/core_abi.o'],
    );
    expect(args.slice(0, 7)).toEqual([
      '-m',
      'avr5',
      '-Tdata=0x800100',
      '--gc-sections',
      '-o',
      '/build/HorangFirmware.elf',
      '/libs/crtatmega328p.o',
    ]);
    expect(args.slice(7, 11)).toEqual([
      '/build/HorangFirmware.o',
      '/build/MyLib.o',
      '/build/prebuilt-0.o',
      '/objects/core_abi.o',
    ]);
    expect(args.slice(-4)).toEqual(['-L/libs', '-lm', '-lc', '-lgcc']);
  });
});
