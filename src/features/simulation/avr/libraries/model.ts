import type { FirmwareProject } from '@/features/simulation/firmware/project';
import { tier2ByName } from './provided';

export interface ProjectLibrary {
  readonly name: string;
  readonly version?: string;
  readonly source: 'provided' | 'custom';
}

export interface LibrarySlotFile {
  readonly path: string;
  readonly content: string;
}

export interface LibrarySlot {
  readonly id: string;
  readonly name: string;
  readonly files: readonly LibrarySlotFile[];
}

export interface CuratedLibrary {
  readonly name: string;
  readonly headers: readonly string[];
}

export const CURATED_LIBRARIES: readonly CuratedLibrary[] = [
  { name: 'Servo', headers: ['Servo.h'] },
  { name: 'DHT', headers: ['DHT.h', 'DHT_U.h'] },
  { name: 'Adafruit_GFX', headers: ['Adafruit_GFX.h', 'gfxfont.h'] },
  { name: 'Adafruit_SSD1306', headers: ['Adafruit_SSD1306.h'] },
  { name: 'Wire', headers: ['Wire.h'] },
  { name: 'SPI', headers: ['SPI.h'] },
];

export function libraryDeclarations(project: FirmwareProject): readonly ProjectLibrary[] {
  return project.libraries ?? [];
}

/** Custom slot contents carried on the project itself (save/share/gallery). */
export function projectSlots(project: FirmwareProject): readonly LibrarySlot[] {
  return project.slots ?? [];
}

/** Declaration errors only; include resolution lives in resolve.ts. */
export function validateLibraries(
  project: FirmwareProject,
  ctx: { slots: readonly LibrarySlot[] },
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of libraryDeclarations(project)) {
    if (seen.has(entry.name)) {
      errors.push(`<${entry.name}>: duplicate library`);
      continue;
    }
    seen.add(entry.name);
    if (entry.source === 'provided') {
      // Tier-1 (bundled in the toolchain) and Tier-2 (fetched, SHA-verified,
      // version-pinned in provided.ts) are both provided libraries. Versions
      // are ignored here, as for Tier-1; the build enforces exact pins.
      if (!CURATED_LIBRARIES.some((lib) => lib.name === entry.name) && tier2ByName(entry.name) === null) {
        errors.push(`<${entry.name}>: unknown provided library`);
      }
    } else {
      const id = entry.name.startsWith('custom:') ? entry.name.slice('custom:'.length) : null;
      if (id === null || !ctx.slots.some((slot) => slot.id === id)) {
        errors.push(`<${entry.name}>: library slot is empty`);
      }
    }
  }
  return errors;
}
