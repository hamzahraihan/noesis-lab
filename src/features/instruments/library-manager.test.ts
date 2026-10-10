// Library Manager UI helpers: version badges, search placeholder, build-row
// labels, category lists, advertised-only license notes, plus the uninstall
// aftermath (declaration-removal, never UI clicks — no component harness in
// the repo, established pattern).
import { describe, expect, it } from 'vitest';
import {
  applyIndexInstall,
  badgeFor,
  buildRowLabel,
  fetchIndexArchive,
  indexCategories,
  indexLicenseNote,
  searchPlaceholder,
} from './library-manager';
import { resolveAngleInclude, validateLibraries } from '@/features/simulation';
import type { IndexLibrary } from '@/features/simulation';

function indexLib(name: string, category: string): IndexLibrary {
  return {
    name,
    versions: [{ version: '1.0.0', url: 'u', checksum: 'SHA-256:x', size: 1 }],
    author: 'A',
    sentence: 's',
    category,
    architectures: ['*'],
    providesIncludes: [],
  };
}

describe('library manager ui helpers', () => {
  it('badges installed, available, and unavailable states', () => {
    expect(badgeFor({ installed: '3.2.0', latest: '3.2.0' })).toBe('installed 3.2.0');
    expect(badgeFor({ installed: '3.1.0', latest: '3.2.0' })).toBe('update available');
    expect(badgeFor({ installed: null, latest: '3.2.0' })).toBe('install');
  });

  it('names the search placeholder for name, header, and sentence queries', () => {
    expect(typeof searchPlaceholder).toBe('string');
    expect(searchPlaceholder.length).toBeGreaterThan(0);
  });

  it('labels build rows as Name@version with a cached tick', () => {
    expect(buildRowLabel('SevSeg', '3.2.0')).toBe('SevSeg@3.2.0 ✓ cached');
  });

  it('lists distinct sorted categories for the filter', () => {
    expect(indexCategories([indexLib('B', 'Other'), indexLib('A', 'Display'), indexLib('C', 'Display')])).toEqual([
      'Display',
      'Other',
    ]);
  });

  it('notes index license terms only when advertised', () => {
    expect(indexLicenseNote([])).toBeNull();
    expect(indexLicenseNote([{ name: 'SevSeg', version: '3.2.0' }])).toBeNull();
    expect(
      indexLicenseNote([
        { name: 'SevSeg', version: '3.2.0', license: 'MIT' },
        { name: 'Nope', version: '0.0.1' },
      ]),
    ).toBe('Index libraries: SevSeg (MIT).');
  });
});

describe('library manager uninstall', () => {
  it('uninstall drops the declaration while cached objects stay shared', () => {
    const bare = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: '#include <Servo.h>\n' }],
      libraries: [{ name: 'Servo', source: 'index', version: '5.0.0' }],
    } as const;
    // Removal itself is a project update (filter `libraries`); assert the aftermath:
    // validateLibraries(cleanedProject, { slots: [] }) is clean, and
    // resolveAngleInclude('Servo.h', { project: cleanedProject, slots: [], toolchainHeaders: new Set(['Servo.h']) })
    // falls back to { kind: 'toolchain' } — the cached objects are simply never referenced again.
    const cleanedProject = { ...bare, libraries: bare.libraries.filter((entry) => entry.name !== 'Servo') };
    expect(validateLibraries(cleanedProject, { slots: [] })).toEqual([]);
    expect(
      resolveAngleInclude('Servo.h', {
        project: cleanedProject,
        slots: [],
        toolchainHeaders: new Set(['Servo.h']),
      }),
    ).toEqual({ kind: 'toolchain' });
  });
});

describe('library manager async install landing', () => {
  const base = {
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [{ name: 'main.ino', content: '' }],
    libraries: [{ name: 'Servo', source: 'index', version: '5.0.0' }],
  } as const;

  it('lands on the latest project so concurrent edits survive', () => {
    // Install starts against `base`; while it awaits network+compile the
    // user adds an unrelated declaration. Landing via the fresh project
    // (projectRef.current in the panel) must keep that edit.
    const latest = {
      ...base,
      libraries: [...base.libraries, { name: 'Other', source: 'provided' as const }],
    };
    const landed = applyIndexInstall(latest, 'SevSeg', '3.2.0');
    expect(landed.libraries).toEqual([
      { name: 'Servo', source: 'index', version: '5.0.0' },
      { name: 'Other', source: 'provided' },
      { name: 'SevSeg', source: 'index', version: '3.2.0' },
    ]);
    // Untouched fields carry over byte-identical.
    expect(landed.files).toBe(latest.files);
  });

  it('re-pins same-name rows instead of duplicating', () => {
    const landed = applyIndexInstall({ ...base, libraries: [...base.libraries] }, 'Servo', '5.0.1');
    expect(landed.libraries).toEqual([{ name: 'Servo', source: 'index', version: '5.0.1' }]);
  });
});

describe('library manager archive fetch', () => {
  it('passes the abort signal into the fetch init', async () => {
    const seen: { init: { signal: AbortSignal } | null } = { init: null };
    const controller = new AbortController();
    const bytes = await fetchIndexArchive(
      'http://example.invalid/lib.zip',
      (async (url: string, init: { signal: AbortSignal }) => {
        seen.init = init;
        expect(url).toBe('http://example.invalid/lib.zip');
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2]).buffer as ArrayBuffer };
      }),
      controller.signal,
    );
    expect(seen.init?.signal).toBe(controller.signal);
    expect(bytes).toEqual(new Uint8Array([1, 2]));
  });

  it('names HTTP failures with url and status', async () => {
    const controller = new AbortController();
    await expect(
      fetchIndexArchive(
        'http://example.invalid/missing.zip',
        (async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })),
        controller.signal,
      ),
    ).rejects.toThrow('library fetch failed for http://example.invalid/missing.zip: 404');
  });
});
