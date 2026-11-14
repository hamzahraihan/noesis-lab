/**
 * The project gallery: runnable builds, each with the bench it needs.
 *
 * Same vocabulary as the exercises (`circuit` names the wiring, `sketch` is
 * what runs on it) minus the curriculum fields — a project is a destination,
 * not a lesson, so it has no level, no hints, and no worked solution. The
 * validation tests hold every entry to the same bar as an exercise: the
 * sketch must parse, the circuit must wire real contacts, the parts must
 * exist in the catalogue.
 */

import type { BoardId } from './boardRegistry';
import { GALLERY } from './generated/gallery-projects';
import {
  ENTRY_BY_LANGUAGE,
  toSingleFileProject,
  type CircuitDocument,
  type FirmwareLanguage,
  type FirmwareProject,
  type ProjectLibrary,
} from '@/features/simulation';

export { GALLERY };

export type GalleryProjectId = typeof GALLERY[number]['id'];

export interface GalleryBuild {
  readonly board: BoardId;
  /** Build flavor on one board (`'library'`); absent means the default build. */
  readonly variant?: string;
  /** Backend this build needs; default `'interpreter'`. */
  readonly execution?: 'interpreter' | 'avr' | 'rp2040' | 'esp32';
  /**
   * `'live'` when this build's sketch talks to a real host (`net/live-hosts`).
   *
   * Opt-in per build on purpose: a fetch leaves the machine, so it is a
   * decision this repository makes when it publishes a build -- never something
   * a link or a sketch can switch on.
   */
  readonly network?: 'live';
  /** The circuit this build needs, as a document (see `circuits/`). */
  readonly circuit: CircuitDocument;
  /** The entry file's source (`main.ino` on Arduino builds). */
  readonly sketch: string;
  /**
   * Extra tabs merged with the entry as one multi-file project, Wokwi-style
   * (`config.h`, module `.h`/`.cpp`). Names must already be bench-legal
   * (lowercase); the entry keeps the `sketch` content so single-file builds
   * stay exactly as they are.
   */
  readonly files?: readonly { readonly name: string; readonly content: string }[];
  /**
   * Declared Arduino libraries, carried into the bench project. Versions stay
   * unpinned here, so the manifest defaults apply at fetch time.
   */
  readonly libraries?: readonly ProjectLibrary[];
  /**
   * How long this build's checks may run, in milliseconds, when the runner's
   * default cap is not enough.
   *
   * The AVR worker compile measures ~150 s, over the 120 s default. A cost that
   * belongs to one build is stated with that build rather than in a special case
   * in the registry.
   */
  readonly wallCapMs?: number;
}

/** The runnable firmware for a build: one multi-file project or one sketch. */
export function firmwareForBuild(build: GalleryBuild, language: FirmwareLanguage): FirmwareProject {
  if (!build.files || build.files.length === 0) {
    const single = toSingleFileProject(build.sketch, language);
    return build.libraries === undefined ? single : { ...single, libraries: build.libraries };
  }
  const entry = ENTRY_BY_LANGUAGE[language];
  return {
    language,
    files: [{ name: entry, content: build.sketch }, ...build.files],
    activeName: entry,
    ...(build.libraries === undefined ? {} : { libraries: build.libraries }),
  };
}

export interface GalleryProject {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly parts: readonly {
    readonly name: string;
    readonly qty: number;
  }[];
  /** One validated build per board; v1 is Uno throughout. */
  readonly builds: readonly GalleryBuild[];
  /** What you should see when it is working. */
  readonly working: readonly string[];
}

export function galleryById(id: string): GalleryProject | null {
  return GALLERY.find((entry) => entry.id === id) ?? null;
}

export function buildFor(
  project: GalleryProject,
  board: BoardId,
  variant?: string,
): GalleryBuild | null {
  const onBoard = project.builds.filter((build) => build.board === board);
  if (variant === undefined) return onBoard[0] ?? null;
  return onBoard.find((build) => build.variant === variant) ?? onBoard[0] ?? null;
}

export function boardsFor(project: GalleryProject): readonly BoardId[] {
  return [...new Set(project.builds.map((build) => build.board))];
}
