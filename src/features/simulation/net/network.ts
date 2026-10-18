/**
 * The bench's network, which is the whole internet as far as a sketch can tell.
 *
 * A board cannot reach the real network from here: the page is COEP
 * `require-corp`, so only hosts that send CORS are reachable at all, a page has
 * no sockets (so MQTT over TCP and TLS are unrepresentable), the app's own
 * value is that the bench works with no network, and a real network would make
 * every test that touches it non-deterministic. So the bench owns the network:
 * it knows a few names, answers a few paths, and — the part that matters —
 * takes time and sometimes fails.
 *
 * Time here is *simulated*. A request is pending until `NET_LATENCY_MS` of
 * engine time has passed, which makes a sketch poll the way it would on a real
 * board while keeping every test a matter of ticking a clock rather than
 * awaiting the real one. Nothing in this file is asynchronous.
 */

import type { NetPort } from '../firmware/interpreter';

/** The network a bench is joined to. Its credentials are the lesson's first fact. */
export const NET_SSID = 'noesis-bench';
export const NET_PASSWORD = 'benchwifi';

/** The address a joined board is handed. */
export const NET_LOCAL_IP = '192.168.4.10';

/** How long the network takes to answer, in simulated milliseconds. */
export const NET_LATENCY_MS = 35;

/**
 * The instant `/time` counts from: midday on the day this was written.
 *
 * Anchored so the same sketch, run twice, prints the same clock — a lesson that
 * showed the wall clock of whoever ran it would teach that time is free.
 */
export const NET_EPOCH_MS = Date.UTC(2026, 9, 17, 12, 0, 0);

/**
 * A sensor on the network, and how often it publishes.
 *
 * The bench has no second board to act as the publisher, so the network itself
 * plays one: a device that reports a temperature once a second, on a retained
 * topic. A subscriber therefore has something to receive on the turn it
 * subscribes — which is also how a real broker behaves with a retained value --
 * and a later message arrives on the next second, never sooner.
 */
export const NET_READING_TOPIC = 'readings/temp';
export const NET_READING_MS = 1000;

/**
 * Where the sensor takes orders: a payload of whole seconds per reading.
 *
 * Publishing has to *do* something or it teaches nothing, and the bench has no
 * second board to receive it. So the network's own sensor listens: tell it "2"
 * and it reports every two seconds instead of every one, which the serial
 * monitor shows without any extra machinery.
 */
export const NET_COMMAND_TOPIC = 'commands/interval';
export const NET_READING_MIN_S = 1;
export const NET_READING_MAX_S = 60;

/** The payload the sensor publishes at a given reading, derived from its index. */
export function netReadingPayload(index: number): string {
  return (20 + (index % 8) * 0.5).toFixed(1);
}

/* The status codes Arduino's WiFi library uses, kept at their real values so a
 * sketch that compares against them reads the way it does on a real board. */
export const WL_IDLE_STATUS = 0;
export const WL_NO_SSID_AVAIL = 1;
export const WL_CONNECTED = 3;
export const WL_CONNECT_FAILED = 4;
export const WL_DISCONNECTED = 6;

/** What a request came back with: a body, or nothing and a reason. */
export interface NetAnswer {
  readonly ok: boolean;
  readonly body: string;
}

/**
 * Wires a network to the sketch: the only code either backend needs.
 *
 * The port's type lives with the other ports (`firmware/interpreter.ts`), which
 * is where a reader looks for what a sketch can call; the implementation lives
 * here, beside the network it adapts.
 */
export function createNetPort(network: VirtualNetwork): NetPort {
  return {
    join: (ssid, password) => {
      network.begin(ssid, password);
      return network.status();
    },
    status: () => network.status(),
    localIp: () => network.localIp(),
    get: (url) => network.get(url),
    read: () => network.read(),
    failed: () => network.failed(),
    subscribe: (topic) => network.subscribe(topic),
    available: () => network.available(),
    message: () => network.message(),
    publish: (topic, payload) => network.publish(topic, payload),
    reset: () => network.reset(),
  };
}

/** One name the network answers for, and the paths it serves. */
interface NetHost {
  readonly address: string;
  readonly routes: Readonly<Record<string, () => string>>;
}

type JoinState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'joining'; readonly readyAt: number; readonly status: number };

type RequestState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly url: string; readonly readyAt: number }
  | { readonly kind: 'answered'; readonly url: string; readonly answer: NetAnswer };

export class VirtualNetwork {
  private joinState: JoinState = { kind: 'idle' };

  private request: RequestState = { kind: 'idle' };

  /** Topics the sketch has asked to receive, in the order it asked. */
  private readonly subscribed: string[] = [];

  /** The reading index the sketch has already been told about, per topic. */
  private readonly seen = new Map<string, number>();

  /** The reading last reported to the sketch, or -1 before the first. */
  private lastReading = -1;

  /** The sensor's current cadence, and when it last published. */
  private intervalMs = NET_READING_MS;
  private lastReadAt = 0;

  /** How many readings the sensor has published; one at boot, before anyone asks. */
  private readings = 1;

  private readonly nowMs: () => number;

  constructor(nowMs: () => number) {
    this.nowMs = nowMs;
  }

  /**
   * Starts joining the bench's network.
   *
   * The outcome is decided here and *delivered* later, which is what makes the
   * poll loop in a sketch honest: a board that neither waits nor checks finds
   * itself not connected, exactly as it would with a real radio.
   */
  begin(ssid: string, password: string): void {
    const status =
      ssid !== NET_SSID
        ? WL_NO_SSID_AVAIL
        : password !== NET_PASSWORD
          ? WL_CONNECT_FAILED
          : WL_CONNECTED;
    this.joinState = { kind: 'joining', readyAt: this.nowMs() + NET_LATENCY_MS, status };
  }

  status(): number {
    if (this.joinState.kind === 'idle') return WL_DISCONNECTED;
    if (this.nowMs() < this.joinState.readyAt) return WL_IDLE_STATUS;
    return this.joinState.status;
  }

  /** The address the network handed out, or "" while there is none. */
  localIp(): string {
    return this.status() === WL_CONNECTED ? NET_LOCAL_IP : '';
  }

  /**
   * Asks for a url: 1 when the answer is ready, 0 while it is not.
   *
   * Asking again is not a second request — a board has one radio and does one
   * thing with it. A different url replaces whatever was in flight, and every
   * request settles: an unknown name, a path nothing serves, and a request made
   * with no connection all arrive as failures rather than as a wait that never
   * ends.
   */
  get(url: string): number {
    if (this.request.kind === 'answered' && this.request.url === url) return 1;

    if (this.request.kind === 'pending' && this.request.url === url) {
      if (this.nowMs() < this.request.readyAt) return 0;
      this.request = { kind: 'answered', url, answer: this.resolve(url) };
      return 1;
    }

    // Anything else -- nothing asked yet, a different url, an old answer -- is a
    // new request, and a new request is never ready on the turn it starts.
    this.request = { kind: 'pending', url, readyAt: this.nowMs() + NET_LATENCY_MS };
    return 0;
  }

  /** The body of the ready answer, or "" when there is none or it failed. */
  read(): string {
    return this.request.kind === 'answered' ? this.request.answer.body : '';
  }

  /** 1 when the ready answer is a failure. */
  failed(): number {
    return this.request.kind === 'answered' && !this.request.answer.ok ? 1 : 0;
  }

  reset(): void {
    this.request = { kind: 'idle' };
  }

  /**
   * Joins a topic on the network's sensor.
   *
   * A connection is required, as it is on a real broker. The topic is accepted
   * whether or not anything publishes to it: subscribing to a name nobody uses
   * is quiet rather than an error, and that quiet is worth meeting once.
   */
  subscribe(topic: string): number {
    if (this.status() !== WL_CONNECTED || topic === '') return 0;
    if (!this.subscribed.includes(topic)) this.subscribed.push(topic);
    return 1;
  }

  /**
   * Whether a reading has arrived since the sketch last asked.
   *
   * This is the poll, and it is the only thing that consumes news: a sketch
   * asks, and on a yes can read the value as often as it likes (draw it *and*
   * print it) until the next reading lands. That split is not an accident of
   * this API -- the sketch language here has no string variables to hold a
   * payload in, so a value that could only be read once could not be used
   * twice.
   */
  available(): number {
    if (this.status() !== WL_CONNECTED) return 0;
    this.advanceSensor();
    const index = this.readings - 1;
    const fresh = this.subscribed.some(
      (topic) => topic === NET_READING_TOPIC && index > (this.seen.get(topic) ?? -1),
    );
    if (!fresh) return 0;
    for (const topic of this.subscribed) {
      if (topic === NET_READING_TOPIC) this.seen.set(topic, index);
    }
    this.lastReading = index;
    return 1;
  }

  /**
   * Sends a message to the network.
   *
   * Every non-empty topic is accepted while connected -- a broker does not
   * refuse a name it has no subscriber for. The one that does something here is
   * the sensor's command topic, whose payload is whole seconds per reading,
   * clamped to what a sensor could plausibly be asked for.
   */
  publish(topic: string, payload: string): number {
    if (this.status() !== WL_CONNECTED || topic === '' || payload === '') return 0;
    if (topic === NET_COMMAND_TOPIC) {
      const seconds = Number(payload);
      if (!Number.isFinite(seconds)) return 0;
      const clamped = Math.min(NET_READING_MAX_S, Math.max(NET_READING_MIN_S, Math.round(seconds)));
      this.intervalMs = clamped * 1000;
    }
    return 1;
  }

  /** Publishes any readings the clock has passed, from the last one forward. */
  private advanceSensor(): void {
    const due = this.nowMs() - this.lastReadAt;
    if (due < this.intervalMs) return;
    const missed = Math.floor(due / this.intervalMs);
    this.lastReadAt += missed * this.intervalMs;
    this.readings += missed;
  }

  /** The last reading reported, or "" before the first one. Re-readable. */
  message(): string {
    return this.lastReading < 0 ? '' : netReadingPayload(this.lastReading);
  }

  private resolve(url: string): NetAnswer {
    if (this.status() !== WL_CONNECTED) return { ok: false, body: '' };

    // A url is `http://name/path`; anything else is not something this network
    // can be asked for.
    const match = /^http:\/\/([^/]+)(\/.*)?$/.exec(url);
    if (!match) return { ok: false, body: '' };

    const host = this.hosts()[match[1]];
    if (!host) return { ok: false, body: '' };

    const route = host.routes[match[2] ?? '/'];
    if (!route) return { ok: false, body: '' };

    return { ok: true, body: route() };
  }

  /** The names the network answers for. Data, so more arrive without new code. */
  private hosts(): Readonly<Record<string, NetHost>> {
    return {
      'api.noesis': {
        address: '192.168.4.1',
        routes: {
          '/hello': () => 'hello from api.noesis',
          /*
           * The clock route, and the reason this host exists: a board keeps
           * time only as well as it can count milliseconds, so the honest way
           * to know the time is to ask someone who has it.
           */
          '/time': () => this.clockBody(),
        },
      },
      /*
       * A second name for the same clock. Two hosts rather than one because
       * that is what a network is: a name resolves or it does not, and a
       * sketch that could only ever talk to one server would never meet the
       * failure a wrong name is.
       */
      'time.noesis': {
        address: '192.168.4.2',
        routes: {
          '/time': () => this.clockBody(),
        },
      },
    };
  }

  /** The bench clock as a request body: ISO-8601 UTC, on simulated time. */
  private clockBody(): string {
    return new Date(NET_EPOCH_MS + this.nowMs()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
}
