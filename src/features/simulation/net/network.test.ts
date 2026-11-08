import { describe, expect, it } from 'vitest';
import {
  NET_LATENCY_MS,
  NET_LOCAL_IP,
  NET_PASSWORD,
  NET_SSID,
  VirtualNetwork,
  WL_CONNECT_FAILED,
  WL_CONNECTED,
  WL_DISCONNECTED,
  WL_IDLE_STATUS,
  NET_COMMAND_TOPIC,
  NET_READING_MS,
  NET_READING_TOPIC,
  WL_NO_SSID_AVAIL,
  createNetPort,
  netReadingPayload,
  sketchHostName,
} from './network';
import type { NetAnswer } from './network';
import type { NetFetcher } from './bridge';

/** A network on a clock the test owns, in simulated milliseconds. */
function bench(): { network: VirtualNetwork; advance: (ms: number) => void } {
  let now = 0;
  return {
    network: new VirtualNetwork(() => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('joining the bench network', () => {
  it('is not connected until something asks to join', () => {
    const { network } = bench();
    expect(network.status()).toBe(WL_DISCONNECTED);
    expect(network.localIp()).toBe('');
  });

  /*
   * The outcome is decided when the join starts and delivered a network's
   * latency later, which is what makes the poll loop in a sketch honest: a
   * board that does not wait, and does not check, is not connected.
   */
  it('takes time, and is idle in the meantime', () => {
    const { network, advance } = bench();
    network.begin(NET_SSID, NET_PASSWORD);
    expect(network.status()).toBe(WL_IDLE_STATUS);
    advance(NET_LATENCY_MS - 1);
    expect(network.status()).toBe(WL_IDLE_STATUS);
    advance(1);
    expect(network.status()).toBe(WL_CONNECTED);
    expect(network.localIp()).toBe(NET_LOCAL_IP);
  });

  it('refuses a network it does not know', () => {
    const { network, advance } = bench();
    network.begin('somebody-elses-wifi', NET_PASSWORD);
    advance(NET_LATENCY_MS);
    expect(network.status()).toBe(WL_NO_SSID_AVAIL);
    expect(network.localIp()).toBe('');
  });

  it('refuses the wrong password', () => {
    const { network, advance } = bench();
    network.begin(NET_SSID, 'hunter2');
    advance(NET_LATENCY_MS);
    expect(network.status()).toBe(WL_CONNECT_FAILED);
  });
});

describe('asking the network for something', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('is not ready on the turn it is asked for', () => {
    const { network } = joined();
    expect(network.get('http://api.noesis/hello')).toBe(0);
    expect(network.read()).toBe('');
    expect(network.failed()).toBe(0);
  });

  it('answers once the network has had its latency', () => {
    const { network, advance } = joined();
    network.get('http://api.noesis/hello');
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/hello')).toBe(1);
    expect(network.read()).toBe('hello from api.noesis');
    expect(network.failed()).toBe(0);
  });

  it('serves the bench clock, which runs on simulated time', () => {
    const { network, advance } = joined();
    network.get('http://api.noesis/time');
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/time')).toBe(1);
    expect(network.read()).toMatch(/^2026-10-17T12:00:00Z$/);

    // A second later, and second request, reads a second later: the clock is
    // the bench's simulated time, not the wall clock of whoever ran it.
    advance(1000);
    network.reset();
    expect(network.get('http://api.noesis/time')).toBe(0);
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/time')).toBe(1);
    expect(network.read()).toMatch(/^2026-10-17T12:00:01Z$/);
  });

  it('serves the clock on a second host as well', () => {
    const { network, advance } = joined();
    network.get('http://time.noesis/time');
    advance(NET_LATENCY_MS);
    expect(network.get('http://time.noesis/time')).toBe(1);
    expect(network.failed()).toBe(0);
    expect(network.read()).toMatch(/^2026-10-17T12:00:00Z$/);
  });

  it('answers a host only for the paths it serves', () => {
    const { network, advance } = joined();
    network.get('http://time.noesis/hello');
    advance(NET_LATENCY_MS);
    expect(network.get('http://time.noesis/hello')).toBe(1);
    expect(network.failed()).toBe(1);
    expect(network.read()).toBe('');
  });

  it('reports a name it does not know as a failure, not as a wait', () => {
    const { network, advance } = joined();
    network.get('http://somewhere.else/hello');
    advance(NET_LATENCY_MS);
    expect(network.get('http://somewhere.else/hello')).toBe(1);
    expect(network.failed()).toBe(1);
    expect(network.read()).toBe('');
  });

  it('reports a path nothing serves as a failure', () => {
    const { network, advance } = joined();
    network.get('http://api.noesis/nothing-here');
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/nothing-here')).toBe(1);
    expect(network.failed()).toBe(1);
  });

  it('reports something that is not a url as a failure', () => {
    const { network, advance } = joined();
    network.get('api.noesis/hello');
    advance(NET_LATENCY_MS);
    network.get('api.noesis/hello');
    expect(network.failed()).toBe(1);
  });

  it('fails a request made with no connection, rather than queueing it', () => {
    const { network, advance } = bench();
    network.get('http://api.noesis/hello');
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/hello')).toBe(1);
    expect(network.failed()).toBe(1);
  });

  it('does not restart a request that is already in flight', () => {
    const { network, advance } = joined();
    // Three polls inside the latency, each of which must leave the request
    // alone rather than starting it again.
    for (let poll = 0; poll < 3; poll++) {
      expect(network.get('http://api.noesis/hello')).toBe(0);
      advance(10);
    }
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/hello')).toBe(1);
    expect(network.read()).toBe('hello from api.noesis');
  });

  it('replaces a request for somewhere else', () => {
    const { network, advance } = joined();
    network.get('http://api.noesis/hello');
    expect(network.get('http://api.noesis/time')).toBe(0);
    advance(NET_LATENCY_MS);
    expect(network.get('http://api.noesis/time')).toBe(1);
    expect(network.read()).toMatch(/^2026-10-17T12:00:00Z$/);
  });

  it('forgets everything on reset', () => {
    const { network, advance } = joined();
    network.get('http://api.noesis/hello');
    advance(NET_LATENCY_MS);
    network.get('http://api.noesis/hello');
    network.reset();
    expect(network.read()).toBe('');
    expect(network.failed()).toBe(0);
    expect(network.get('http://api.noesis/hello')).toBe(0);
  });
});

describe("the network's sensor host", () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('answers with simulated latency, like every other host', () => {
    const { network, advance } = joined();
    expect(network.get('http://sensor.noesis/temperature')).toBe(0);
    advance(NET_LATENCY_MS - 1);
    expect(network.get('http://sensor.noesis/temperature')).toBe(0);
    advance(1);
    expect(network.get('http://sensor.noesis/temperature')).toBe(1);
    expect(network.read()).toBe('20.0');
  });

  it('publishes temperature, humidity and pressure that move with the clock', () => {
    const { network, advance } = joined();

    network.get('http://sensor.noesis/humidity');
    advance(NET_LATENCY_MS);
    expect(network.get('http://sensor.noesis/humidity')).toBe(1);
    expect(network.read()).toBe('40.0');

    network.reset();
    network.get('http://sensor.noesis/pressure');
    advance(NET_LATENCY_MS);
    expect(network.get('http://sensor.noesis/pressure')).toBe(1);
    expect(network.read()).toBe('1000');

    // A second later the same sensor has moved on, as a real one would.
    advance(1000);
    network.reset();
    network.get('http://sensor.noesis/temperature');
    advance(NET_LATENCY_MS);
    expect(network.get('http://sensor.noesis/temperature')).toBe(1);
    expect(network.read()).toBe('20.5');
  });

  it('serves all readings together as JSON', () => {
    const { network, advance } = joined();
    network.get('http://sensor.noesis/reading');
    advance(NET_LATENCY_MS);
    expect(network.get('http://sensor.noesis/reading')).toBe(1);
    expect(network.failed()).toBe(0);
    expect(JSON.parse(network.read())).toEqual({
      temperature: 20,
      humidity: 40,
      pressure: 1000,
    });
  });

  it('reports a path it does not serve as a failure', () => {
    const { network, advance } = joined();
    network.get('http://sensor.noesis/temperature');
    advance(NET_LATENCY_MS);
    expect(network.get('http://sensor.noesis/temperature')).toBe(1);
    expect(network.read()).toBe('20.0');

    network.reset();
    network.get('http://sensor.noesis/nothing-here');
    advance(NET_LATENCY_MS);
    expect(network.get('http://sensor.noesis/nothing-here')).toBe(1);
    expect(network.failed()).toBe(1);
    expect(network.read()).toBe('');
  });
});

describe('the NTP host', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('serves the bench clock under its own name', () => {
    const { network, advance } = joined();
    network.get('http://ntp.noesis/time');
    advance(NET_LATENCY_MS);
    expect(network.get('http://ntp.noesis/time')).toBe(1);
    expect(network.failed()).toBe(0);
    expect(network.read()).toBe('2026-10-17T12:00:00Z');
  });

  it('serves the same instant as whole epoch seconds', () => {
    const { network, advance } = joined();
    network.get('http://ntp.noesis/epoch');
    advance(NET_LATENCY_MS);
    expect(network.get('http://ntp.noesis/epoch')).toBe(1);
    expect(network.read()).toBe('1792238400');

    advance(1000);
    network.reset();
    network.get('http://ntp.noesis/epoch');
    advance(NET_LATENCY_MS);
    expect(network.get('http://ntp.noesis/epoch')).toBe(1);
    expect(network.read()).toBe('1792238401');
  });
});

describe('the version host', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('answers a version string on its own address', () => {
    const { network, advance } = joined();
    network.get('http://repo.noesis/version');
    advance(NET_LATENCY_MS);
    expect(network.get('http://repo.noesis/version')).toBe(1);
    expect(network.read()).toBe('1.2.3');
    expect(network.failed()).toBe(0);
  });

  it('serves a changelog under the same host', () => {
    const { network, advance } = joined();
    network.get('http://repo.noesis/changelog');
    advance(NET_LATENCY_MS);
    expect(network.get('http://repo.noesis/changelog')).toBe(1);
    expect(network.read()).toBe(
      '1.2.3\n- fixed: the brownout never latched\n- added: the status host',
    );
  });
});

describe('the geo host', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('answers the bench IP on its own route', () => {
    const { network, advance } = joined();
    network.get('http://geo.noesis/ip');
    advance(NET_LATENCY_MS);
    expect(network.get('http://geo.noesis/ip')).toBe(1);
    expect(network.read()).toBe(NET_LOCAL_IP);
    expect(network.failed()).toBe(0);
  });

  it('serves a location as JSON under the same host', () => {
    const { network, advance } = joined();
    network.get('http://geo.noesis/location');
    advance(NET_LATENCY_MS);
    expect(network.get('http://geo.noesis/location')).toBe(1);
    expect(network.read()).toBe('{"lat":51.5,"lon":-0.1,"city":"London"}');
    expect(JSON.parse(network.read())).toEqual({
      lat: 51.5,
      lon: -0.1,
      city: 'London',
    });
  });
});

describe('the status host', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('reports health on its own route', () => {
    const { network, advance } = joined();
    network.get('http://status.noesis/health');
    advance(NET_LATENCY_MS);
    expect(network.get('http://status.noesis/health')).toBe(1);
    expect(network.read()).toBe('ok');
    expect(network.failed()).toBe(0);
  });

  it('reports uptime in whole seconds from the simulated clock', () => {
    const { network, advance } = joined();
    advance(2500);
    network.get('http://status.noesis/uptime');
    advance(NET_LATENCY_MS);
    expect(network.get('http://status.noesis/uptime')).toBe(1);
    expect(network.read()).toBe('2');
  });
});

describe('the weather host', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('serves temperature and condition', () => {
    const { network, advance } = joined();
    network.get('http://weather.noesis/temperature');
    advance(NET_LATENCY_MS);
    expect(network.get('http://weather.noesis/temperature')).toBe(1);
    expect(network.read()).toBe('20.0');
    expect(network.failed()).toBe(0);

    network.reset();
    network.get('http://weather.noesis/condition');
    advance(NET_LATENCY_MS);
    expect(network.get('http://weather.noesis/condition')).toBe(1);
    expect(network.read()).toBe('sunny');
  });

  it('serves a forecast as JSON', () => {
    const { network, advance } = joined();
    network.get('http://weather.noesis/forecast');
    advance(NET_LATENCY_MS);
    expect(network.get('http://weather.noesis/forecast')).toBe(1);
    expect(network.failed()).toBe(0);
    const parsed = JSON.parse(network.read());
    expect(parsed).toHaveProperty('temperature');
    expect(parsed).toHaveProperty('condition');
    expect(parsed).toHaveProperty('humidity');
  });
});

describe('the echo host', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('answers on its own address', () => {
    const { network, advance } = joined();
    network.get('http://echo.noesis/');
    advance(NET_LATENCY_MS);
    expect(network.get('http://echo.noesis/')).toBe(1);
    expect(network.read()).toBe('echo');
    expect(network.failed()).toBe(0);
  });
});

describe('the port a sketch talks to', () => {
  it('is the same object either backend wires', () => {
    const { network, advance } = bench();
    const port = createNetPort(network);
    expect(port.join(NET_SSID, NET_PASSWORD)).toBe(WL_IDLE_STATUS);
    advance(NET_LATENCY_MS);
    expect(port.status()).toBe(WL_CONNECTED);
    expect(port.localIp()).toBe(NET_LOCAL_IP);
    expect(port.get('http://api.noesis/hello')).toBe(0);
    advance(NET_LATENCY_MS);
    expect(port.get('http://api.noesis/hello')).toBe(1);
    expect(port.read()).toBe('hello from api.noesis');
    expect(port.failed()).toBe(0);
    port.reset();
    expect(port.read()).toBe('');
  });
});

describe("messages from the network's sensor", () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('refuses to subscribe before it has joined', () => {
    const { network } = bench();
    expect(network.subscribe(NET_READING_TOPIC)).toBe(0);
    expect(network.available()).toBe(0);
  });

  it("has the sensor's latest reading waiting on the turn it subscribes", () => {
    const { network } = joined();
    expect(network.subscribe(NET_READING_TOPIC)).toBe(1);
    // A retained value, as a broker hands one over: the first second's reading.
    expect(network.available()).toBe(1);
    expect(network.message()).toBe('20.0');
    // The news is consumed by asking; the value stays readable for this turn,
    // because a sketch has no string variable to hold it in.
    expect(network.available()).toBe(0);
    expect(network.message()).toBe('20.0');
  });

  it('delivers the next reading a second later, not before', () => {
    const { network, advance } = joined();
    network.subscribe(NET_READING_TOPIC);
    // The retained first reading is the one already waiting; consume it so this
    // test is about the *next* one.
    expect(network.available()).toBe(1);
    expect(network.message()).toBe('20.0');

    /*
     * Readings land on absolute seconds, not on a second since subscribing:
     * the join spent `NET_LATENCY_MS`, so the next boundary is one second from
     * zero. Just short of it, nothing is available; on it, the next reading is.
     */
    advance(NET_READING_MS - NET_LATENCY_MS - 1);
    expect(network.available()).toBe(0);
    expect(network.message(), 'the last value is still readable').toBe('20.0');
    advance(1);
    expect(network.available()).toBe(1);
    expect(network.message()).toBe('20.5');
  });

  it('accepts a topic nobody publishes, and stays quiet about it', () => {
    const { network, advance } = joined();
    expect(network.subscribe('readings/nobody')).toBe(1);
    expect(network.available()).toBe(0);
    advance(NET_READING_MS * 3);
    expect(network.available()).toBe(0);
  });

  it('publishes a reading that reads as a temperature and wraps by design', () => {
    // The payload is deterministic, so a lesson and a test can both name it.
    expect([0, 1, 7, 8].map(netReadingPayload)).toEqual(['20.0', '20.5', '23.5', '20.0']);
  });
});

describe('sending a message to the sensor', () => {
  function joined(): { network: VirtualNetwork; advance: (ms: number) => void } {
    const held = bench();
    held.network.begin(NET_SSID, NET_PASSWORD);
    held.advance(NET_LATENCY_MS);
    return held;
  }

  it('refuses to publish before it has joined, or with nothing to say', () => {
    const { network } = bench();
    expect(network.publish(NET_COMMAND_TOPIC, '2')).toBe(0);
    const { network: joinedNet } = joined();
    expect(joinedNet.publish('', '2')).toBe(0);
    expect(joinedNet.publish(NET_COMMAND_TOPIC, '')).toBe(0);
  });

  it('accepts a topic nothing listens on, as a broker does', () => {
    const { network } = joined();
    expect(network.publish('nobody/listens', 'hello')).toBe(1);
  });

  it('refuses a command that is not a number', () => {
    const { network } = joined();
    expect(network.publish(NET_COMMAND_TOPIC, 'soon')).toBe(0);
  });

  /*
   * The observable effect: asking for a reading every two seconds means the
   * second reading does not arrive at the first second, and does at the second.
   */
  it('slows the sensor down when told to', () => {
    const { network, advance } = joined();
    network.subscribe(NET_READING_TOPIC);
    expect(network.available()).toBe(1);
    expect(network.message()).toBe('20.0');

    expect(network.publish(NET_COMMAND_TOPIC, '2')).toBe(1);

    // One second later: the old cadence would have published; the new one has not.
    advance(NET_READING_MS - NET_LATENCY_MS);
    expect(network.available()).toBe(0);

    // Two seconds after the last reading (t = 0) it does.
    advance(NET_READING_MS);
    expect(network.available()).toBe(1);
    expect(network.message()).toBe('20.5');
  });

  it('clamps a cadence to what a sensor could be asked for', () => {
    const { network, advance } = joined();
    network.subscribe(NET_READING_TOPIC);
    network.available();

    expect(network.publish(NET_COMMAND_TOPIC, '0')).toBe(1);
    advance(1000);
    expect(network.available(), 'zero seconds becomes the fastest cadence').toBe(1);
    network.available();

    expect(network.publish(NET_COMMAND_TOPIC, '999')).toBe(1);
    advance(60_000);
    expect(network.available(), 'a minute is the slowest').toBe(1);
  });
});

/**
 * A network joined to the bench, with a bridge to a host the test owns.
 *
 * The fetcher is the test's: it records what was asked and hands back a
 * resolver, so "pending", "answered" and "replaced mid-flight" are all things
 * the test decides rather than waits for.
 */
function bridgedBench(join = true): {
  network: VirtualNetwork;
  advance: (ms: number) => void;
  calls: string[];
  answer: (result: NetAnswer) => void;
} {
  let now = 0;
  const calls: string[] = [];
  const waiters: ((answer: NetAnswer) => void)[] = [];
  const fetcher: NetFetcher = (url) => {
    calls.push(url);
    const { promise, resolve } = Promise.withResolvers<NetAnswer>();
    waiters.push(resolve);
    return promise;
  };
  const network = new VirtualNetwork(() => now, {
    fetch: fetcher,
    liveHosts: { 'test.noesis': { base: 'https://example.test', note: 'the test host' } },
  });
  if (join) {
    network.begin(NET_SSID, NET_PASSWORD);
    now += NET_LATENCY_MS;
  }
  return {
    network,
    advance: (ms) => {
      now += ms;
    },
    calls,
    answer: (result) => waiters.shift()?.(result),
  };
}

/** Lets the bridge's `then` chain run: microtask turns, no wall clock. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('bridging to a real host', () => {
  it('leaves for the real host, and stays pending until it answers', async () => {
    const { network, calls, advance, answer } = bridgedBench();
    const url = 'http://test.noesis/v1/forecast?x=1';
    expect(network.get(url)).toBe(0);
    expect(calls).toEqual(['https://example.test/v1/forecast?x=1']);
    expect(network.read()).toBe('');
    expect(network.failed()).toBe(0);

    // The bench's own latency does not settle a real request: there is none to
    // invent, and a sketch's poll is what waits.
    advance(NET_LATENCY_MS * 100);
    expect(network.get(url)).toBe(0);

    answer({ ok: true, body: '21.5' });
    await flush();
    expect(network.get(url)).toBe(1);
    expect(network.read()).toBe('21.5');
    expect(network.failed()).toBe(0);
    // Re-readable, like every other answer.
    expect(network.get(url)).toBe(1);
    expect(network.read()).toBe('21.5');
  });

  it('reports a real host that could not answer as a failure', async () => {
    const { network, answer } = bridgedBench();
    const url = 'http://test.noesis/whatever';
    network.get(url);
    answer({ ok: false, body: '' });
    await flush();
    expect(network.get(url)).toBe(1);
    expect(network.read()).toBe('');
    expect(network.failed()).toBe(1);
  });

  it('replaces a bridged request, and drops the answer nobody waits for', async () => {
    const { network, calls, answer } = bridgedBench();
    const first = 'http://test.noesis/a';
    const second = 'http://test.noesis/b';
    network.get(first);
    network.get(second);
    expect(calls).toEqual(['https://example.test/a', 'https://example.test/b']);

    // The replaced request's answer lands after the fact: one radio, and an
    // answer nobody is waiting for is not news.
    answer({ ok: true, body: 'stale' });
    await flush();
    expect(network.get(second)).toBe(0);
    expect(network.read()).toBe('');

    answer({ ok: true, body: 'fresh' });
    await flush();
    expect(network.get(second)).toBe(1);
    expect(network.read()).toBe('fresh');
  });

  it('does not bridge a request made without a connection', () => {
    const { network, calls, advance } = bridgedBench(false);
    const url = 'http://test.noesis/a';
    expect(network.get(url)).toBe(0);
    expect(calls).toEqual([]);
    advance(NET_LATENCY_MS);
    expect(network.get(url)).toBe(1);
    expect(network.failed()).toBe(1);
  });

  it('still answers its own hosts when a bridge is installed', () => {
    const { network, calls, advance } = bridgedBench();
    const url = 'http://time.noesis/time';
    expect(network.get(url)).toBe(0);
    expect(calls).toEqual([]);
    advance(NET_LATENCY_MS);
    expect(network.get(url)).toBe(1);
    expect(network.read()).toMatch(/^2026-10-17T12:00:0\dZ$/);
  });

  /*
   * The offline case, which is the shipped default: the name is real, the bench
   * has no bridge, and the sketch gets exactly what an unknown host gives it --
   * after the bench's own latency.
   */
  it('answers a live name as an unknown host on a bench with no bridge', () => {
    const { network, advance } = bench();
    network.begin(NET_SSID, NET_PASSWORD);
    advance(NET_LATENCY_MS);
    const url = 'http://weather.noesis/v1/forecast';
    expect(network.get(url)).toBe(0);
    advance(NET_LATENCY_MS);
    expect(network.get(url)).toBe(1);
    expect(network.failed()).toBe(1);
    expect(network.read()).toBe('');
  });
});

describe('reading a sketch url', () => {
  it('names the host, and nothing else', () => {
    expect(sketchHostName('http://api.noesis/time')).toBe('api.noesis');
    expect(sketchHostName('http://api.noesis')).toBe('api.noesis');
    expect(sketchHostName('http://api.noesis/a/b?c=1')).toBe('api.noesis');
    // A port is part of the name, which is why it names no host in the table.
    expect(sketchHostName('http://api.noesis:80/time')).toBe('api.noesis:80');
    expect(sketchHostName('https://api.noesis/time')).toBeNull();
    expect(sketchHostName('api.noesis/time')).toBeNull();
    expect(sketchHostName('')).toBeNull();
  });
});
