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
  NET_READING_MS,
  NET_READING_TOPIC,
  WL_NO_SSID_AVAIL,
  createNetPort,
  netReadingPayload,
} from './network';

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

describe('messages from the network\'s sensor', () => {
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

  it('has the sensor\'s latest reading waiting on the turn it subscribes', () => {
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
