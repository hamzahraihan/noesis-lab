import { describe, expect, it } from 'vitest';
import { liveHostIn } from './live-hosts';

/*
 * The bench's notice reads the sketch text, so this is the one thing that turns
 * a name in a program into a sentence about the bench. It is deliberately
 * narrow: a name is only a name when it appears as a url's host.
 */
describe('finding a live host in a sketch', () => {
  it('finds the host of a url literal', () => {
    expect(liveHostIn('  while (net.get("http://weather.noesis/v1/forecast?x=1") == 0) {')).toBe(
      'weather.noesis',
    );
    expect(liveHostIn('net.get("http://data.noesis/todos/1")')).toBe('data.noesis');
  });

  it('finds it without a path, before the closing quote', () => {
    expect(liveHostIn('net.get("http://data.noesis")')).toBe('data.noesis');
  });

  it('ignores a bench host, a name in prose, and a name that only looks like one', () => {
    expect(liveHostIn('net.get("http://api.noesis/time")')).toBeNull();
    // No `//` before it: a comment or a sentence, not a request.
    expect(liveHostIn('the weather.noesis host is real')).toBeNull();
    expect(liveHostIn('net.get("http://weather.noesis.example.com/x")')).toBeNull();
    expect(liveHostIn('')).toBeNull();
  });
});
