/**
 * The real hosts a bench can bridge to, under the names a sketch uses.
 *
 * The bench owns its network (`network.ts`): a name it knows, a path it serves,
 * an answer on simulated time. A *bridged* name is the exception, and it is
 * opt-in per build (`GalleryBuild.network === 'live'`), because a fetch is a
 * decision about the machine the bench is running on -- not something a pasted
 * link or an unknown sketch gets to make.
 *
 * The sketch still names a bench host (`net.get("http://weather.noesis/...")`):
 * the name is what a lesson text can keep, and the real endpoint can move
 * without rewriting the lesson. Only the path and query travel: the name table
 * is the allowlist.
 *
 * A host earns a place here on four counts, all of them checked by hand:
 *
 * - no API key, because a key shipped in a page is a published key;
 * - CORS for an anonymous GET from any origin, since the page is COEP
 *   `require-corp` and a request without `Access-Control-Allow-Origin` cannot
 *   be read at all (never `no-cors`: a refusal would arrive as an opaque 200
 *   and the sketch would print nothing useful, which is the trap
 *   `map-fetcher.ts` documents for tiles);
 * - terms that allow a browser client, with attribution where the host asks;
 * - a body a lesson can *do* something with.
 */

/** One name the bench can bridge, and the endpoint behind it. */
export interface LiveHost {
  /** Where the path and query of the request are appended. */
  readonly base: string;
  /** Why this host, in the words a reviewer needs. */
  readonly note: string;
}

export const LIVE_HOSTS: Readonly<Record<string, LiveHost>> = {
  /*
   * Weather, keyless and JSON. Verified 2026-10-18: `GET /v1/forecast` answers
   * 200 with `access-control-allow-origin: *` for an anonymous request.
   */
  'weather.noesis': {
    base: 'https://api.open-meteo.com',
    note: 'open-meteo: keyless JSON forecast, CORS * - the IoT shape a lesson can draw',
  },
  /*
   * A live host whose body never changes, so a first exercise (or a test) can
   * name an exact answer and still be talking to the internet. Verified
   * 2026-10-18: `GET /todos/1` answers 200 and reflects the request's origin in
   * `access-control-allow-origin`, so it works off localhost too.
   */
  'data.noesis': {
    base: 'https://jsonplaceholder.typicode.com',
    note: 'jsonplaceholder: static JSON, CORS reflects the origin - a deterministic real answer',
  },
};

/**
 * The live host a sketch text names, or null.
 *
 * A sketch writes `net.get("http://weather.noesis/...")`, so the scan looks for
 * the `//name` of a table entry with a path or the closing quote after it. Read
 * from the text on purpose: when the bench has no bridge, the sketch's own
 * answer is only "that host does not exist", and this is what lets the bench say
 * *which* host it meant -- in both backends, since the worker owns the network
 * when it steps and a runtime signal would not travel back.
 */
export function liveHostIn(text: string): string | null {
  for (const name of Object.keys(LIVE_HOSTS)) {
    if (text.includes(`//${name}/`) || text.includes(`//${name}"`)) return name;
  }
  return null;
}
