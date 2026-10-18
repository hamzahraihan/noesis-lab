import type { FirmwareProject } from '@/features/simulation/firmware/project';
import { CURATED_LIBRARIES, libraryDeclarations, type LibrarySlot } from './model';

export type AngleResolution =
  | { kind: 'custom-slot'; slot: LibrarySlot }
  | { kind: 'index'; library: string }
  | { kind: 'provided'; library: string }
  | { kind: 'toolchain' }
  | { kind: 'unknown' };

export interface ResolveContext {
  readonly project: FirmwareProject;
  readonly slots: readonly LibrarySlot[];
  readonly toolchainHeaders: ReadonlySet<string>;
  readonly indexInstalled?: ReadonlyMap<string, { headers: readonly string[] }>;
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/** Custom slots → installed index → declared provided → toolchain bundle. Case-sensitive; undeclared falls through. */
export function resolveAngleInclude(header: string, ctx: ResolveContext): AngleResolution {
  const declared = libraryDeclarations(ctx.project);
  for (const entry of declared) {
    if (entry.source !== 'custom' || !entry.name.startsWith('custom:')) continue;
    const slot = ctx.slots.find((candidate) => candidate.id === entry.name.slice('custom:'.length));
    if (slot !== undefined && slot.files.some((file) => baseName(file.path) === header)) {
      return { kind: 'custom-slot', slot };
    }
  }
  for (const entry of declared) {
    if (entry.source !== 'index') continue;
    const installed = ctx.indexInstalled?.get(entry.name);
    if (installed !== undefined && installed.headers.includes(header))
      return { kind: 'index', library: entry.name };
  }
  for (const entry of declared) {
    if (entry.source !== 'provided') continue;
    const lib = CURATED_LIBRARIES.find((candidate) => candidate.name === entry.name);
    if (lib !== undefined && lib.headers.includes(header))
      return { kind: 'provided', library: lib.name };
  }
  if (ctx.toolchainHeaders.has(header)) return { kind: 'toolchain' };
  return { kind: 'unknown' };
}
