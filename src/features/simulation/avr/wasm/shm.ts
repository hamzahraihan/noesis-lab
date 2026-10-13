export interface WasmShm {
  readPin(gpio: number): boolean;
  samplePin(gpio: number, level: boolean): void;
  queueEdge(gpio: number, high: boolean): void;
  drainEvents(): Array<{ gpio: number; high: boolean }>;
}

export function createShm(): WasmShm {
  const pins = new Map<number, boolean>();
  let events: Array<{ gpio: number; high: boolean }> = [];
  return {
    readPin: (gpio) => pins.get(gpio) ?? false,
    samplePin: (gpio, level) => {
      pins.set(gpio, level);
    },
    queueEdge: (gpio, high) => {
      events.push({ gpio, high });
    },
    drainEvents: () => {
      const out = events;
      events = [];
      return out;
    },
  };
}

export function attachShm(_core: unknown, _shm: WasmShm): void {}
