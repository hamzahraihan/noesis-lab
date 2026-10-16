import { describe, expect, it } from 'vitest';
import { Rp2040Clock } from './clock';

describe('rp2040 clock', () => {
  it('fires alarms in time order at their scheduled instants', () => {
    const clock = new Rp2040Clock();
    const fired: Array<[string, number]> = [];
    clock.createAlarm(() => fired.push(['late', clock.nanos])).schedule(80);
    clock.createAlarm(() => fired.push(['early', clock.nanos])).schedule(30);
    clock.tick(100);
    expect(fired).toEqual([['early', 30], ['late', 80]]);
    expect(clock.nanos).toBe(100);
    expect(clock.nanosToNextAlarm).toBe(0);
  });

  it('supports rescheduling from a callback and cancellation', () => {
    const clock = new Rp2040Clock();
    const fired: number[] = [];
    const alarm = clock.createAlarm(() => {
      fired.push(clock.nanos);
      if (fired.length === 1) alarm.schedule(60);
    });
    alarm.schedule(40);
    clock.tick(200);
    expect(fired).toEqual([40, 100]);
    const cancelled = clock.createAlarm(() => fired.push(-1));
    cancelled.schedule(10);
    cancelled.cancel();
    clock.tick(10);
    expect(fired).toEqual([40, 100]);
    expect(clock.nanosToNextAlarm).toBe(0);
  });
});
