import { describe, expect, it, vi } from 'vitest';
import { LIVE_BODY_LIMIT, LIVE_TIMEOUT_MS, createLiveFetcher } from './bridge';
import { LIVE_HOSTS } from './live-hosts';

/** A `fetch` that records what it was asked and answers with what the test says. */
function stub(result: { ok: boolean; text?: string } | 'throw') {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (result === 'throw') return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: result.ok,
      status: result.ok ? 200 : 404,
      text: () => Promise.resolve(result.text ?? ''),
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Lets the fetcher's `then` chain run: microtask turns, no wall clock. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('the live fetcher', () => {
  it('asks with CORS, no credentials and no method of its own', async () => {
    const { calls, fetchImpl } = stub({ ok: true, text: 'hello' });
    const answer = await createLiveFetcher({ fetchImpl })('https://example.test/x');
    expect(answer).toEqual({ ok: true, body: 'hello' });
    expect(calls[0]!.url).toBe('https://example.test/x');
    expect(calls[0]!.init).toMatchObject({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
    });
    // No request headers at all: the sketch is not the person running the bench.
    expect(calls[0]!.init?.headers).toBeUndefined();
  });

  it('keeps only the first bytes of a long body', async () => {
    const { fetchImpl } = stub({ ok: true, text: '0123456789' });
    const answer = await createLiveFetcher({ fetchImpl, limitBytes: 4 })('https://example.test/x');
    expect(answer).toEqual({ ok: true, body: '0123' });
    expect(LIVE_BODY_LIMIT).toBeGreaterThan(0);
  });

  it('reports a non-2xx as a failure', async () => {
    const { fetchImpl } = stub({ ok: false });
    expect(await createLiveFetcher({ fetchImpl })('https://example.test/x')).toEqual({
      ok: false,
      body: '',
    });
  });

  it('reports a thrown fetch as a failure', async () => {
    const { fetchImpl } = stub('throw');
    expect(await createLiveFetcher({ fetchImpl })('https://example.test/x')).toEqual({
      ok: false,
      body: '',
    });
  });

  it('gives up on a host that never answers', async () => {
    // Fake timers: the timeout is the fetcher's own, and the test advances it
    // rather than waiting for it.
    vi.useFakeTimers();
    try {
      const never = (() => Promise.withResolvers<Response>().promise) as unknown as typeof fetch;
      const pending = createLiveFetcher({ fetchImpl: never, timeoutMs: 5 })(
        'https://example.test/x',
      );
      await vi.advanceTimersByTimeAsync(5);
      expect(await pending).toEqual({ ok: false, body: '' });
      expect(LIVE_TIMEOUT_MS).toBeGreaterThan(1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the shipped hosts', () => {
  /*
   * The names and their endpoints are a deliberate decision (see the file's own
   * rule), and the CORS evidence behind them is dated in the design spec. A
   * change to either is a change to what the app can reach, so it is pinned
   * here rather than left to a diff nobody reads.
   */
  it('are the two verified endpoints', () => {
    expect(LIVE_HOSTS['weather.noesis']?.base).toBe('https://api.open-meteo.com');
    expect(LIVE_HOSTS['data.noesis']?.base).toBe('https://jsonplaceholder.typicode.com');
  });

  it('are all https, and all say why they are here', () => {
    for (const [name, host] of Object.entries(LIVE_HOSTS)) {
      expect(host.base.startsWith('https://'), name).toBe(true);
      expect(host.note.length, name).toBeGreaterThan(20);
    }
  });
});

// The fetcher's own contract: it never rejects, so the network has one shape to
// read however the host behaved.
describe('the fetcher contract', () => {
  it('resolves rather than rejecting, whatever the host did', async () => {
    const { fetchImpl } = stub('throw');
    const fetcher = createLiveFetcher({ fetchImpl });
    const answer = await fetcher('https://example.test/x');
    await flush();
    expect(answer.ok).toBe(false);
  });
});
