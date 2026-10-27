import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { compileInWorker } from '../toolchain/client';
import { AvrBackend } from '../core';

const SOURCE = `#include <Arduino.h>
volatile int gCount = 3;
struct Pt { int x; int y; };
void setup(){ Serial.begin(9600); }
void loop(){
  volatile int a = 1;
  volatile long b = 2;
  Pt p;
  p.x = a;
  p.y = (int)b;
  int arr[3] = {6,7,8};
  char c = 'z';
  int *ptr = arr;
  gCount += a + p.x + arr[1] + (int)b + c + *ptr;
  delay(10);
}`;

function backend(program: Uint16Array): AvrBackend {
  return new AvrBackend(program, {
    mcu: new McuRuntime(arduinoUnoR3()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

describe('compiled AVR variables', () => {
  it('reads a volatile local, a global and an SRAM snapshot', async () => {
    try {
      createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      console.warn('SKIP: toolchain absent');
      return;
    }
    const lineMap = SOURCE.split('\n').map((_line, index) => ({
      file: 'main.ino',
      line: index + 1,
    }));
    const built = await compileInWorker(
      SOURCE,
      () => {},
      new AbortController().signal,
      lineMap,
    );
    expect(built.debug).toBeDefined();
    const avr = backend(built.hex);
    avr.attachDebug(built.debug ?? null);
    avr.setDebugStops({
      armed: true,
      hasBreakpoint: (file, line) => file === 'main.ino' && line === 14,
    });
    for (let index = 0; index < 200 && !avr.debugPaused(); index += 1) {
      avr.step(20);
    }
    const frame = avr.debugFrame();
    expect(frame?.file).toBe('main.ino');
    expect(frame?.line).toBe(14);
    const values = new Map(frame?.variables.map((variable) => [variable.name, variable.value]));
    expect(values.get('a')).toBe('1');
    expect(values.get('b')).toBe('2');
    expect(values.get('c')).toBe("'z' (0x7a)");
    expect(values.get('gCount')).toBe('3');
    expect(frame?.memory?.start).toBe(0x100);
    expect(frame?.memory?.bytes).toHaveLength(0x800);
    expect(frame?.memory?.bytes[0]).toBe(3);
  }, 120_000);
});
