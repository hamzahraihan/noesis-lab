/**
 *
 * Side panels: the inspector, the firmware editor and the serial monitor.
 *
 * Each is deliberately plain. The bench is the thing worth looking at; these
 * panels are instruments, and an instrument that needs explaining is a bad one.
 */

import Editor, { type OnMount } from '@monaco-editor/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { PartInstance } from '@/features/simulation';
import {
  addFile,
  buildIndexObjects,
  compileToolchainUnit,
  createProductionBackend,
  CURATED_LIBRARIES,
  ENTRY_BY_LANGUAGE,
  fetchIndex,
  libraryDeclarations,
  MAX_FILE_BYTES,
  projectSlots,
  refreshIndex,
  reinstallIndexObjects,
  removeFile,
  renameFile,
  restoreInstalledIndex,
  searchIndex,
  selectIndexRelease,
  TIER2_MANIFEST,
  updateFileContent,
  validateLibraries,
  validateSlotPath,
  type IndexLibrary,
  type LibrarySlot,
} from '@/features/simulation';
import { matchSlotFile, reasonFor, slotViewKey } from './library-ui';
import {
  badgeFor,
  applyIndexInstall,
  buildRowLabel,
  fetchIndexArchive,
  indexCategories,
  indexLicenseNote,
  searchPlaceholder,
} from './library-manager';
import { DynamicState, type KnobSpec } from '@/features/parts';
import { formatOhms, formatVolts } from '@/utils';
import { FIRMWARE_LANGUAGE, FIRMWARE_THEME, PYTHON_LANGUAGE } from './monaco-setup';
import type { FirmwareLanguage, FirmwareProject } from '@/features/simulation';
import type { Example } from '@/features/learn';
import {
  CaretRightIcon,
  CodeIcon,
  Cross2Icon,
  CrossCircledIcon,
  CubeIcon,
  PlayIcon,
  ReaderIcon,
  ResetIcon,
  ResetIcon as RotateIcon,
  TargetIcon,
  TrashIcon,
  ValueIcon,
} from '@radix-ui/react-icons';
import {
  Button,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components';

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------


export interface InspectorProps {
  part: PartInstance | null;
  pinVoltages: ReadonlyMap<string, number>;
  /** What the operator is doing to this part, read as the panel is drawn. */
  controls: DynamicState;
  onDelete(): void;
  onSetPressed(pressed: boolean): void;
  onSetKnob(spec: KnobSpec, value: number): void;
  /**
   * Turns the selected part a quarter turn, on the bench.
   *
   * Not a knob, and deliberately so: turning a part is a physical act with a
   * consequence for the circuit -- its pins land in different contacts -- so it
   * re-solves the netlist, which is what a knob would do anyway. Keeping it a
   * direct action makes that honest.
   */
  onRotate(): void;
  /** The colour panel's visible size, when the part is one. */
  panelSize?: string;
  /** Which way up the part is, in degrees. 0 is as it was drawn. */
  rotation: number;
}

export function Inspector({
  part,
  pinVoltages,
  controls,
  panelSize,
  rotation,
  onDelete,
  onRotate,
  onSetPressed,
  onSetKnob,
}: InspectorProps) {
  if (!part) {
    // An empty panel is the first thing a new operator sees, so it says what
    // to click and shows the glyph for the thing they'd click.
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
          <CardTitle className="flex items-center gap-2">
            <CubeIcon className="icon-sm text-slate-500" aria-hidden="true" />
            Inspector
          </CardTitle>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-xs text-slate-500">
          <TargetIcon className="icon text-slate-700" aria-hidden="true" />
          <p>Select a part on the bench to read its pins and drive it.</p>
        </div>
      </div>
    );
  }

  const { definition } = part;
  const knobs = definition.knobs ?? [];
  // Only pins that carry a silkscreen label are worth a voltage readout; a
  // resistor's two leads would otherwise render an empty section header.
  const labelledPins = definition.pins.filter((pin) => pin.label !== '').slice(0, 32);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
        <CardTitle className="flex items-center gap-2">
          <CubeIcon className="icon-sm text-slate-500" aria-hidden="true" />
          Inspector
        </CardTitle>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{definition.name}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{definition.id}</p>
        </div>

        <dl className="flex flex-col gap-1 text-xs">
          <Row label="Pins" value={String(definition.pins.length)} />
          <Row label="Footprint" value={`${definition.widthMm} × ${definition.heightMm} mm`} />
          {definition.component.kind === 'resistor' && (
            <Row label="Resistance" value={formatOhms(definition.component.ohms)} />
          )}
          {definition.component.kind === 'led' && (
            <Row label="Forward voltage" value={`${definition.component.profile.forwardVolts} V`} />
          )}
        </dl>

        {labelledPins.length > 0 && (
          <div>
            <CardTitle className="mb-1.5 flex items-center gap-2">
              <ValueIcon className="icon-sm" aria-hidden="true" />
              Pin voltages
            </CardTitle>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {labelledPins.map((pin) => (
                <li key={pin.id} className="flex justify-between gap-2">
                  <span className="truncate text-slate-500">{pin.label}</span>
                  <span className="num text-slate-200">
                    {formatVolts(pinVoltages.get(`${part.id}:${pin.id}`) ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {definition.momentary && (
          <Button
            type="button"
            onMouseDown={() => onSetPressed(true)}
            onMouseUp={() => onSetPressed(false)}
            onMouseLeave={() => onSetPressed(false)}
            variant={controls.isPressed(part.id) ? 'default' : 'secondary'}
            className={controls.isPressed(part.id) ? 'h-8 w-full !bg-amber-400 !text-slate-900' : 'h-8 w-full'}
          >
            <ReaderIcon className="icon" aria-hidden="true" />
            {controls.isPressed(part.id) ? 'Pressed' : 'Press and hold'}
          </Button>
        )}

        {knobs.map((spec) => (
          <KnobControl
            key={spec.id}
            spec={spec}
            value={controls.knob(part.id, spec)}
            onChange={(value) => onSetKnob(spec, value)}
          />
        ))}

        {/*
         * Turning a part is a physical act, so it belongs on every part rather
         * than on the displays alone -- a resistor is the part most worth
         * turning, since a quarter turn is what puts its leads in two different
         * rows of a breadboard.
         *
         * The button is labelled for what it does rather than what it is
         * called. `R` does the same thing, which is why the key is on the
         * button too: a part can be turned while the operator's attention is on
         * the board rather than the side panel.
         *
         * The screen readout stays below it for a colour panel, because there
         * is a second, unrelated rotation on a display -- the electronic one
         * the sketch asks for -- and a learner who cannot see the two apart
         * concludes neither works.
         */}
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            onClick={onRotate}
            variant="secondary"
            className="h-8 w-full"
            title="Turn this part a quarter turn clockwise (R)"
          >
            <RotateIcon className="icon" aria-hidden="true" />
            Turn part
            <span className="num ml-auto text-slate-400">{rotation}°</span>
          </Button>
          {panelSize && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Screen</span>
              <span className="num text-slate-200">{panelSize}</span>
            </div>
          )}
        </div>

        <Button type="button" onClick={onDelete} variant="destructive" className="mt-1 w-full">
          <TrashIcon className="icon" aria-hidden="true" />
          Remove part
        </Button>
      </div>
    </div>
  );
}

/**
 * One of a part's controls.
 *
 * Every control arrives with the range and unit its part works in, so a new
 * sensor on the bench needs this written once rather than again for each one:
 * the panel has nothing left to decide beyond how to draw it.
 */
function KnobControl({
  spec,
  value,
  onChange,
}: {
  spec: KnobSpec;
  value: number;
  onChange(value: number): void;
}) {
  if (spec.toggle) {
    return (
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-400">{spec.label}</span>
        <input
          type="checkbox"
          className="size-4 accent-amber-400"
          checked={value >= 1}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="flex items-center justify-between">
        <span className="text-slate-400">{spec.label}</span>
        <span className="num text-slate-200">{formatKnobValue(spec, value)}</span>
      </span>
      <input
        type="range"
        className="wiper"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/**
 * A knob's readout in the unit its part works in.
 *
 * A bare fraction of travel says nothing about what a sensor is reading, so
 * anything that has a unit of its own is shown in it.
 */
function formatKnobValue(spec: KnobSpec, value: number): string {
  if (spec.unit) return `${trimNumber(value)} ${spec.unit}`;
  return `${Math.round(((value - spec.min) / (spec.max - spec.min)) * 100)}%`;
}

/** Trims the float noise a slider's own step leaves behind. */
function trimNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200 tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The serial log, memoised on the lines array itself: the bench hands out the
 * same array until new output arrives, so most animation frames skip this
 * subtree entirely instead of re-joining 400 lines of scrollback.
 *
 * Only the tail reaches the DOM. The full log stays in state (and in tests);
 * this panel autoscrolls to the newest line anyway, so older lines are never
 * seen -- only reconciled, sixty times a second in dev.
 */
const SERIAL_TAIL_LINES = 100;

/** Tier-2 libraries download once and then cache: until then the bench is offline for them. */
const NOT_FETCHED_NOTE = 'not fetched — needs network once';

export const SerialMonitor = memo(function SerialMonitor({ lines }: { lines: readonly string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
        <CardTitle className="flex items-center gap-2">
          <ReaderIcon className="icon-sm text-slate-500" aria-hidden="true" />
          Serial Monitor
        </CardTitle>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-emerald-300">
        {lines.length === 0 ? (
          // Dim prose here read as a stalled instrument rather than an idle
          // one, so it names what would make the sketch start printing.
          <span className="font-sans text-slate-600">
            Serial.print and Serial.println output lands here.
          </span>
        ) : (
          // Serial.print fragments concatenate; only println breaks the line,
          // so the stream is joined before rendering rather than split per write.
          // The tail only: see above.
          lines.slice(-SERIAL_TAIL_LINES).join('')
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------

export function FirmwareEditor({
  project,
  onProjectChange,
  error,
  language,
  expanded,
  onToggle,
  headerHidden = false,
  onChangeLanguage,
  onRun,
  onReset,
  running,
  examples,
  activeExampleId,
  onLoadExample,
}: {
  project: FirmwareProject;
  onProjectChange(next: FirmwareProject): void;
  error: string | null;
  /** Which grammar the text in the editor is written in. */
  language: FirmwareLanguage;
  /** Whether the editor body is showing under its header. */
  expanded: boolean;
  onToggle(): void;
  /**
   * Hides the collapse toggle and the internal file tabstrip, for the IDE
   * shell: the center tabstrip owns file switching there, so a second
   * tabstrip would be two controls for one thing. Language, examples and Run
   * stay in the header.
   */
  headerHidden?: boolean;
  onChangeLanguage(language: FirmwareLanguage): void;
  onRun(): void;
  onReset(): void;
  running: boolean;
  /** What an example brings with it, so the panel can offer it. */
  examples: readonly Example[];
  activeExampleId: string | null;
  onLoadExample(id: string): void;
}) {
  const active = project.files.find((f) => f.name === project.activeName) ?? project.files[0];
  const activeName = active?.name;
  const entry = ENTRY_BY_LANGUAGE[project.language];

  /*
   * Declared libraries and custom slot contents, read off the project the
   * same way the toolchain client reads them. Validation reasons come from
   * `validateLibraries` verbatim, so a greyed row names the same failure the
   * next compile would report.
   */
  const slots = projectSlots(project);
  const declarations = libraryDeclarations(project);
  const providedCatalog: readonly { readonly name: string; readonly tier: 'bundled' | 'fetch' }[] = [
    ...CURATED_LIBRARIES.map((lib) => ({ name: lib.name, tier: 'bundled' as const })),
    ...TIER2_MANIFEST.map((lib) => ({ name: lib.name, tier: 'fetch' as const })),
  ];

  /*
   * Helper-op failures (add/rename/delete, oversize edits) surface here in
   * the error bar rather than in a `window.alert`, so a rejected tab edit
   * reads like any other firmware error. Cleared by the next successful op
   * or Run; `window.prompt` stays for name input.
   */
  const [notice, setNotice] = useState<string | null>(null);

  /* Whether the Libraries popup is open over the editor. */
  const [libsPopupOpen, setLibsPopupOpen] = useState(false);
  const libsPopupRef = useRef<HTMLDivElement>(null);
  /* Which custom slot (and file) the slot editor shows; null keeps the fallbacks below. */
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotPath, setSlotPath] = useState<string | null>(null);

  /*
   * Library Manager browse + install state. The index loads lazily on first
   * Browse open — the manager never fetches unless opened — and installs pin
   * their version on the declaration while the verified build's headers feed
   * validation and resolution for the session (Task 5 owns persistence; the
   * IDB object cache itself already outlives it).
   */
  const [browseOpen, setBrowseOpen] = useState(false);
  const [indexLibs, setIndexLibs] = useState<readonly IndexLibrary[] | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pinnedVersion, setPinnedVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState<{ name: string; version: string } | null>(null);
  const installAbortRef = useRef<AbortController | null>(null);
  /*
   * Fresh project for the async install landing: `handleInstallIndex`
   * awaits seconds of network+compile, so the `project` value it closed
   * over is stale by land time. This ref tracks the latest render's
   * project; the landing spreads `projectRef.current` (fresh declarations
   * included) instead of the stale closure.
   */
  const projectRef = useRef(project);
  projectRef.current = project;
  const [installedIndex, setInstalledIndex] = useState<
    ReadonlyMap<string, { version: string; headers: readonly string[] }>
  >(new Map());

  /*
   * One Monaco instance shows every tab, so each tab's cursor and scroll live
   * here rather than in the editor. Saved on the way out of a tab, restored on
   * the way in; anything Monaco rejects is dropped, since a lost scroll
   * position is never worth an error bar.
   */
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const viewStatesRef = useRef(new Map<string, unknown>());
  /*
   * The slot editor's own Monaco instance. Cursor and scroll keys are
   * slot-scoped (`slot:<id>:<path>`) in the same map, so a slot file and a
   * sketch tab can never trade view states.
   */
  const slotEditorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeName) return;
    const saved = viewStatesRef.current.get(activeName);
    if (saved) {
      try {
        editor.restoreViewState(saved as ReturnType<typeof editor.saveViewState>);
      } catch {
        // Dropped: the tab still opens at the top, which is always correct.
      }
    }
  }, [activeName]);

  /*
   * Which slot file the slot editor shows: the explicit pick, else the first
   * slot and its first file, else nothing. A removed pick falls back rather
   * than pointing at a file that is no longer there.
   */
  const selectedSlot = slots.find((slot) => slot.id === slotId) ?? slots[0] ?? null;
  const activeSlotId = selectedSlot?.id ?? null;
  const selectedSlotFile =
    selectedSlot?.files.find((file) => file.path === slotPath) ?? selectedSlot?.files[0] ?? null;
  const activeSlotPath = selectedSlotFile?.path ?? null;

  const handleSlotMount: OnMount = (editor) => {
    slotEditorRef.current = editor;
  };

  useEffect(() => {
    const editor = slotEditorRef.current;
    if (!editor || !activeSlotId || !activeSlotPath) return;
    const saved = viewStatesRef.current.get(slotViewKey(activeSlotId, activeSlotPath));
    if (saved) {
      try {
        editor.restoreViewState(saved as ReturnType<typeof editor.saveViewState>);
      } catch {
        // Dropped: the file still opens at the top, which is always correct.
      }
    }
  }, [activeSlotId, activeSlotPath]);

  /** Switches the slot editor, stashing the outgoing file's view state first. */
  const selectSlotFile = (id: string, path: string | null) => {
    const editor = slotEditorRef.current;
    if (editor && activeSlotId && activeSlotPath && (id !== activeSlotId || path !== activeSlotPath)) {
      try {
        const state = editor.saveViewState();
        if (state) viewStatesRef.current.set(slotViewKey(activeSlotId, activeSlotPath), state);
      } catch {
        // Dropped: the file still opens, which is what matters.
      }
    }
    setSlotId(id);
    setSlotPath(path);
  };

  const selectFile = (name: string) => {
    const editor = editorRef.current;
    if (editor && active && name !== active.name) {
      try {
        const state = editor.saveViewState();
        if (state) viewStatesRef.current.set(active.name, state);
      } catch {
        // Dropped: the tab still opens, which is what matters.
      }
    }
    onProjectChange({ ...project, activeName: name });
  };

  const reportHelperError = (cause: unknown) => {
    setNotice(cause instanceof Error ? cause.message : String(cause));
  };

  const handleAddFile = () => {
    const name = window.prompt('New file name', 'helpers.h');
    if (!name || !name.trim()) return;
    try {
      onProjectChange(addFile(project, name.trim()));
      setNotice(null);
    } catch (cause) {
      reportHelperError(cause);
    }
  };

  const handleRenameFile = (name: string) => {
    const next = window.prompt('Rename file', name);
    if (!next || next.trim() === name) return;
    try {
      onProjectChange(renameFile(project, name, next.trim()));
      setNotice(null);
    } catch (cause) {
      reportHelperError(cause);
    }
  };

  const handleRemoveFile = (name: string) => {
    try {
      onProjectChange(removeFile(project, name));
      setNotice(null);
    } catch (cause) {
      reportHelperError(cause);
    }
  };

  const handleContentChange = (name: string, next: string) => {
    try {
      onProjectChange(updateFileContent(project, name, next));
      setNotice(null);
    } catch (cause) {
      // Over the 32 KB cap: the edit is rejected by the controlled `value`,
      // so surface it now — waiting for Run would validate stale content.
      reportHelperError(cause);
    }
  };

  /*
   * Installed index builds for validation: name → headers from the verified
   * build, the `indexInstalled` shape Task 3 added. Declared-but-unbuilt
   * index entries stay unknown, greyed with the validation reason below.
   */
  const indexInstalled = useMemo(() => {
    const map = new Map<string, { headers: readonly string[] }>();
    for (const [name, entry] of installedIndex) map.set(name, { headers: entry.headers });
    return map;
  }, [installedIndex]);
  const libraryProblems = validateLibraries(project, { slots, indexInstalled });

  /*
   * Reload rebuild: declarations persist with the project and built objects
   * persist in IDB, but installedIndex is session state — repopulate
   * declared-but-unbuilt entries from the versioned cache so a reload
   * validates clean instead of greying `unknown index library` until
   * reinstall. A failed restore stays grey with the validation reason;
   * reinstall rebuilds.
   */
  useEffect(() => {
    const wanted = declarations.filter(
      (entry) => entry.source === 'index' && entry.version !== undefined && !installedIndex.has(entry.name),
    );
    if (wanted.length === 0) return;
    let cancelled = false;
    void restoreInstalledIndex(wanted, createProductionBackend())
      .then((restored) => {
        if (cancelled || restored.size === 0) return;
        setInstalledIndex((previous) => {
          const next = new Map(previous);
          for (const [name, entry] of restored) {
            if (!next.has(name)) next.set(name, entry);
          }
          return next;
        });
      })
      .catch(() => {
        // Stays grey with the validation reason; reinstall rebuilds.
      });
    return () => {
      cancelled = true;
    };
  }, [declarations, installedIndex]);

  /* Debounced browse input: the index holds tens of thousands of rows, so typing filters on a delay. */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  /*
   * Lazy index load on first Browse open. A fresh cache serves immediately
   * with zero fetches; the background refresh is an explicit refreshIndex()
   * call (Task 1 contract), landing only while the browse is still open.
   */
  useEffect(() => {
    if (!browseOpen || indexLibs !== null || indexLoading) return;
    let cancelled = false;
    setIndexLoading(true);
    const store = createProductionBackend();
    fetchIndex({ store })
      .then((libs) => {
        if (cancelled) return;
        setIndexLibs(libs);
        setIndexLoading(false);
        void refreshIndex({ store })
          .then((fresh) => {
            if (!cancelled) setIndexLibs(fresh);
          })
          .catch(() => {
            // Stale rows stay; the next open retries the refresh.
          });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setIndexLoading(false);
        reportHelperError(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [browseOpen, indexLibs, indexLoading]);

  const categories = useMemo(
    () => (indexLibs === null ? [] : indexCategories(indexLibs)),
    [indexLibs],
  );
  const browseResults = useMemo(
    () =>
      indexLibs === null
        ? []
        : searchIndex(indexLibs, debouncedQuery.trim(), category === 'all' ? undefined : { category }),
    [indexLibs, debouncedQuery, category],
  );
  const selectedLib =
    selectedName === null ? null : (indexLibs?.find((lib) => lib.name === selectedName) ?? null);
  const selectedLatest = selectedLib === null ? null : (selectIndexRelease(selectedLib)?.version ?? null);
  const effectivePin = pinnedVersion ?? selectedLatest;

  /** Declared index version for a name, else null (browse rows then badge 'install'). */
  const installedVersionOf = (name: string): string | null => {
    const declared = declarations.find((entry) => entry.name === name && entry.source === 'index');
    return declared?.version ?? null;
  };

  /** Latest index version for a name, else null when the index is unloaded or releaseless. */
  const latestVersionOf = (name: string): string | null => {
    const lib = indexLibs?.find((candidate) => candidate.name === name) ?? null;
    if (lib === null) return null;
    return selectIndexRelease(lib)?.version ?? null;
  };

  /*
   * Pinned index install through the Tier-2 pipeline, through the same
   * notice pattern as the tab helpers: progress reads like the compile
   * progress in the bench header, and a cancelled install lands 'install
   * cancelled' and stays undeclared, the way a cancelled compile stays
   * stopped. The version is pinned on the declaration; the verified build's
   * headers join the session's installed map for validation. Reinstalls
   * (`force`) evict the cached entry first, so they always refetch + rebuild
   * per spec §2 instead of no-op on a cache hit.
   */
  const handleInstallIndex = async (name: string, version: string, force = false) => {
    const lib = indexLibs?.find((candidate) => candidate.name === name) ?? null;
    const release = lib === null ? null : selectIndexRelease(lib, version);
    if (release === null) {
      // Requested version absent from the index: name it, never silently install latest.
      reportHelperError(`<${name}>: version ${version} is not in the index`);
      return;
    }
    if (installing !== null) {
      reportHelperError(`<${name}>: install already in progress`);
      return;
    }
    const controller = new AbortController();
    installAbortRef.current = controller;
    setInstalling({ name, version });
    setNotice(null);
    try {
      const backend = createProductionBackend();
      const fetchArchive = async (url: string): Promise<Uint8Array> => {
        if (controller.signal.aborted) throw new Error('install cancelled');
        // Signal wired into the transfer itself: cancel aborts a large
        // download instead of waiting it out.
        return fetchIndexArchive(url, fetch, controller.signal);
      };
      const cache = {
        get: (key: string) => backend.get(key),
        put: (key: string, value: Uint8Array) => backend.put(key, value),
        delete: (key: string) => backend.delete(key),
      };
      const compileUnit = (source: string, headers: ReadonlyMap<string, string>) => {
        if (controller.signal.aborted) return Promise.reject(new Error('install cancelled'));
        // Same two-stage cc1plus→as unit build Tier-2 installs use; the
        // toolchain assets load over plain fetch here because the browser
        // UI thread carries no FetchCache shim (cf. client.ts, in-worker only).
        return compileToolchainUnit({ name: 'IndexUnit.cpp', source, headers });
      };
      const built = force
        ? await reinstallIndexObjects({ name, release }, { fetch: fetchArchive, cache, compileUnit })
        : await buildIndexObjects(
          { name, release },
          { fetch: fetchArchive, cache, compileUnit },
        );
      if (controller.signal.aborted) throw new Error('install cancelled');
      const headers = [...built.headers.keys()];
      setInstalledIndex((previous) => new Map(previous).set(name, { version, headers }));
      // Same-name rows replace, so reinstalls re-pin rather than duplicate.
      // Lands on projectRef.current (fresh), not the stale closed-over project.
      onProjectChange(applyIndexInstall(projectRef.current, name, version));
      setNotice(null);
    } catch (cause) {
      reportHelperError(cause);
    } finally {
      if (installAbortRef.current === controller) {
        installAbortRef.current = null;
        setInstalling(null);
      }
    }
  };

  const handleCancelInstall = () => {
    installAbortRef.current?.abort();
  };

  const handleUninstallIndex = (name: string) => {
    // Uninstall drops the declaration while the cached objects stay shared
    // in IDB — they are simply never referenced again.
    setInstalledIndex((previous) => {
      if (!previous.has(name)) return previous;
      const next = new Map(previous);
      next.delete(name);
      return next;
    });
    handleUndeclare(name);
  };

  const installedIndexEntries = declarations.filter((entry) => entry.source === 'index');
  const indexFootnote = indexLicenseNote(
    installedIndexEntries.map((entry) => ({
      name: entry.name,
      version: entry.version ?? installedIndex.get(entry.name)?.version ?? 'unknown',
      // No license field: the index advertises none, so no terms are claimed.
    })),
  );

  /*
   * Library declarations and custom slots, through the same notice pattern as
   * the tab helpers: a rejected op reads like any other firmware error.
   * Slot file paths keep their original casing (`MyLib.h` is legal here
   * while a tab of that name is not), checked by the same rule the loader
   * enforces on saves and shares.
   */
  const handleAddProvided = (name: string) => {
    if (declarations.some((entry) => entry.name === name)) {
      reportHelperError(`<${name}>: duplicate library`);
      return;
    }
    onProjectChange({ ...project, libraries: [...declarations, { name, source: 'provided' }] });
    setNotice(null);
  };

  const handleUndeclare = (name: string) => {
    onProjectChange({ ...project, libraries: declarations.filter((entry) => entry.name !== name) });
    setNotice(null);
  };

  const handleAddSlot = () => {
    const name = window.prompt('New library name', 'MyLib');
    if (!name || !name.trim()) return;
    const id = name.trim();
    if (slots.some((slot) => slot.id === id)) {
      reportHelperError(`${id}: library already exists`);
      return;
    }
    // A slot with no declaration compiles to nothing, so the declaration
    // arrives with the slot; removing the slot below takes it back.
    const declaration = `custom:${id}`;
    onProjectChange({
      ...project,
      slots: [...slots, { id, name: id, files: [] }],
      libraries: declarations.some((entry) => entry.name === declaration)
        ? declarations
        : [...declarations, { name: declaration, source: 'custom' }],
    });
    setSlotId(id);
    setSlotPath(null);
    setNotice(null);
  };

  const handleRemoveSlot = (id: string) => {
    const declaration = `custom:${id}`;
    onProjectChange({
      ...project,
      slots: slots.filter((slot) => slot.id !== id),
      libraries: declarations.filter((entry) => entry.name !== declaration),
    });
    if (slotId === id) {
      setSlotId(null);
      setSlotPath(null);
    }
    setNotice(null);
  };

  const handleDeclareSlot = (id: string) => {
    const declaration = `custom:${id}`;
    if (declarations.some((entry) => entry.name === declaration)) return;
    onProjectChange({ ...project, libraries: [...declarations, { name: declaration, source: 'custom' }] });
    setNotice(null);
  };

  const slotPathProblem = (slot: LibrarySlot, path: string, except?: string): string | null => {
    const trimmed = path.trim();
    if (trimmed === '') return 'library file: path must not be empty';
    const bad = validateSlotPath(trimmed);
    if (bad) return bad;
    if (slot.files.some((file) => file.path === trimmed && file.path !== except)) {
      return `${trimmed}: file already exists`;
    }
    return null;
  };

  const handleAddSlotFile = (id: string) => {
    const slot = slots.find((candidate) => candidate.id === id);
    if (!slot) return;
    const path = window.prompt('New library file path', 'MyLib.h');
    if (!path || !path.trim()) return;
    const problem = slotPathProblem(slot, path);
    if (problem) {
      reportHelperError(problem);
      return;
    }
    const trimmed = path.trim();
    onProjectChange({
      ...project,
      slots: slots.map((candidate) =>
        candidate.id === id
          ? { ...candidate, files: [...candidate.files, { path: trimmed, content: '' }] }
          : candidate,
      ),
    });
    selectSlotFile(id, trimmed);
    setNotice(null);
  };

  const handleRenameSlotFile = (id: string, path: string) => {
    const slot = slots.find((candidate) => candidate.id === id);
    if (!slot) return;
    const next = window.prompt('Rename library file', path);
    if (!next || next.trim() === path) return;
    const problem = slotPathProblem(slot, next, path);
    if (problem) {
      reportHelperError(problem);
      return;
    }
    const trimmed = next.trim();
    onProjectChange({
      ...project,
      slots: slots.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              files: candidate.files.map((file) => (file.path === path ? { ...file, path: trimmed } : file)),
            }
          : candidate,
      ),
    });
    selectSlotFile(id, trimmed);
    setNotice(null);
  };

  const handleRemoveSlotFile = (id: string, path: string) => {
    onProjectChange({
      ...project,
      slots: slots.map((candidate) =>
        candidate.id === id
          ? { ...candidate, files: candidate.files.filter((file) => file.path !== path) }
          : candidate,
      ),
    });
    if (slotId === id && (slotPath === path || slotPath === null)) {
      const slot = slots.find((candidate) => candidate.id === id);
      const rest = slot?.files.filter((file) => file.path !== path) ?? [];
      setSlotPath(rest[0]?.path ?? null);
    }
    setNotice(null);
  };

  const handleSlotContentChange = (id: string, path: string, next: string) => {
    // Same 32 KB cap as sketch tabs: the edit is rejected by the controlled
    // `value`, so surface it now rather than at the next Run.
    if (next.length > MAX_FILE_BYTES) {
      reportHelperError(`${path}: file is larger than 32 KB`);
      return;
    }
    onProjectChange({
      ...project,
      slots: slots.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              files: candidate.files.map((file) => (file.path === path ? { ...file, content: next } : file)),
            }
          : candidate,
      ),
    });
    setNotice(null);
  };

  const handleRun = () => {
    setNotice(null);
    onRun();
  };

  const displayError = notice ?? error;

  /*
   * Library errors name their origin (`path:line`, as the worker reports
   * them): open the Libraries popup on that slot file, the same way Run
   * opens the sketch tab an interpreter error names.
   */
  useEffect(() => {
    const target = matchSlotFile(displayError, slots);
    if (target !== null) {
      setSlotId(target.slotId);
      setSlotPath(target.path);
      setLibsPopupOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayError]);

  /*
   * Popup dismissal: an outside pointer or Escape closes, the way a menu
   * should. The header button lives outside the popup node, so its clicks are
   * ignored here and toggle instead.
   */
  useEffect(() => {
    if (!libsPopupOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-libs-popup]') ?? false) return;
      if (target?.closest?.('[data-libs-button]') ?? false) return;
      setLibsPopupOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLibsPopupOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [libsPopupOpen]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
        {!headerHidden && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase transition-colors hover:text-slate-200"
        >
          <CaretRightIcon
            className={`icon-sm transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span className="text-slate-500">
            <CodeIcon className="icon-sm" aria-hidden="true" />
          </span>
          Firmware
        </button>
        )}

        {/*
         * Which grammar, stated rather than inferred. The two are not
         * interchangeable and neither is a subset of the other, so the editor
         * cannot pick one from the text and the bench cannot switch the board
         * under a sketch without saying so.
         */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Firmware language</span>
          <Select
            value={language}
            onValueChange={(next) => onChangeLanguage(next as FirmwareLanguage)}
          >
            <SelectTrigger
              className="h-7 text-xs"
              aria-label="Firmware language"
              title={
                language === 'python'
                  ? 'Python, with the gpiozero API. A Raspberry Pi runs this.'
                  : 'An Arduino sketch. Runs on every microcontroller here.'
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="arduino-cpp">C++</SelectItem>
              <SelectItem value="python">Python</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {/*
         * An example carries its own wiring, so picking one replaces the
         * sketch *and* rebuilds the bench around it. Loading a sketch onto a
         * bench that has none of its parts teaches the wrong thing twice.
         */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Load an example</span>
          <Select value={activeExampleId ?? undefined} onValueChange={onLoadExample}>
            <SelectTrigger className="h-7 max-w-44 text-xs" aria-label="Load an example">
              <SelectValue placeholder="Load an example…" />
            </SelectTrigger>
            <SelectContent>
              {examples.map((example) => (
                <SelectItem key={example.id} value={example.id}>
                  <span title={example.note}>{example.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <span className="flex-1" />
        {/*
         * Libraries live in a popup, not a section: the old section stacked
         * the catalogue, the index browser and a second Monaco in one
         * `max-h-96` box and overflowed. The badge counts active declarations;
         * custom slot *files* still edit below the sketch when one is picked.
         */}
        <div data-libs-button>
          <Button
            type="button"
            onClick={() => setLibsPopupOpen((open) => !open)}
            aria-expanded={libsPopupOpen}
            size="sm"
            variant="secondary"
            title="Libraries: which are active, which are available"
          >
            Libraries
            {declarations.length > 0 && (
              <span className="num text-slate-400">{declarations.length}</span>
            )}
          </Button>
        </div>
        {/*
         * One button that changes what it does, so the pair never sits side by
         * side claiming equal weight. Reset is deliberately the quiet
         * dressing: it discards run state, it does not start work.
         */}
        <Button
          type="button"
          onClick={running ? onReset : handleRun}
          size="sm"
          variant={running ? 'secondary' : 'default'}
          title={running ? 'Reset the running sketch' : 'Run this sketch'}
        >
          {running ? (
            <ResetIcon className="icon" aria-hidden="true" />
          ) : (
            <PlayIcon className="icon" aria-hidden="true" />
          )}
          {running ? 'Reset' : 'Run'}
        </Button>
      </div>

      {expanded && (
        <>
          {!headerHidden && (
          <>
          {/*
           * One tab per file over a single Monaco instance. The entry tab has
           * no close button; double-click renames in v1. Tab order is file
           * order, which is also include order.
           */}
          <div
            role="tablist"
            aria-label="Firmware files"
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 px-2 py-1"
          >
            {project.files.map((file) => {
              const selected = file.name === active?.name;
              const isEntry = file.name === entry;
              return (
                <div
                  key={file.name}
                  role="tab"
                  aria-selected={selected}
                  className={`flex shrink-0 items-center rounded-md font-mono text-xs ${
                    selected ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectFile(file.name)}
                    onDoubleClick={() => handleRenameFile(file.name)}
                    title={isEntry ? file.name : `${file.name} — double-click to rename`}
                    className="rounded-md px-2 py-1 transition-colors hover:text-slate-100"
                  >
                    {file.name}
                  </button>
                  {!isEntry && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(file.name)}
                      aria-label={`Remove ${file.name}`}
                      title={`Remove ${file.name}`}
                      className="rounded-md px-1 py-1 text-slate-500 transition-colors hover:text-red-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              onClick={handleAddFile}
              variant="secondary"
              size="icon-sm"
              className="shrink-0 font-mono"
              aria-label="Add file"
              title="Add file"
            >
              +
            </Button>
          </div>
          </>
          )}
          <Editor
            height="100%"
            language={language === 'python' ? PYTHON_LANGUAGE : FIRMWARE_LANGUAGE}
            theme={FIRMWARE_THEME}
            value={active?.content ?? ''}
            onChange={(next) => {
              if (active) handleContentChange(active.name, next ?? '');
            }}
            onMount={handleMount}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineHeight: 19,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              padding: { top: 10, bottom: 10 },
              renderLineHighlight: 'none',
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'off',
            }}
          />
          {/*
           * Libraries: the curated provided set plus the project's own custom
           * slots, in a popup over the editor rather than a section under it.
           * Provided rows come from the Tier-1 bundle list and the Tier-2
           * manifest with add/remove buttons; declared-but-unknown names sit
           * greyed with the validation reason, as do custom declarations
           * whose slot is empty. Slot files edit in a second Monaco below the
           * sketch when one is picked, reusing the tab helpers and the notice
           * pattern — paths keep their original casing throughout.
           */}
          {libsPopupOpen && (
            <div
              data-libs-popup
              ref={libsPopupRef}
              role="dialog"
              aria-label="Libraries"
              className="absolute top-11 right-2 bottom-12 z-50 flex w-[min(94vw,38rem)] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
            >
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase">
                  Libraries
                </span>
                {declarations.length > 0 && (
                  <span className="num text-[11px] text-slate-500">{declarations.length}</span>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setLibsPopupOpen(false)}
                  aria-label="Close libraries"
                  title="Close (Esc)"
                  className="flex size-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
                >
                  <Cross2Icon className="icon-sm" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {/*
                 * Library Manager browse: lazy index search (debounced input,
                 * category filter, 50-row pages from the search cap), detail,
                 * and pinned installs. The index loads on first open only.
                 */}
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                    Index
                  </span>
                  <span className="flex-1" />
                  <Button
                    type="button"
                    onClick={() => setBrowseOpen((open) => !open)}
                    variant="secondary"
                    size="sm"
                    aria-expanded={browseOpen}
                    title="Browse the Arduino library index"
                  >
                    {browseOpen ? 'Close browse' : 'Browse…'}
                  </Button>
                </div>
                {browseOpen && (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={searchPlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Search libraries"
                        className="h-7 text-xs"
                      />
                      <label className="flex shrink-0 items-center gap-1.5">
                        <span className="sr-only">Category filter</span>
                        <Select value={category} onValueChange={setCategory}>
                          <SelectTrigger className="h-7 text-xs" aria-label="Category filter">
                            <SelectValue placeholder="All categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All categories</SelectItem>
                            {categories.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                    {indexLoading ? (
                      <p className="py-1 text-xs text-slate-600" role="status">
                        Loading the library index…
                      </p>
                    ) : indexLibs === null ? (
                      <p className="py-1 text-xs text-slate-600">
                        The index loads when Browse opens, and never before.
                      </p>
                    ) : browseResults.length === 0 ? (
                      <p className="py-1 text-xs text-slate-600">
                        No libraries match “{debouncedQuery.trim()}”.
                      </p>
                    ) : (
                      <>
                        <p className="text-[11px] text-slate-600">
                          {browseResults.length} match{browseResults.length === 1 ? '' : 'es'}
                          {browseResults.length >= 50 ? ' — first 50, refine the search' : ''}
                        </p>
                        <div className="flex flex-col gap-1">
                          {browseResults.map((lib) => {
                            const latest = selectIndexRelease(lib)?.version ?? null;
                            const installed = installedVersionOf(lib.name);
                            const selected = lib.name === selectedName;
                            return (
                              <div
                                key={lib.name}
                                className={`flex shrink-0 items-center gap-2 rounded-md text-xs ${
                                  selected ? 'bg-slate-800 text-slate-100' : ''
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedName(lib.name);
                                    setPinnedVersion(null);
                                  }}
                                  title={lib.sentence}
                                  className="truncate rounded-md px-2 py-1 font-mono text-slate-200 transition-colors hover:text-slate-100"
                                >
                                  {lib.name}
                                </button>
                                <span className="truncate text-[11px] text-slate-500">{lib.sentence}</span>
                                <span className="flex-1" />
                                <span className="shrink-0 text-[11px] text-slate-500">
                                  {latest === null ? 'no releases' : badgeFor({ installed, latest })}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {selectedLib !== null && (
                      <div className="rounded-md border border-slate-800 p-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-slate-100">{selectedLib.name}</span>
                          <span className="flex-1" />
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedName(null);
                              setPinnedVersion(null);
                            }}
                            aria-label={`Close ${selectedLib.name} details`}
                            title="Close details"
                            className="rounded-md px-1 py-0.5 text-slate-500 transition-colors hover:text-slate-100"
                          >
                            ×
                          </button>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">{selectedLib.sentence}</p>
                        <p className="text-[11px] text-slate-500">
                          by {selectedLib.author} · {selectedLib.category} ·{' '}
                          {selectedLib.architectures.join(', ')}
                        </p>
                        {/* No license line: the index advertises none, so none is claimed. */}
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <label className="flex items-center gap-1.5">
                            <span className="sr-only">Version to install</span>
                            <Select
                              value={effectivePin ?? undefined}
                              onValueChange={(next) => setPinnedVersion(next)}
                            >
                              <SelectTrigger className="h-7 text-xs" aria-label="Version to install">
                                <SelectValue placeholder="Pick a version" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedLib.versions.map((release) => (
                                  <SelectItem key={release.version} value={release.version}>
                                    {release.version}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          {installing !== null && installing.name === selectedLib.name ? (
                            /*
                             * Install progress reuses the compile progress +
                             * cancel UX: quiet status text with an abort beside
                             * it, in the same dressing as the bench header.
                             */
                            <span
                              className="flex items-center gap-1.5 text-xs text-slate-400"
                              role="status"
                            >
                              Installing {installing.name}@{installing.version}…
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={handleCancelInstall}
                                title="Abort the in-flight install"
                              >
                                Cancel
                              </Button>
                            </span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              disabled={effectivePin === null}
                              onClick={() => {
                                if (effectivePin !== null) void handleInstallIndex(selectedLib.name, effectivePin, installedVersionOf(selectedLib.name) !== null);
                              }}
                              title={
                                effectivePin === null
                                  ? 'No indexed releases to install'
                                  : installedVersionOf(selectedLib.name) === null
                                    ? `Install ${selectedLib.name}@${effectivePin}, pinned`
                                    : `Rebuild ${selectedLib.name}@${effectivePin}`
                              }
                            >
                              {installedVersionOf(selectedLib.name) === null ? 'Install' : 'Reinstall'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {providedCatalog.map(({ name, tier }) => {
                    const declared = declarations.some(
                      (entry) => entry.name === name && entry.source === 'provided',
                    );
                    return (
                      <div key={name} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-slate-200">{name}</span>
                        {tier === 'fetch' && (
                          <span
                            className="text-[11px] text-slate-500"
                            title="Tier-2 libraries download once, then cache"
                          >
                            {NOT_FETCHED_NOTE}
                          </span>
                        )}
                        <span className="flex-1" />
                        {declared ? (
                          <button
                            type="button"
                            onClick={() => handleUndeclare(name)}
                            aria-label={`Remove ${name}`}
                            title={`Remove ${name}`}
                            className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:text-red-300"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddProvided(name)}
                            aria-label={`Add ${name}`}
                            title={`Add ${name}`}
                            className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:text-slate-100"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {declarations
                    .filter(
                      (entry) =>
                        entry.source === 'provided' &&
                        !providedCatalog.some((known) => known.name === entry.name),
                    )
                    .map((entry) => (
                      <div
                        key={entry.name}
                        className="flex items-center gap-2 text-xs text-slate-500"
                      >
                        <span className="font-mono">{entry.name}</span>
                        <span className="text-[11px]">
                          {reasonFor(entry.name, libraryProblems) ?? 'unknown provided library'}
                        </span>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => handleUndeclare(entry.name)}
                          aria-label={`Remove ${entry.name}`}
                          title={`Remove ${entry.name}`}
                          className="rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  {declarations
                    .filter((entry) => entry.source === 'custom')
                    .map((entry) => {
                      const id = entry.name.startsWith('custom:')
                        ? entry.name.slice('custom:'.length)
                        : null;
                      const slot =
                        id !== null ? slots.find((candidate) => candidate.id === id) : undefined;
                      const reason = reasonFor(entry.name, libraryProblems);
                      return (
                        <div
                          key={entry.name}
                          className={`flex items-center gap-2 text-xs ${
                            slot === undefined ? 'text-slate-500' : 'text-slate-200'
                          }`}
                        >
                          <span className="font-mono">{entry.name}</span>
                          <span className="text-[11px] text-slate-500">
                            {slot === undefined ? (reason ?? 'library slot is empty') : 'custom'}
                          </span>
                          <span className="flex-1" />
                          <button
                            type="button"
                            onClick={() => handleUndeclare(entry.name)}
                            aria-label={`Remove ${entry.name}`}
                            title={`Remove ${entry.name}`}
                            className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                </div>

                {/*
                 * Installed index builds, one row per declaration in link
                 * order: `Name@version ✓ cached` after a verified build.
                 * Declared-but-unbuilt entries sit greyed with the validation
                 * reason, the way unknown provided names do.
                 */}
                {installedIndexEntries.length > 0 && (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                        Installed
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {installedIndexEntries.map((entry) => {
                        const built = installedIndex.get(entry.name);
                        const version = entry.version ?? built?.version ?? null;
                        const latest = latestVersionOf(entry.name);
                        return (
                          <div
                            key={entry.name}
                            className={`flex items-center gap-2 text-xs ${
                              built === undefined ? 'text-slate-500' : ''
                            }`}
                          >
                            <span className="font-mono text-slate-200">
                              {version === null ? entry.name : buildRowLabel(entry.name, version)}
                            </span>
                            {built === undefined ? (
                              <span className="text-[11px]">
                                {reasonFor(entry.name, libraryProblems) ?? 'unknown index library'}
                              </span>
                            ) : (
                              latest !== null && (
                                <span className="text-[11px] text-slate-500">
                                  {badgeFor({ installed: built.version, latest })}
                                </span>
                              )
                            )}
                            <span className="flex-1" />
                            {built !== undefined && version !== null && (
                              <button
                                type="button"
                                onClick={() => void handleInstallIndex(entry.name, version, true)}
                                aria-label={`Rebuild ${entry.name}`}
                                title={`Rebuild ${entry.name}@${version}`}
                                className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:text-slate-100"
                              >
                                Reinstall
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleUninstallIndex(entry.name)}
                              aria-label={`Remove ${entry.name}`}
                              title={`Remove ${entry.name}`}
                              className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {/*
                     * Index license footnote: terms only ever come from
                     * advertised text, so with nothing advertised there is no
                     * line at all rather than a guess.
                     */}
                    {indexFootnote !== null && (
                      <p className="mt-1 text-[11px] text-slate-500">{indexFootnote}</p>
                    )}
                  </>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                    Custom
                  </span>
                  <span className="flex-1" />
                  <Button
                    type="button"
                    onClick={handleAddSlot}
                    variant="secondary"
                    size="icon-sm"
                    className="shrink-0 font-mono"
                    aria-label="New custom library"
                    title="New custom library"
                  >
                    +
                  </Button>
                </div>
                {slots.length === 0 ? (
                  <p className="py-1 text-xs text-slate-600">
                    No custom libraries. A new one starts empty — add headers and sources, then
                    include them from the sketch.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {slots.map((slot) => {
                      const declaration = `custom:${slot.id}`;
                      const isDeclared = declarations.some(
                        (entry) => entry.name === declaration,
                      );
                      const selected = slot.id === activeSlotId;
                      return (
                        <div
                          key={slot.id}
                          className={`flex shrink-0 items-center gap-2 rounded-md font-mono text-xs ${
                            selected ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => selectSlotFile(slot.id, slot.files[0]?.path ?? null)}
                            title={`${slot.name} — ${slot.files.length} files`}
                            className="rounded-md px-2 py-1 transition-colors hover:text-slate-100"
                          >
                            {slot.name}
                          </button>
                          <span className="num text-[11px] text-slate-500">
                            {slot.files.length}
                          </span>
                          {!isDeclared && (
                            <button
                              type="button"
                              onClick={() => handleDeclareSlot(slot.id)}
                              aria-label={`Declare ${slot.name}`}
                              title={`Declare ${slot.name}`}
                              className="rounded-md px-1.5 py-0.5 font-sans text-[11px] text-slate-400 transition-colors hover:text-slate-100"
                            >
                              Declare
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(slot.id)}
                            aria-label={`Remove ${slot.name}`}
                            title={`Remove ${slot.name}`}
                            className="rounded-md px-1 py-1 font-sans text-slate-500 transition-colors hover:text-red-300"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          {selectedSlot && (
            <div className="shrink-0 border-t border-slate-800">
              <>
                <div
                  role="tablist"
                  aria-label="Library files"
                      className="mt-1 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 px-2 py-1"
                    >
                      {selectedSlot.files.map((file) => {
                        const selected = file.path === activeSlotPath;
                        return (
                          <div
                            key={file.path}
                            role="tab"
                            aria-selected={selected}
                            className={`flex shrink-0 items-center rounded-md font-mono text-xs ${
                              selected ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => selectSlotFile(selectedSlot.id, file.path)}
                              onDoubleClick={() => handleRenameSlotFile(selectedSlot.id, file.path)}
                              title={`${file.path} — double-click to rename`}
                              className="rounded-md px-2 py-1 transition-colors hover:text-slate-100"
                            >
                              {file.path}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveSlotFile(selectedSlot.id, file.path)}
                              aria-label={`Remove ${file.path}`}
                              title={`Remove ${file.path}`}
                              className="rounded-md px-1 py-1 text-slate-500 transition-colors hover:text-red-300"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        onClick={() => handleAddSlotFile(selectedSlot.id)}
                        variant="secondary"
                        size="icon-sm"
                        className="shrink-0 font-mono"
                        aria-label="Add library file"
                        title="Add library file"
                      >
                        +
                      </Button>
                    </div>
                    {selectedSlotFile && activeSlotId && activeSlotPath ? (
                      <Editor
                        height="12rem"
                        language={FIRMWARE_LANGUAGE}
                        theme={FIRMWARE_THEME}
                        value={selectedSlotFile.content}
                        onChange={(next) => {
                          handleSlotContentChange(activeSlotId, activeSlotPath, next ?? '');
                        }}
                        onMount={handleSlotMount}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 12,
                          lineHeight: 19,
                          fontFamily:
                            "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                          scrollBeyondLastLine: false,
                          smoothScrolling: true,
                          cursorBlinking: 'smooth',
                          padding: { top: 10, bottom: 10 },
                          renderLineHighlight: 'none',
                          automaticLayout: true,
                          tabSize: 2,
                          wordWrap: 'off',
                        }}
                      />
                    ) : (
                      <p className="px-1 py-2 text-xs text-slate-600">
                        Empty library: add a header and its sources from the Libraries popup.
                      </p>
                    )}
                  </>
              </div>
            )}
        </>
      )}

      {displayError && (
        <p className="flex shrink-0 items-start gap-1.5 border-t border-red-900 bg-red-950 px-3 py-1.5 text-xs text-red-300">
          <CrossCircledIcon className="icon-sm mt-px shrink-0" aria-hidden="true" />
          {displayError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StatusBar({
  timeMs,
  running,
  netCount,
}: {
  timeMs: number;
  running: boolean;
  netCount: number;
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-800 bg-slate-900 px-3 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        {/*
         * The lamp is the fastest read on the whole bench: it is the only
         * thing visible when the operator's eyes are on the breadboard, so it
         * pulses in step with the solver rather than sitting steady.
         */}
        <span className="relative flex size-2">
          {running && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={`relative inline-block size-2 rounded-full ${running ? 'bg-emerald-400' : 'bg-slate-600'}`}
          />
        </span>
        <span className={running ? 'text-slate-200' : ''}>{running ? 'Running' : 'Stopped'}</span>
      </span>
      <span className="num">t = {timeMs.toFixed(0)} ms</span>
      <span className="num">{netCount} nets</span>
      <span className="ml-auto hidden truncate text-slate-600 md:inline">
        Drag to move · wheel to zoom · shift-drag to pan
      </span>
    </footer>
  );
}
