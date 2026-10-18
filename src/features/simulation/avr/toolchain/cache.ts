// Offline-first read-through fetch cache for the pinned AVR toolchain package.
//
// Every toolchain byte is fetched once from the pinned CDN origin, verified
// against the per-file SRI table below, and stored under a versioned key.
// Task 2 routes all toolchain traffic (tools/*.wasm, assets/manifest.json,
// assets/fs/**, assets/objects/**, assets/libs/**, assets/ldscripts/**)
// through FetchCache keyed by URL pathname relative to CDN_BASE.
//
// SRI table: 550 entries, sha384 over the extracted @horang-corp/avr-gcc-wasm
// 0.2.0 package files via `openssl dgst -sha384 -binary <file> | openssl
// base64 -A` (8 tools/* + assets/manifest.json + 504 manifest headerFiles +
// 32 objects incl. the hardcoded core_abi.o + 4 libs + avr5.xn).

export const CACHE_VERSION = 'avr-toolchain/0.2.0/1';
export const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@horang-corp/avr-gcc-wasm@0.2.0/';

export interface IDBBackend {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryBackend implements IDBBackend {
  private store: Map<string, Uint8Array> = new Map();
  async get(key: string): Promise<Uint8Array | null> {
    const hit = this.store.get(key);
    return hit === undefined ? null : hit;
  }
  async put(key: string, value: Uint8Array): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/** Thrown when stored or fetched bytes fail the SRI check. Retried exactly once. */
export class IntegrityError extends Error {
  constructor(path: string) {
    super(`toolchain integrity check failed for ${path}`);
    this.name = 'IntegrityError';
  }
}

export const IDB_DB_NAME = 'avr-toolchain-cache';
export const IDB_STORE_NAME = 'toolchain-files';
export const IDB_DB_VERSION = 1;

export interface IndexedDBBackendOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
  idb?: IDBFactory;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('indexedDB request failed'));
    };
  });
}

/**
 * Production IDBBackend over the standard IndexedDB API: one versioned
 * database, one object store, keyed by the existing
 * `${CACHE_VERSION}:${path}` keys (so a CACHE_VERSION bump makes older
 * entries invisible exactly once — no migration, no re-fetch loop).
 * Uint8Array values round-trip via structured clone.
 */
export class IndexedDBBackend implements IDBBackend {
  private dbName: string;
  private storeName: string;
  private version: number;
  private idb: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | undefined;
  constructor(options?: IndexedDBBackendOptions) {
    this.dbName = options?.dbName ?? IDB_DB_NAME;
    this.storeName = options?.storeName ?? IDB_STORE_NAME;
    this.version = options?.version ?? IDB_DB_VERSION;
    const factory = options?.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    if (factory === undefined) throw new Error('indexedDB is unavailable');
    this.idb = factory;
  }
  private open(): Promise<IDBDatabase> {
    if (this.dbPromise === undefined) {
      const storeName = this.storeName;
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.idb.open(this.dbName, this.version);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error(`indexedDB open failed for ${this.dbName}`));
        };
      });
    }
    return this.dbPromise;
  }
  async get(key: string): Promise<Uint8Array | null> {
    const db = await this.open();
    const store = db.transaction(this.storeName, 'readonly').objectStore(this.storeName);
    const value: unknown = await idbRequest(store.get(key));
    if (value === undefined || value === null) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
  }
  async put(key: string, value: Uint8Array): Promise<void> {
    const db = await this.open();
    const store = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName);
    await idbRequest(store.put(value, key));
  }
  async delete(key: string): Promise<void> {
    const db = await this.open();
    const store = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName);
    await idbRequest(store.delete(key));
  }
}

/**
 * Production backend: real IndexedDB where available (browser window and
 * module worker), in-memory fallback elsewhere (Node/vitest). Tests keep
 * using MemoryBackend directly.
 */
export function createProductionBackend(): IDBBackend {
  if (typeof indexedDB !== 'undefined') return new IndexedDBBackend();
  return new MemoryBackend();
}

export const SRI: Readonly<Record<string, string>> = {
  'tools/avr-as.mjs': 'sha384-U+rvoWFAO4mGO8ruBUUYVKCp1NZr252A4rGO6H6Xa1kObbYavJkGapqZMGUz5AbF',
  'tools/avr-as.wasm': 'sha384-dXRJb5gdz0z+oKA6DUr/+eLHeokvH1TnFUQ+BJud4rzklMDABqZSb1TEJM4eDtcG',
  'tools/avr-ld.mjs': 'sha384-Hp4JlxcLbBxRYX+AUxR79/3vgwgRefgZG4Q21Zb/t8b8tVyNBMVVgDPoj7MPo3aZ',
  'tools/avr-ld.wasm': 'sha384-96Vza02NQmZItFPqPQ7N3OCuuP5YudgwpWhp/9qm9ycjw/g3Wvb6Hu6VLc9yl8zZ',
  'tools/avr-objcopy.mjs':
    'sha384-3pPcCwmyWP+g9WmmpKPUJ2yr3ANj/PDhJSAMwWY0nhUr7SQJxJKrS4aWzyzUT9fC',
  'tools/avr-objcopy.wasm':
    'sha384-xNmeMwUjuEkpitUtQhkMftvZXKoYaPsv3iTqMKSQ4UVVY7P33CCqOX/GH2Y2aCWv',
  'tools/cc1plus.mjs': 'sha384-XbV8vcwgEBpmMt0u5koi57A33EQZ3NFIb423Hc/EPfySEa0jhM+92QDxYSUOad6C',
  'tools/cc1plus.wasm': 'sha384-DZ5vsdP5iR+sooAShBAqFX6wKXh027mEZ50B6LvcT8N8o0vGxRxoJ575clxdhbf8',
  'assets/manifest.json': 'sha384-mIGNyhi9bIHK5REUkW2j2ltFpa0rWBQZMd9z7utWSu72cfERbMuMe98OGr7vD5Aj',
  'assets/fs/arduino/core/Arduino.h':
    'sha384-U7TrGjRGlk6H1cidn5dCDiKggRTlOVsc+Wp8jIydcfiC4BtqW3PHMPlVJ4IUjgwt',
  'assets/fs/arduino/core/Client.h':
    'sha384-xSLdwdmrElonSUhKu0dqH+Sw3BzDRuaXNI4mijxsDTF4o1y7WvtVJ1l+qiuF4xks',
  'assets/fs/arduino/core/HardwareSerial.h':
    'sha384-dkn4wDctwwak6jF4K39MuEGF9qJbwDVkUzuvUkVmKhMFJxTVz1fTpH3edGvCGaGH',
  'assets/fs/arduino/core/HardwareSerial_private.h':
    'sha384-8Yt6ESNP8hYzk/9Q4057qGWNMtsmF+fPNxyniwtCvKlI8qwo21YYGi7/jKVZMi3L',
  'assets/fs/arduino/core/IPAddress.h':
    'sha384-s1t2rbQ22tBjr4t2jFUdp4AieNy6Uvx58ztAHHcpaF2EEKkV0zhW7JtZOy/3e0NI',
  'assets/fs/arduino/core/PluggableUSB.h':
    'sha384-tnwumc6CMqRZDBqeeokoO85hBd1y84yZIfiq9ju6nFa3Casu2uNThpOZJZe6zaaA',
  'assets/fs/arduino/core/Print.h':
    'sha384-DeFpSQCTz0DKDtbWbJppjAoQU+bQmvsGgWEcgqOASU+b8AEKKbw76oKZyA9atgAr',
  'assets/fs/arduino/core/Printable.h':
    'sha384-3wkhaVmO0uHjYg33tQCvDuNzt/6fKTQTw/GD+tHjfq1JzdUxNmS1U5NFChcrclrd',
  'assets/fs/arduino/core/Server.h':
    'sha384-k7xe8eAbBjKhVqZOHHheGjlOBEJTFlP5BO4TLayP/u92bX18eqxQ6vBE2gfh/F17',
  'assets/fs/arduino/core/Stream.h':
    'sha384-MiOBUzkihxvFOvnU4Nqv7fHqC/1vZ+pb9HbUeauSU/XE2/e5GDEJw1OHDDOQQ/DC',
  'assets/fs/arduino/core/USBAPI.h':
    'sha384-qxcR96g9oJnozQHrHpZ4GnordaEysoD7FnTDrbSHLy4+nF6chKh0dCNnrkHO5Lb7',
  'assets/fs/arduino/core/USBCore.h':
    'sha384-s/AnzixZ8dO23ydblRDfQ04GatTll2ToTxZuOXo8uDR2hB3NJcZoB4hdzSVp7Gxk',
  'assets/fs/arduino/core/USBDesc.h':
    'sha384-uzK8o3paCRLc26UzuG3AbWcG6EerNHI+qBeignf/IPLitA1/NFEgbZNEuoeNP4rQ',
  'assets/fs/arduino/core/Udp.h':
    'sha384-qTBR+BoIaz5NrI/p22/kuUg/++QSi3YSNCwmfiRG8uIVYGMQ+4Ln0Ixpmg9HFYPt',
  'assets/fs/arduino/core/WCharacter.h':
    'sha384-UfgbU8EUsSuRVQVNkv4CV+l0ZkPnT+mesL1Zslnj4BY1DR51qWDdAebFLY4XFm9H',
  'assets/fs/arduino/core/WString.h':
    'sha384-ZCq4GzGBZk9c++wS2YCyuiv6MVtEDxNAFXkD/1cGDKPXQgWoRwPo/5notrBkxGBF',
  'assets/fs/arduino/core/binary.h':
    'sha384-MPO0lcsVhDFqpeQRTPLn9Etygj6My3uBjAqhN65DhIlYIHzkhVZEFH81bIj5NqNS',
  'assets/fs/arduino/core/new':
    'sha384-d3vWNSydXSGkienxIWxNTPtRbbBtZ6w34clamx94TG9IpxFkk97xlGQY+E7XFHBx',
  'assets/fs/arduino/core/new.h':
    'sha384-qXXHJe8+v7LmkbVJmoVp3efCdbjbowkCI5stiXLUh8xeVaop5+nn+Q0vD6alrAQD',
  'assets/fs/arduino/core/wiring_private.h':
    'sha384-bXF2Y+NtTVosHBMacLq7KTpqIODHxzOO0dHl8G3E7ye40DLXVJWKEbJxZKZePScF',
  'assets/fs/arduino/libraries/SPI/src/SPI.h':
    'sha384-WjkEQjac81XMsoiBKGmCEUBOXa5Yq2tKwmN1DSResdU14AILz4mzsCv9YRZXlwvk',
  'assets/fs/arduino/libraries/Wire/src/Wire.h':
    'sha384-H5O5MVjKsxVerTX6k4DKnOkYA/7Nl61+1BBA9bW2bW4nYLrWVgE9GLuuveddgJUi',
  'assets/fs/arduino/libraries/Wire/src/utility/twi.h':
    'sha384-EcMDgWKCKIHJmQxYiiGIG5i+qVEHggpVUwyxO7BYHR9Ow2YN8SoZXp0ElJBn21X7',
  'assets/fs/arduino/variant/pins_arduino.h':
    'sha384-qJ8Ia1i5R+V8R138ZKnBTXoeWIYLNouKZnUY35i0Z4nDEszz45qtogUdV5SwNmba',
  'assets/fs/libraries/Adafruit_BMP085_Library/Adafruit_BMP085.h':
    'sha384-VI/l/O21CAHZF12lR4QM7e3GN34v5ub+L2lzu7MfECgi5ELaJzVd0gRmms1La9Cy',
  'assets/fs/libraries/Adafruit_BusIO/Adafruit_BusIO_Register.h':
    'sha384-twS1hbzjUErQRio3uy179T1fB/O7TI9mmkE7ONC7+QVivyszcjG8GoYhg7p1P/Zy',
  'assets/fs/libraries/Adafruit_BusIO/Adafruit_GenericDevice.h':
    'sha384-poVwii9lTYHiU7oP8CH7WlM6xVaH26RfrhO2qpXgCLZADnWPBnC9qrkwjK5XThTi',
  'assets/fs/libraries/Adafruit_BusIO/Adafruit_I2CDevice.h':
    'sha384-HE9wQdBtMf7CtRawRHR49APWqoO0aKBiZcjLgN0wyT9cizw8FWu+fg951dmgvj4r',
  'assets/fs/libraries/Adafruit_BusIO/Adafruit_I2CRegister.h':
    'sha384-8RTwbXeIMK2Px1qwrhiUZc96qA3lGhauYDXQ0x4Ja2kTPoAviRcbCVGx6lid2f1R',
  'assets/fs/libraries/Adafruit_BusIO/Adafruit_SPIDevice.h':
    'sha384-J1Dj0iwxqd/HOlBKImcKm+Ovx8fi+e2VwW8ilglLaRW9jDweDGfIbwNMXXdPSxa8',
  'assets/fs/libraries/Adafruit_GFX_Library/Adafruit_GFX.h':
    'sha384-mL+jsyLzlkeIHkRDfPzgfogeLzE8Tke/sjSQo2nJIyujeFco6lajm+DQxG4HvEmT',
  'assets/fs/libraries/Adafruit_GFX_Library/Adafruit_GrayOLED.h':
    'sha384-HLHwbJ1RXPxBfLyddGqNYO+kfxq9kmAOcZbUSPbvHU4MWPInq9WZR9n+zvjqrqdz',
  'assets/fs/libraries/Adafruit_GFX_Library/Adafruit_SPITFT.h':
    'sha384-JOaKT7RPIrToCUfEp9rwPRDV1dWYVk0zIVK3DhJ5zII1KeeaGe/dIqsZiWdrwC2y',
  'assets/fs/libraries/Adafruit_GFX_Library/Adafruit_SPITFT_Macros.h':
    'sha384-KIrr4bBnMtd+XODn7GtktXYtLEFJcRzNA2PSbamcRdCYCNVfOVR9p/s7wRHbVwan',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMono12pt7b.h':
    'sha384-6ya2vOzVcLUq4evAlR4YQLcUMXACV1F+OyuoVAeSTOWKsMtTZbVGvNSdjm7goxzd',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMono18pt7b.h':
    'sha384-YG9rAnbtegZwyU9QrIv9sgkThMo3AvyMToP8vgVFbMsbM8tkw6KrfDcPf54BXN99',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMono24pt7b.h':
    'sha384-wGTJ8hFWBe+G1qWuQF1jf07dmR5WsnJcJhOUBAME3mdEGEpNihiEupmVju3dMBj1',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMono9pt7b.h':
    'sha384-FExp2hS2HNFCX09qGqi+uZF5qwwHfwkYvF7jBmJN4MUmqHHTxmm3ENrj2d+Atm4m',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBold12pt7b.h':
    'sha384-LVpgz39EksDssJV2RWsJC/pQ4rsWWlG6Ureb8eiQUnkptkh9U1AJyYrUyE7WEN+N',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBold18pt7b.h':
    'sha384-VLn46lqaJ+1Bxs+kJCb6WBzG/sCBZyJoyG3lcul6PPsyOlVRqyr8U17RmymwvzCf',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBold24pt7b.h':
    'sha384-SDavhlYEb/UDcgkluhZO+PnT0rM3pwKDBk1CPSU4OQYtxHAgwWLHymm8CtinVlgN',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBold9pt7b.h':
    'sha384-gg+dBfYH3oX7YZ39HSW6PmgTOXAKAsxgqcEOopchnpH+HioGbwyjsrOVgydHjowk',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBoldOblique12pt7b.h':
    'sha384-YFaf8b0VV1w8P63KpSzHVYhRKT8xoW8528tX5ndItYCiEnK3/QStZJEfNI+bjFqU',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBoldOblique18pt7b.h':
    'sha384-nDjGf4FP+SeVzfRsbBbLi2qOGEZJYXLXiPmCT5u3G/Zf9jBclbLzosxn7Hb8znZN',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBoldOblique24pt7b.h':
    'sha384-oLitLy9EQDBB4il2dAxNFX3WP8FBtO21hoc41Oae6L3/iq334Q/IVWz/gebqK0it',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoBoldOblique9pt7b.h':
    'sha384-CDXnA6dMJaZhsa9dCxAIJYVCQaHm0LnRKeL4PxhkKttUZRAQRG4oK425L/eR3pFu',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoOblique12pt7b.h':
    'sha384-VtpnAqf9rJmzmJ2zJrMr7DKyLdjiQxsMWOoNWXQhqoh/aadqa9fuT+5oQNFWYeV+',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoOblique18pt7b.h':
    'sha384-HEBsPnaOFgAb0XepJ1dIpbWb96eXTA8+av7cvYUWdBtO+3SIiTyXX2q5Jpor/5iv',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoOblique24pt7b.h':
    'sha384-Ux3W3KJ2Y5q9jHX39sEjTNIl8UaHS2LuFSABLPK62jkMKMhTZ2DdbXo24obVoh2S',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeMonoOblique9pt7b.h':
    'sha384-Gqeegsw4HZP5AdkAe8pxmdNtWTSTP1IDYLTXYKouRB6pmHCWNphPYeKFkmBn5CGp',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSans12pt7b.h':
    'sha384-fGEKcnCDYxqve2VWdqBdy6+kWWdCR9Ar0kXzo6VAqlbeLI7ChQ4cNiJnGCv/0LRD',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSans18pt7b.h':
    'sha384-1HUauD2n+Plp3Sa5AjXW1lhOByrZvY+C/dQaV5rpqykTfKMmvIJ32TDlVZ1TACJq',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSans24pt7b.h':
    'sha384-MCxawmGXWb9CfcAa+0htwpBpedGVxIeh63UBfowFpcDtQyZYk8lvdz4KMWTfz0dV',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSans9pt7b.h':
    'sha384-o3lK5UwMpJslkvUegnDisdQ1uCCWjCiNo1jP+LXe23ydhuYLQBx+lcBjLaztP/r/',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBold12pt7b.h':
    'sha384-hX9Gc9gPDQBAlJOMdKMSWb6zDqMwe/SGKhsSG+fCZU92O0YSlysFAKgWvghaxbf+',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBold18pt7b.h':
    'sha384-dQ0zs/ZGS6ouvPrbsyZo7j0T+DB9Nq/owTo6jozHkSJEmUEykY/mAgbXN1wRPdqw',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBold24pt7b.h':
    'sha384-pAWF0v8IyjylUlx5olLv/vgSOTRs8+z/Cjn9ETYFEBfsbl4nxwh7Op/yfeVoB9Oh',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBold9pt7b.h':
    'sha384-Wz8NHJ8gXevtC/m83lhGL1T9Io5SL9mLg8lDkWB5vAdGCwmE3N2hoDasv2j4UAY9',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBoldOblique12pt7b.h':
    'sha384-e8mytNdMy8rjzx9PDKmLifyNl6eDp0TH6Y2ASwccIBrUejCN6/Qf4/wv/K74/Tzt',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBoldOblique18pt7b.h':
    'sha384-UdFJ4q/xAMVIc8te0Z8/GonSmL/1eB8mBtyJuOy4DfWo4blfWeFfIwaygQe8f0fb',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBoldOblique24pt7b.h':
    'sha384-snmlQH2NruaCuBfY3MOd2vVrP7UNabnIap8QbP+zgxrn7ySfLj7VOhm2BCqDA51n',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansBoldOblique9pt7b.h':
    'sha384-LVcrmFmcj1YO/W6jXMjzVYFCdOpGo6MwTzd7iZgemd8NwaF3BebA03UmMFHtDUs5',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansOblique12pt7b.h':
    'sha384-7QV1UKUyMFtBiqHfRh+FIMn3iP0IqyatiryEytBKgH7kY8fvq76jlWXeHx0vIB9b',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansOblique18pt7b.h':
    'sha384-2UqxWnkt4PEqOQzmNnvYkPucHvbnSRvWCa8O78HlP5P/vTEHP7vSIoe5W41VkPgj',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansOblique24pt7b.h':
    'sha384-t8ZN3J8RAJ/UYm+s3Vf5BIYXsgdQqfNKQaBVh/28Sr0M6Sh+ljuzTgotUcn/0vU1',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSansOblique9pt7b.h':
    'sha384-49fYIyujg0edOpND9HPvfHGE9CrWrldai47kgP64wWFmgmqripP0ffIlaIlAfDne',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerif12pt7b.h':
    'sha384-zD6AC8FqQbO2/I/jugcrXW7YvMxuRjG5CH5JfYXYVkYEf+wCQRKjKU5Y6tMuxrkC',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerif18pt7b.h':
    'sha384-9VetiNzCzkhbu3TUzQc9cQ60bPw+TI73QiQunA/BJV6mk9vJax7JebuaoVtfHA0k',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerif24pt7b.h':
    'sha384-4t858MNR69fFwEVO8WBSTTTExcd4pgnbfhJI/Nwwj5ejehDcBBGnonJ7zVWzd6a2',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerif9pt7b.h':
    'sha384-vpnsK37/sqNnvUtqAjYCwh7yoUyqqmdgKHatzGCpSNi8NXNCieXl0W0QPxPWeI87',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBold12pt7b.h':
    'sha384-1IBKNGj5PoQWn2MJ+PDWJ0mnwONK2DHKibaePwiG/li3JyXRH5wSmeLm2jMkqa5j',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBold18pt7b.h':
    'sha384-kPemQxljSFtEeG+JDvi6aaUrpHGpPARlTRbF0yImWMcsklymhIaZItHbp9lUWFtj',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBold24pt7b.h':
    'sha384-woFH11xcg4H+vQN7zlR4wHiiXW8xDkzLz6R6rPbCt3/OZi9MusHXpK4LA9dDFb/W',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBold9pt7b.h':
    'sha384-oesCCLYrFJmPi9CiD0BgPp+ko3sEfh/5VXs6o8CD/fPuxhMNobMXE3RDd3ZLC4KJ',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBoldItalic12pt7b.h':
    'sha384-JmmpcF7UPa6Ic0nAZbtjw0J/5Yg3MkxEDU0oIaTvdWvkLpsG45OY5eVGL4O7xk+3',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBoldItalic18pt7b.h':
    'sha384-uL/YnRmsaSiGV9IRKugqyck/BO9lABXYloESN0uZ1nNxPymnoBCVaytaa38m8dS9',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBoldItalic24pt7b.h':
    'sha384-vmVuyX3hhqCWhyKulSFUAqdwgP9HnIvOfc5H1soGk9e/6W+GI3tS5CrmYHj4ev2O',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifBoldItalic9pt7b.h':
    'sha384-gNDsNC8mtnXIceCiI2ooUxaQ544P0y4J+rmXFwtisvV9xXutEwns4anIu+g2ag3b',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifItalic12pt7b.h':
    'sha384-+n1IRmKbWJR+gAwd12waA/9zzle2TAsLI8feyhY9kGMT36sRxcBlqclTnQfbsyRH',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifItalic18pt7b.h':
    'sha384-DaoT+1msVCH2HFASHKJ2GuRuN+s63ZIKySCoCab9hEuHGgchxHcyQhwfonTk2STa',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifItalic24pt7b.h':
    'sha384-KZB32vww3VCKqfV4aktSafsrLZi+HbunoTqFHa09Xf5mXF8kgJxU8IrXJ9t2ODg8',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/FreeSerifItalic9pt7b.h':
    'sha384-yR9WLsXxJdZCQ3BpKvz2rIN2Ho0OJNMyNYcPuYUWHWfsOgr1mHdFakgHAR5fkenF',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/Org_01.h':
    'sha384-UdU4QjYZ8G9BLSa2aaldcU8IR+Kw9UcnlvBjmA+Xc5c2TY+Te+vAcHvyTWrijp6Z',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/Picopixel.h':
    'sha384-TJAX/Yoc+2fJtig1pTwRTHlt4rBIBiriKs20r07paiI6ftnmX4Xe5ctvNAzlyQvH',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/Tiny3x3a2pt7b.h':
    'sha384-+0yL3mlF2qLe5m/ylbZ62rXDLCNB8Qq9qnafkcLCckAu4GaspKJdxVNMSzUzBsX9',
  'assets/fs/libraries/Adafruit_GFX_Library/Fonts/TomThumb.h':
    'sha384-SSZmkTnHA75b1mcMtOLsika9qxWvfyGHRnJKNlx0N+rai5pyz5z46jMjjZEIdEJ3',
  'assets/fs/libraries/Adafruit_GFX_Library/examples/GFXcanvas/GFXcanvasSerialDemo.h':
    'sha384-HraIl7UOCtCvn1nKeAMelKpP5U7hxWyr6j0FxRAx/WINVjQYueWTiIgFTtexgmJ3',
  'assets/fs/libraries/Adafruit_GFX_Library/gfxfont.h':
    'sha384-dpTxi4T6YJO6d8IbmkKpWEYU4Gf13eAyidr4jGI6LuD2OxEZhPnw7PtxgM+sXPG6',
  'assets/fs/libraries/Adafruit_SSD1306/Adafruit_SSD1306.h':
    'sha384-dH+MxxU/VdjG+bfgns1rg92ixQGc+ATCoUe5Hc2nPfaxB+fa8pp/vWcEBr72GPKS',
  'assets/fs/libraries/Adafruit_SSD1306/splash.h':
    'sha384-9yaR62/EqsUvt5ynXgiuov/5cGdAHpsFM06TYiDmEecP+j4bcWQPL14q6Mb+AtbN',
  'assets/fs/libraries/Adafruit_Unified_Sensor/Adafruit_Sensor.h':
    'sha384-Tyo4n7oVCKbeLYG5su3O9NtyZjy1oSbkP/SLBIMI9Ik0WQik5kAhlLND50IIzNp/',
  'assets/fs/libraries/DHT_sensor_library/DHT.h':
    'sha384-KSpj5ImaXfWdNISZI1dgjMgL0E0ykEierYAg7V7pMk/YXgy9tb/zdVqRR/U7HWS+',
  'assets/fs/libraries/DHT_sensor_library/DHT_U.h':
    'sha384-t3MDTt4mdrTaQhUL+flnpfLwjs05U8AKUwHCZt+6G74RTWIAHLXNIPqflLF327NU',
  'assets/fs/libraries/Firmata/Boards.h':
    'sha384-rtZf+hiZF+NnbLPnRc95GlS1hXmYMwNLGI/JzwbuMT2zIxohiWPB8lkGCgd4uNV9',
  'assets/fs/libraries/Firmata/Firmata.h':
    'sha384-wZANzzw0HkOAIlK8jEfBxugFaH1QwnRsOOsvCwArmc/9Kvge/U37r/k3/Yjjl9cq',
  'assets/fs/libraries/Firmata/FirmataConstants.h':
    'sha384-UZFvAsklmansTKqV4gEAl3m7o7H+SuOUYoRjvPQOcxHFVC3esbXNOd+Hxq90JMJl',
  'assets/fs/libraries/Firmata/FirmataDefines.h':
    'sha384-JtGenaOulsWJKqPKBTqgUbP4p4u4QG+oRK1klKX3HF4e2M6QugNy08fbB/SJgc4o',
  'assets/fs/libraries/Firmata/FirmataMarshaller.h':
    'sha384-tR7cqDJmS3IPZpe4c2bpDTiemSGQrS27noPoMHV+/ndQuoBie65AJDqFR76L0sQ5',
  'assets/fs/libraries/Firmata/FirmataParser.h':
    'sha384-pj/BDiItEbeSlgAFTPoOnsM+gPYhStGeIvNfeAIbkjJGoNLUj7EZ1lH4K8TTwZLp',
  'assets/fs/libraries/Firmata/examples/StandardFirmataBLE/bleConfig.h':
    'sha384-x2hx+s/bgfxFABBpIci6s8faHkTjRjC8NI9sz9vYV/eJc2wYZg4NzfOgqmjDcINe',
  'assets/fs/libraries/Firmata/examples/StandardFirmataEthernet/ethernetConfig.h':
    'sha384-ZbGQI03OLPUMBj5Fuj2TpnNjyKQyJUcvprgidcOVCY8onM9fXXDn/QakHJ03zBew',
  'assets/fs/libraries/Firmata/examples/StandardFirmataWiFi/wifiConfig.h':
    'sha384-sb47kDoXhuFtM+MzNz/r9o6xR3Exl5Ey26+tA9lLdjip979yCXK/AdPoGiw8fmwB',
  'assets/fs/libraries/Firmata/utility/ArduinoBLE_UART_Stream.h':
    'sha384-cutSd67SygU37qsls6//yLrT7/k5v4csh4tY0KIk+xdn010TZShd6+cCUCTe/bXy',
  'assets/fs/libraries/Firmata/utility/BLEStream.h':
    'sha384-V7cUdSa7Z1hLSV7SnqqIL8i7wdWwGFuqsNedJ0bGoFp8hmKZ4xTnVVCq7f95SMqR',
  'assets/fs/libraries/Firmata/utility/BluefruitLE_SPI_Stream.h':
    'sha384-CL2aLUXP+jOhuIrHBwNAaDASB2mdFxSThNY9p8Zr4b8KiJnOK6jFkAorG/SuoBkG',
  'assets/fs/libraries/Firmata/utility/EthernetClientStream.h':
    'sha384-E0ZPwY974iaBifNoPN93N/40B3WQzJPFcBkVJ1MbRHDMOfX46ilXcWnERQNLoAFA',
  'assets/fs/libraries/Firmata/utility/EthernetServerStream.h':
    'sha384-0egHNYxg3y5jJ8TVSWyrQ7gzVjILiMyQVRw3l25g51+DirHp1FZMV4vRKRwve7lM',
  'assets/fs/libraries/Firmata/utility/FirmataFeature.h':
    'sha384-vThT0njswKt6hm35U77/CnlrpjFtHkscYYy7OoyuJ81d/Mz5llhZf8G5gFX/9FCF',
  'assets/fs/libraries/Firmata/utility/SerialFirmata.h':
    'sha384-25UfRgpuxJeEBIUYr8sXDQbx4MpA3MbsJcgYbMiXABdKIZuYfojTXEcPRGyjALmT',
  'assets/fs/libraries/Firmata/utility/WiFiClientStream.h':
    'sha384-FwmbDk7vUhicmjJkEj8RFcBLRO68SyCj5sjHcWgQQmHCqK4cAHe+4ri4oGDLBbvj',
  'assets/fs/libraries/Firmata/utility/WiFiServerStream.h':
    'sha384-xKDc20nNHES256GuhaCTeXkg1RMpSfOT+I9hscm4XKgoz1aTikce0DqJyEuiai4a',
  'assets/fs/libraries/Firmata/utility/WiFiStream.h':
    'sha384-ngEs3TUvfG3hR73s4bE4lE+JhwrQlTc+FQ2K2/Fa+8ufIvGScjkR6OClgO1D1/eg',
  'assets/fs/libraries/Firmata/utility/firmataDebug.h':
    'sha384-w4YCLOI97IqRwLbAS2GqBvLpmJQhezxd2YflAB24dArUIZOyVeEppIILfpwxLuE5',
  'assets/fs/libraries/Servo/src/Servo.h':
    'sha384-KtyeaZGCIUVGCOG9mdo7aMrQqpBzMBjkn4CMC13SAVP0y5nXswYc1iNGrLP5t/IR',
  'assets/fs/libraries/Servo/src/avr/ServoTimers.h':
    'sha384-42zN0J8ea0yIV0lmWz0qVq+xuF+VPH1u9kqPqKkPG5SEybKeRi38XIyUksrLI/xv',
  'assets/fs/libraries/Servo/src/esp32/ServoTimers.h':
    'sha384-+hbb1RY3HwqOe+8MNgwGrt9EhaH3uWb3nNwvNGX6dUUsOflymsGbRGIYKEq1At/2',
  'assets/fs/libraries/Servo/src/mbed/ServoTimers.h':
    'sha384-y6RJLZIezPStQRp1ASAA+ZH6ycYqtTqPI/rdxINMwaL5vFou/BCpKTivWhtr0t4O',
  'assets/fs/libraries/Servo/src/megaavr/ServoTimers.h':
    'sha384-U00w+MPuW4Z3ZcG1xYBv62QfERo+7sdMxOnGkJFhLI8EpxAQNWDRpin/eVeMwN15',
  'assets/fs/libraries/Servo/src/nrf52/ServoTimers.h':
    'sha384-pL6l0BtB5pRGVm8BUnxXi4zD6CouTbfpul4CY/2b4gN2Utu6c+2WcoMGACjStZHq',
  'assets/fs/libraries/Servo/src/renesas/ServoTimers.h':
    'sha384-nYtvnCXPxiCiKvBeuwBtonYYUsWvbuplMqOeO6KrB8TuX/pf2SKo+9ezY7KQegLK',
  'assets/fs/libraries/Servo/src/sam/ServoTimers.h':
    'sha384-/8sWh1S8xUMwEnnNXtDKYw4tzWWS6/5W26M+/rq9alk636ZMZW2MyIJShfiO6HYH',
  'assets/fs/libraries/Servo/src/samd/ServoTimers.h':
    'sha384-9DqNGnJSMwUzhrRZBJI6ZkeDt6xEa38MjxtMqyfsOvd0ugc6jJqEVSaVYHgmLWD7',
  'assets/fs/libraries/Servo/src/stm32f4/ServoTimers.h':
    'sha384-zoEviGSXpz1kSK8gudkohACEGOBgOwqEoPRojOFUvwbO9Mdu811dbRixX92BZe96',
  'assets/fs/libraries/Servo/src/xmc/ServoTimers.h':
    'sha384-uzr7xZegK5PcfDzGOdvFI4ib3gLIDaXHEJXh7QUEaXWq6DAYL2jaJTEP+Vtl7JoW',
  'assets/fs/libraries/Servo/src/zephyr/ServoTimers.h':
    'sha384-VdMafAA2dPhX/gU7X/nWg53sqFtaULCIpsDbxiOSlj7FZUUcT766e8Eikv+Ez3wL',
  'assets/fs/libraries/VL53L0X/VL53L0X.h':
    'sha384-wfon+h6X8T9tmUjSe4QIfAWdlu1/QxAiwB0stXN0Mhk32TGlwP7ARra513pFwTA1',
  'assets/fs/sysroot/avr/include/alloca.h':
    'sha384-wy4GWjFH5GogNpKyN0ta/1xp6EO8IePCHwPxcBZzK5d3+ico0dTK6YBBPWfwURAF',
  'assets/fs/sysroot/avr/include/assert.h':
    'sha384-VA+UHUNQCh2uUW0jAUky/srpWxL2Rnoq34/O+TJbeCEhN9y1tdBI3IRZj2//i7fc',
  'assets/fs/sysroot/avr/include/avr/boot.h':
    'sha384-ryZwhuFtUm7DxIcxSsc2dANotcn9kQSO9ZYTvr7soLathCzA3sCEYhD9c8c0SocI',
  'assets/fs/sysroot/avr/include/avr/builtins.h':
    'sha384-HSniV7Iy6cudg75YtLt6zrFBqKhva8Awxbd+8GpxO78T5z/L33nO3WptP4dW5WPH',
  'assets/fs/sysroot/avr/include/avr/common.h':
    'sha384-gY47w6hedFclzfi55Ep4Uo/jFcN7sHInza6D4M4eGtx8Jeoh9lnaXj7QcTp559e/',
  'assets/fs/sysroot/avr/include/avr/cpufunc.h':
    'sha384-z/mPfHfVtM7ZUXGp7YvFf0GMYAzTQ49BxrvFwlJ5xtB+rlw8PleTWOI4tOsW4vmG',
  'assets/fs/sysroot/avr/include/avr/crc16.h':
    'sha384-KZ4hToWwMgkv3DeFITUj23JdBoDwGIP2fH3b4hRhmUeGpI3aBt1txj+GV7BSnE83',
  'assets/fs/sysroot/avr/include/avr/delay.h':
    'sha384-bp4FAUdYa2cbQBrBCKFmFDs8j56ADXMjfrGP1u+d9M3ayH+NZSlQGMv+VHukJwbB',
  'assets/fs/sysroot/avr/include/avr/eeprom.h':
    'sha384-m/DKZENXDu6i14IHcfsk2ddqxK8UtaZlQJDPpOdsjftMInD27THhBeI1yOF8Gjav',
  'assets/fs/sysroot/avr/include/avr/fuse.h':
    'sha384-QChnXYCxHv3mVQk1vshLE3fUK7wixMgSNZs+3kGbJOKq76COXPB8uxNIqARs7lyE',
  'assets/fs/sysroot/avr/include/avr/interrupt.h':
    'sha384-xlxFCfS36VJJysdruo5f3PLOIs4pnu/+NzD1V+w/yacRlqMzPG1FQBf2VKBNBUmw',
  'assets/fs/sysroot/avr/include/avr/io.h':
    'sha384-mN+MMm0Y5bKYz057Ii52mJ7AgtuJw3BrWCRaiB/KcFUfSAWrCK7jb2C0QO9jnyud',
  'assets/fs/sysroot/avr/include/avr/io1200.h':
    'sha384-qELbl85WGATqu3j0a8whu9JAwMvgovhJIUOa7ILX8CYiAVgwf9Mop/SNqOnHKr44',
  'assets/fs/sysroot/avr/include/avr/io2313.h':
    'sha384-5y4KYJTM34X3O6c8Ed2zEEXEkzQFDs66ijM1cXnXNgWK/KnCg7vkKDEOeLxouwCH',
  'assets/fs/sysroot/avr/include/avr/io2323.h':
    'sha384-8cWNdh0gm0Hdi+st3Re2hjm7r3q2Y6P/vHRGf/9bYK7OtmKSF+VC52AcyBw8uAsF',
  'assets/fs/sysroot/avr/include/avr/io2333.h':
    'sha384-GnjK+tNx3ygFnzOY5e3LgwjQSjMiBOvxiy22r34/M0ubpqWPWIgFEZmeEsrNEbb3',
  'assets/fs/sysroot/avr/include/avr/io2343.h':
    'sha384-ow+8LdVUmOfr6VPVebPN699DWzSgm0DOQx8f7iJ4TPek4QxmPXeGo2v24rtZ+74q',
  'assets/fs/sysroot/avr/include/avr/io43u32x.h':
    'sha384-CjaMX7oTJawgkfBOrcJ+E8n4ljiEMTr02OYjPLdpJio19Nj9oWSXzifAT/Gd3oUt',
  'assets/fs/sysroot/avr/include/avr/io43u35x.h':
    'sha384-akjUW9tZLLGkQAePGULMiCGNOE5SgAe7bzQlmlFSGG7hbv5OgSrwBMUSl6Wmls8A',
  'assets/fs/sysroot/avr/include/avr/io4414.h':
    'sha384-Lorri//l3rSPNTMr/zd86iM96t+rSF05GP0mus4DomGIw5QYRwSRjOJtpZVpCoNV',
  'assets/fs/sysroot/avr/include/avr/io4433.h':
    'sha384-6UGSUJZX01ObsWqUzOtccOkMYKQZK9CHCyh+vLqEbdd2k8bNp/vLI1DL1bu/B8aY',
  'assets/fs/sysroot/avr/include/avr/io4434.h':
    'sha384-Ou/wcGDu+rO1md63ovgrkwlG+WvpdMKPZNd9wK2vnSrAYwdX0cKSC8Bdv3lOKoTU',
  'assets/fs/sysroot/avr/include/avr/io76c711.h':
    'sha384-RX6ThwUWk+7XvmGPbhb0Sd58EsAyHFZ/9y2bt6k/9SaDKer6c1G0P50gHdUxSOvd',
  'assets/fs/sysroot/avr/include/avr/io8515.h':
    'sha384-iYlXHp63Vurd1M2VCfbPPwx4N26uYHpw8Vs9e/zFL4CMLyyffWJMaf3apoK3niiH',
  'assets/fs/sysroot/avr/include/avr/io8534.h':
    'sha384-yalvpf/a5aYMGokYlogOyUa68SJ1HmHDZd+NKZfi1cVVpAeO9ar+9hZzSMRfQPB4',
  'assets/fs/sysroot/avr/include/avr/io8535.h':
    'sha384-QZqoYHNwlGJSuBQiASXz/CpAPBA/6oDZ0HnFePjSOmRCTDp9QfxSPMwaSYKHngCQ',
  'assets/fs/sysroot/avr/include/avr/io86r401.h':
    'sha384-c86wyssLCJPs+DxY8voHh5NdkQ4Cm90EabWk5erKiOSwSUt0si74r1AV4J0KopeD',
  'assets/fs/sysroot/avr/include/avr/io90pwm1.h':
    'sha384-tqFZ/M5V0sJNMCy8+xIWRnSIQISsvaEZb+9BirO4bM3WEbag4lnuAAOQx/K19uZ1',
  'assets/fs/sysroot/avr/include/avr/io90pwm161.h':
    'sha384-naYgiuPvLt9w0MFudpkNPFu9NhyCZHAJACYvnLqORX4q9kxutVf7hTfzDVyX+1Tu',
  'assets/fs/sysroot/avr/include/avr/io90pwm216.h':
    'sha384-ml5IeqkGIoFhJJp+FcUlx5L40mi+bmkJ8ShvZUQ/Owgjlg3aEm5Ftz5dWUd+YFDs',
  'assets/fs/sysroot/avr/include/avr/io90pwm2b.h':
    'sha384-DpejOcfyrSWMJYjsFzTQFvQeSNfa0va5hqklfmL+4EJfd2HBnaUlQmjO7EnO/cYt',
  'assets/fs/sysroot/avr/include/avr/io90pwm316.h':
    'sha384-BLuw4uwbVO9AFhvIo4Yvob4AgT8VjkqsQAyjE3RG66TQ27SgYz8PX0LzKzTbLrnJ',
  'assets/fs/sysroot/avr/include/avr/io90pwm3b.h':
    'sha384-r4g5aaUpRhnkCr5DRsRoEZkZaqNbq3vdWA+IqpVQb+4npnTZM0p1W8BHhugqNt5A',
  'assets/fs/sysroot/avr/include/avr/io90pwm81.h':
    'sha384-W5dSt3MWMxqPa8eN5tWWVcwK5C/I+Ej5wnqEY77ctqlwq5R3w3/ELPVnHGkHLVl9',
  'assets/fs/sysroot/avr/include/avr/io90pwmx.h':
    'sha384-0VlxQIEoUQZqgyNgPxx25iDRjL/kN/X5v43TVbF/+CYqNkvFOPFonsubrjOKKFwu',
  'assets/fs/sysroot/avr/include/avr/io90scr100.h':
    'sha384-2gC1pFbiMOFAt/iGGCd2Jpq0FJf3RJNAPEfE8AZ2LDX8Juja8BuGuGOIXAgNT64e',
  'assets/fs/sysroot/avr/include/avr/ioa5272.h':
    'sha384-Ju9MX1xJej3H7vVNnp7WvWJ0jCaM+AS9R6XvufUwtBXOiD6oewPFW29AxSIWYxQA',
  'assets/fs/sysroot/avr/include/avr/ioa5505.h':
    'sha384-96eVNIU/rBTgWX168+orSdlKMqxzlgAyhlYvUcbsEnHEXpFJUXDTMUqQjk3gFv7I',
  'assets/fs/sysroot/avr/include/avr/ioa5702m322.h':
    'sha384-dhPTPbJfim7gsTfaE8uh8fHczhEIhor2ISUOt28d8v7ZoGSlA3H+IQVh1rclAiKo',
  'assets/fs/sysroot/avr/include/avr/ioa5782.h':
    'sha384-GfXKFhBiXJARq16UXsXZJ++js/SlnD4RT6IY32DOnxtq3LowuJojq0BvEtOPCmHm',
  'assets/fs/sysroot/avr/include/avr/ioa5790.h':
    'sha384-0dNrk09fxnZBMZr2ix+jFoZx547WVVoFrpj8hK/z7KWBT90qjmWbqRNhaSAgsOeM',
  'assets/fs/sysroot/avr/include/avr/ioa5790n.h':
    'sha384-5lllDk3BsBvCDa4U6MgEw/elYoYbytnuql4ppDEqQ024SY12tJmuHObx5K2NOBQN',
  'assets/fs/sysroot/avr/include/avr/ioa5791.h':
    'sha384-mxfO4Iyl6gs9iosTlAwsQ9oGCQ2J3vCkh1XDMLp4VmgsMgp5VrPbdm/ydG7VDi0e',
  'assets/fs/sysroot/avr/include/avr/ioa5795.h':
    'sha384-QevqXVwCrlTDYq8RFRsyyUsBlyQQPG8d1MeDJ8+X4iZhyGJvWjN8ZDBiFs97oYJp',
  'assets/fs/sysroot/avr/include/avr/ioa5831.h':
    'sha384-XlBGqox8bVA6yvQEU5uKflGqIzfLa1jVKRqdmfTFdDeOSibKtO4IBkXCSJKs4IHB',
  'assets/fs/sysroot/avr/include/avr/ioa6285.h':
    'sha384-RHBolYiB9Q1aOGX65N2+NKaXLW0bnsXKeRuCiPC/Ptn7SemsgQAF95d/qOT8Eue3',
  'assets/fs/sysroot/avr/include/avr/ioa6286.h':
    'sha384-Xj7nL5DU0xOwuYSn2JhZdXiCqSY3aGuYptjnV82WJuuw6trC1bU9qsV7dpUiLl3K',
  'assets/fs/sysroot/avr/include/avr/ioa6289.h':
    'sha384-s3UEiJfFVeoB7fKri7dL4wn3EaHztnNYMJTI+CvIdcATx1NyfLyaTTgu+L9c/80O',
  'assets/fs/sysroot/avr/include/avr/ioa6612c.h':
    'sha384-oZ5wH8LGvwdVLWWCaYzO2vnDDVGGRsDri+bKHVbeVfY3PXPGfPL/skgFI1/BfVVa',
  'assets/fs/sysroot/avr/include/avr/ioa6613c.h':
    'sha384-g1NlM7UTovrgSHK77YGotGa0OG0nNP7kWVoXLKsUjOn75/d9BfxBkVSJxhkgVyed',
  'assets/fs/sysroot/avr/include/avr/ioa6614q.h':
    'sha384-kSiEQ4rYGUldy3s8keHEffqnapDuNpko+cCH5V9zbmmlNuvgYBZKtsrDMwaHKST4',
  'assets/fs/sysroot/avr/include/avr/ioa6616c.h':
    'sha384-gM4tE9f0FY0MBeev8yGFcwTElZMwrsuGyVtzkXD86ufLEjAzaHEhDIEvg5yJEXkw',
  'assets/fs/sysroot/avr/include/avr/ioa6617c.h':
    'sha384-WbqARGWeFFOugRi3SDjmguUikEADA3wzlq3c34E96o7gULfsJZTKpuD/uFNNbQT1',
  'assets/fs/sysroot/avr/include/avr/ioa664251.h':
    'sha384-/Az1lWe4/CMHYTt7Q9GMkyGbc824zhVPY/N73FCC7QJ25OONsEdO7jDtHmFN44BZ',
  'assets/fs/sysroot/avr/include/avr/ioa8210.h':
    'sha384-vZ+ig0oKik/effmYV2qNo5Xj6uQ9iSyEUgk+AEQJBy9FkCEeZRx4aBLlzA7l3wHq',
  'assets/fs/sysroot/avr/include/avr/ioa8510.h':
    'sha384-v6uRkdUXs3Rgyv4Om1+0zSJFiZixIpHwNZQZ6g7Q3UlEpklWienkLCgpWP4GedN6',
  'assets/fs/sysroot/avr/include/avr/ioat94k.h':
    'sha384-WQpyvjtw9Q+yFADbIhdPE8pC5DUfVKOiysB1YLPVc+rFC+tk1SEKmzz1VmlTfjXJ',
  'assets/fs/sysroot/avr/include/avr/ioavr128da28.h':
    'sha384-EvPmFXBeE8slRTiub4HSX644YVvWNM+LIn6cnslRVNwdQ4CK3PpjKHIQZOxPx1+J',
  'assets/fs/sysroot/avr/include/avr/ioavr128da32.h':
    'sha384-5EcWTfoeiikXGWI10RddLYyeDXT7Xqe8WaSe5+vnmR84mQSgvYoKh9HCMZUicPEv',
  'assets/fs/sysroot/avr/include/avr/ioavr128da48.h':
    'sha384-5ok2t8Yr/RsaqUTgVVZy3xu+eyu1ERuB/th7ZO38jFbgdZ9g4bHa9tR9Azqf5f/z',
  'assets/fs/sysroot/avr/include/avr/ioavr128da64.h':
    'sha384-VcKC4tLyoR7YGiBPo6czB690VZRtTdIuZDo85i3yc13pRn2ipSgMIKTSu62nK3wl',
  'assets/fs/sysroot/avr/include/avr/iocan128.h':
    'sha384-DmIB8uskgIBO61Pdb3piKEnm9kGQzvgr6EKKQ0vk4eNRiOIGsB/rFcVmXpSdG6H8',
  'assets/fs/sysroot/avr/include/avr/iocan32.h':
    'sha384-j35wCq54pkr9XAd/TkDLOf85gSKLaKi7QEe+vOAFgGpXGZvXxWDmhpWLtPvbeN8q',
  'assets/fs/sysroot/avr/include/avr/iocan64.h':
    'sha384-FvEiyAp/ckd0gOrsrbdB3gpvG7c8JryjanWFlvV3R17TG15yy0s0dHPsrQNVNFff',
  'assets/fs/sysroot/avr/include/avr/iocanxx.h':
    'sha384-CLth7W8gkeOl8eW89hDkLLOtLTz3t89lM32YT+UolYGR9r1ND/wTurh7kt5qqOuQ',
  'assets/fs/sysroot/avr/include/avr/iom103.h':
    'sha384-TLApdl82nBlyV6pp4P3puTe9yotN5FcRTUEH6eWqnbSj9jAc5TSUS+ylhv6ALnVH',
  'assets/fs/sysroot/avr/include/avr/iom128.h':
    'sha384-SYvsnii5iC+33pEGSOngJkGJI3OhBo8TWA4+qpn/HqaGELCY5mMVMRyyg1L2MjWo',
  'assets/fs/sysroot/avr/include/avr/iom1280.h':
    'sha384-Jon8diMTIpC4cENILFoaMhw6c8X4T9aKZx9DdXhWzG/iYPjYrrAt3JvnfN9UvP76',
  'assets/fs/sysroot/avr/include/avr/iom1281.h':
    'sha384-Jc/f6O7bNaeQAooXRKMeJRr3ac1Ec9dWPDsVSXjP3zmNv+sO63GJAdKAFS97nmsA',
  'assets/fs/sysroot/avr/include/avr/iom1284.h':
    'sha384-5/z7SYHAgVBdv4HcQETx8eT2sQ81Tn7ychqIOL+Mgpo8A5eRpQCACAfiLECmEJeb',
  'assets/fs/sysroot/avr/include/avr/iom1284p.h':
    'sha384-pnQy2zdY7n801ad4Zx+LdDzn8IjpQV0SiyyqKGEEfOru8IkyhyCq3g7d3qOl2Wn+',
  'assets/fs/sysroot/avr/include/avr/iom1284rfr2.h':
    'sha384-XXiRkG367zjNsZVv6A/o01p9QskgmUPDhdaOrGceuRwo2+uSML0PGDhcQxfOHBUO',
  'assets/fs/sysroot/avr/include/avr/iom128a.h':
    'sha384-lm87H+XsQXj0+Va0Q7R0bpgK0B+qyr1SmeSbPTYBTvaxG92yOCy2BG3i4Ph5s05l',
  'assets/fs/sysroot/avr/include/avr/iom128rfa1.h':
    'sha384-lTuMdcQ163Uw7Vw0SejwbjwXTdqYJnVx/Ufwz0mlHkGHwq9mod+vymzTSqPbmbdb',
  'assets/fs/sysroot/avr/include/avr/iom128rfr2.h':
    'sha384-aIvSJGNIchkRsfw5A2GQiztGoCtkNvG31mN3liPgrZigLSAGXPIjn9n1ocxuf0Kc',
  'assets/fs/sysroot/avr/include/avr/iom16.h':
    'sha384-ZrBg0ialT6OkZUuZgJpCOE86AQya12mYTdAVCJo5P7R1i31W7DX0crRQ5ohWaT91',
  'assets/fs/sysroot/avr/include/avr/iom1608.h':
    'sha384-XWEDRzNwR4ewUEXuicnJcjcQmPHdhqCK+3TTuhVAaOTmFoGI55PhZCUHRAeDQtYi',
  'assets/fs/sysroot/avr/include/avr/iom1609.h':
    'sha384-VIGRoCp49Vyol8xNLeIMEX5hjtTHEx7XQWHXW0IKVjtHit+VsgNh6wSBgVZGSK4r',
  'assets/fs/sysroot/avr/include/avr/iom161.h':
    'sha384-UQQgKeyluZ9ERTJNobqgbVXMNe1knLSAeFHo27/AnRVORCwm8SDm3FLT+VvEx53h',
  'assets/fs/sysroot/avr/include/avr/iom162.h':
    'sha384-drMqUbV/wc8ytXx2Jl1LfgX6Af8A+dlJuI07Yhw2uk4pzKn38ls2vN4oz5DP93eH',
  'assets/fs/sysroot/avr/include/avr/iom163.h':
    'sha384-xkwFfQWuh45W2RXYaCkoQ0lnwO30qlc2KIXdLSTZ1bbonq8hh1vb0yij4KQFmzrV',
  'assets/fs/sysroot/avr/include/avr/iom164.h':
    'sha384-MVJxywZhwGXwyzxe7XVEaMVm6zeb5WVWxeg167aHsVtZ/dhM6tsUtXU7/3MEQWmc',
  'assets/fs/sysroot/avr/include/avr/iom164a.h':
    'sha384-OYb9oQi0IKsHxDTJJovd3Vtnegu7X6AkmEE0vo9rpGMqYDv6djZEbdrTCkqpx/5k',
  'assets/fs/sysroot/avr/include/avr/iom164p.h':
    'sha384-OYb9oQi0IKsHxDTJJovd3Vtnegu7X6AkmEE0vo9rpGMqYDv6djZEbdrTCkqpx/5k',
  'assets/fs/sysroot/avr/include/avr/iom164pa.h':
    'sha384-8GUDOawtqNzIE8jyUGcrGugXMHRzY7Piw+tkUxDBTMq083wtrEcBxG4fhqpg5ssB',
  'assets/fs/sysroot/avr/include/avr/iom165.h':
    'sha384-/BQmS9SguctpI5/YxaeY9OrdTydyW7Q/JZymMNzt0V0ry2RC7YGE/3IF3YQlfNX6',
  'assets/fs/sysroot/avr/include/avr/iom165a.h':
    'sha384-17yC4n+oxUTnodK9Cv1wigYeDeXhCC/QUNgfY3a+GKbcpUP11bLKaMgGUsCEZgX0',
  'assets/fs/sysroot/avr/include/avr/iom165p.h':
    'sha384-xOSxcDF3G6VEPqmP0PU4KdU/FJvIc49ENMYY+w2382Ruw34dzRaJ2hggCYqKz2WC',
  'assets/fs/sysroot/avr/include/avr/iom165pa.h':
    'sha384-DHPXBs0TDtGUj3lZYn3+Q5CMP6eBghOLrdHJTl8SwgZvgRgLmhjkD2Vk6srjkFOT',
  'assets/fs/sysroot/avr/include/avr/iom168.h':
    'sha384-JidnKcoOG6O4AIRT5IIJGDRsomy7B0673rNTYrt1lSHO5tsFT5wS4+UL9kFMoTXf',
  'assets/fs/sysroot/avr/include/avr/iom168a.h':
    'sha384-vMYaYaUPlJaF/1XjHfZ370VPw93dyb/wo7EgvTdY2JuGqUsLR7GjeY7Z8zfAKQ1k',
  'assets/fs/sysroot/avr/include/avr/iom168p.h':
    'sha384-NjlJksd2BNpURWJojIpGsMpCN7sxu0p3E4EHGYPSh6sNZ05tnczEGiapwNTO2w8D',
  'assets/fs/sysroot/avr/include/avr/iom168pa.h':
    'sha384-mijnQSC7iImH4cTu5a8RRExpxBGVvV4y3oTQzuYxLsk6qOT26FruVfxNbBDFzZ5p',
  'assets/fs/sysroot/avr/include/avr/iom168pb.h':
    'sha384-IE7v/HEUMabi299cwxrmwj234jWa1z39uChGERFNKeb1OxmBBv3fdszYtkjfL5CX',
  'assets/fs/sysroot/avr/include/avr/iom169.h':
    'sha384-IvWiUzCrt3PoymDFMsvSPhvY46wCyqZTd3EUnhSjiNdpwS9/86Dg3LaYFG3xp0NT',
  'assets/fs/sysroot/avr/include/avr/iom169a.h':
    'sha384-RRvp36nua1QtZEDyKazxwgLjRs2ROZyaXaKRpkugDK5QKUsjuRd/AA0rquZx8wtL',
  'assets/fs/sysroot/avr/include/avr/iom169p.h':
    'sha384-tUw5eB+Fhbpp8zRL4Vq3ByIp8WKvZ6G8OMVuZOtsGy9tbMybTtSgREq9qwLqSLgW',
  'assets/fs/sysroot/avr/include/avr/iom169pa.h':
    'sha384-q8/WM6cNLOGxnbQDtUwcckEegnVTivi3fhC61WtER9Y4pl4vSbN8P5LNp3LEZLtI',
  'assets/fs/sysroot/avr/include/avr/iom16a.h':
    'sha384-J7eeKaVM/ascZG339lPbaaWLkChYo8xWPgGLt0t5ICsPmT/n6uKcY2yFmktRz67d',
  'assets/fs/sysroot/avr/include/avr/iom16hva.h':
    'sha384-Dai0ayQxE7RpfPiXaA23jV399RY4gHlVZr8kHiFF3Gt8moQ5o0FnWUDfehS4HKR+',
  'assets/fs/sysroot/avr/include/avr/iom16hva2.h':
    'sha384-5DZgFRfWNTueuY24sOOqJbztAP218Gnd7Ork3awpWw3NB7lj1DppUD5Xf5itxD51',
  'assets/fs/sysroot/avr/include/avr/iom16hvb.h':
    'sha384-07ZbUjndzeJQ8clAHsI/1Qpe/tWE+vYPrRbeHrtSzaD3swpU/8/gT0GiT+2Ym/TG',
  'assets/fs/sysroot/avr/include/avr/iom16hvbrevb.h':
    'sha384-e2xjj9ABzgh8Y0NGfyoLPkleulZRfe8WKCInYNpxHYTobQea0wdN5rrAoRK39DDZ',
  'assets/fs/sysroot/avr/include/avr/iom16m1.h':
    'sha384-9+cFhQY2Z1Y83WqmvmBwIsiGmZTGxaPLMFmXmAQuMXaYHKnk9N7oi+sG+r1H1413',
  'assets/fs/sysroot/avr/include/avr/iom16u2.h':
    'sha384-mDxZa1OBXwlAHWLXudOJufIOUSe66egZEYBCdwB7GoOQBr1h0ITl7+nVO05RlnRm',
  'assets/fs/sysroot/avr/include/avr/iom16u4.h':
    'sha384-LDCXkdKGPh6BcLyvdJ5jkK/yExlu2QN2kwvDzjrtNaxN/yjFKlCAkHj5kQOjMvIt',
  'assets/fs/sysroot/avr/include/avr/iom2560.h':
    'sha384-VGbryPXlMB3oUKOny0qYX079Epwg0u2fcqlOt5LnftORwMdedw3mX4Po1BGjtZQp',
  'assets/fs/sysroot/avr/include/avr/iom2561.h':
    'sha384-56cyhreEl8IgucN3uQuBaQBEcbhsn33mOIuVKGTgF+DST1dYi3NNy5G2GUwgnKqM',
  'assets/fs/sysroot/avr/include/avr/iom2564rfr2.h':
    'sha384-YUx8Dc120aEDwQi5/ksT1STJKrL3m80jQdi7Pgf6WlKQ2Cuy4DBADPcQXUD1FpM3',
  'assets/fs/sysroot/avr/include/avr/iom256rfr2.h':
    'sha384-6jt0wpHI22wq6MeP9OvOfyr5TB/U80bc+kSFcuXwwVkgZTJvjbDmT8w/eFi0JV99',
  'assets/fs/sysroot/avr/include/avr/iom3000.h':
    'sha384-HDpr50fUnxOcivQVcqh4mmSrx4V5fBtUdNljVRZqTshGj7WMWrJ4hqB0hIZIbVei',
  'assets/fs/sysroot/avr/include/avr/iom32.h':
    'sha384-n35Kjedw3H6qQIcI7G2rtloUQSQhf3rPKNxr/24IASENe1K68bvWYzqM0+SHSxk/',
  'assets/fs/sysroot/avr/include/avr/iom3208.h':
    'sha384-rJORkCjSm0lbFumX6EhAAzwR0WTP0aEXz7pJ/yVo4oPTHtX6fnNbs5NTuv1QalL+',
  'assets/fs/sysroot/avr/include/avr/iom3209.h':
    'sha384-g6Kgyxw4OjxmLyd1dcaaOCJAZPDTN0k7QrC8e/wt+9GszBEAZD6ZM3F8F3kHAel+',
  'assets/fs/sysroot/avr/include/avr/iom323.h':
    'sha384-SnA1MNiR07XwNX56ZWcd1I3llpbhc8rlbU5fGdLAtMq8J3QSYsCOfgfTHf1CdYeK',
  'assets/fs/sysroot/avr/include/avr/iom324a.h':
    'sha384-ueq31ap1Pb+Ug+f9jkxmY3N6lNDtWZPLXetHwSugDKsFc0ZV5ckjXfy2z+sK0GNY',
  'assets/fs/sysroot/avr/include/avr/iom324p.h':
    'sha384-78VWe51ebqcSUdcw1i18KHNrxHOEh9KttDcKt8YWw7+Uxau4VDNQFGvoJ0DL2DF6',
  'assets/fs/sysroot/avr/include/avr/iom324pa.h':
    'sha384-lOPd1AV1xgfjrnIOo4cO8lRD9Ivq65LcA2+RVSSnmkmmdK/0sK+6x9YBF/M7jC+W',
  'assets/fs/sysroot/avr/include/avr/iom324pb.h':
    'sha384-6adEsr3KZy9Gif1wzhaJTDYmETqKLbN1xTpdQsBJ5UfONLXHUU6VL6ZdZsJhEElL',
  'assets/fs/sysroot/avr/include/avr/iom325.h':
    'sha384-3J0H25+k5+AIdfjuAB728h9op6gbQOXh+Rgmw5584jOMlb4tZi7aaa1Il7fbADpr',
  'assets/fs/sysroot/avr/include/avr/iom3250.h':
    'sha384-job+XyTZaWQsxEOtDdowxjqOz6BMnj4xRqezakVyFJx6oyiJsiD6nrHEoqmu6o9A',
  'assets/fs/sysroot/avr/include/avr/iom3250a.h':
    'sha384-2mAsEKkpPBsWqDj0n7CAAno7Q4e33XBiAHOpNhrazLapbVgQCmmIk+dvTSIZ8+WX',
  'assets/fs/sysroot/avr/include/avr/iom3250p.h':
    'sha384-2mAsEKkpPBsWqDj0n7CAAno7Q4e33XBiAHOpNhrazLapbVgQCmmIk+dvTSIZ8+WX',
  'assets/fs/sysroot/avr/include/avr/iom3250pa.h':
    'sha384-47YYmPovSrqPvcTZp8ayDTxSoPmjt7e5QNegvDgUc3KvBjDauBt/6cqcxKTSDckD',
  'assets/fs/sysroot/avr/include/avr/iom325a.h':
    'sha384-Blf4/03WzBKa1P6WN8W780NnN1obH1raBPzqNhSyduM3t24rM7RcK6vu2rg05grj',
  'assets/fs/sysroot/avr/include/avr/iom325p.h':
    'sha384-Blf4/03WzBKa1P6WN8W780NnN1obH1raBPzqNhSyduM3t24rM7RcK6vu2rg05grj',
  'assets/fs/sysroot/avr/include/avr/iom325pa.h':
    'sha384-a+0BHXZ5xu/kCbWf521bcVwKn/ABFotz4OBDLvNyAkOyaIoH6GSws+gSIe7mXgsy',
  'assets/fs/sysroot/avr/include/avr/iom328.h':
    'sha384-BOdzzvRjp6fUdipn2M46l8mltaxLTyd0C2RCpYrKpTlIodIA43y1pnq4MWqruE0k',
  'assets/fs/sysroot/avr/include/avr/iom328p.h':
    'sha384-5FJq13VZE1HX9qFEJa4WmA/9C58uZvK3vW6Lktlv0FIxIzh8WgLicZsbIHiJ040S',
  'assets/fs/sysroot/avr/include/avr/iom328pb.h':
    'sha384-qTK8ZoJrFXz1EzewY/bPS7/AJeMzK1E+OtMZJx8+0Q9a1KxxpjFTKt85uFVMCah4',
  'assets/fs/sysroot/avr/include/avr/iom329.h':
    'sha384-aAWZkhwwRsTkoQObENgPqsqVUUhgaJpvJDJWKG0vCAM8k06d114z5499RAgp+HGy',
  'assets/fs/sysroot/avr/include/avr/iom3290.h':
    'sha384-v/JuWP6TYNSRTMCEskDysdmNVl4qnaXenDpVk8EEHaTB0/QZTiIr7juXsbHIS1qG',
  'assets/fs/sysroot/avr/include/avr/iom3290a.h':
    'sha384-yeSPQQZvXsC/iwhgl03b6vg4DdUz3FtErN5a0xAcHJQ5nBbwbR+Dnm/WSMqCyD3T',
  'assets/fs/sysroot/avr/include/avr/iom3290p.h':
    'sha384-yeSPQQZvXsC/iwhgl03b6vg4DdUz3FtErN5a0xAcHJQ5nBbwbR+Dnm/WSMqCyD3T',
  'assets/fs/sysroot/avr/include/avr/iom3290pa.h':
    'sha384-vUO1onF5zyHeyILSbTgHwGSNnXz+Ov1Rbw2WzEPQ/2Psmdm7LQ98QNWpdZ8DedVv',
  'assets/fs/sysroot/avr/include/avr/iom329a.h':
    'sha384-jHYBgbxhg/jhCOIl7BLx8CiSfSwjV3/alK28Orkm0W4r17CeJNz6fhb8JqqwuJZS',
  'assets/fs/sysroot/avr/include/avr/iom329p.h':
    'sha384-KDUvHHFNRyQPxc/ndX2MYWCtcaCvhs0e1+zd1MmUTBZXcjqNSFZJ2uwZn+3n3wTm',
  'assets/fs/sysroot/avr/include/avr/iom329pa.h':
    'sha384-jHYBgbxhg/jhCOIl7BLx8CiSfSwjV3/alK28Orkm0W4r17CeJNz6fhb8JqqwuJZS',
  'assets/fs/sysroot/avr/include/avr/iom32a.h':
    'sha384-vTBQBqF2QtROpuw3NQhNSSBOaAZpQiJUWCw7xLRch53Dgql2Cie/EiEjMyHoXz5X',
  'assets/fs/sysroot/avr/include/avr/iom32c1.h':
    'sha384-opwOdc4oGApZP2wp427n7tudQcC5jv7ReI94sm8WkbdwMKsGcaJFkDDwnYf68K6d',
  'assets/fs/sysroot/avr/include/avr/iom32hvb.h':
    'sha384-xzy+fjE/Kedu1OdSj/AMOdqSNAFV8KvGGMFeBR/J33xcjRzLkmfsXwHjY1YC97MY',
  'assets/fs/sysroot/avr/include/avr/iom32hvbrevb.h':
    'sha384-a4l0MkC//xoJQkPk2WlbLgGouksEgeN14zDOY/Q0i9jAcLzLwoAsRzCpGpHoEHK1',
  'assets/fs/sysroot/avr/include/avr/iom32m1.h':
    'sha384-GTkgK0ZJ7krMOUpJiHirC+MQ0GGQY7jrLf+N6azfVqy8wg/Oc9nvjnACTBwb+gDg',
  'assets/fs/sysroot/avr/include/avr/iom32u2.h':
    'sha384-Gy01TnJNAoPbI4i04mxXjttcd1nQ4BJklmmhCErR/YDO21l1+TyqqADqCnVAsrcl',
  'assets/fs/sysroot/avr/include/avr/iom32u4.h':
    'sha384-LID/nW7r+yTZ4HwaA783d/OhhW28iT87KKEU9O2sffA53LMVjFjqBpjNCdj2rpUW',
  'assets/fs/sysroot/avr/include/avr/iom32u6.h':
    'sha384-2MOLHrNvw0vfpv7q0loZ52UQTtfj0OzAQ+cd6olWftu6DD0eycYLbiHm6d1DkIlm',
  'assets/fs/sysroot/avr/include/avr/iom406.h':
    'sha384-VHCsu+Is7/e78ISvS5IHtLULBYvX9t6XWkQYwOUPGM8FDVN0MSXBj6YeN8vAAgaP',
  'assets/fs/sysroot/avr/include/avr/iom48.h':
    'sha384-jYPPDnJY9/pLjFh1SgnY3uDr75GaXCkryFpv11LF1T1QApC+iCH7x1x8Ijf3z3Ju',
  'assets/fs/sysroot/avr/include/avr/iom4808.h':
    'sha384-ilPItaG9NaZxkw9uT+NCX0tgILgVXmixH1r2GJhqgtEdNig0D9P+4K4GRRiaIUTt',
  'assets/fs/sysroot/avr/include/avr/iom4809.h':
    'sha384-BknWirALVpNsg5yvkNgO/hXZEG/YEUEK9+6DsgXIpNs6lRSn3xqQPEqREMxAISaJ',
  'assets/fs/sysroot/avr/include/avr/iom48a.h':
    'sha384-821/dQBq9GW4v7dVNWJwTGTF4SVBq175WEm1xV4ybHKiMke8xrwkqajHk7DfTRc/',
  'assets/fs/sysroot/avr/include/avr/iom48p.h':
    'sha384-AQZ6hfAf/gpfr5Y99yt3hFMOu8dQiRZEgjjNzumlynUtznAg5id9LWz1LeglkdFF',
  'assets/fs/sysroot/avr/include/avr/iom48pa.h':
    'sha384-kLCn2dWxCUB2QJJXwKpB7GdzRg1Z8aNLj5B5u8/ovEjM1WXzt0omgjSUhfQ3GXXC',
  'assets/fs/sysroot/avr/include/avr/iom48pb.h':
    'sha384-8uNNsnj/yiYPDxQ2abnf96vEK4nhc3V/6SQBrDXhj7FcU53kUL3eWr4ev5MTzxee',
  'assets/fs/sysroot/avr/include/avr/iom64.h':
    'sha384-qKLkp5/YBoEv8LYQD7A0vyGFLAGjNkbtVpYxkV0GQjWP/o+QjS2IygExwIZ08f2A',
  'assets/fs/sysroot/avr/include/avr/iom640.h':
    'sha384-9LxO81bFgaoVAPaKNBr14Iiwsax1umD9I9pxJN9rh7QCU0wespXgj8mRx3sFWLJj',
  'assets/fs/sysroot/avr/include/avr/iom644.h':
    'sha384-bP0AbFTAty8Ce0j8wArCjO8yjAIwICAUvLLvNZgfD8yLPCaJlK31InDrs6ZQn+A3',
  'assets/fs/sysroot/avr/include/avr/iom644a.h':
    'sha384-wB3sWNknpoFH9+VMzgCCNkBBPQfkN+sn10X6gV1Gy/gfPr2u82EU9AH27ImFtLB7',
  'assets/fs/sysroot/avr/include/avr/iom644p.h':
    'sha384-hxXVxruUAWlzKdjhVoZHhRApWR5mr+3m6VUwirdV9h/ikuUk4Na/ywZzbkhsch3z',
  'assets/fs/sysroot/avr/include/avr/iom644pa.h':
    'sha384-JGRiskZ2h/Uzz+P3FcjTb/qlsC0QzODKkrPAhMY3QmHG5CZCDQJH5AcukQsJUGgq',
  'assets/fs/sysroot/avr/include/avr/iom644rfr2.h':
    'sha384-A0RXEUGd5RCFQLbtHLHnCG72rnUTuPsYdnVqhSvZ587QfRN0B4DSLOOflhzLIoHg',
  'assets/fs/sysroot/avr/include/avr/iom645.h':
    'sha384-0k2kaLiKuqOGhljlYo5sG2iqfBtzPpD3z0UXCyLq85eV8qkhbRSjusG3L9FcgvWn',
  'assets/fs/sysroot/avr/include/avr/iom6450.h':
    'sha384-rjnjU0siIekmo8zFasu4rcalmR0pVIWPIXiFc3KupdtGALGi4WWsLo5PjDtSVBGm',
  'assets/fs/sysroot/avr/include/avr/iom6450a.h':
    'sha384-hOiXI/2gTjCNGXVEApeeGMWyyckCsJu2GZr6w/6aCNZNm6YyGKP7XRI3m/a/aiRz',
  'assets/fs/sysroot/avr/include/avr/iom6450p.h':
    'sha384-hOiXI/2gTjCNGXVEApeeGMWyyckCsJu2GZr6w/6aCNZNm6YyGKP7XRI3m/a/aiRz',
  'assets/fs/sysroot/avr/include/avr/iom645a.h':
    'sha384-MUp9x0eCFuii/ARJq6ys3L+tzjIh8fplmb0H36BCAOyy/aPgHeDj0uCNgbhziqUn',
  'assets/fs/sysroot/avr/include/avr/iom645p.h':
    'sha384-MUp9x0eCFuii/ARJq6ys3L+tzjIh8fplmb0H36BCAOyy/aPgHeDj0uCNgbhziqUn',
  'assets/fs/sysroot/avr/include/avr/iom649.h':
    'sha384-pbI7qFuoe0glCgPqIk201En6H28sf8a1e/Ltd4VlYAu7ZRcau9AZpo+fw8nCI2Cy',
  'assets/fs/sysroot/avr/include/avr/iom6490.h':
    'sha384-NuBV+G0sYNEAkrNg5Baput+uAfasB+MAR7mrX49RWPgb+O2++1+6WcaNoVJcPer1',
  'assets/fs/sysroot/avr/include/avr/iom6490a.h':
    'sha384-Z0uM9KzVOwMQInuTE3RWp1Ytb0O81tda6GLEZ/rq0EcClipi4qF6MyGy5FEaN1+U',
  'assets/fs/sysroot/avr/include/avr/iom6490p.h':
    'sha384-Z0uM9KzVOwMQInuTE3RWp1Ytb0O81tda6GLEZ/rq0EcClipi4qF6MyGy5FEaN1+U',
  'assets/fs/sysroot/avr/include/avr/iom649a.h':
    'sha384-j9WSVRVjjO7eT+jc0/fUwegaiYUYbbZkAT4Qi6N45Q05eWMVa297OBQEIZVSFpcO',
  'assets/fs/sysroot/avr/include/avr/iom649p.h':
    'sha384-nCxDpPsB6F4aszkcl0wq4TZ0KQyf7VSIV8AcoC3Idut5c4MNbMbhhfeVHoim9MMP',
  'assets/fs/sysroot/avr/include/avr/iom64a.h':
    'sha384-wJP88YDgfy1K37maggEODdXLGvqMH9kewJ41/VvAjZ9EL7snHLYna95cHVJRV3mL',
  'assets/fs/sysroot/avr/include/avr/iom64c1.h':
    'sha384-Kgl/QGUaXDzvCO+pqbM74YniL+uXV+NUJdzUE7vk//sFEVHQkGB4IKlCaPeSxi2n',
  'assets/fs/sysroot/avr/include/avr/iom64hve.h':
    'sha384-SIuPrhvoIt+d8tMVGoxc//vjXCOWx9TSckGcsDavbArOVxPkZlDnIRFi5xWPvaEz',
  'assets/fs/sysroot/avr/include/avr/iom64hve2.h':
    'sha384-JICz1tabN7dhk50YmnObLz/C+c/I1lI5G0vMijgGRsBGdnPfB1HqnPRbbOjLtcRG',
  'assets/fs/sysroot/avr/include/avr/iom64m1.h':
    'sha384-tV7ejBoCSi025LYuKoe5dGvKDJNgIb9csZMPAox+pBTobTOwyEDpzz6CkBOBKQMh',
  'assets/fs/sysroot/avr/include/avr/iom64rfr2.h':
    'sha384-0EU0mZeydt7ogMzkkjy+6NL19+ifZp+rNLW3CAYI1qOEUFQszRrigflRvufBbWX8',
  'assets/fs/sysroot/avr/include/avr/iom8.h':
    'sha384-2oOETAsbfxn1s3uUcjGqI8NKJmcSX43yTc/QqY0nWrPm9bSWKW07mIEWXPuF79lh',
  'assets/fs/sysroot/avr/include/avr/iom808.h':
    'sha384-OxJr8WrNdpsZoylBpusJnIn+OpAwwZcFm52Ko6vGRZxFIBQ2Z+6Tj3LpSVqPfBrL',
  'assets/fs/sysroot/avr/include/avr/iom809.h':
    'sha384-b4bo8I7gRZF0pkbAh8iTQAP+Nspeinba8IcxYIoZJ9LdD+yZtQ+jeTUkKv2kM4wI',
  'assets/fs/sysroot/avr/include/avr/iom8515.h':
    'sha384-bOHR7zvA9D/M5oU2XxP3k0zBtFwgCuq9yfh7aidecWBux3/x5fZ0mYgrp7oRgEp+',
  'assets/fs/sysroot/avr/include/avr/iom8535.h':
    'sha384-JWfRrSQaqIjNlVGmKYfoN9z5G0M0luN0Ve5Ae0PW0vobZDi3qHPW3E3fhNaC02BC',
  'assets/fs/sysroot/avr/include/avr/iom88.h':
    'sha384-rw804P2nhMX95Zv6YT555PqFyoyDZhqtbJ2BPcRuKVCafWin2X2nMtgA3H0ScPWU',
  'assets/fs/sysroot/avr/include/avr/iom88a.h':
    'sha384-AwxONIpq76RsujCoD7bXPB613POk8GySsmIpYPgIeI4nyXFBdlJVcJCOfWeV04IM',
  'assets/fs/sysroot/avr/include/avr/iom88p.h':
    'sha384-v/WUm6KExlU+yAcx/EO9mh+PWPeDSLznYjoV4UPVzspSxVGLDKzIcAZaBdrn2WgO',
  'assets/fs/sysroot/avr/include/avr/iom88pa.h':
    'sha384-MjxuglCSSDk/nTUihbOsw+OOKM3jWgOTh1JDPQC0f+4h7Gj3D006cdbtW9RsdS9b',
  'assets/fs/sysroot/avr/include/avr/iom88pb.h':
    'sha384-MGNx9W8huOPYer/fwp7GxH/4b/ckYWrtZkdD98ZCGx0hMk20qq7dpKjo3Gp1Ed4X',
  'assets/fs/sysroot/avr/include/avr/iom8a.h':
    'sha384-IWwiyi1n8b7z4TrVyEKB5KPaR2qdkEDuaJwtu8ddYV6VnL2vaukOThcarNWwSAjC',
  'assets/fs/sysroot/avr/include/avr/iom8hva.h':
    'sha384-qH7e8qoH5uUn/MVmlZzpcsF6iBmS0lenRpsymNKHF31GYnEoawCroV3xpOWoZA5t',
  'assets/fs/sysroot/avr/include/avr/iom8u2.h':
    'sha384-qrcI3LctTYLk7qzv0IBv5XgTZYgYVNJqhevKBUizQB9KirV1420jvxXAD6KzCV7E',
  'assets/fs/sysroot/avr/include/avr/iomx8.h':
    'sha384-f06S4NIORZ4XEjiL4Qw7rDMd0T5cxNF3sTOLCiIrpSVnG6AulslKp3QyxiqcUkBM',
  'assets/fs/sysroot/avr/include/avr/iomxx0_1.h':
    'sha384-e+YMX8qPxKLZ1NqowYMrTbEjdh2loPpRPdvRAyb2AMIAL1MToh5hUDJpFBJf6x9w',
  'assets/fs/sysroot/avr/include/avr/iomxx4.h':
    'sha384-eeRWP3x4ywRcHjO9mDCzxZk8Fb2g3uLA5HPMmlVapQ9+DG2sy2Z1uu+0Aqj7K9HL',
  'assets/fs/sysroot/avr/include/avr/iomxxhva.h':
    'sha384-y03KOYzBug7gbfcEDqr/YYd3wGFss8JfERP+HYNPepfk3snQUOYfA01dQLgb6DJ/',
  'assets/fs/sysroot/avr/include/avr/iotn10.h':
    'sha384-N30AqynbZgoKrA9RGA0kBzG2QGcF1RzeLmH4w9SfAwRLbzbaCn7qGS6Utgl1jR/u',
  'assets/fs/sysroot/avr/include/avr/iotn102.h':
    'sha384-b0rLNyWys5+lgDf2OTqkfIVrA0w2qjRPsuQRrNdBWL2gfWcEPadocfZhWBVqlumh',
  'assets/fs/sysroot/avr/include/avr/iotn104.h':
    'sha384-HK62IATqDYDOGI7mDkvGX6ykFXZzMHdXVvhaUN2fnFlgM0lzwAXf3t3bEjNTaHQr',
  'assets/fs/sysroot/avr/include/avr/iotn11.h':
    'sha384-/X4eqRrYya6XdHMsn96uViFMLjeG/2FlwwqNcqD6/RSBvq3eijOQOWiTw6vkwzxu',
  'assets/fs/sysroot/avr/include/avr/iotn12.h':
    'sha384-7AqCLiE3PS0fwkLF5C4NQ5Inf3JO6N83eT7cqwcSiBrxYyTX3lOryCvwEe7EyHwH',
  'assets/fs/sysroot/avr/include/avr/iotn13.h':
    'sha384-t8whvcqIhkb/IjXO4HwhMl5hclHai+7phy5ndd0IKZ5SeIREM73BkwoeedjjOdS/',
  'assets/fs/sysroot/avr/include/avr/iotn13a.h':
    'sha384-RKScRE7t8ucOlvmYgMCfk2v0mdOuH7SMbVaAeuBlf5/XisI5ae27WFCaT4du80yP',
  'assets/fs/sysroot/avr/include/avr/iotn15.h':
    'sha384-H8dwzCTGy6m3jImUDuFhZzvxeaZ2+esA92SBw4VZemXpJZUh8DKqEVvW3ZOMTXzy',
  'assets/fs/sysroot/avr/include/avr/iotn1604.h':
    'sha384-pWb0wz4gqW1z5piF7rv6VskoB0Z56FxDiW53wV4nCnbuYFRFQN7UnmS+81j9Df6B',
  'assets/fs/sysroot/avr/include/avr/iotn1606.h':
    'sha384-O8nrWJxm4phkFHGckRBmBmdSttHAQkW4F8ipKylvIDFvunXVaHRfiGdtnu6E+0al',
  'assets/fs/sysroot/avr/include/avr/iotn1607.h':
    'sha384-YrUm/2h5AhmpivtCEOghWSYyRZWRKLPow+2sYXe9KvjFxtXQJfHMrfPw7faLaDty',
  'assets/fs/sysroot/avr/include/avr/iotn1614.h':
    'sha384-xahm8DaVyux3ERDYJqPViznz45VX3/INR86titqG6YHtxT0fn3xR9zq+ADchdSSg',
  'assets/fs/sysroot/avr/include/avr/iotn1616.h':
    'sha384-CSTnQnhe9PTqkZyMYxgzqXkPcUDCP60wVM/8dm2r3y4xvLwriGHBg7yYgF0xsLhu',
  'assets/fs/sysroot/avr/include/avr/iotn1617.h':
    'sha384-PwV4ltGBhbpdf8VTEErGm+Wh1X4Th1XbkAjqhLmGCAVMrqosiZkpLije0hHJgpAF',
  'assets/fs/sysroot/avr/include/avr/iotn1624.h':
    'sha384-q4kGPMJtONLaF12NBKvv0WqLfu0zQXiXm7iLMABCDEd3sH62yEqIeFYLUrxWXMVb',
  'assets/fs/sysroot/avr/include/avr/iotn1626.h':
    'sha384-WgZPlvG4UgA8yooz1ooxRU0dX8b2Y6RJFYOq0uRMmWVrWevmS04om1uoV4TMr41D',
  'assets/fs/sysroot/avr/include/avr/iotn1627.h':
    'sha384-4sFAG7NV3Jj6NKDP8QwZmcd55bnms+4hgWGkHTs1p5RaY12OmUx3yMA4BnTQmWBF',
  'assets/fs/sysroot/avr/include/avr/iotn1634.h':
    'sha384-5616wDj7S5wFaDpn9pmFpM9kowXJomy4B+qltLduSEtuqdQkYBJzd73zjdNV4TXV',
  'assets/fs/sysroot/avr/include/avr/iotn167.h':
    'sha384-aFes8BRWGY2bpiqaqGR52qfXnwOIti0QsF+ebDmKR4kUckwyEJrlCnhWgamOMN4r',
  'assets/fs/sysroot/avr/include/avr/iotn20.h':
    'sha384-UcIZYR9HWHsJUS2LxAfw6PMQbP/J2Xc8Y4ZWjMvxLfkZLr2C4C9egk+Xl4au3v6n',
  'assets/fs/sysroot/avr/include/avr/iotn202.h':
    'sha384-zOwdglNp80yK1/pAOfac+VlZFAS/MQsi3Gsp1UR6WRBV0kwVN0w7cTsuXquHejLg',
  'assets/fs/sysroot/avr/include/avr/iotn204.h':
    'sha384-tMGRnHuBuH50IIPSg/oXqa8663xFg2VaSeNZGl1dKyJq1UeSuZ155wT3CUfljmg5',
  'assets/fs/sysroot/avr/include/avr/iotn212.h':
    'sha384-5mwl7BHHhSC2I9ODpuCEpwZ7KSXJdYq4MEKV3eZ0RpMyQusB9NVgmDQvsgwJs/sf',
  'assets/fs/sysroot/avr/include/avr/iotn214.h':
    'sha384-NhJIEuog87Rcc3jQleD8XZf3dDB6YTL9+BDjteUE/nB9K0wIaCAcizyGZTdFpWlp',
  'assets/fs/sysroot/avr/include/avr/iotn22.h':
    'sha384-vGt2LrkmppWbJYjYfj+k3JcsrLre9AqDqIKESVaEZMx+fYzJqvbcpfaLpPNHuMxg',
  'assets/fs/sysroot/avr/include/avr/iotn2313.h':
    'sha384-hYBpfhnW2mDrySE7Ee77rkPB9kiO31vXM8cXKhi68FBJZxT5zWocD3dBL0F0mI91',
  'assets/fs/sysroot/avr/include/avr/iotn2313a.h':
    'sha384-8tih2Ja8LG/gLgm3zufOjgirtK8FuTOnOoVseU74S5KAeKNJ/kc4IQZZ6WKd4PzU',
  'assets/fs/sysroot/avr/include/avr/iotn24.h':
    'sha384-SVWtpFh+hX1LjTpiqVQCHfO/8Dxtg2qlmkJBRW1H0/EyJ4si41bGtt1FcYpmOAAF',
  'assets/fs/sysroot/avr/include/avr/iotn24a.h':
    'sha384-WVsPCm8X1TUATuK9vzfQg6Crm/J/pv6We3yuEWL8zMTgx7XuOIpx21p5IrhfmjDv',
  'assets/fs/sysroot/avr/include/avr/iotn25.h':
    'sha384-5PtL4slsDdVtmiwFihJd49GygAVmEPglUymzRKyB4NWi3ZX0bVM/zG7jUou1TwtP',
  'assets/fs/sysroot/avr/include/avr/iotn26.h':
    'sha384-aR2ipVZHosU92smXLkCeWwjUO9gM9iPIpG6143FIyXBufaQ143uW3XiQdHKmCQ1J',
  'assets/fs/sysroot/avr/include/avr/iotn261.h':
    'sha384-Jc0/0OJeqkHt35C3K1GQ5/rTt4JhiKuea9XF4IDLl+UhLBo9PP3mqAc+wLXr/yO2',
  'assets/fs/sysroot/avr/include/avr/iotn261a.h':
    'sha384-2H/gGXeqsQ4jgHHbZI4h6AxbOu6XIFlljllKaV/qIZncvOGg381OeVxzjBVejwsJ',
  'assets/fs/sysroot/avr/include/avr/iotn28.h':
    'sha384-4qnKwylwX9FO3bwHrIZ/hW3TfOAcSEUHFd0Yoqhx1Z8+RK6ULIqRorlLRGWgoDCR',
  'assets/fs/sysroot/avr/include/avr/iotn3216.h':
    'sha384-1gA9AfutONIe97yHdJhlc5jScJY4ZxOlffGkXp2tA6xApX8/BAAT5tNfDt8jIeZW',
  'assets/fs/sysroot/avr/include/avr/iotn3217.h':
    'sha384-+NT5IgsOJGeEJ9hdM1dkWHAG281AcdswGyFur9UanFpysPXB1Y9TLE6apr54g+dr',
  'assets/fs/sysroot/avr/include/avr/iotn4.h':
    'sha384-LKXyedfAzPcjNCbTg46DYkUpt+1fiq9nGLdK9CW/5srq27wP8dY+uFM8w8fJdzhP',
  'assets/fs/sysroot/avr/include/avr/iotn40.h':
    'sha384-D7Elz82yA+LT+CfouleBdt5xvSuqT/0eA/HZbCtfcY1/uV6jqag+JgqCFVO77/g7',
  'assets/fs/sysroot/avr/include/avr/iotn402.h':
    'sha384-ETH4kq8AQLm8NCaoTFqfXpiREoftJ+bFNg3fAvmqfYd+jwQMW6qVf77csS/B4lZA',
  'assets/fs/sysroot/avr/include/avr/iotn404.h':
    'sha384-+nEttYgjBW7QhoaX+91agBSsEh2zfdbQBBGHwDk0a2WVW0dnDz7shHNWc8uJuvM+',
  'assets/fs/sysroot/avr/include/avr/iotn406.h':
    'sha384-asjoYVb27oz/SLx2buEQq/HKR1O+CdUiIBcj6CA3i6n9RjMrWfIlJOO2SLEgchRH',
  'assets/fs/sysroot/avr/include/avr/iotn412.h':
    'sha384-uuFlk0NLc8cvk3q8OJWEhkXV0T0em71HOOwTD1jmNcNY2slaAOGve44qSu6bFA0E',
  'assets/fs/sysroot/avr/include/avr/iotn414.h':
    'sha384-+kv6PGgvqjktBsJxO9RfgAgwJWhh98dDPGuubq/v5H282inBAv7geMzdFtLOT3YG',
  'assets/fs/sysroot/avr/include/avr/iotn416.h':
    'sha384-xmRDI4Dun5rsdyIUpaBgiuoO/DGsaaxaxMMCkan1gWdvg1ruxqss1YiMfLVrp5w3',
  'assets/fs/sysroot/avr/include/avr/iotn417.h':
    'sha384-48fVu/EMSRMNIKsCQ1I/BCIO8JZnIkEg7rIHJ9Nusr2pneSftuUxYfEPJBRVb/IM',
  'assets/fs/sysroot/avr/include/avr/iotn4313.h':
    'sha384-bVd0ViDOl96Sp1n+5/L+LvvS/4giliMPT/Of4WvgHyQ1obCyqkFpwdfbEG6B3sGH',
  'assets/fs/sysroot/avr/include/avr/iotn43u.h':
    'sha384-pZ9xTZs3OFDK4hGAVLkE50PY+ic0nWcIHMPIqoD2R3zTSmiz7Qtx5owz6HpvhaYi',
  'assets/fs/sysroot/avr/include/avr/iotn44.h':
    'sha384-t+pTkwTPcFITA3knZXTVULyI2AKWf434apYBWptoZuqiMejsXcaiQ1HbEgo3fSEN',
  'assets/fs/sysroot/avr/include/avr/iotn441.h':
    'sha384-igteg8G+7QvinrAr4JFg+Gf8Zjc4+8NEIsMe8TYt4gBZ1dbwfRZXwNVU6QvRg/o+',
  'assets/fs/sysroot/avr/include/avr/iotn44a.h':
    'sha384-WiG8hPlvDV9mSoNcx22DQk16PiBr+1sU/KKEYlGxlTKaKXN7D9JfNrCYuHUP2AxA',
  'assets/fs/sysroot/avr/include/avr/iotn45.h':
    'sha384-9btMzBbwz20rrvIRHVATlbAA/i1OxGhJhki2izucCXGfd4Eo38aDMdASHvpI8l17',
  'assets/fs/sysroot/avr/include/avr/iotn461.h':
    'sha384-fBY2cY9iptIDo8seCPwhx1Ng2xtNV1LuPGQ775KKrRnK11DW3oesRnZOiPypdWMt',
  'assets/fs/sysroot/avr/include/avr/iotn461a.h':
    'sha384-ykrvbf2G5n7jstbtWP2GrCeXha/ENCiAAYY7i2/Zc5gPgn/wv7tSmgzSGsXhLfmY',
  'assets/fs/sysroot/avr/include/avr/iotn48.h':
    'sha384-Rvwoikgt10oe5LWq+4KakxpceFDgFCoRYq1sEbu8bU3SV00xk+EfAG/7dTksKMqv',
  'assets/fs/sysroot/avr/include/avr/iotn5.h':
    'sha384-EpTeNQGntDlCMKjNhwcFSfiYtYXfFVbJDvRcu5dHkgD/R1qz5xnmg2zwiRqH1WhL',
  'assets/fs/sysroot/avr/include/avr/iotn804.h':
    'sha384-FuxPxMA8RPNNhDO3iNC5OSkQUOlPnQCWvxVqPGLK5WO2+wYuCPsuO5J3oqBJCWKZ',
  'assets/fs/sysroot/avr/include/avr/iotn806.h':
    'sha384-J3KAHLuUtJnjVHGhiuEha7Dt5mTiQFhRQwhOQRataN6GGJVz/V8s1BaRlzMZd13W',
  'assets/fs/sysroot/avr/include/avr/iotn807.h':
    'sha384-5fgstCTDMeKyelqy9Iq5FCji8JoCSewFDqVW7ySzg5dsHEmQDkMDb8hcd7ouv6dN',
  'assets/fs/sysroot/avr/include/avr/iotn814.h':
    'sha384-w+E3DzMUss5aKAdp6+dG1CBhEAx7XBaCM6rnjyKnRgpKfjWJ2YTfo6EVIo0ex//7',
  'assets/fs/sysroot/avr/include/avr/iotn816.h':
    'sha384-7j32Dr+MXEcSbxOpYj2p1WTai3ZshXAt/ZcgpvmbU8buRl/gJcWH2i2bE5UJtDWV',
  'assets/fs/sysroot/avr/include/avr/iotn817.h':
    'sha384-5M302gfi4k1q5BC37dsHZzbZzUvYCVcXd25Eqxj7r7XykX+/BmeIzlzC4O1qR60R',
  'assets/fs/sysroot/avr/include/avr/iotn828.h':
    'sha384-jMYOTL8RkEOrPq8p+vsY+msVAHCjXnp/3AMJqwOq4iZTplZ6isB2EQat9PDpdKMj',
  'assets/fs/sysroot/avr/include/avr/iotn84.h':
    'sha384-k2ydvqRgMZi9O70hw0neW6SPZopWWRuEarlI88Bney4DtSng7MZw8BATv3fTx1Ee',
  'assets/fs/sysroot/avr/include/avr/iotn841.h':
    'sha384-Pj/CWVQw1H+8h4l6R7TRzjv8pvn4qik1dSpZ5A1cMXJ/e9sBKhpTuDVfsV5J01d1',
  'assets/fs/sysroot/avr/include/avr/iotn84a.h':
    'sha384-oByejIWGlo/Nk0ob1C5b4cNIa94s45oGRWgO96k2WFcoGWHamTA2ikklXM7cowF7',
  'assets/fs/sysroot/avr/include/avr/iotn85.h':
    'sha384-RBgtaWrtZ0Zj1F73iU8HeBTfg1PlxsfAc8Lx/lnLfNYW2wO7mg9Tr9hpEsnODumc',
  'assets/fs/sysroot/avr/include/avr/iotn861.h':
    'sha384-7TRVpMSZJxw3V4SFOO3DuRJc3NMGqif5g0RQFNzJN1AEMGCRGlQnJ+Q6la225bXM',
  'assets/fs/sysroot/avr/include/avr/iotn861a.h':
    'sha384-1Hm5sU1ghS90VDEtpUVf5h05kHohnKsQBAsErqwX2wZ95V16ij7ztdobMwzgDn9H',
  'assets/fs/sysroot/avr/include/avr/iotn87.h':
    'sha384-KyZ55Zn9jeVoQb4wYeYJiEtgeappN2LhLxzVkWwOkZRMFbH4BBNvdZNvupYL8Nt8',
  'assets/fs/sysroot/avr/include/avr/iotn88.h':
    'sha384-eXTP8m9rSNv8K1fTiorL7VhT1qilofJgeFDAosBnogVX4ig+o68hVAU7Kl80b9Nq',
  'assets/fs/sysroot/avr/include/avr/iotn9.h':
    'sha384-VuA8FyhdIZmtD40m3s0VcGxVw3qfJf3yMwQkiY3x4wSThZEobOrypBO4Sx+y+/d+',
  'assets/fs/sysroot/avr/include/avr/iotnx4.h':
    'sha384-cQIkQltYN2Dyd//Z6hYSFatBNfhV5aWyZDHoLXny0ThZX8t0BswVkBdTTk4jM2Mm',
  'assets/fs/sysroot/avr/include/avr/iotnx5.h':
    'sha384-9WDbmEBnI3h3YF9rbCqSQLg7sb5Di4hgFUgtyGMwAcQmSbZr9gBBZxSLxje1Y2mH',
  'assets/fs/sysroot/avr/include/avr/iotnx61.h':
    'sha384-E7lnkcFs1LUbj5jACXBhIiJidw612MlHFb0UsgOOf2btafZAMqLoawXjs+VlIX5O',
  'assets/fs/sysroot/avr/include/avr/iousb1286.h':
    'sha384-SkXQoX0PhZoHSFHS1yw+Ott/RdV4IN++tSAQX9LnzXFoNI2j+raMFMnV7eDX0Gus',
  'assets/fs/sysroot/avr/include/avr/iousb1287.h':
    'sha384-M4XHiCN1nMFTQur24gkW4WdeyJ21haTVByI7WZ1zyWo/0RE2tlDBJ4kaQsw9kkTW',
  'assets/fs/sysroot/avr/include/avr/iousb162.h':
    'sha384-sZuQsFkT9oxCITUA4ja8uAJsbrS19Fsgj9NB2uUeHN1b/vjVzpwzZfMag3XOouRl',
  'assets/fs/sysroot/avr/include/avr/iousb646.h':
    'sha384-Q4Qd7zYjFprSygSp2flUedfujJtMAzSObkV9xsd5p3IjZsJd6EnJEOQzgvK3gkXp',
  'assets/fs/sysroot/avr/include/avr/iousb647.h':
    'sha384-0CX9npIKfPDzMyktRAk86nlsMzhkSxI1AWDYxLvVUQyuKYPH0y4wltnu1YLmSCRe',
  'assets/fs/sysroot/avr/include/avr/iousb82.h':
    'sha384-jQJgJbh7epbBhcR7Taz69sKOa+jeKoasZ3HdEMB6osTkCkOr8uCE3Wq4bTJA4/7Z',
  'assets/fs/sysroot/avr/include/avr/iousbxx2.h':
    'sha384-pt42YLuSBK9R7iXqNK6bl/ApiYmw22zXyX9WlcqRzOe8mU00s7rM1hBS/FfvA8z7',
  'assets/fs/sysroot/avr/include/avr/iousbxx6_7.h':
    'sha384-rrnQmyNT4txdD1avPyt6KOfGwYVci94AHQsdVo+47LLT2Kit7okRNh9kTwaxhm/L',
  'assets/fs/sysroot/avr/include/avr/iox128a1.h':
    'sha384-MYTmtWfF3lfaWYpYxuvIjBfeT3Rh6Hj4yult3erwiTlVnFA2Isvn6SrUi/2fhEdQ',
  'assets/fs/sysroot/avr/include/avr/iox128a1u.h':
    'sha384-gV1mpLsvFx9ay8askYurFkoxnifacpKGNy+1xzSa9KW56WqDqSGh40C6tGInMU6K',
  'assets/fs/sysroot/avr/include/avr/iox128a3.h':
    'sha384-rQkLAKnW3mbfPxaT6ZEiJut3mc86DLdTR/cq+S2fip4721RyP+60Dx3ejh5KwEqi',
  'assets/fs/sysroot/avr/include/avr/iox128a3u.h':
    'sha384-WNnbKM4Xm9ROW2YQ9AkN1l++w4V0UyKUP2A8U0/ywmyhkchxQ9DAyu2MGQtSajJh',
  'assets/fs/sysroot/avr/include/avr/iox128a4u.h':
    'sha384-8e5/36bQiaAsEdbTDu9fEJAziFRJbt+s+iPVxEpwsSQgCjemoETlistI26iOlJZH',
  'assets/fs/sysroot/avr/include/avr/iox128b1.h':
    'sha384-nEyhoV8TluPmgmInRokn7+lYHEfwdUE/51wckLrvyhASQFyXj7kA4P06dqzrQvJS',
  'assets/fs/sysroot/avr/include/avr/iox128b3.h':
    'sha384-exxYOuu8/+iPGWgziQw8sT9A9+QRT8FtiQ54UTHN9z+Izp7GqApPZM2zSFldWaiF',
  'assets/fs/sysroot/avr/include/avr/iox128c3.h':
    'sha384-cd5YRH+QC+8axXLaDZ+2pc+aSSoNcp1ZUfHX86J1a0+VT07mUEo72wbRdDaZPaRI',
  'assets/fs/sysroot/avr/include/avr/iox128d3.h':
    'sha384-oVNZg9GfcRVV8bqRpWs8GXSY89LQSXOmTBqvvdNx89pYgki7I4cbYcP+yFRF1XT+',
  'assets/fs/sysroot/avr/include/avr/iox128d4.h':
    'sha384-EASRKGKyTEqb2MUjmpnIMC9UMwqARod7j0BhgCIMXVBjAfHn5NKHOk4nnRtPr8T1',
  'assets/fs/sysroot/avr/include/avr/iox16a4.h':
    'sha384-Yv5zlJpIfyoZqzFxYmVFJcUk6P4Y68zZPoh994e2WgUXV+RlQjoVc+PhyPK6EWvL',
  'assets/fs/sysroot/avr/include/avr/iox16a4u.h':
    'sha384-NjOUw2oqvS4KRILDHZiU54DrA/vv34DKRV8kgucPkN4AlqUo8gO843bnePMEj8NI',
  'assets/fs/sysroot/avr/include/avr/iox16c4.h':
    'sha384-6tLAeedktSZ6WMfYexTc/xS1VDQV7wsrWc8OQ5azlvBeXApnINdDUVcIH/ByKsUy',
  'assets/fs/sysroot/avr/include/avr/iox16d4.h':
    'sha384-I59szfAJja+dQOZc4iOIudLeb7PD1Hd5VIUSaxOXZQ/VRsIlGVLE6XxQ874LBYO7',
  'assets/fs/sysroot/avr/include/avr/iox16e5.h':
    'sha384-m1Nj86p0CQIsTkMymqi6daFiWUacp3inyHbnnv/zbCvB1PNZmG4nZgS/HDeHRVQy',
  'assets/fs/sysroot/avr/include/avr/iox192a3.h':
    'sha384-ZzDYdYgJFYHhr8g54TAn9Was3KNgKHlq7XJauMbDdGnlgWYsvXkLa5mWOIDEMKad',
  'assets/fs/sysroot/avr/include/avr/iox192a3u.h':
    'sha384-U9/eCko1Tg7UxolV8E464Orxh9K8NjPfucKtbCeWRgpyV+ku7TENWPztUZGqQaV7',
  'assets/fs/sysroot/avr/include/avr/iox192c3.h':
    'sha384-TK6Yl2hstaViD4cvq//PfCfrvDX5LuKOTliFXS9MzTO05o9eF46lF1xPh+tFWHIL',
  'assets/fs/sysroot/avr/include/avr/iox192d3.h':
    'sha384-/LFnF+9JxUfdzp15O8rkPP8v9BgPeQO2QDtAhCuY6+D8FRNYl7fTVbBqGC22xLRq',
  'assets/fs/sysroot/avr/include/avr/iox256a3.h':
    'sha384-alfZTC5SMfH2xFvYukYdKumSkGO9DnlFjoOpnZ5aC3T+KRNY6S7ICL0qH3AViQuD',
  'assets/fs/sysroot/avr/include/avr/iox256a3b.h':
    'sha384-Q9cNj1KGI1g8/RkvXu9Muep4bgKV9zepbtQSUkqs1PPhuph/m27+wxtfH4Vl+xHa',
  'assets/fs/sysroot/avr/include/avr/iox256a3bu.h':
    'sha384-DZQrfgehzMXypaf6ncZKOFd/AgDe3mD3KKKl7ahgE2Sc4JcxmGHs9Kmv19TJLgpd',
  'assets/fs/sysroot/avr/include/avr/iox256a3u.h':
    'sha384-UY//4JoLj+EqZeZNfzPStFq9E6hGZpbF5m4MjBdVmv60gIc1gjKAue93ApdtUK+F',
  'assets/fs/sysroot/avr/include/avr/iox256c3.h':
    'sha384-0FROb0H4N8khKdlLmuKyprnEp68KZvmmOoTw3KKKgy2eY3m6skg/a2eLw540jMD5',
  'assets/fs/sysroot/avr/include/avr/iox256d3.h':
    'sha384-88PP0Tetu5JKXVPfRUH7ke8JClh0a5n1UHFA+hiJwdW9Y7qs4WYat5PDwL33ntXz',
  'assets/fs/sysroot/avr/include/avr/iox32a4.h':
    'sha384-UfqrBld//dnnw1px16qxszFhQnjhbo7yg2LgTU61EauD3ArKt7ykvy0NOzT40Xdk',
  'assets/fs/sysroot/avr/include/avr/iox32a4u.h':
    'sha384-brtBK+4tyrDgfLOMIe+457AOl0l6Kyz6vOQQ6V41x8Axop7p1eDsyu0GDuVwGn2P',
  'assets/fs/sysroot/avr/include/avr/iox32c3.h':
    'sha384-lU9yCoa0ZvBbeUyLZsSICVb54zAa1LjB1Gl7tD8s3gwoMoHNvYBags4sfQikZgac',
  'assets/fs/sysroot/avr/include/avr/iox32c4.h':
    'sha384-r81zBwCXSIE6IzcB4y9kl8X8bDVz3FU5J2Qb10b6ukqYtA/U+HVKIGxWxbh95hfT',
  'assets/fs/sysroot/avr/include/avr/iox32d3.h':
    'sha384-kLA6QEjh3bjLCvPZ21uOHMgpElGIw7Nop+mOO7MJRMsJDhVom3ATZOwvsrFT6PCD',
  'assets/fs/sysroot/avr/include/avr/iox32d4.h':
    'sha384-hSx7JQdwb6swKjjo8RQyF7cWUWUooYaleYbF7meDsa1g1il25T9QYwa3LhXS7E0a',
  'assets/fs/sysroot/avr/include/avr/iox32e5.h':
    'sha384-iUPXboqijt53hXgpVDrEGSqEIbE8vMEFKh2McqKaCDGtigkA88xRVlHBUmZ2SSEN',
  'assets/fs/sysroot/avr/include/avr/iox384c3.h':
    'sha384-tgDe5rgJEXHaJEWzpr1nMdYUmvN/XT2DiDgya5GyBwASwyPF+7dcSCRuY465a6xi',
  'assets/fs/sysroot/avr/include/avr/iox384d3.h':
    'sha384-Hhe2FGMM3hLMuChs+IkRJt43DL20wYc4o/97xCI458daXW2FAYIPqGZck1yybxmj',
  'assets/fs/sysroot/avr/include/avr/iox64a1.h':
    'sha384-mZLmL64GdM01v0IsRNlWpUZMRi4dYlQtghsZ40psI8XV16OcpcNEzXQdcm+ECZav',
  'assets/fs/sysroot/avr/include/avr/iox64a1u.h':
    'sha384-JGgGZ4V+Iy8ZT3Rwfc7/IIvu22HIDGSW+a+47KKRZerxlr8ldA6I/x8/RZWqZY3A',
  'assets/fs/sysroot/avr/include/avr/iox64a3.h':
    'sha384-fdrzwdPOL2LbpVyDs/U4gGXqbX8GztwFLU/pWoewJk90i97+jWpVHlwuMG02AwWR',
  'assets/fs/sysroot/avr/include/avr/iox64a3u.h':
    'sha384-fpQASvKEcLSd0hHv2NfkUjTTgtEpHcMwL7QT5DkNCcCAWKuyjV/O+XA/67AbzDEN',
  'assets/fs/sysroot/avr/include/avr/iox64a4u.h':
    'sha384-otqf4qWHAsTZz/LPzc443lAPLzMX+BxbPFgAQDU8f3YLZzzQVvCn9wXBDl0PTQnP',
  'assets/fs/sysroot/avr/include/avr/iox64b1.h':
    'sha384-W8SvUceByQAIupVfAaMLBvidhkSHxj0a2YOw0vXGZiY2YWTr7bR61+y946QpzseT',
  'assets/fs/sysroot/avr/include/avr/iox64b3.h':
    'sha384-qA6olQON3f4vmoK/7kJa3HV8ylO625Oy2m2XS4a0521kyn0SMg5tnN1ojwH5QkYC',
  'assets/fs/sysroot/avr/include/avr/iox64c3.h':
    'sha384-M7x4CbaRLQZP+Ke/JBM330WoWhzp6uOvNzPjjjRysaCALGH1IaNTfp3mEH5jIIvI',
  'assets/fs/sysroot/avr/include/avr/iox64d3.h':
    'sha384-81ZoYsmZT/FpY3fTMer2TKOYOgLMc1W5ut7NZJfSu/dDJciJP148tsjHoUtNZD8X',
  'assets/fs/sysroot/avr/include/avr/iox64d4.h':
    'sha384-rAUo/YGZrkBfq7jmCiIgrG/rrc4XEBT0yXsejxzxRYjo4w125m7CpyCEomFObXep',
  'assets/fs/sysroot/avr/include/avr/iox8e5.h':
    'sha384-Z/MJtD3ypeV6klXNBPM4XzCW50sUiypvr5yLk2OuxujRnexbPelVmtKdtKYM+3ZJ',
  'assets/fs/sysroot/avr/include/avr/lock.h':
    'sha384-8BJxkHr7w30qYafbGxW6pkozy6XzpcmFQStwNCR+sUF35oN6F56uQMnymURRh8yj',
  'assets/fs/sysroot/avr/include/avr/parity.h':
    'sha384-wqUlaFm/hb7BHOpk4u/SVrg9YPdHtwlvMn45KzyrtXajRBJhid5EIIo4EBHA6qwe',
  'assets/fs/sysroot/avr/include/avr/pgmspace.h':
    'sha384-w+rLOwkC4zct8r7FB7+jCmptr5UvFD1vEhvLHHV8SNbHasqlQzZ8uf84oifvgrkh',
  'assets/fs/sysroot/avr/include/avr/portpins.h':
    'sha384-oqXwQ3J00UbqSxKzn+QUE+7bJ9sB63GnFhDeQ8Gr8YhqkktGHCR93OT+O7FAvY8x',
  'assets/fs/sysroot/avr/include/avr/power.h':
    'sha384-3rNVpwYonrVjXQfZwk6yfd+CNMAue8XeaC5oDduVSeIMmDz2Vg4zSwkJTUPjBe1f',
  'assets/fs/sysroot/avr/include/avr/sfr_defs.h':
    'sha384-sP00yERIiH/ywiOFT4xloJmM3mE2ZwtXZuhjpaxX3b7os/p+7m4divl//ZhcfhrO',
  'assets/fs/sysroot/avr/include/avr/signal.h':
    'sha384-P7iIcZ6TNIqTgJSNtnjAeHGXzTdoEErSGqBRoqGU2Jyzoqyu/aRyhJb8vfHCw6i3',
  'assets/fs/sysroot/avr/include/avr/signature.h':
    'sha384-jSwkV7S01OlaP+JmB/UwvALPzQGbTSbGuRgUJu1ec66BttO2RLVOWcDWVm/B89bw',
  'assets/fs/sysroot/avr/include/avr/sleep.h':
    'sha384-hxUdUjTzr2uP6j7btriSV95RnibOOA9Y/VwroJUGStqYcsbC+v/1Vmm5XC56rihH',
  'assets/fs/sysroot/avr/include/avr/version.h':
    'sha384-O3r3Xo1Oz3fFeIpF7tEL+KSvPtjVxFWFquPBe7hAzd1n/ZQmbsWt92mCFYSrGVRo',
  'assets/fs/sysroot/avr/include/avr/wdt.h':
    'sha384-J6PGt1UpFxz79N6pw2dgzjkMpJANZt21xUSEDrjCyaWBaAZN6tfP7Ij/DqYCJAgJ',
  'assets/fs/sysroot/avr/include/avr/xmega.h':
    'sha384-jFPC6FyVWHu/Vko3JzposVFRGfgWuRTMDZqNR0kkI+wUDeA8gPWVoEpUDHs4s05n',
  'assets/fs/sysroot/avr/include/compat/deprecated.h':
    'sha384-E9mXMPiqCAUsVCs+/Alaw5E43UbFsmPRCNPf4eLx+rnUNpVhkbx6gP6XSaQKyp3a',
  'assets/fs/sysroot/avr/include/compat/ina90.h':
    'sha384-L/FrH3AE8N8Fn31A1bNVplTvy5H1uZ84yoY3eVisjih6wvFrf+qBNGDRgLmfPSB1',
  'assets/fs/sysroot/avr/include/compat/twi.h':
    'sha384-Lm5ARyOsiNlRWKmOgJYd00npiBKF1RgDwpn00Hp/MQgeymmkF01EaUTCJ9ojDGhR',
  'assets/fs/sysroot/avr/include/ctype.h':
    'sha384-A75ChM/bzwqBTxM7AbnlK8Dqk4xKwDkBGPKGZZPkBV9hkw6lutGwykflnlCMD94w',
  'assets/fs/sysroot/avr/include/errno.h':
    'sha384-FRq56b//t9dbHVFKP6owkzpbXJEeF4rU9Cv1/1AqIMjW6wZciiY8qc5/y/IBkB28',
  'assets/fs/sysroot/avr/include/fcntl.h':
    'sha384-OtByj6j+Vq35MjQ3QTU52lncz/skCosGkTvk+l6dtVHsRNXoHSCBxE/km4ijlCbQ',
  'assets/fs/sysroot/avr/include/inttypes.h':
    'sha384-9oVxCDMskDMmAZxiWuC3foJYOF+lGzc2ihdgiG0WumJ3jDgr6FwDQrfdNzfgfMsb',
  'assets/fs/sysroot/avr/include/locale.h':
    'sha384-iYRtp5a7185HSxbbU/NEfLAW05IUp0Cb4UDNdghF3LROTcN6pOwk3rGLxD64D9VC',
  'assets/fs/sysroot/avr/include/math.h':
    'sha384-dMN9skF34Ffgjwps7zfD2AuE6+nuPm2cspVBCtMuaRElM0VJBX6zF8+JYeMRUwG6',
  'assets/fs/sysroot/avr/include/setjmp.h':
    'sha384-PqpH0cflZ+r2rlTW8OwAwCycKP5KfBE/mNq8HIOSnfi93vqAUrpME/ncaiaCLqH6',
  'assets/fs/sysroot/avr/include/signal.h':
    'sha384-xaUeH4N5E3aIJnV2tPJYibYYXp+ZsdNx4aL04SRBb3hsc8/85d4kQRkXOkOONyVn',
  'assets/fs/sysroot/avr/include/stdfix-avrlibc.h':
    'sha384-Eajy3dK5rFfKdIcTC1lwIJfoNjib7hVj0ugXDx+6Ef88S4JnkXMpRK65R8Hz8KYu',
  'assets/fs/sysroot/avr/include/stdint.h':
    'sha384-UwCf/qNEqhW5k5b5SdLrbbZJ3cuP/JYPxMDJzHetzEhAvD1AwGZyOPgBetUEVJgc',
  'assets/fs/sysroot/avr/include/stdio.h':
    'sha384-sP1MC3RL52Jd+m0VA7JH9OiyKCGuJcVFJMtTmddpU/pjFyF48IkKfySrelzLkyQe',
  'assets/fs/sysroot/avr/include/stdlib.h':
    'sha384-HxSDrvBrnEkeumQ/5nwtBqvSVE4NimXRk7t2QUbr5VQ4ostoUrW5djLEHU7QsdR3',
  'assets/fs/sysroot/avr/include/string.h':
    'sha384-QZb/JH4ocKF7/5DrpCMh8tsuQPhtaxN+uuv7j7YBOEfb1cuNAt+S2l0vI8B+FIKd',
  'assets/fs/sysroot/avr/include/sys/types.h':
    'sha384-fre7MA8caa2IefFEbxYQT1IUz2d1DMHo3RZA14HBARuorn+ffpc8U+pSSnbx8wF1',
  'assets/fs/sysroot/avr/include/time.h':
    'sha384-5dNk5ZqxAAhwrVP/GbbDZYxpIUDDMf60jn7OqQbx42OJXV+q/Am5QyoBrO1+bJux',
  'assets/fs/sysroot/avr/include/unistd.h':
    'sha384-6WEQX7eWr3YuQmaO8GKiEvivdqQu6PjP3oCIG65O3W9XZk+Lz4/4W03uKrgoNxus',
  'assets/fs/sysroot/avr/include/util/atomic.h':
    'sha384-MV9IAldPnPQdkba/14DJu4NtKMo9AUZg7frsNf9abOKsBx8clzRKVyfIpLmvDnN+',
  'assets/fs/sysroot/avr/include/util/crc16.h':
    'sha384-LEe7zt07cf+sIeOGsZn7TbrIZN6eXYo7ggt2hufm4st9/KMvrIy279qrGjNNGJaY',
  'assets/fs/sysroot/avr/include/util/delay.h':
    'sha384-dWB+t1Cq1hVLxH+zb6B7gDtY+v0FHpI37RrbpGmeklfPuEpxw56o/tqq3gFiPhN5',
  'assets/fs/sysroot/avr/include/util/delay_basic.h':
    'sha384-71gFje6f2FGlYbskDmjZz3+ZWoj/T+1Q57IdLE7APYdJGRG5UJ2Nco9xJNvbsYY5',
  'assets/fs/sysroot/avr/include/util/eu_dst.h':
    'sha384-IRXHdkgU4m8Wrb63sTCWQvgEt9fbRKUdRalEAsmGvkviqT3GuSCbnr2hdlvKXqlZ',
  'assets/fs/sysroot/avr/include/util/parity.h':
    'sha384-9tn28hd1gNS14VX2lf7VcpdZKB7ReJoa/pgqi7votZNcjiafqpiYPJwUlxZXUWo/',
  'assets/fs/sysroot/avr/include/util/setbaud.h':
    'sha384-S0/prTImY1WfIC/dyTUNeJYp3Zh4aOdnFBHIB1ox9oQqtSwv2rPOyIOWimoyhL+M',
  'assets/fs/sysroot/avr/include/util/twi.h':
    'sha384-DEzeSNl6NPUokaxE4TYFr8ea+NceRyDrpfThsuoT/RPmkNW5WOlsQvFrfR8Nq6jD',
  'assets/fs/sysroot/avr/include/util/usa_dst.h':
    'sha384-27XpQmcSiyW+6r7aHONhQY06ohk1xF0qTXW1A1BNsQOaT1zRH2wPpyKjk/JVmJHv',
  'assets/fs/sysroot/gcc/include/float.h':
    'sha384-xWEear9rXQfTuUjzDV2jiYlqfsQs3XN8TpUngw/EHfpvYFCi6PlKYw1ySK9dB5Oo',
  'assets/fs/sysroot/gcc/include/gcov.h':
    'sha384-AiezyRSjtDx7/9rofZ0BjZMH6uoGglcFdLXLIZZbn6KmHk9xTUbuA0ng3SYgwTIJ',
  'assets/fs/sysroot/gcc/include/iso646.h':
    'sha384-LtlnV0vuCglYIQmp8e9W9sAZai2WrM25TyeFVtZTEWx3zLvV7L8onHBNz6Cr51sd',
  'assets/fs/sysroot/gcc/include/stdalign.h':
    'sha384-j6U0oiDdZGi3zxxeKqaL3pgk6Bpg0pWIS4l7Wb+EpzgsDL0+p/me5yDFywwy+F+5',
  'assets/fs/sysroot/gcc/include/stdarg.h':
    'sha384-dfWSOJCYsLefHCaQUgWEZrf9QstRfdqUrBQrutF0eDpY28qSge+K2qnQJNoUeTHa',
  'assets/fs/sysroot/gcc/include/stdatomic.h':
    'sha384-3PXLdZkr2Xu2bog/xO38jpco5ReMp3csIxrkpJ3Se5EaqVwHc/Uynq/LRZExW5ol',
  'assets/fs/sysroot/gcc/include/stdbool.h':
    'sha384-c8Eub+6wrn8KO511o0hJ77oM5idtlKdZ3l9CAYWNbBCaRInzodjrTZ96OYwey2zs',
  'assets/fs/sysroot/gcc/include/stddef.h':
    'sha384-otZFRV0zmAcG6O0Blo1BrJ8NfUqZ7+NrtIydCEbgcl2HIRN2lW+TyTotjhrYx5jp',
  'assets/fs/sysroot/gcc/include/stdfix-gcc.h':
    'sha384-G4Z0Fp60Vl4Xa3vVtNCUrHX1stVnlB77wwfY12XFqAVviydwx/Y/TdP9nhwnuj1h',
  'assets/fs/sysroot/gcc/include/stdfix.h':
    'sha384-F2qH40E9J698j+eVJO0FSKiGW8tPmwuaFR2NbXQ79kwEFo8HUZcD9GOdqIzLoRx5',
  'assets/fs/sysroot/gcc/include/stdint-gcc.h':
    'sha384-pp8XL0dYVAKcuVgkG387G12Vm9dE/1DESHHpJmdNWk8F9LKK2dbVyjG0wa0FgRL+',
  'assets/fs/sysroot/gcc/include/stdint.h':
    'sha384-IRlLGPXgMqoFd2cXDLoqbON34LHX+jHDZI3McpOuZVWTKuf3jrpzTxHxRRRfWG3w',
  'assets/fs/sysroot/gcc/include/stdnoreturn.h':
    'sha384-2kVM8H829oVChMw5SP9jn7C9jIDuHNw1mBCFCeqiSJpI/gKMb6jAH0Mug50EmPSY',
  'assets/fs/sysroot/gcc/include/unwind.h':
    'sha384-jAJfp5/Ed5xAvMaVhrbbu1zita9eTr2mLHCJGlFesbwM6nYDqHo/XizKTvj6ojQ6',
  'assets/fs/sysroot/gcc/include/varargs.h':
    'sha384-WZIwoXA9ZiGc4fI0LhXdY/xiCQC33Yr1qNwkMUQQOrMyGgNJgxZyNyp2+SpXOynn',
  'assets/objects/core_abi.o':
    'sha384-N1Ld3SmYcNS2vkJsVRkcCSAOe5Q8lircQGRGClznRZ5HvAcgB2JNKrDju3PPcngk',
  'assets/objects/core_HardwareSerial.o':
    'sha384-N9GbmFm5gg0MffM1kHjE8ADwOr0QFhmeO/xd+ynegZeKkqyOcduhXkmZV351RDv5',
  'assets/objects/core_HardwareSerial0.o':
    'sha384-qb31q39PwvuSAtm5gFpujEugFFBuKlISM8t1ra+XX/2UdbgnwjczT4VAO/3lR5bV',
  'assets/objects/core_Print.o':
    'sha384-VFkjiC/z7FEWSJ2bFXj9OcgfGNWIyqcjJ9v5Qjc0Dz4WGwslqTUrUVvFpG7KAjxf',
  'assets/objects/core_Stream.o':
    'sha384-WJ4XI0Tup0NsUVKJnS76+A3ehGDRyvowrIpEDi1sS5P694v6g2pGqiRfdg5sTekk',
  'assets/objects/core_Tone.o':
    'sha384-erCzT0YjCv1TPJQTEVXv4PQQNELXnf7tjKuyt512AHaoqtIuS+FVg2/NYuViAOUM',
  'assets/objects/core_WMath.o':
    'sha384-g9uVVzg98Zijkgww73Hs2N9aV5ybHi+x0J7Kb6HNspF2xMlHe1i+f3GbbW1rCh0p',
  'assets/objects/core_WString.o':
    'sha384-RlFc1GibpRf3dB4M2AdMz9eCbRxqyMvfPCQgJLY4D9e88z46BTBX8jhuCP3QjebO',
  'assets/objects/core_hooks.o':
    'sha384-m7TFLSjgYPVSEOBDlsj4pWH50JyoNCYE3sfMNQTS/PbDfrvId/NCGpJGW09JfM/3',
  'assets/objects/core_main.o':
    'sha384-rMr0MuZp6V/p4upTbUxH2qnfEZYaGsneLhthSm653QLcTblX9MDLXKo6i/QJvk1b',
  'assets/objects/core_new.o':
    'sha384-utPG7FjUjPr35zU2SaObaQf7wHkgk3+3nf4x45uj2ik96v9cLiFDgzy5+gXtH7ws',
  'assets/objects/core_wiring.o':
    'sha384-oNntK2bsN6NCz2hIpcPjwt435iLmiHXEwRbWz08KMkx+nDGApFZWENGV74Fo78Mh',
  'assets/objects/core_wiring_analog.o':
    'sha384-9SbhsO3efDnUnFspsbHnP6u25gFuhxZF5A0s52W9b+DegOaHSROZ+NFEAO768KOH',
  'assets/objects/core_wiring_digital.o':
    'sha384-PrklucvCq/C2xhrmpuNrWwNI+tDhgQQUcfJOBDEZMo68oIwYF94riH3rrTOvOlLu',
  'assets/objects/core_wiring_pulse.o':
    'sha384-hF3N4I9QxBW+2VrXaaDlup2OYSfeMnX9HlLFxjjGFvqwV0O06OXD2pB6nFFM0bfe',
  'assets/objects/core_wiring_pulse_asm.o':
    'sha384-nf6WCY2Ns1MtxTUCCMnqeCYSFmmSaGfi8ifHDkOMpmbYmbEcsO5173OQHlsemEdy',
  'assets/objects/core_wiring_shift.o':
    'sha384-aNCtDR4kss8VzLJyKIomZnxmGMbqy9HThqoDUDpKaEoaW0gOghgSMw2SgQlFOLZr',
  'assets/objects/lib_BMP085.o':
    'sha384-Ijw8K7/OsjiWs+QiEyssm/0A6wP/yfFzM8RuGChhP1BkFmBSa3Pdrp/8z8IEikmd',
  'assets/objects/lib_BusIO_Register.o':
    'sha384-cX9NBLB3YITTugFhazP64oOgvWq7BTMS+mXXtlog6omGvVxQVokMs1lMEZs6NZhD',
  'assets/objects/lib_DHT.o':
    'sha384-tvW8MAvgNy+uurqPFQp9K+SpQL5+WdngCcDq/1qdnkg4quua0PmD6mZmidIU9fcd',
  'assets/objects/lib_Firmata.o':
    'sha384-4ROY7wxWSltR0SyT4rseADaz6Mal7R78Q0hB6894wFNvax9/MXqnvV+nbl6nykDW',
  'assets/objects/lib_FirmataMarshaller.o':
    'sha384-GJ3/IVnjxxY8RFH7tLq39hRQBrs0DTMbu7kdrV2cmPdJB2PiQOsIDR3213RcfKo4',
  'assets/objects/lib_FirmataParser.o':
    'sha384-v2VpcMkD4E0Z7V5QRTgG74P91GlhiL13kn+PXimc9xFK57ecbXN9ffc1sSTyCZAB',
  'assets/objects/lib_I2CDevice.o':
    'sha384-MLa6yEmPyuVjwdVeM0dm7yDX/ldIM0DZZz3nfGn+7kaeYZLOAbw6VgBkJN+2ztUx',
  'assets/objects/lib_SPI.o':
    'sha384-+IknJRvJUYYOdvtuK5rjfF0wsEPafldz2Lm1kUqySevuviTO4UAANT6jXO6qWHTy',
  'assets/objects/lib_SPIDevice.o':
    'sha384-yHBiJFnMp288rfT5Xg/MYaoVu6ZSxVvcdqtXsHjURgY7yTo9vS82JEl3EfSOoZQs',
  'assets/objects/lib_Servo.o':
    'sha384-CTH/0PmngqgKYKmv0bf766qjnwiWW/DtAF4qcztqOYsHu4MKsSw83kOyEto6FBUG',
  'assets/objects/lib_Wire.o':
    'sha384-hdOdWvOFSr5Irq4MhGzEYPWzBM4z/dYGTHRuVd3N3l+dkxfyyzl7io+8wm1Mi7YF',
  'assets/objects/lib_twi.o':
    'sha384-tcxAZvvV072j+GrMIj9WDv4nHhIWJIGdQdI4605zcapuBO1BADrEKXSn/WT5we3g',
  'assets/objects/lib_GFX.o':
    'sha384-0dOo7rJU2LsJdptVE6RsoHIHDuPMQuQeE9K79mf/Ad4KokPzS/5Ka7xgY7vQ1XDF',
  'assets/objects/lib_SSD1306.o':
    'sha384-6C3AsQ2CDz2kUYhxpkyRfp1hTOQzDyT1+z6vX9wAyVylwE0ePjHFifJw3DuvafM/',
  'assets/objects/lib_VL53L0X.o':
    'sha384-vVsUVr8x5jVsToJY3BetT7+87DNkFrcwAlx97N41D+VnNsoK8T/WvJN8o5t5WGDl',
  'assets/libs/crtatmega328p.o':
    'sha384-zO+JhQWRtqMMSCbf2cSLYKCbgk/uyFZiF2tk7/hLum/gUPrs6kcMB8+H2mbicC8u',
  'assets/libs/libc.a': 'sha384-hLoHYZliEQrluCvKB97pHi9XkEMJAZVITmafOd93s2jouEAbYzNRkNLnS7BGlGiG',
  'assets/libs/libm.a': 'sha384-fsdU0UEKMVeEIjmWbKo8BjEOR5lcoYA2MCAX2nFwigxacFaQp3Oip4DekJUHKwT3',
  'assets/libs/libgcc.a': 'sha384-MLDV8rKWr2kVlDXe7hjcuWAQaIWK1tmEAf/+ykIpEmhbr5tmYaJ/qJ0/Gsh8GXKm',
  'assets/ldscripts/avr5.xn':
    'sha384-kLVZyy6go50F6C7OnVfqx3BgQWxkPULMB9gLV0n1+wcmZSLAPdS1f7BCvOvzC3GS',
};

function cacheKey(path: string): string {
  return `${CACHE_VERSION}:${path}`;
}

function decodePin(pin: string): Uint8Array {
  const match = /^sha384-([A-Za-z0-9+/]+=*)$/.exec(pin);
  if (match === null) throw new Error('toolchain integrity check failed: malformed pin');
  return Uint8Array.from(atob(match[1]), (ch) => ch.charCodeAt(0));
}

async function verifyIntegrity(
  path: string,
  bytes: Uint8Array,
  sri: Readonly<Record<string, string>>,
): Promise<void> {
  const expected = sri[path];
  if (expected === undefined) return;
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', copy.buffer));
  const want = decodePin(expected);
  if (digest.length !== want.length) throw new IntegrityError(path);
  let diff = 0;
  for (let i = 0; i < digest.length; i += 1) diff |= digest[i] ^ want[i];
  if (diff !== 0) throw new IntegrityError(path);
}

export class FetchCache {
  private backend: IDBBackend;
  private fetchFn: typeof fetch;
  private sri: Readonly<Record<string, string>>;
  constructor(backend: IDBBackend, fetchFn: typeof fetch, sri: Readonly<Record<string, string>>) {
    this.backend = backend;
    this.fetchFn = fetchFn;
    this.sri = sri;
  }
  /**
   * Read-through with corrupt-cache auto-recovery. This is the single choke
   * point where toolchain bytes enter the build (both the worker fetch shim
   * and the client shims funnel through it): every cached hit is re-verified
   * against the SRI table, so corrupt pinned bytes never reach WASM
   * instantiation. A failed verification invalidates the entry and retries
   * the network fetch exactly once; a second integrity failure degrades with
   * a distinct corrupt-cache error. Never loops, never boots corrupt bytes,
   * never caches bad bytes. Non-integrity failures (HTTP status, network)
   * throw immediately with no retry.
   */
  async fetch(path: string): Promise<Uint8Array> {
    const key = cacheKey(path);
    const hit = await this.backend.get(key);
    if (hit !== null) {
      try {
        await verifyIntegrity(path, hit, this.sri);
        return hit;
      } catch (error) {
        if (!(error instanceof IntegrityError)) throw error;
        await this.backend.delete(key);
      }
    }
    try {
      return await this.fetchOnce(path, key);
    } catch (error) {
      if (!(error instanceof IntegrityError)) throw error;
      return await this.refetchOnce(path, key);
    }
  }
  private async fetchOnce(path: string, key: string): Promise<Uint8Array> {
    const res = await this.fetchFn(`${CDN_BASE}${path}`);
    if (!res.ok) throw new Error(`toolchain fetch failed for ${path}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await verifyIntegrity(path, bytes, this.sri);
    await this.backend.put(key, bytes);
    return bytes;
  }
  private async refetchOnce(path: string, key: string): Promise<Uint8Array> {
    try {
      return await this.fetchOnce(path, key);
    } catch (error) {
      if (!(error instanceof IntegrityError)) throw error;
      throw new Error(`toolchain cache corrupt; refetch failed for ${path}`);
    }
  }
  async invalidate(path: string): Promise<void> {
    await this.backend.delete(cacheKey(path));
  }
}
