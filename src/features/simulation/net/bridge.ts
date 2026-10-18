/**
 * The bench's one doorway to a real host.
 *
 * Everything a bridged request is allowed to be is decided here, in one
 * function, because this is the app's whole exposure to the open network: the
 * sketch is the user's code, and it must not be able to carry their cookies,
 * set headers, choose a method, or read more than a lesson needs. The network
 * (`network.ts`) calls this only for a name in `LIVE_HOSTS`, and only when a
 * build opted in, so an arbitrary url never reaches `fetch` in the first place.
 *
 * A failed bridge is an answer, not an exception: the sketch learns the same
 * thing it learns from a bench host that is not there, which is the lesson the
 * network slice already teaches.
 */

import type { NetAnswer } from './network';

/** A request the bench makes instead of the board. Never rejects. */
export type NetFetcher = (url: string) => Promise<NetAnswer>;

/** When a bridge gives up. A promise that never settles must not hang a sketch. */
export const LIVE_TIMEOUT_MS = 10_000;

/** How much of a body is kept. A lesson draws a number, not a document. */
export const LIVE_BODY_LIMIT = 4096;

/** The answer a bridge reports when it has nothing to hand over. */
function refused(): NetAnswer {
  return { ok: false, body: '' };
}

/**
 * Resolves with the promise, or with a rejection once `ms` have passed.
 *
 * `setTimeout` is cleared in both directions: a slow timer left behind would
 * keep the tab's timer list growing for every request a sketch makes.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { promise: raced, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new Error('bridge timeout')), ms);
  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    },
  );
  return raced;
}

/**
 * The shipped fetcher: a CORS GET with no credentials.
 *
 * `mode: 'cors'` rather than `no-cors` so a host without the header is a
 * failure instead of an opaque body; `credentials: 'omit'` so the request
 * speaks for the bench and never for the person running it; no headers and no
 * method choice, because the sketch cannot express either.
 */
export function createLiveFetcher(
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
    readonly limitBytes?: number;
  } = {},
): NetFetcher {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? LIVE_TIMEOUT_MS;
  const limitBytes = options.limitBytes ?? LIVE_BODY_LIMIT;
  return async (url: string): Promise<NetAnswer> => {
    try {
      const response = await withTimeout(
        doFetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow' }),
        timeoutMs,
      );
      if (!response.ok) return refused();
      const text = await withTimeout(response.text(), timeoutMs);
      return { ok: true, body: text.slice(0, limitBytes) };
    } catch {
      return refused();
    }
  };
}
