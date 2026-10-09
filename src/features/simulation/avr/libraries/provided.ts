export interface ProvidedTier2 {
  readonly name: 'SevSeg' | 'RTClib';
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  readonly license: string;
  readonly headers: readonly string[];
}

export const TIER2_MANIFEST: readonly ProvidedTier2[] = [
  // Values recorded from the Arduino index on 2026-10-09; see commit body.
  { name: 'SevSeg', version: '3.7.0', url: 'https://downloads.arduino.cc/libraries/github.com/untr0py/SevSeg-3.7.0.zip', sha256: '1c2b115485e72533d3626ba98af0b4a7989b1ce6a7ee9a7a7bd01ae75446f526', license: 'MIT', headers: ['SevSeg.h'] },
  { name: 'RTClib', version: '2.1.4', url: 'https://downloads.arduino.cc/libraries/github.com/adafruit/RTClib-2.1.4.zip', sha256: '8dc4bbf8f25e12353533778f13295e9fe12ed6a92d66a8e8c062b24d83fe70dd', license: 'MIT', headers: ['RTClib.h'] },
];

/** Null names the failure at the call site — never substitute another version. */
export function tier2ByName(name: string, version?: string): ProvidedTier2 | null {
  const entry = TIER2_MANIFEST.find((candidate) => candidate.name === name);
  if (entry === undefined) return null;
  if (version !== undefined && version !== entry.version) return null;
  return entry;
}
