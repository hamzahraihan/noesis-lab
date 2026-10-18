/**
 * The Noesis Lab workbench, for one chosen board.
 *
 * The whole UI is a thin shell over `Simulation`: the bench model is mutable and
 * lives outside React, and the component tree re-renders from a version counter
 * each animation frame. Rendering a populated breadboard means walking nearly a
 * thousand terminals, so keeping that work out of the render path is the
 * difference between a smooth bench and a slideshow.
 *
 * The board arrives as a prop from the route rather than as local state, so a
 * bench is addressable: `/bench/uno` is the Uno bench, and reloading it or
 * sending the link to someone else rebuilds the same board.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { isLargePart, type CatalogueEntry } from '@/features/parts';
import { Sidebar } from '../ide/Sidebar';
import { CatalogueGrid } from '../ide/CatalogueGrid';
import { breadboardDefinition, columnX, railRowY, stripRowY } from '@/features/parts';
import { ledDefinition, resistorDefinition } from '@/features/parts';
import { DIODE_PROFILES } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import { Servo, type DisplayController, type Lcd1602 } from '@/features/parts';
import type { BendPoint, PartInstance, Terminal } from '@/features/simulation';
import { ili9341Definition, ssd1306Definition } from '@/features/parts';
import { Workbench } from './Workbench';
import { TopBar } from '../ide/TopBar';
import { ActivityBar } from '../ide/ActivityBar';
import type { FootprintState } from '../wokwi/footprints';
import { BREADBOARD_ORIGIN_X, Simulation } from '../simulations/simulation';
import {
  createWorkerClient,
  lcdFromSnapshot,
  sevenSegmentFromSnapshot,
  tftFromSnapshot,
  type WorkerClient,
} from '../simulations/worker-client';
import { CenterTabs } from '../ide/CenterTabs';
import { BottomPanel } from '../ide/BottomPanel';
import { ResizeHandle } from '../ide/ResizeHandle';
import { WokwiLibrary } from '../wokwi/WokwiLibrary';
import { bottomTabForError, centerKeyForFile, resolveErrorCenter } from '../store/shell-state';
import { persistLayoutSoon, useBenchShellStore, useLayoutStore } from '../store/bench-store';
import type {
  BoardId,
  BoardOption,
  Example,
  Exercise,
  GalleryBuild,
  GalleryProject,
  StarterWiring,
} from '@/features/learn';
import type { FirmwareLanguage, FirmwareProject } from '@/features/simulation';
import {
  ENTRY_BY_LANGUAGE,
  removeFile,
  renameFile,
  toSingleFileProject,
  decompile,
} from '@/features/simulation';
import { FirmwareEditor, Inspector, SerialMonitor, StatusBar } from '@/features/instruments';
import { WIRE_COLOURS } from '../wiring/wire-colours';
import type { WireEnd } from '@/features/simulation';
import { ScopePanel } from '@/features/instruments';
import { MultimeterPanel } from '@/features/instruments';
import { LogicAnalyser } from '@/features/instruments';
import { BusMonitor } from '@/features/instruments';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  Component1Icon,
  Cross2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Link2Icon,
  ReaderIcon,
  DownloadIcon,
  UploadIcon,
} from '@radix-ui/react-icons';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components';
import { decodeShareToProject, isShareable, projectShareQuery } from '../utils/share-codec';
import {
  hasBenchProject,
  loadBenchProject,
  resolveBenchSeed,
  saveBenchProject,
} from '../store/project-store';
import { resolveCircuitSeed, loadCircuit, hasCircuit, saveCircuit } from '../store/circuit-store';
import {
  circuitShareQuery,
  decodeShareToCircuit,
  isCircuitShareable,
} from '../utils/circuit-codec';
import {
  CIRCUIT_FILE_MAX_BYTES,
  UNREADABLE_FILE_NOTICE,
  circuitFileName,
  circuitFileText,
  readCircuitFile,
} from '../utils/circuit-file';
import { avrAvailableFor, resolveBackendSelection } from '../simulations/avr-mode';
import { canResumeRun, type RunSession } from '../simulations/run-session';

/** Left of this the palette opens rightwards, so it stays on screen. */
const PALETTE_FLIP_X = 200;
/** Above this the palette opens downwards, for the same reason. */
const PALETTE_FLIP_Y = 60;

/** Column the starter LED circuit is wired onto. */
const SIGNAL_COLUMN = 20;

/**
 * Shown on every control the running bench refuses to act on, so a dead
 * button says why it is dead and what revives it.
 */
const LAYOUT_LOCK_HINT = 'Pause the run to edit the bench';

/** A terminal-shaped placeholder, for routing wires before a hole exists. */
function at(x: number, y: number): Terminal {
  return { id: -1, x, y };
}

/**
 * Builds the bench the app opens with: a blinking LED, an OLED on I2C and a
 * TFT on SPI.
 *
 * Both displays are wired through to the controller pins their buses actually
 * run on. Pull a wire and that screen goes dark while the other carries on,
 * which is the whole reason they are both here.
 *
 * Assumes the board and breadboard are already down: the caller places those
 * once for every bench, because an exercise needs them too and placing them
 * here would mean two boards on any bench that arrives through this path.
 */
function buildStartingBench(simulation: Simulation, wiring: StarterWiring): void {
  const board = simulation.bench.parts[0];

  const pinAt = (id: string) => {
    const pin = board.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`${board.definition.name} has no pin ${id}`);
    return pin;
  };
  const holeX = (column: number) => BREADBOARD_ORIGIN_X + columnX(column);
  const holeY = (row: number) => stripRowY(row);
  const groundRailY = railRowY(2);

  // --- LED on the bench ---------------------------------------------------
  const ledPin = pinAt(wiring.led);
  simulation.routeWire(at(ledPin.x, ledPin.y), at(holeX(SIGNAL_COLUMN), holeY(8)));
  // Landed by its own leads rather than by a remembered number: the resistor's
  // pins sit 2.54 mm down inside its footprint, which is a whole breadboard
  // row. Hardcoding that offset is what put a part half a row out when the pin
  // moved, and the wire then reached the pin instead of the visible lead.
  const [resistorDx, resistorDy] = offsetOfFirstPin(resistorDefinition(330));
  simulation.addPart(
    resistorDefinition(330),
    holeX(SIGNAL_COLUMN) - resistorDx,
    holeY(8) - resistorDy,
  );
  // Anchored by the anode, so the long leg lands on its hole and the cathode
  // steps one column along; the cathode sits 0.1 mm off pitch, inside snap.
  const ledDef = ledDefinition(DIODE_PROFILES.red, 'Red');
  const ledAnode = ledDef.pins.find((pin) => pin.id === 'anode')!;
  simulation.addPart(ledDef, holeX(SIGNAL_COLUMN + 4) - ledAnode.x, holeY(8) - ledAnode.y);
  simulation.routeWire(
    at(holeX(SIGNAL_COLUMN + 3), holeY(8)),
    at(holeX(SIGNAL_COLUMN + 3), groundRailY),
  );
  const ground = pinAt(wiring.ground);
  simulation.routeWire(at(ground.x, ground.y), at(holeX(10), groundRailY));

  /** Wires a display pin to a breadboard column, and the board pin to it too. */
  const connect = (display: PartInstance, pin: string, column: number, row: number) => {
    const spec = display.definition.pins.find((candidate) => candidate.id === pin);
    if (!spec) throw new Error(`${display.definition.name} has no pin ${pin}`);
    simulation.routeWire(at(holeX(column), holeY(row)), at(display.x + spec.x, display.y + spec.y));
  };

  // --- 128x64 OLED, on I2C ------------------------------------------------
  const oled = simulation.addPart(ssd1306Definition(), BREADBOARD_ORIGIN_X + 40, 86);
  const oledColumn = SIGNAL_COLUMN + 7;
  connect(oled, 'SDA', oledColumn, 8);
  connect(oled, 'SCL', oledColumn + 2, 8);
  simulation.routeWire(
    at(holeX(oledColumn), groundRailY),
    at(oled.x + oled.definition.pins[1].x, oled.y + oled.definition.pins[1].y),
  );
  simulation.routeWire(
    at(holeX(oledColumn + 2), groundRailY),
    at(oled.x + oled.definition.pins[0].x, oled.y + oled.definition.pins[0].y),
  );
  [wiring.i2c[0], wiring.i2c[1]].forEach((boardPin, index) => {
    const pin = pinAt(boardPin);
    simulation.routeWire(at(pin.x, pin.y), at(holeX(oledColumn + index * 2), holeY(8)));
  });

  // --- 2.4" TFT, on SPI ---------------------------------------------------
  const tft = simulation.addPart(ili9341Definition(), BREADBOARD_ORIGIN_X + 55, 150);
  const spiColumn = SIGNAL_COLUMN + 13;
  ['CS', 'DC', 'SCK', 'MOSI'].forEach((signal, index) => {
    const column = spiColumn + index * 2;
    const pin = pinAt(wiring.spi[index]);
    simulation.routeWire(at(pin.x, pin.y), at(holeX(column), holeY(8)));
    connect(tft, signal, column, 8);
  });
  connect(tft, 'VCC', spiColumn, 4);
  connect(tft, 'GND', spiColumn + 2, 4);
}

/**
 * Where dropped parts land.
 *
 * Small parts go onto the breadboard's row-e strip, spaced far enough apart not
 * to sit on each other. Anything board-sized goes on the bench below instead,
 * because dropping a breadboard onto a breadboard would just hide it.
 */
let nextDropColumn = 44;
let nextBenchSlot = 0;

const BENCH_SLOTS_X = [230, 240, 250, 260, 270, 280];
const BENCH_SLOTS_Y = [70, 78, 86];

/**
 * Offset of a part's first pin inside its own footprint.
 *
 * Dropping a part means landing its leads in holes, and where the leads sit
 * inside the footprint differs per part: a resistor's are 1.6 mm down, an
 * LED's are 3 mm and a potentiometer's 4.5 mm. Dropping the origin on the
 * strip row instead is what left half the palette floating above the board.
 */
function offsetOfFirstPin(definition: PartDefinition): [x: number, y: number] {
  let x = Infinity;
  let y = Infinity;
  for (const pin of definition.pins) {
    if (pin.x < x) x = pin.x;
    if (pin.y < y) y = pin.y;
  }
  return [x, y];
}

/**
 * Learn content the bench renders against, injected by the composition layer
 * (`src/routes/BenchRoute.tsx`).
 *
 * The bench never imports `@/features/learn` values itself — the
 * bench → learn direction is forbidden (T7 gate) — so every name below arrives
 * here as a prop with exactly the name the body already uses. The body is
 * untouched; only the source of the names changed from import to argument.
 */
export interface BenchProps {
  readonly BLINK_EXAMPLE: Example;
  readonly EXAMPLES: readonly Example[];
  readonly PI_BLINK_SKETCH: string;
  readonly BOARDS: ReadonlyArray<BoardOption>;
  readonly boardOption: (boardId: BoardId) => BoardOption;
  readonly DEFAULT_BOARD_ID: BoardId;
  readonly isBoardId: (value: string | undefined) => value is BoardId;
  readonly STARTER_WIRING: Readonly<Record<BoardId, StarterWiring>>;
  readonly exerciseBoard: (exercise: Exercise) => BoardId;
  readonly exerciseById: (id: string) => Exercise | null;
  readonly exerciseLanguage: (exercise: Exercise) => FirmwareLanguage;
  readonly buildFor: (
    project: GalleryProject,
    board: BoardId,
    variant?: string,
  ) => GalleryBuild | null;
  readonly firmwareForBuild: (build: GalleryBuild, language: FirmwareLanguage) => FirmwareProject;
  readonly galleryById: (id: string) => GalleryProject | null;
  readonly ExerciseGuide: ComponentType<{
    exercise: Exercise;
    open: boolean;
    onClose(): void;
  }>;
  readonly isGuideDismissed: (id: string) => boolean;
}

export default function Bench(props: BenchProps) {
  const {
    BLINK_EXAMPLE,
    EXAMPLES,
    PI_BLINK_SKETCH,
    BOARDS,
    boardOption,
    DEFAULT_BOARD_ID,
    isBoardId,
    STARTER_WIRING,
    exerciseBoard,
    exerciseById,
    exerciseLanguage,
    buildFor,
    firmwareForBuild,
    galleryById,
    ExerciseGuide,
    isGuideDismissed,
  } = props;
  const navigate = useNavigate();
  const { boardId: requested } = useParams<{ boardId?: string }>();

  /*
   * The board is a route parameter, so it arrives as a string from the URL
   * rather than as one of our own ids. Falling back to the default here is what
   * makes a hand-edited or stale link land on a working bench rather than on a
   * blank page -- and it cannot throw, because the throw would happen inside
   * the bench build below and take the whole route down with it.
   */
  const boardId = isBoardId(requested) ? requested : DEFAULT_BOARD_ID;

  /*
   * An exercise arriving from `/learn`, as `?ex=1.1` on the bench URL.
   *
   * Resolved here rather than in an effect so the circuit is wired before
   * anything first renders it -- an effect would paint the starter bench and
   * then visibly rebuild it underneath the reader.
   *
   * Only honoured on the board the exercise was written for. Every lesson is
   * an Uno lesson unless it says otherwise, and re-applying an Uno's wiring to
   * an ESP32 would put a 5 V circuit on 3.3 V pins -- the mistake Module 3
   * exists to warn about. A lesson that names its own board is only ever
   * applied on that board.
   */
  const [search] = useSearchParams();
  const requestedExercise = search.get('ex');
  const found = requestedExercise === null ? null : exerciseById(requestedExercise);
  const exercise = found !== null && boardId === exerciseBoard(found) ? found : null;

  /*
   * A project arriving from a board page, as `?project=alarm-clock`.
   *
   * Same shape as an exercise — a validated setup plus a sketch — but only
   * honoured on a board the project has a build for, and never together with
   * `?ex=`: an exercise wins when both are present, so a shared link always
   * means one thing.
   */
  const requestedProject = search.get('project');
  const requestedVariant = search.get('variant');
  const foundProject = requestedProject === null ? null : galleryById(requestedProject);
  const projectBuild =
    exercise === null && foundProject !== null
      ? buildFor(foundProject, boardId, requestedVariant ?? undefined)
      : null;

  /*
   * Whether this bench is pinned to an exercise or gallery build: in that case
   * the circuit document is not owned by the operator, so autosave must not
   * persist its wiring into this board's circuit slot.
   */
  const pinned = exercise !== null || projectBuild !== null;

  /*
   * The firmware project: every tab, the language they are written in, and
   * which tab is open.
   *
   * Seeded from the exercise when there is one -- a Pi lesson hands over a
   * Python program and opens the editor in Python, an Uno lesson the same in
   * C++ -- because a reader who pressed "Put it on the bench" and landed on
   * Blink is being told to press Run on a program that is not the one they
   * were just handed.
   *
   * A board that does not run sketches opens on one it can run. Handing a Pi
   * the C++ blink would put a syntax error on screen before anyone had touched
   * anything, which reads as a broken simulator rather than a board that speaks
   * a different language.
   *
   * Seeded once, on mount, in this order: the exercise or gallery build when
   * the URL names one (`?ex=` / `?project=` win over everything, so a shared
   * lesson link always means one thing); then a `?files=` share payload; then
   * this board's autosave; then the starter single-file project. A corrupt
   * `?files=` falls back to the starter with an error line under the editor,
   * never a blank bench — as does an unreadable autosave.
   *
   * The precedence itself lives in `resolveBenchSeed` (project-store) so it is
   * node-testable; this only folds the exercise/build sketch into the starter.
   */
  const starterFor = useCallback(
    (id: BoardId) => {
      const language = boardOption(id).language;
      return toSingleFileProject(
        language === 'python' ? PI_BLINK_SKETCH : BLINK_EXAMPLE.sketch,
        language,
      );
    },
    [boardOption, BLINK_EXAMPLE, PI_BLINK_SKETCH],
  );
  const [seed] = useState(() => {
    const starter =
      exercise !== null
        ? toSingleFileProject(exercise.sketch, exerciseLanguage(exercise))
        : projectBuild !== null
          ? firmwareForBuild(projectBuild, boardOption(boardId).language)
          : starterFor(boardId);
    return resolveBenchSeed({
      starter,
      pinned: exercise !== null || projectBuild !== null,
      sharedPayload: search.get('files'),
      saved: loadBenchProject(boardId),
      hadUnreadableSave: hasBenchProject(boardId),
      decode: decodeShareToProject,
    });
  });
  const [project, setProject] = useState<FirmwareProject>(seed.project);
  /*
   * The corrupt-share notice: shown in the error bar until the next Run, when
   * real firmware errors take over. Editing does not clear it -- the bench
   * still opened a fresh project instead of the link's, which stays true.
   */
  const [shareError, setShareError] = useState<string | null>(seed.shareError);

  /*
   * Autosave: every project change lands in this board's localStorage slot
   * ~500 ms later, so a reload reopens the same tabs.
   */
  useEffect(() => {
    const timer = setTimeout(() => saveBenchProject(boardId, project), 500);
    return () => clearTimeout(timer);
  }, [boardId, project]);
  const {
    sidebarOpen,
    activity,
    activeCenter,
    instrumentsOpen,
    bottomTab,
    bottomOpen,
    selectedId,
    selectedWireId,
    paletteFor,
    wireColour,
    guideOpen,
    projectBannerOpen,
    baud,
    meterRedPin,
    meterBlackPin,
    pickActivity,
    showActivity,
    setActiveCenter,
    repairCenter,
    setBottomTab,
    setBottomOpen,
    toggleBottom,
    setInstrumentsOpen,
    toggleInstruments,
    toggleSidebar,
    selectPart,
    selectWire,
    openPalette,
    closePalette,
    clearSelection,
    clearWire,
    setWireColour,
    setGuideOpen,
    setProjectBannerOpen,
    setBaud,
    setMeterRedPin,
    setMeterBlackPin,
  } = useBenchShellStore();
  const { layout, nudge: nudgeLayout, resetKey: resetLayoutKey } = useLayoutStore();
  /* The center key must name the canvas or a live file; repaired centrally. */
  useEffect(() => {
    repairCenter(project.files, project.activeName);
  }, [project, repairCenter]);
  useEffect(() => persistLayoutSoon(layout), [layout]);
  const [frameTick, forceRender] = useState(0);
  const [exampleId, setExampleId] = useState<string | null>(null);
  /*
   * Which backend the next Run executes on. Uno-only: the AVR option
   * disables with its reason everywhere else, and switching boards drops
   * back to the interpreter, so a Mega can never inherit the Uno's mode.
   */
  const [avrMode, setAvrMode] = useState(projectBuild?.execution === 'avr');
  /* Whether a worker compile is in flight, driving the progress + cancel UI. */
  const [compiling, setCompiling] = useState(false);
  /*
   * Fast forward: run the sketch at twice speed until switched off. A
   * property of the run rather than of either backend, so the toggle
   * survives pause/resume and recompiles, and takes effect mid-run.
   */
  const [fastForward, setFastForward] = useState(false);
  /* Guards the progress flag when a second Run supersedes the first. */
  const compileSeq = useRef(0);
  /*
   * Latest Run handler for the keyboard shortcut below: the effect subscribes
   * once, and the ref carries the current render's handler into it, so Space
   * always loads/compiles exactly what the editor's Run button would.
   */
  const handleRunRef = useRef<() => void>(() => {});
  /*
   * What the last Run loaded: sketch, backend, wiring revision, and owning
   * backend. A paused bench that still matches this record resumes on Run
   * instead of recompiling; anything else misses it and takes the full path.
   */
  const runSession = useRef<RunSession | null>(null);

  /*
   * Switching boards reloads that board's tabs from its own autosave (or its
   * starter when it has none). The project belongs to the board it was written
   * for — pin numbers differ per board — and carrying it across would let the
   * autosave below write the wrong-language project over the new board's own
   * save. `?ex=` / `?project=` / `?files=` stay mount-only: they named the
   * bench that was opened, not the one being switched to.
   *
   * Skipped on mount (the ref still names this board), so the mount seed above
   * is never overwritten by it.
   */
  const mountedBoard = useRef(boardId);
  useEffect(() => {
    if (mountedBoard.current === boardId) return;
    mountedBoard.current = boardId;
    setProject(loadBenchProject(boardId) ?? starterFor(boardId));
    setExampleId(null);
    setShareError(null);
    // AVR mode belongs to the Uno alone: a board switch drops back to the
    // interpreter rather than carrying the mode onto a board that refuses it.
    setAvrMode(false);
  }, [boardId, starterFor]);

  /* AVR-only builds pin the backend: the interpreter option is disabled
   * while one is loaded, so the slow path cannot be selected by accident. */
  useEffect(() => {
    if (projectBuild?.execution === 'avr') setAvrMode(true);
  }, [projectBuild]);

  /* The exercise guide auto-opens on arrival unless dismissed for this exercise. */
  useEffect(() => {
    if (exercise && !isGuideDismissed(exercise.id)) setGuideOpen(true);
    else setGuideOpen(false);
  }, [exercise, isGuideDismissed, setGuideOpen]);

  /* The project banner re-announces itself whenever the build changes. */
  useEffect(() => {
    setProjectBannerOpen(true);
  }, [projectBuild, setProjectBannerOpen]);

  // Rebuilt on board change only: a sketch's pin numbers mean something
  // different on each board, so carrying one across would silently misfire.
  const circuitSeedParam = search.get('circuit');
  const circuitSeedErrorRef = useRef<string | null>(null);
  const simulation = useMemo(() => {
    circuitSeedErrorRef.current = null;
    const created = new Simulation(boardOption(boardId).make());

    if (exercise) {
      /*
       * A pinned build IS a circuit document. The document carries the board
       * and the breadboard, so nothing is placed first: restoring it replaces
       * whatever is on the bench, and anything placed before it would be
       * discarded anyway.
       */
      const admitted = created.loadCircuit(exercise.circuit);
      // A pinned circuit that will not load would otherwise leave an empty
      // bench with nothing said about it; the panel is where the reason goes.
      circuitSeedErrorRef.current = admitted.length > 0 ? admitted.join('; ') : null;
      // In the language the exercise is written in, not the board's default.
      // A Pi lesson hands over Python, and handing that to the C++ parser
      // reports "expected a type" on the first `from` and stops there.
      created.loadFirmware(exercise.sketch, exerciseLanguage(exercise));
    } else if (projectBuild) {
      const admitted = created.loadCircuit(projectBuild.circuit);
      circuitSeedErrorRef.current = admitted.length > 0 ? admitted.join('; ') : null;
      created.loadFirmware(firmwareForBuild(projectBuild, boardOption(boardId).language));
    } else {
      const boardDefinition = boardOption(boardId).make();
      const circuitSeed = resolveCircuitSeed({
        boardDefinitionId: boardDefinition.id,
        pinned: false,
        sharedPayload: circuitSeedParam,
        saved: loadCircuit(boardId),
        hadUnreadableSave: hasCircuit(boardId),
        decode: decodeShareToCircuit,
      });
      if (circuitSeed.circuit !== null) {
        // One seeding primitive whichever way the circuit arrived: the
        // document is compiled, checked against this board's pin model, put
        // down whole and the operator state copied over.
        const refused = created.loadCircuit(circuitSeed.circuit);
        circuitSeedErrorRef.current = refused.length > 0 ? refused.join('; ') : circuitSeed.error;
      } else {
        /*
         * The starter bench is the one circuit that is not a document: it
         * routes wires to the board's own pin ids and to breadboard hole
         * coordinates, so the board and the breadboard have to be down
         * before it does (`new Simulation(board)` builds the MCU but places
         * no part). Without them every wire quietly claims a loose contact of
         * its own and the circuit is drawn but electrically dead.
         */
        created.addPart(boardDefinition, 0, 0);
        created.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);
        buildStartingBench(created, STARTER_WIRING[boardId]);
        circuitSeedErrorRef.current = circuitSeed.error;
      }
      created.loadFirmware(
        boardOption(boardId).language === 'python' ? PI_BLINK_SKETCH : BLINK_EXAMPLE.sketch,
        boardOption(boardId).language,
      );
    }
    /*
     * Deliberately left stopped. The bench opens on a loaded sketch at
     * t=0 that the operator has to run themselves, which is the honest
     * initial state -- starting the moment the page loads ran the firmware
     * before anyone had looked at it, and left the status lamp claiming
     * "running" over a simulation nobody had started.
     */
    /*
     * And the history starts here too. Building the bench went through the
     * same methods the operator edits with, so it pushed history like any
     * other change; without this the first Ctrl+Z on a freshly loaded
     * project would dismantle the project one wire at a time.
     */
    created.clearHistory();
    return created;
  }, [
    boardId,
    exercise,
    projectBuild,
    boardOption,
    STARTER_WIRING,
    PI_BLINK_SKETCH,
    exerciseLanguage,
    BLINK_EXAMPLE,
    firmwareForBuild,
    circuitSeedParam,
  ]);

  /*
   * Autosave: every 500 ms decompile the live bench and persist the circuit
   * document when it changed, so a reload reopens the same parts and wiring.
   *
   * Pinned benches (exercise / gallery build) never autosave their wiring: it
   * belongs to the lesson/build, not to this board's circuit slot. Gating here
   * keeps a plain bench reload from resurrecting lesson wiring.
   */
  const lastSavedCircuitRef = useRef<string | null>(null);
  // Reset the "last saved" hash on any pinned transition so a stale hash
  // cannot suppress the first save on an unpinned bench.
  useEffect(() => {
    lastSavedCircuitRef.current = null;
  }, [pinned]);
  useEffect(() => {
    if (pinned) return;
    const id = window.setInterval(() => {
      const { doc } = decompile(simulation.builder.build(), simulation.controls);
      const serialized = JSON.stringify(doc);
      if (serialized === lastSavedCircuitRef.current) return;
      lastSavedCircuitRef.current = serialized;
      saveCircuit(boardId, doc);
    }, 500);
    return () => window.clearInterval(id);
  }, [boardId, simulation, pinned]);

  /*
   * Surface a corrupt-circuit notice from the seed resolution without calling
   * setState during render.
   */
  useEffect(() => {
    if (circuitSeedErrorRef.current) {
      setShareError(circuitSeedErrorRef.current);
    }
  }, [simulation]);

  /*
   * Sim worker client (Task 8): attempted per simulation; null while the
   * worker is absent or fails, in which case the in-page Simulation owns
   * everything exactly as before. The fallback reason feeds the status
   * lamp's tooltip. `workerLive` is the takeover gate: the worker owns
   * stepping only after its first live `ok` frame lands (handshake success);
   * until then the in-page simulation keeps ticking underneath.
   */
  const [workerClient, setWorkerClient] = useState<WorkerClient | null>(null);
  const [workerFallback, setWorkerFallback] = useState<string | null>(null);
  const [workerLive, setWorkerLive] = useState(false);
  useEffect(() => {
    // A fresh simulation has nothing loaded to resume.
    runSession.current = null;
    setWorkerLive(false);
    const client = createWorkerClient({
      board: simulation.mcu.definition,
      bench: simulation.bench,
      wasm: projectBuild?.execution === 'avr',
      onFallback: (reason) => {
        setWorkerFallback(reason);
        setWorkerClient(null);
        setWorkerLive(false);
      },
    });
    setWorkerClient(client);
    return () => {
      client?.dispose();
      setWorkerClient(null);
      setWorkerLive(false);
    };
    /*
     * The execution mode belongs in the deps even though the client is built
     * per simulation: `wasm` is decided once, here, and nothing later updates
     * it -- without this a project that flipped to AVR would keep a client
     * told to interpret. Re-attaching costs one worker start, which is what
     * the flip costs anyway.
     */
  }, [simulation, projectBuild?.execution]);

  /*
   * The speed multiplier belongs to the run, not to either backend: push it
   * to the in-page tick and to the worker (which keeps its copy across
   * recompiles) whenever the toggle flips or a worker appears. The worker's
   * post queue holds the message until the handshake, so setting it before
   * the first Run is safe.
   */
  useEffect(() => {
    const speed = fastForward ? 2 : 1;
    simulation.setTimeScale(speed);
    workerClient?.setSpeed(speed);
  }, [simulation, workerClient, fastForward]);

  /* Which backend owns stepping + its running flag. One owner only: the
   * worker once its first live frame has landed, else the in-page simulation. */
  const workerActive = workerLive && workerClient !== null;
  const isRunning = workerActive ? workerClient.running : simulation.running;
  /*
   * The bench layout is frozen while the core steps: moving, turning, or
   * rewiring a part mid-run unclips its jumpers and the firmware is suddenly
   * driving a circuit nobody wired. Every layout edit below refuses while this
   * is set. Inputs (button presses, knobs) and cosmetic touches that never
   * re-solve (wire colour, cap colour, rename) stay live, and Pause unlocks
   * everything -- edits then take effect, and the next Run recompiles cleanly.
   */
  const layoutLocked = isRunning;
  const activeStop = useCallback(() => {
    if (workerActive) workerClient.stop();
    else simulation.stop();
  }, [simulation, workerClient, workerActive]);
  /* Firmware verdict from the owning backend (worker fault travels by
   * message; the parse/fallback verdicts stay in-page). */
  const activeFirmwareError = workerActive
    ? (workerClient.fault ?? simulation.firmwareError)
    : simulation.firmwareError;

  // Only pins firmware can actually name are worth probing; the power and
  // ground headers are rails, not signals.
  const probePins = useMemo(
    () => simulation.mcu.pins().filter((pin) => pin.role === 'gpio' || pin.role === 'adc'),
    [simulation],
  );
  // One animation frame drives both the firmware and the circuit solver. The
  // wall-clock delta is what keeps simulated time honest: without it the bench
  // would advance as fast as the solver could go, not as fast as real time.
  useEffect(() => {
    let frame = 0;
    let running = true;
    let previous = performance.now();
    const tick = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - previous) / 1000, 0.25);
      previous = now;
      if (workerClient && workerLive) {
        /*
         * The worker owns stepping; per rAF ingest the live buffer. `'ok'`
         * carries a new frame to draw (and posts one `ack` with its
         * generation, draining the entry's backpressure), `'stale'` renders
         * the last copy (no re-render), and `'reallocated'` rebinds and drops
         * one frame.
         */
        if (workerClient.poll() === 'ok') {
          forceRender((n) => n + 1);
        }
      } else {
        // In-page owns stepping: solely while no worker is constructed, and
        // during the handshake window before its first live frame. A
        // constructed-but-not-yet-live worker is polled for the takeover.
        simulation.tick(deltaSeconds);
        if (workerClient && workerClient.poll() === 'ok') {
          // Handshake success: transfer stepping ownership exactly once.
          setWorkerLive(true);
          forceRender((n) => n + 1);
        } else if (running && simulation.isAnimating()) {
          forceRender((n) => n + 1);
        }
      }

      /*
       * Stop before asking for another frame, not after cancelling one.
       *
       * `cancelAnimationFrame` alone is a race: if the cleanup ran while this
       * callback was mid-execution, the reschedule below landed *after* the
       * cancel and the loop carried on with nothing holding its handle. A flag
       * cannot lose that race -- in either order the loop stops.
       */
      if (running) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [simulation, workerClient, workerLive]);

  /* The colour palette opens where a picked wire was clicked (see store). */

  /**
   * Takes a jumper off the bench. Re-solved, because pulling a wire is how an
   * operator disconnects two things.
   */
  const removeWire = useCallback(
    (wireId: string) => {
      if (layoutLocked) return;
      simulation.removeWire(wireId);
      clearWire();
      forceRender((n) => n + 1);
    },
    [simulation, clearWire, layoutLocked],
  );

  /** Steps the bench back/forward, dropping selections that may be gone. */
  const stepHistory = useCallback(
    (forward: boolean) => {
      if (layoutLocked) return;
      if (!(forward ? simulation.redo() : simulation.undo())) return;
      clearSelection();
      forceRender((n) => n + 1);
    },
    [simulation, clearSelection, layoutLocked],
  );

  /*
   * Keyboard controls for the things an operator reaches for while watching a
   * sketch run, and for taking a picked wire off the bench.
   *
   * Keys are ignored whenever focus is in a text field: pressing `b` has to type
   * a `b` in the sketch editor, and Delete has to delete a character there
   * rather than pull a jumper out from under the operator.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        // Monaco keeps focus in a hidden textarea, which the checks above
        // already catch, but the editor also hosts focusable widgets of its
        // own -- and its Ctrl+Z is the sketch's own undo, which has to win.
        target?.closest?.('.monaco-editor')
      ) {
        return;
      }

      /*
       * Undo and redo before the modifier guard, because they *are* modifier
       * combinations. Shift+Z is redo and Ctrl+Y is offered alongside it,
       * since which one a keyboard sends is a local convention rather than
       * something worth guessing at.
       */
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          stepHistory(event.shiftKey);
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          stepHistory(true);
          return;
        }
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          if (isRunning) activeStop();
          else void handleRunRef.current();
          forceRender((n) => n + 1);
          break;
        case 'r':
          // Turning a part is a layout edit; a running layout is frozen.
          if (selectedId === null || layoutLocked) return;
          event.preventDefault();
          simulation.rotatePart(selectedId);
          forceRender((n) => n + 1);
          break;
        case 'b':
          toggleSidebar();
          break;
        case 'c':
          showActivity('components');
          break;
        case 'i':
          toggleInstruments();
          break;
        case 'j':
          toggleBottom();
          break;
        case 'Delete':
        case 'Backspace':
          // Pulling a jumper is a layout edit; a running layout is frozen.
          if (selectedWireId === null || layoutLocked) return;
          event.preventDefault();
          removeWire(selectedWireId);
          break;
        case 'Escape':
          if (paletteFor) closePalette();
          else if (selectedId) selectPart(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    simulation,
    isRunning,
    layoutLocked,
    activeStop,
    paletteFor,
    selectedId,
    selectedWireId,
    removeWire,
    stepHistory,
    toggleSidebar,
    showActivity,
    toggleInstruments,
    toggleBottom,
    closePalette,
    selectPart,
  ]);

  const bench = simulation.bench;

  /* Live worker status for the header badge; null while in-page owns stepping. */
  const workerStatus = workerActive && workerClient !== null ? workerClient.status() : null;

  /*
   * Rebuilt every frame while running, not only when the bench changes.
   *
   * An example adds its parts to a simulation that already exists, so this
   * cannot key on the simulation alone — but it also cannot key on the bench
   * alone: ticking the simulation advances voltages and display frames without
   * touching the bench at all. Keying on the frame counter keeps the glass,
   * the Inspector and the LEDs live while running, and still refreshes when
   * parts are added while stopped.
   */
  const renderState = useMemo<FootprintState>(() => {
    if (workerClient !== null && workerLive) {
      /*
       * Mirror-fed frame: pin volts remapped with the bench, servo horns as
       * real models driven to the mirrored angle, pixel dies as RGB triplets,
       * 7-segment controllers rebuilt from latched patterns + colon, LCD
       * panels replayed from text bytes + flags, and the colour TFT rebuilt
       * from the mirrored `{ width, height, rgb565 }` frame onto the first
       * ILI9341 part (the core transports one frame — the same first-match
       * rule its sketch port uses). Steppers show the last in-page
       * angles by explicit decision: the core's display region carries no
       * stepper bytes (shaft angles derive from coil-volt edge counting
       * inside the solver, which has no frame encoding), so there is nothing
       * to transport without a core change.
       */
      const snapshots = workerClient.displaySnapshots();
      const colon = workerClient.colonFlags();
      const tft = workerClient.tftSnapshot();
      let tftPlaced = false;
      const servos = new Map<string, Servo>();
      const pixels = new Map<string, readonly { r: number; g: number; b: number }[]>();
      const displays = new Map<string, DisplayController>();
      const lcds = new Map<string, Lcd1602>();
      const logicVolts = simulation.mcu.board.logicVolts;
      for (const part of bench.parts) {
        const component = part.definition.component;
        const kind = component.kind;
        const bytes = snapshots.get(part.id);
        if (kind === 'servo') {
          const servo = new Servo();
          servo.write(bytes?.[0] ?? 90);
          servos.set(part.id, servo);
        } else if (kind === 'neopixel' || kind === 'neopixel-matrix' || kind === 'led-ring') {
          const colors: { r: number; g: number; b: number }[] = [];
          if (bytes !== undefined) {
            for (let i = 0; i + 2 < bytes.length; i += 3) {
              colors.push({ r: bytes[i] ?? 0, g: bytes[i + 1] ?? 0, b: bytes[i + 2] ?? 0 });
            }
          }
          pixels.set(part.id, colors);
        } else if (kind === '7segment' && bytes !== undefined) {
          const digits = component.digits ?? 1;
          displays.set(
            part.id,
            sevenSegmentFromSnapshot(
              digits,
              bytes.slice(0, digits),
              colon.get(part.id) ?? false,
              logicVolts,
            ),
          );
        } else if (kind === 'lcd' && bytes !== undefined) {
          const panel = lcdFromSnapshot(
            part.definition,
            bytes.slice(0, bytes.length - 1),
            bytes[bytes.length - 1] ?? 0,
          );
          if (panel !== null) lcds.set(part.id, panel);
        } else if (
          component.kind === 'display' &&
          component.controller === 'ili9341' &&
          tft !== null &&
          !tftPlaced
        ) {
          const panel = tftFromSnapshot(tft.width, tft.height, tft.rgb565);
          if (panel !== null) {
            displays.set(part.id, panel);
            tftPlaced = true;
          }
        }
      }
      return {
        pinVolts: workerClient.pinVoltages(),
        displays,
        servos,
        steppers: simulation.stepperAngles(),
        pixels,
        lcds,
        controls: workerClient.controls,
        parts: bench.parts.length,
      };
    }
    return {
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
      servos: simulation.servoModels(),
      steppers: simulation.stepperAngles(),
      pixels: simulation.pixelColors(),
      lcds: simulation.lcdModels(),
      controls: simulation.controls,
      // Read here so the memo is honest about depending on the bench: the maps
      // above are built from it, and an example changes it without touching
      // the simulation.
      parts: bench.parts.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, bench, frameTick, workerClient, workerLive]);

  // Meter probes come from the same pin list as the scope's. The black probe
  // defaults to bench ground, which is where it sits when unclipped.

  useEffect(() => {
    simulation.setMeterProbes(meterRedPin, meterBlackPin);
  }, [simulation, meterRedPin, meterBlackPin]);

  // The meter can be clipped anywhere, including the power rails -- measuring
  // rail current is one of the main reasons to reach for it. The scope stays
  // limited to signal pins, where a trace is actually interesting.
  const meterPins = useMemo(() => simulation.mcu.pins(), [simulation]);

  const meterRedLabel = meterPins.find((pin) => pin.id === meterRedPin)?.label ?? null;
  const meterBlackLabel = meterPins.find((pin) => pin.id === meterBlackPin)?.label ?? null;
  /*
   * How much of the bench has changed, which is not the same question as which
   * bench it is: turning a part moves its contacts in place, so the bench
   * object is unchanged while every terminal under that part is somewhere else.
   * Anything derived from where things are has to key on this.
   */
  const benchRevision = bench.revision;

  /*
   * Structural edits send a bench snapshot; the realloc reply carries the
   * new SharedArrayBuffer (Task 5). `benchRevision` is the trigger without
   * being read in the body — same pattern as the net map below.
   */
  useEffect(() => {
    workerClient?.sendBench(simulation.bench);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, workerClient, benchRevision]);

  /*
   * Which net each contact belongs to, for the highlight and the probes.
   *
   * `benchRevision` is in the dependency list without being read in the body,
   * and cannot be read there. The solver assigns nets to contacts by id, so
   * this map is right whenever the solver has been re-run -- which every
   * mutator does. What the body cannot detect is that a contact *moved*:
   * terminals are mutated in place, so the bench object and its arrays are
   * identical to the previous render and nothing read here shows the
   * difference. Without the count, turning a part leaves the highlight on the
   * nets its pins belonged to before the turn.
   *
   * The rule calls the entry redundant because it follows reads rather than
   * mutations, which is the one thing it cannot see from in here.
   */
  const netOfTerminal = useMemo(() => {
    const netlist = simulation.engine.currentNetlist;
    const map = new Map<number, number>();
    for (const terminal of bench.terminals) {
      map.set(terminal.id, netlist.nodeOfTerminal[terminal.id]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bench, benchRevision, simulation]);

  const selected = bench.parts.find((part) => part.id === selectedId) ?? null;

  const onMovePart = useCallback(
    (partId: string, x: number, y: number) => {
      if (layoutLocked) return;
      const part = bench.parts.find((candidate) => candidate.id === partId);
      const nextX = Math.round(x);
      const nextY = Math.round(y);
      // Carry the waypoints of any jumper tied to this part along with it, so
      // a moved part drags its wiring instead of leaving bends behind.
      const dx = part ? nextX - part.x : 0;
      const dy = part ? nextY - part.y : 0;
      const partTerminals = part ? new Set(Object.values(part.terminals)) : new Set<number>();
      const tiedWires =
        part && (dx !== 0 || dy !== 0)
          ? bench.wires.filter((wire) => partTerminals.has(wire.from) || partTerminals.has(wire.to))
          : [];
      simulation.movePart(partId, nextX, nextY);
      for (const wire of tiedWires) {
        if (wire.bends.length === 0) continue;
        simulation.setWireBends(
          wire.id,
          wire.bends.map((bend) => ({ x: bend.x + dx, y: bend.y + dy })),
        );
      }
      // Asked for explicitly, because the animation loop only re-renders while
      // the simulation is running. A stopped bench relied on that loop drawing
      // every frame for everything to update -- which is why dragging a part
      // moved it in the model and left it exactly where it was on screen.
      forceRender((n) => n + 1);
    },
    [simulation, layoutLocked, bench],
  );

  /**
   * Recolours the selected wire.
   *
   * No re-solve: insulation carries no electrical meaning, so the only thing
   * that changes is what the operator sees.
   */
  const recolourSelectedWire = useCallback(
    (colour: string) => {
      if (selectedWireId === null) return;
      simulation.setWireColour(selectedWireId, colour);
      forceRender((n) => n + 1);
    },
    [simulation, selectedWireId],
  );

  /**
   * Re-clips one end of a placed jumper.
   *
   * The Wokwi gesture: grab an end, drop it on another hole. Re-solved, because
   * it changes what the wire joins.
   */
  const moveWireEnd = useCallback(
    (wireId: string, end: WireEnd, to: Terminal) => {
      if (layoutLocked) return;
      simulation.moveWireEnd(wireId, end, to);
      forceRender((n) => n + 1);
    },
    [simulation, layoutLocked],
  );

  /*
   * The chosen colour rides along with the route rather than being read from
   * the canvas, so the swatch in the header and the wire it places cannot
   * disagree about what "the next colour" means.
   */
  const onRouteWire = useCallback(
    (from: Terminal, to: Terminal, bends: readonly BendPoint[]) => {
      if (layoutLocked) return;
      simulation.routeWire(from, to, bends, wireColour);
    },
    [simulation, wireColour, layoutLocked],
  );

  const onSetWireBends = useCallback(
    (wireId: string, bends: readonly BendPoint[]) => {
      if (layoutLocked) return;
      simulation.setWireBends(wireId, bends);
      forceRender((n) => n + 1);
    },
    [simulation, layoutLocked],
  );

  const onRemoveWireBend = useCallback(
    (wireId: string, index: number) => {
      if (layoutLocked) return;
      simulation.removeWireBend(wireId, index);
      forceRender((n) => n + 1);
    },
    [simulation, layoutLocked],
  );

  const onInsertWireBend = useCallback(
    (wireId: string, index: number, bend: BendPoint) => {
      if (layoutLocked) return;
      simulation.insertWireBend(wireId, index, bend);
      forceRender((n) => n + 1);
    },
    [simulation, layoutLocked],
  );

  const bendIndexNear = useCallback(
    (wireId: string, x: number, y: number) => simulation.bendIndexNear(wireId, x, y),
    [simulation],
  );

  /* Inputs route to the owning backend only (worker messages on the worker
   * path, the in-page model otherwise) — never both. */
  const onTogglePressed = useCallback(
    (partId: string, pressed: boolean) => {
      if (workerClient !== null && workerLive) workerClient.setPressed(partId, pressed);
      else simulation.setPressed(partId, pressed);
    },
    [simulation, workerClient, workerLive],
  );

  const clearBusLog = useCallback(() => simulation.clearBusLog(), [simulation]);

  /**
   * Loads an example: the sketch, and the bench it expects to find.
   *
   * Both halves or neither. A sketch that talks to a clock nobody wired reads
   * nothing and looks exactly like a broken API, so the circuit goes down and
   * the sketch is loaded onto it.
   *
   * The bench is *replaced*, not added to: an example is a fresh starting point,
   * which is also how its sketch arrives (the project is swapped, not merged).
   * A part left over from the operator's own circuit sitting in the middle of
   * one teaches the wrong thing twice — once when the sketch ignores it, and
   * again when the reader assumes the example put it there. What makes replacing
   * safe to offer is that the operator's bench comes back with a single Ctrl+Z:
   * `replaceBench` records the whole load as one undoable step. The sketch is
   * not part of that step, so undo restores the circuit they had under the
   * example's code.
   */
  const loadExample = useCallback(
    (id: string) => {
      const example = EXAMPLES.find((candidate) => candidate.id === id);
      if (!example) return;
      simulation.replaceBench((bench) => example.wire(bench));
      const next = toSingleFileProject(example.sketch, boardOption(boardId).language);
      setProject(next);
      setExampleId(example.id);
      if (workerClient !== null && workerLive) workerClient.loadFirmware(next);
      else simulation.loadFirmware(next);
      forceRender((n) => n + 1);
    },
    [simulation, workerClient, workerLive, EXAMPLES, boardOption, boardId],
  );

  /*
   * Switching grammars on a multi-file project drops every tab but the entry:
   * a `.h` means nothing to the Python front end and vice versa. A native
   * confirm guards the multi-file case; a single file restarts from that
   * language's blink.
   */
  const handleLanguageChange = (nextLanguage: FirmwareLanguage) => {
    if (nextLanguage === project.language) return;
    if (
      project.files.length > 1 &&
      !window.confirm('Switching language discards other-language tabs. Continue?')
    ) {
      return;
    }
    setProject(
      toSingleFileProject(
        nextLanguage === 'python' ? PI_BLINK_SKETCH : BLINK_EXAMPLE.sketch,
        nextLanguage,
      ),
    );
    // A fresh blink in a new grammar is not the example that was highlighted.
    setExampleId(null);
  };

  /*
   * Whether this board can run the AVR backend, recomputed per render so the
   * selector and the Run path track board switches together.
   */
  const avr = avrAvailableFor(boardId);
  const backend = resolveBackendSelection({ execution: projectBuild?.execution, avr, avrMode });

  /*
   * Run loads the whole project, then opens the tab the error names: the bar
   * shows the message verbatim and the editor shows the file it came from, so
   * the operator never has to guess which tab broke.
   *
   * With AVR mode on an Uno, Run compiles in the worker first and flashes
   * the fresh HEX onto the AVR core; every other board, or interpreter mode,
   * loads straight into the interpreter as before. A cancelled compile stays
   * stopped: there is nothing fresh to run.
   */
  async function handleRun() {
    // A real firmware verdict replaces the corrupt-share notice: the bar
    // shows one thing at a time, and the run just produced something newer.
    setShareError(null);
    /*
     * What this Run would load. While a paused bench still matches the last
     * load on all four counts, Run is a play on a paused player: start the
     * core where it stands, no recompile and no reload. Any difference --
     * an edited sketch, a switched backend, a moved wire, a new owner --
     * misses the record and takes the full load below, exactly as before.
     */
    const session: RunSession = {
      project,
      backend: avrMode && avr.ok ? 'avr' : 'interpreter',
      benchRevision,
      owner: workerClient ? 'worker' : 'in-page',
    };
    if (!isRunning && canResumeRun(runSession.current, session)) {
      if (workerClient) workerClient.start();
      else simulation.start();
      forceRender((n) => n + 1);
      return;
    }
    if (session.backend === 'avr') {
      // A second Run supersedes the first: the new build aborts the previous
      // one inside compileAndRun, and only the latest run clears progress or
      // lands a verdict.
      const seq = ++compileSeq.current;
      setCompiling(true);
      try {
        if (workerClient) await workerClient.compileAndRun(project);
        else await simulation.compileAndRun(project);
      } finally {
        if (compileSeq.current === seq) setCompiling(false);
      }
      if (compileSeq.current !== seq) return;
      const cancelled = workerClient
        ? workerClient.fault === 'compile cancelled'
        : typeof simulation.compileState === 'object' &&
          simulation.compileState.error === 'compile cancelled';
      if (cancelled) {
        forceRender((n) => n + 1);
        return;
      }
    } else if (workerClient) {
      workerClient.loadFirmware(project);
    } else {
      simulation.loadFirmware(project);
    }
    const message = activeFirmwareError;
    if (message) {
      // A real firmware verdict opens Problems, the way Run opens the tab an
      // error names: the failure is visible without hunting for it.
      setBottomTab(bottomTabForError(message));
      setBottomOpen(true);
      const head = message.split(':')[0]?.trim() ?? '';
      // The center follows the failure even when it names the tab already
      // open: Run is usually pressed from the canvas, and Problems alone never
      // shows the line that broke.
      const failed = resolveErrorCenter(
        head,
        project.files.map((file) => file.name),
      );
      if (failed !== null) {
        setActiveCenter(failed);
        if (failed !== project.activeName) {
          setProject((previous) => ({ ...previous, activeName: failed }));
        }
      }
    }
    if (workerClient) workerClient.start();
    else simulation.start();
    /*
     * The record trails the load: a verdict (compile failed, syntax error)
     * leaves nothing worth resuming, so the next Run takes the full path --
     * and the retry -- again.
     */
    const clean = workerClient ? workerClient.fault === null : simulation.firmwareError === null;
    runSession.current = clean ? session : null;
    forceRender((n) => n + 1);
  }
  // Published to the keyboard shortcut above (declared below, hoisted).
  handleRunRef.current = handleRun;

  const onPlacePart = useCallback(
    (definition: PartDefinition, entry: CatalogueEntry) => {
      if (layoutLocked) return;
      const part = isLargePart(entry.id)
        ? (() => {
            const slot = nextBenchSlot++;
            return simulation.addPart(
              definition,
              BENCH_SLOTS_X[slot % BENCH_SLOTS_X.length],
              BENCH_SLOTS_Y[Math.floor(slot / BENCH_SLOTS_X.length) % BENCH_SLOTS_Y.length],
            );
          })()
        : (() => {
            const column = nextDropColumn;
            nextDropColumn = (nextDropColumn + 8) % 60;
            const [pinX, pinY] = offsetOfFirstPin(definition);
            return simulation.addPart(
              definition,
              BREADBOARD_ORIGIN_X + columnX(column) - pinX,
              stripRowY(8) - pinY,
            );
          })();
      selectPart(part.id);
    },
    [simulation, selectPart, layoutLocked],
  );

  /*
   * Whether the whole project fits in a shareable link, recomputed per render
   * (cheap next to the bench itself) so the button tracks the current project.
   *
   * Oversize projects stay local-only by design: the button disables rather
   * than producing a URL no address bar will survive. The payload itself is
   * encoded at click time, so the check and the link cannot disagree.
   */
  const shareTooLarge = !isShareable(project);
  const currentCircuitDoc = decompile(simulation.builder.build(), simulation.controls).doc;
  const circuitShareable = isCircuitShareable(currentCircuitDoc);
  const copyShareLink = () => {
    const base = window.location.href.split('#')[0];
    const url = `${base}#/bench/${boardId}?${projectShareQuery(project)}`;
    void navigator.clipboard.writeText(url).catch(() => {
      /* Clipboard unavailable: the button stays, the project stays local. */
    });
  };
  const copyCircuitLink = () => {
    const base = window.location.href.split('#')[0];
    const url = `${base}#/bench/${boardId}?${circuitShareQuery(currentCircuitDoc)}`;
    void navigator.clipboard.writeText(url).catch(() => {
      /* Clipboard unavailable: the button stays, the circuit stays local. */
    });
  };

  /*
   * A circuit leaves as a file, and arrives as one.
   *
   * The document is the file: what this writes is the same text the repository
   * stores under `learn/circuits/`, so a circuit off the bench can be renamed
   * and committed, and one checked in can be opened here unchanged. The save is
   * never disabled — a circuit too large for a link is exactly the one worth
   * writing to a file — and the open goes through the same gate a link does
   * (`parseCircuit` for the format, `loadCircuit` for the board), so a wrong
   * file leaves the bench as it was and says so.
   */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveCircuitFile = () => {
    const blob = new Blob([circuitFileText(currentCircuitDoc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = circuitFileName(boardId);
    // In the document, because Firefox ignores a click on a detached anchor.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked late: a browser may still be reading the blob when click returns,
    // and Firefox cancels a download whose URL is revoked under it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openCircuitFile = (file: File) => {
    // Rewiring the bench mid-run leaves the firmware driving a circuit nobody
    // wired, which is why every layout edit refuses while one is live; opening
    // a file replaces the whole circuit, so it refuses too.
    if (layoutLocked) return;
    void (async () => {
      try {
        if (file.size > CIRCUIT_FILE_MAX_BYTES)
          throw new Error(`${file.name}: too large to be a circuit`);
        const doc = readCircuitFile(await file.text(), file.name);
        const refused = simulation.loadCircuit(doc);
        if (refused.length > 0) throw new Error(`${file.name}: ${refused.join('; ')}`);
        setShareError(null);
        // A load replaces every part and terminal under the renderer, so the
        // bench has to be repainted the way any other edit repaints it.
        forceRender((n) => n + 1);
      } catch (error) {
        // The reason goes to the console -- which file, and why -- and the
        // operator gets one sentence, the same one the other circuit paths
        // would give them.
        console.warn(
          'circuit file rejected:',
          error instanceof Error ? error.message : String(error),
        );
        setShareError(UNREADABLE_FILE_NOTICE);
      }
    })();
  };

  /*
   * Swapping boards is a navigation, not a state change: the board is in the
   * path, so the bench is shareable and the back button steps through the
   * boards actually visited. React Router keeps this component mounted across
   * the change and hands it a new boardId, which is what makes the memo above
   * rebuild the simulation.
   */
  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/*
       * Three groups, left to right: what bench you are on, what the simulation
       * is doing, then what you can reach. The old header ran them together as
       * five equal buttons, so stopping the firmware and opening the parts
       * browser looked like the same kind of act.
       */}
      <TopBar>
        <h1 className="text-sm font-semibold tracking-tight">Noesis Lab</h1>

        {/*
         * The way back to the board list, as a link rather than a button so it
         * is a real destination: middle-click opens the picker in a new tab,
         * and the back button returns to it. It sits beside the board dropdown
         * rather than in the far-right action group because it belongs to the
         * same question -- which board is this.
         */}
        <Button asChild variant="secondary" size="sm" title="Back to the board list">
          <Link to="/">
            <Component1Icon className="icon" aria-hidden="true" />
            Boards
          </Link>
        </Button>

        <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
          <span className="text-slate-500" aria-hidden="true">
            <Component1Icon className="icon" />
          </span>
          <Select
            value={boardId}
            onValueChange={(next) => {
              // Guarded rather than cast: the select is the one place a board
              // id can come from something we did not choose, and navigating
              // to a board that does not exist would leave the path lying about
              // what is on the bench.
              if (isBoardId(next)) navigate(`/bench/${next}`);
            }}
          >
            <SelectTrigger
              className="h-7 max-w-44 truncate text-xs"
              aria-label="Board"
              title="Swap board"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARDS.map((board) => (
                <SelectItem key={board.id} value={board.id}>
                  {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (isRunning) activeStop();
              else void handleRun();
              forceRender((n) => n + 1);
            }}
            title={isRunning ? 'Pause the simulation (Space)' : 'Run the simulation (Space)'}
          >
            {isRunning ? (
              <PauseIcon className="icon" aria-hidden="true" />
            ) : (
              <PlayIcon className="icon" aria-hidden="true" />
            )}
            {isRunning ? 'Pause' : 'Run'}
          </Button>

          {/*
           * Fast forward: the sketch's clock at twice wall-clock speed. No
           * 4× option on purpose -- a worker tick caps its slice, so a bigger
           * multiplier would promise more than the engine could deliver.
           */}
          <Button
            type="button"
            variant={fastForward ? 'default' : 'secondary'}
            size="sm"
            aria-pressed={fastForward}
            onClick={() => setFastForward((on) => !on)}
            title={
              fastForward
                ? 'Running at 2× — click to return to real time'
                : 'Fast forward: run the sketch at 2× until you switch it off'
            }
          >
            2×
          </Button>

          {/*
           * Which backend the next Run executes on. The AVR option is
           * Uno-only: disabled with its reason everywhere else, so a board
           * that cannot compile never offers to.
           */}
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Execution backend</span>
            <Select value={backend.value} onValueChange={(next) => setAvrMode(next === 'avr')}>
              <SelectTrigger
                className="h-7 text-xs"
                aria-label="Execution backend"
                title={
                  avr.ok
                    ? 'Which backend the next Run executes on'
                    : avrMode
                      ? avr.reason
                      : 'Which backend the next Run executes on'
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="interpreter"
                  disabled={backend.interpreterDisabled}
                  title={backend.interpreterTitle}
                >
                  Interpreter
                </SelectItem>
                <SelectItem
                  value="avr"
                  disabled={!avr.ok}
                  title={avr.ok ? 'Compile in the worker, run on the AVR core' : avr.reason}
                >
                  AVR (Uno)
                </SelectItem>
              </SelectContent>
            </Select>
          </label>

          {/*
           * Which backend owns stepping. The worker badge shows live fps plus
           * the sim/wall ratio from `status()`; in-page shows the fallback
           * reason on hover.
           */}
          {workerStatus !== null ? (
            <span
              className="rounded-none border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-xs text-emerald-300"
              title="Stepping in the sim worker"
              role="status"
            >
              {`worker · ${workerStatus.fps}fps · ${workerStatus.ratio.toFixed(2)}×`}
            </span>
          ) : (
            <span className="text-xs text-slate-500" title={workerFallback ?? 'In-page simulation'}>
              in-page
            </span>
          )}

          {/*
           * Worker-compile progress, in the same quiet dressing as the
           * controls around it. Cancel aborts the in-flight build; the
           * awaiting Run lands 'compile cancelled' and stays stopped.
           */}
          {compiling && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400" role="status">
              Compiling for Uno…
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (workerClient) workerClient.cancelCompile();
                  else simulation.cancelCompile();
                }}
                title="Abort the in-flight compile"
              >
                Cancel
              </Button>
            </span>
          )}

          {/*
           * Undo and redo, beside Run because that is where an operator's
           * hands already are when something has just gone wrong.
           *
           * Both go grey when there is nothing to step to, rather than being
           * hidden: a control that appears and disappears with the history is a
           * control whose absence has to be explained, and a greyed button
           * explains itself.
           */}
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={() => stepHistory(false)}
            disabled={layoutLocked || !simulation.canUndo()}
            title={layoutLocked ? LAYOUT_LOCK_HINT : 'Undo the last change to the bench (Ctrl+Z)'}
            aria-label="Undo"
          >
            <ArrowLeftIcon className="icon" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={() => stepHistory(true)}
            disabled={layoutLocked || !simulation.canRedo()}
            title={
              layoutLocked ? LAYOUT_LOCK_HINT : 'Redo the change you just undid (Ctrl+Shift+Z)'
            }
            aria-label="Redo"
          >
            <ArrowRightIcon className="icon" aria-hidden="true" />
          </Button>
        </div>

        <span className="flex-1" />

        <div className="flex items-center gap-1.5">
          {/*
           * The jumper palette, Wokwi's: pick a colour, then route a wire in it.
           *
           * With a wire picked the swatches recolour *that* wire instead, which
           * is the other half of picking a wire on the canvas. The picked colour
           * gets a ring rather than a check, matching how the header shows
           * "held" state everywhere else.
           */}
          <div
            className="flex items-center gap-0.5 border-l border-slate-800 pl-2"
            role="group"
            aria-label={
              selectedWireId === null
                ? 'Jumper colour for the next wire'
                : 'Colour of the selected wire'
            }
          >
            {WIRE_COLOURS.map((colour) => {
              const selected =
                selectedWireId !== null
                  ? bench.wires.find((wire) => wire.id === selectedWireId)?.colour === colour.hex
                  : wireColour === colour.hex;
              return (
                <button
                  key={colour.hex}
                  type="button"
                  onClick={() => {
                    if (selectedWireId !== null) recolourSelectedWire(colour.hex);
                    else setWireColour(colour.hex);
                  }}
                  aria-pressed={selected}
                  aria-label={`Wire colour ${colour.label}`}
                  title={colour.label}
                  className={`h-5 w-5 rounded-none transition-transform ${
                    selected ? 'scale-110 ring-2 ring-sky-400' : 'hover:scale-105'
                  }`}
                  style={{
                    backgroundColor: colour.hex,
                    boxShadow: `inset 0 0 0 1px ${colour.border}`,
                  }}
                />
              );
            })}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={copyShareLink}
            disabled={shareTooLarge}
            title={
              shareTooLarge
                ? 'Too large to share by link — files stay local'
                : 'Copy a link carrying this project'
            }
          >
            <Link2Icon className="icon" aria-hidden="true" />
            Copy link
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!circuitShareable}
            onClick={copyCircuitLink}
            title={
              circuitShareable
                ? 'Copy a link carrying this circuit'
                : 'Too large to share by link — save it as a file instead'
            }
          >
            Copy circuit link
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={saveCircuitFile}
            title={`Write this circuit as ${circuitFileName(boardId)}`}
          >
            <DownloadIcon className="icon" aria-hidden="true" />
            Save circuit
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={layoutLocked}
            title={
              layoutLocked
                ? LAYOUT_LOCK_HINT
                : 'Open a circuit file, replacing the circuit on the bench'
            }
          >
            <UploadIcon className="icon" aria-hidden="true" />
            Open circuit…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared first, so choosing the same file twice fires again.
              event.target.value = '';
              if (file) openCircuitFile(file);
            }}
          />

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => showActivity('components')}
            title="Browse every part the bench can hold (C)"
          >
            <PlusIcon className="icon" aria-hidden="true" />
            Components
          </Button>

          {exercise && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGuideOpen(true)}
              title={`Open the guide for ${exercise.id} ${exercise.title}`}
            >
              <ReaderIcon className="icon" aria-hidden="true" />
              Guide {exercise.id}
            </Button>
          )}
        </div>
      </TopBar>

      {projectBuild !== null && foundProject !== null && projectBannerOpen && (
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-1.5 text-sm">
          <span className="truncate text-slate-300">
            <span className="font-medium text-slate-100">{foundProject.title}</span>
            <span className="text-slate-500"> — wired and loaded, press Run to see it live.</span>
          </span>
          <span className="flex-1" />
          <Link
            to={`/projects/${boardId}`}
            className="shrink-0 text-xs text-sky-400 underline underline-offset-2"
          >
            Back to project
          </Link>
          <button
            type="button"
            onClick={() => setProjectBannerOpen(false)}
            aria-label="Dismiss the project banner"
            title="Dismiss"
            className="flex size-6 shrink-0 items-center justify-center rounded-none text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <Cross2Icon className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ActivityBar activity={activity} onActivity={(next) => pickActivity(next)} />
        {sidebarOpen && (
          <Sidebar
            activity={activity}
            project={project}
            entryName={ENTRY_BY_LANGUAGE[project.language]}
            activeName={project.activeName}
            width={layout.sidebarWidth}
            onSelectFile={(name) => {
              setActiveCenter(centerKeyForFile(name));
              setProject((previous) => ({ ...previous, activeName: name }));
            }}
            onProjectChange={setProject}
            componentsPane={
              <CatalogueGrid
                locked={layoutLocked}
                onPlace={(def, entry) => {
                  onPlacePart(def, entry);
                  setActiveCenter('circuit');
                }}
              />
            }
            libraryPane={<WokwiLibrary />}
          />
        )}
        {sidebarOpen && (
          <ResizeHandle
            axis="x"
            onResize={(delta) => nudgeLayout('sidebarWidth', delta)}
            onReset={() => resetLayoutKey('sidebarWidth')}
            label="Resize sidebar"
          />
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CenterTabs
            active={activeCenter}
            files={project.files}
            entryName={ENTRY_BY_LANGUAGE[project.language]}
            onSelect={(key) => {
              if (key === 'circuit') {
                setActiveCenter('circuit');
                return;
              }
              setActiveCenter(centerKeyForFile(key));
              setProject((previous) => ({ ...previous, activeName: key }));
            }}
            onCloseFile={(name) => {
              try {
                setProject((previous) => removeFile(previous, name));
              } catch {
                // Editor notice surface owns errors.
              }
              setActiveCenter('circuit');
            }}
            onRenameFile={(name) => {
              const next = window.prompt('Rename file', name);
              if (!next || next.trim() === name) return;
              try {
                setProject((previous) => renameFile(previous, name, next.trim()));
                setActiveCenter(centerKeyForFile(next.trim()));
              } catch {
                // Editor notice surface owns errors.
              }
            }}
            circuit={
              <div className="relative min-h-0 flex-1">
                <Workbench
                  bench={bench}
                  renderState={renderState}
                  netOfTerminal={netOfTerminal}
                  selectedId={selectedId}
                  selectedWireId={selectedWireId}
                  locked={layoutLocked}
                  onSelect={(partId) => selectPart(partId)}
                  onSelectWire={selectWire}
                  onWirePicked={(wireId, x, y) => openPalette({ wireId, x, y })}
                  onMovePart={onMovePart}
                  onRouteWire={onRouteWire}
                  onMoveWireEnd={moveWireEnd}
                  onTogglePressed={onTogglePressed}
                  onSetWireBends={onSetWireBends}
                  onRemoveWireBend={onRemoveWireBend}
                  onInsertWireBend={onInsertWireBend}
                  bendIndexNear={bendIndexNear}
                />

                {/*
                 * The colour palette for a picked wire, opening where it was
                 * picked.
                 *
                 * Positioned `fixed` against the click's client coordinates, so it
                 * lands under the cursor regardless of where the canvas sits in
                 * the page -- which matters because the bench is a column in a
                 * layout, not the whole window.
                 *
                 * Offset above the click so it never covers the wire it is editing,
                 * and flipped to the right near the left edge, because a palette
                 * that opens off the side of the canvas cannot be used.
                 */}
                {paletteFor && (
                  <div
                    role="group"
                    aria-label="Colour of the picked jumper"
                    className="fixed z-20 flex items-center gap-0.5 rounded-none border border-slate-700 bg-slate-900/95 p-1 shadow-lg"
                    style={{
                      left: paletteFor.x,
                      top: paletteFor.y,
                      // Opens above and to the left of the click, which keeps it off
                      // the wire and off the cursor that summoned it. Both flips
                      // matter: a palette that opens over the header or off the
                      // left of the window is a palette that cannot be used.
                      transform: [
                        `translateX(${paletteFor.x < PALETTE_FLIP_X ? '0' : '-100%'})`,
                        paletteFor.y < PALETTE_FLIP_Y
                          ? 'translateY(12px)'
                          : 'translateY(calc(-100% - 12px))',
                      ].join(' '),
                    }}
                  >
                    {WIRE_COLOURS.map((colour) => (
                      <button
                        key={colour.hex}
                        type="button"
                        onClick={() => {
                          recolourSelectedWire(colour.hex);
                          closePalette();
                        }}
                        aria-label={`Wire colour ${colour.label}`}
                        title={colour.label}
                        className="h-5 w-5 rounded-none transition-transform hover:scale-110"
                        style={{
                          backgroundColor: colour.hex,
                          boxShadow: `inset 0 0 0 1px ${colour.border}`,
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => closePalette()}
                      aria-label="Close the colour palette"
                      title="Close (Esc)"
                      className="ml-1 flex h-5 w-5 items-center justify-center rounded-none text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                    >
                      <Cross2Icon className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            }
            editor={
              <FirmwareEditor
                project={project}
                onProjectChange={setProject}
                error={activeFirmwareError ?? shareError}
                expanded
                onToggle={() => {}}
                headerHidden
                language={project.language}
                onChangeLanguage={handleLanguageChange}
                onRun={handleRun}
                onReset={() => {
                  // Reset discards the run, so the next Run can no longer resume it.
                  runSession.current = null;
                  if (workerClient !== null && workerLive) workerClient.loadFirmware(project);
                  else simulation.reset();
                  forceRender((n) => n + 1);
                }}
                running={isRunning}
                examples={EXAMPLES}
                activeExampleId={exampleId}
                onLoadExample={loadExample}
              />
            }
          />
          {/*
           * The bottom panel lives in the center column, under the canvas and
           * code, the way VS Code centers its panel under the editor group:
           * the sidebar and the inspector rail run full height beside it.
           */}
          {bottomOpen && (
            <ResizeHandle
              axis="y"
              onResize={(delta) => nudgeLayout('bottomHeight', -delta)}
              onReset={() => resetLayoutKey('bottomHeight')}
              label="Resize bottom panel"
            />
          )}
          {/*
           * Instruments limitation (accepted): scope traces, analyser
           * captures, bus log, and meter stay in-page — the core transports
           * no probe waveforms, bus entries, or meter state, so they freeze
           * while the worker owns stepping. Surfaced by the one-line note
           * below rather than left silent.
           */}
          {workerActive && (
            <p className="shrink-0 border-t border-slate-800 px-3 py-1 text-[11px] text-slate-500">
              Worker mode: scope, bus monitor, and meter stay in-page and are frozen while the
              worker steps.
            </p>
          )}
          <BottomPanel
            tab={bottomTab}
            open={bottomOpen}
            height={layout.bottomHeight}
            hasError={(activeFirmwareError ?? shareError) !== null}
            onTab={setBottomTab}
            onToggle={() => toggleBottom()}
            serial={
              <SerialMonitor
                lines={
                  workerClient !== null && workerLive
                    ? workerClient.serialLines()
                    : simulation.serialLines()
                }
              />
            }
            scope={
              <ScopePanel
                pins={probePins}
                baud={baud}
                probePinId={simulation.probePinId}
                samples={simulation.probeTrace()}
                logicVolts={simulation.mcu.board.logicVolts}
                onProbe={(pinId: string | null) => simulation.setProbePin(pinId)}
                onBaud={setBaud}
              />
            }
            logic={
              <LogicAnalyser
                pins={probePins}
                traces={simulation.analyserTraces()}
                logicVolts={simulation.mcu.board.logicVolts}
                onTogglePin={(pinId) => simulation.toggleAnalysedPin(pinId)}
                isCapturing={(pinId) => simulation.isPinAnalysed(pinId)}
              />
            }
            bus={<BusMonitor entries={simulation.busLines()} onClear={clearBusLog} />}
            meter={
              <MultimeterPanel
                pins={meterPins}
                redPinId={meterRedPin}
                blackPinId={meterBlackPin}
                onRedPin={setMeterRedPin}
                onBlackPin={setMeterBlackPin}
                mode={simulation.meterMode}
                reading={simulation.meterReading()}
                redLabel={meterRedLabel ?? 'not clipped'}
                blackLabel={meterBlackLabel ?? 'ground'}
                rangeId={simulation.meterRangeId}
                onMode={(mode) => simulation.setMeterMode(mode)}
                onRange={(rangeId: string) => simulation.setMeterRange(rangeId)}
              />
            }
            problems={
              <p className="px-3 py-2 font-mono text-xs text-red-300">
                {activeFirmwareError ?? shareError ?? 'No problems.'}
              </p>
            }
          />
        </main>

        {instrumentsOpen && (
          <ResizeHandle
            axis="x"
            onResize={(delta) => nudgeLayout('railWidth', -delta)}
            onReset={() => resetLayoutKey('railWidth')}
            label="Resize inspector panel"
          />
        )}
        <aside
          style={instrumentsOpen ? { width: layout.railWidth } : undefined}
          className={`shrink-0 flex-col border-l border-slate-800 bg-slate-900 ${
            instrumentsOpen ? 'hidden lg:flex' : 'hidden'
          }`}
        >
          <button
            type="button"
            onClick={() => setInstrumentsOpen(false)}
            aria-expanded={true}
            aria-label="Collapse the instruments sidebar"
            title="Collapse instruments (I)"
            className="flex h-9 shrink-0 items-center justify-center border-b border-slate-800 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <CaretRightIcon className="icon" aria-hidden="true" />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Inspector
              part={selected}
              pinVoltages={renderState.pinVolts}
              controls={renderState.controls}
              locked={layoutLocked}
              onDelete={() => {
                if (layoutLocked) return;
                if (selected) simulation.removePart(selected.id);
                selectPart(null);
              }}
              onSetPressed={(pressed) => {
                if (!selected) return;
                if (workerClient !== null && workerLive)
                  workerClient.setPressed(selected.id, pressed);
                else simulation.setPressed(selected.id, pressed);
              }}
              onSetKnob={(spec, value) => {
                if (!selected) return;
                if (workerClient !== null && workerLive)
                  workerClient.setKnob(selected.id, spec, value);
                else simulation.setKnob(selected.id, spec, value);
              }}
              onRotate={() => {
                // Physical, not electronic: this turns the part on the bench.
                // A colour panel has a second rotation of its own, the one a
                // sketch asks for through `tft.setRotation`, and the two are
                // independent -- turning the panel does not tell the sketch.
                if (layoutLocked) return;
                if (selected) simulation.rotatePart(selected.id);
              }}
              onRename={(name) => {
                if (selected) simulation.renamePart(selected.id, name);
              }}
              onSetCapColour={(colour) => {
                if (selected) simulation.setCapColour(selected.id, colour);
              }}
              panelSize={selected ? simulation.displaySize(selected.id) : undefined}
              rotation={selected ? simulation.partRotation(selected.id) : 0}
            />
          </div>
        </aside>

        {!instrumentsOpen && (
          <aside className="hidden w-9 shrink-0 flex-col border-l border-slate-800 bg-slate-900 lg:flex">
            <button
              type="button"
              onClick={() => setInstrumentsOpen(true)}
              aria-expanded={false}
              aria-label="Expand the instruments sidebar"
              title="Expand instruments (I)"
              className="flex h-9 shrink-0 items-center justify-center border-b border-slate-800 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <CaretLeftIcon className="icon" aria-hidden="true" />
            </button>
          </aside>
        )}

        {exercise && (
          <ExerciseGuide
            key={exercise.id}
            exercise={exercise}
            open={guideOpen}
            onClose={() => setGuideOpen(false)}
          />
        )}
      </div>

      <StatusBar
        timeMs={
          workerClient !== null && workerLive ? workerClient.timeMs : simulation.engine.timeMs
        }
        running={isRunning}
        netCount={simulation.engine.currentNetlist.nodeCount}
      />
    </div>
  );
}
