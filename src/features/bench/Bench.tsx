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

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { isLargePart, type CatalogueEntry } from '@/features/parts';
import { ComponentBrowser } from './ComponentBrowser';
import { breadboardDefinition, columnX, railRowY, stripRowY } from '@/features/parts';
import { ledDefinition, resistorDefinition } from '@/features/parts';
import { DIODE_PROFILES } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';
import type { BendPoint, PartInstance, Terminal } from '@/features/simulation';
import { ili9341Definition, ssd1306Definition } from '@/features/parts';
import { Workbench } from './Workbench';
import type { FootprintState } from './footprints';
import { Simulation } from './simulation';
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
import { toSingleFileProject } from '@/features/simulation';
import { PartSearch } from './PartSearch';
import {
  FirmwareEditor,
  Inspector,
  SerialMonitor,
  StatusBar,
} from '@/features/instruments';
import { DEFAULT_WIRE_COLOUR, WIRE_COLOURS } from './wire-colours';
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
  ReaderIcon,
} from '@radix-ui/react-icons';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';


/** Left of this the palette opens rightwards, so it stays on screen. */
const PALETTE_FLIP_X = 200;
/** Above this the palette opens downwards, for the same reason. */
const PALETTE_FLIP_Y = 60;
/** Where the breadboard sits, clear of the board plugged in beside it. */
const BREADBOARD_ORIGIN_X = 230;

/** Column the starter LED circuit is wired onto. */
const SIGNAL_COLUMN = 20;

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
  simulation.addPart(
    ledDef,
    holeX(SIGNAL_COLUMN + 4) - ledAnode.x,
    holeY(8) - ledAnode.y,
  );
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
    simulation.routeWire(
      at(holeX(column), holeY(row)),
      at(display.x + spec.x, display.y + spec.y),
    );
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
  readonly buildFor: (project: GalleryProject, board: BoardId) => GalleryBuild | null;
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
  const exercise =
    found !== null && boardId === exerciseBoard(found) ? found : null;

  /*
   * A project arriving from a board page, as `?project=alarm-clock`.
   *
   * Same shape as an exercise — a validated setup plus a sketch — but only
   * honoured on a board the project has a build for, and never together with
   * `?ex=`: an exercise wins when both are present, so a shared link always
   * means one thing.
   */
  const requestedProject = search.get('project');
  const foundProject = requestedProject === null ? null : galleryById(requestedProject);
  const projectBuild =
    exercise === null && foundProject !== null ? buildFor(foundProject, boardId) : null;

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
   */
  const [project, setProject] = useState<FirmwareProject>(() =>
    toSingleFileProject(
      exercise?.sketch ??
        projectBuild?.sketch ??
        (boardOption(boardId).language === 'python' ? PI_BLINK_SKETCH : BLINK_EXAMPLE.sketch),
      exercise ? exerciseLanguage(exercise) : boardOption(boardId).language,
    ),
  );
  const [browserOpen, setBrowserOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /*
   * The right-hand rails — Inspector + Serial, and Scope + Logic + Bus +
   * Multimeter — collapse together under one toggle, mirroring the parts rail
   * on the left. They keep separate breakpoints (lg vs xl) but one piece of
   * state, so there is a single "instruments" question rather than two.
   */
  const [instrumentsOpen, setInstrumentsOpen] = useState(true);
  const [, forceRender] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [exampleId, setExampleId] = useState<string | null>(null);
  /*
   * The colour the next jumper will be drawn in.
   *
   * Held here rather than inside the canvas because the picker lives in the
   * header and the wire is placed on the canvas: one owner means the swatch
   * shown and the colour applied cannot drift apart.
   */
  const [wireColour, setWireColour] = useState(DEFAULT_WIRE_COLOUR);
  const [firmwareOpen, setFirmwareOpen] = useState(true);

  /*
   * The exercise guide: popup instructions for the bench the learner just
   * opened through `?ex=:id`.
   *
   * Auto-opens on arrival unless dismissed for this exercise, and reopens
   * from the header's Guide button. Reset on exercise change so a second
   * exercise never inherits the first one's dismissal in this session.
   */
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (exercise && !isGuideDismissed(exercise.id)) setGuideOpen(true);
    else setGuideOpen(false);
  }, [exercise, isGuideDismissed]);

  /*
   * The project banner: a slim strip naming the build this bench was opened
   * for through `?project=:id`. Dismissible, and reset on project change so
   * a second project re-announces itself. Deliberately not the full guide —
   * the instructions live on the board page this links back to.
   */
  const [projectBannerOpen, setProjectBannerOpen] = useState(true);
  useEffect(() => {
    setProjectBannerOpen(true);
  }, [projectBuild]);

  // Rebuilt on board change only: a sketch's pin numbers mean something
  // different on each board, so carrying one across would silently misfire.
  const simulation = useMemo(
    () => {
      const created = new Simulation(boardOption(boardId).make());

      /*
       * The board and breadboard go down first, whatever else happens.
       *
       * An exercise's setup routes jumpers to `boardTerminal('D8')` and the
       * like, and those are coordinates. On a bench with no board on it they
       * land on nothing, so every wire quietly claims a loose contact of its
       * own and the circuit looks drawn while being electrically dead: no LED
       * lights, and every input reads zero. `new Simulation(board)` builds the
       * MCU but does not place the board part.
       */
      created.addPart(boardOption(boardId).make(), 0, 0);
      created.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);

      if (exercise) {
        exercise.setup(created);
        // In the language the exercise is written in, not the board's default.
        // A Pi lesson hands over Python, and handing that to the C++ parser
        // reports "expected a type" on the first `from` and stops there.
        created.loadFirmware(exercise.sketch, exerciseLanguage(exercise));
      } else if (projectBuild) {
        projectBuild.setup(created);
        created.loadFirmware(projectBuild.sketch, boardOption(boardId).language);
      } else {
        buildStartingBench(created, STARTER_WIRING[boardId]);
        created.loadFirmware(
          boardOption(boardId).language === 'python' ? PI_BLINK_SKETCH : BLINK_EXAMPLE.sketch,
          boardOption(boardId).language,
        );
      }
      // Deliberately left stopped. The bench opens on a loaded sketch at
      // t=0 that the operator has to run themselves, which is the honest
      // initial state -- starting the moment the page loads ran the firmware
      // before anyone had looked at it, and left the status lamp claiming
      // "running" over a simulation nobody had started.
      return created;
    },
    [boardId, exercise, projectBuild, boardOption, STARTER_WIRING, PI_BLINK_SKETCH, exerciseLanguage, BLINK_EXAMPLE],
  );

  const [baud, setBaud] = useState(9600);

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
      simulation.tick(deltaSeconds);

      /*
       * Re-render only when the bench actually changed.
       *
       * This used to force a render every frame unconditionally, on the
       * reasoning that the frame rate drove the simulation. It does not: the
       * wall-clock delta does, and a stopped simulation returns immediately
       * from `tick` without touching anything.
       *
       * So a parked bench was re-rendering its whole tree -- nearly a thousand
       * breadboard terminals, two canvas-backed panels -- sixty times a second
       * to draw an identical picture. That is not merely wasteful, it is what
       * made leaving the bench unusably slow: React Router performs a
       * navigation in a transition, which is a lower-priority lane than the
       * one these renders are written to. Sixty urgent renders a second starve
       * the transition, so the new page could not commit until the bench gave
       * up the main thread -- tens of seconds -- while arriving at the bench
       * had nothing queued behind it and was immediate.
       *
       * The bench still animates whenever it is running, which is the only
       * time anything is moving.
       */
      if (running && simulation.isAnimating()) {
        forceRender((n) => n + 1);
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
  }, [simulation]);

  /*
   * The colour palette that opens where a wire was picked.
   *
   * Anchored to the click rather than to the wire, so it sits under the cursor
   * the operator just used and does not slide around while they move it. It is
   * transient: any further canvas click, Escape, or the wire going away closes
   * it, because a palette left open over the bench would be in the way of the
   * wiring it was opened to do.
   */
  const [paletteFor, setPaletteFor] = useState<{
    wireId: string;
    x: number;
    y: number;
  } | null>(null);

  /**
   * Takes a jumper off the bench.
   *
   * Re-solved, because pulling a wire is how an operator disconnects two
   * things, and whatever net it was the only link in is now open.
   */
  const removeWire = useCallback(
    (wireId: string) => {
      simulation.removeWire(wireId);
      // The selection cannot outlive the wire: leaving it set would point the
      // palette and the endpoint handles at a jumper that is no longer here.
      setSelectedWireId(null);
      setPaletteFor(null);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  /**
   * Steps the bench back or forward through its history.
   *
   * Selections are dropped either way. A restored bench need not contain the
   * part or the wire that was picked, and a selection left pointing at
   * something that is no longer there is how the inspector ends up describing
   * a part that does not exist and the delete key pulling a wire that was
   * already gone.
   */
  const stepHistory = useCallback(
    (forward: boolean) => {
      if (!(forward ? simulation.redo() : simulation.undo())) return;
      setSelectedId(null);
      setSelectedWireId(null);
      setPaletteFor(null);
      forceRender((n) => n + 1);
    },
    [simulation],
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
          if (simulation.running) simulation.stop();
          else simulation.start();
          forceRender((n) => n + 1);
          break;
        case 'r':
          // Turning a part is only meaningful with one selected, and the key is
          // left alone otherwise for the same reason Delete is: swallowing it
          // would take the letter from anything else that wants it.
          if (selectedId === null) return;
          event.preventDefault();
          simulation.rotatePart(selectedId);
          forceRender((n) => n + 1);
          break;
        case 'b':
          setSidebarOpen((open) => !open);
          break;
        case 'c':
          setBrowserOpen(true);
          break;
        case 'i':
          setInstrumentsOpen((open) => !open);
          break;
        case 'Delete':
        case 'Backspace':
          // Only a picked wire answers to this. With nothing picked the key is
          // left alone rather than swallowed, so it stays available to whatever
          // else might want it.
          if (selectedWireId === null) return;
          event.preventDefault();
          removeWire(selectedWireId);
          break;
        case 'Escape':
          // Escape backs out of whatever is open, deepest first, so it never
          // leaves the bench in a state with no way back.
          if (browserOpen) setBrowserOpen(false);
          else if (paletteFor) setPaletteFor(null);
          else if (selectedId) setSelectedId(null);
          else if (firmwareOpen) setFirmwareOpen(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [simulation, browserOpen, paletteFor, selectedId, selectedWireId, firmwareOpen, removeWire, stepHistory]);


  const bench = simulation.bench;

  /*
   * Rebuilt when the bench changes, not only when the simulation does, because
   * an example adds its parts to a simulation that already exists: keyed on the
   * simulation alone this map would never learn about a display that arrived
   * later, and its artwork would sit on the bench showing whatever it was
   * constructed with.
   */
  const renderState = useMemo<FootprintState>(
    () => ({
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
    }),
    [simulation, bench],
  );


  // Meter probes come from the same pin list as the scope's. The black probe
  // defaults to bench ground, which is where it sits when unclipped.
  const [meterRedPin, setMeterRedPin] = useState<string | null>(null);
  const [meterBlackPin, setMeterBlackPin] = useState<string | null>(null);

  useEffect(() => {
    simulation.setMeterProbes(
      meterRedPin ? simulation.engine.netOfMcuPin(meterRedPin) : null,
      meterBlackPin ? simulation.engine.netOfMcuPin(meterBlackPin) : null,
    );
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
      simulation.movePart(partId, Math.round(x), Math.round(y));
      // Asked for explicitly, because the animation loop only re-renders while
      // the simulation is running. A stopped bench relied on that loop drawing
      // every frame for everything to update -- which is why dragging a part
      // moved it in the model and left it exactly where it was on screen.
      forceRender((n) => n + 1);
    },
    [simulation],
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
      simulation.moveWireEnd(wireId, end, to);
      forceRender((n) => n + 1);
    },
    [simulation],
  );


  /*
   * The chosen colour rides along with the route rather than being read from
   * the canvas, so the swatch in the header and the wire it places cannot
   * disagree about what "the next colour" means.
   */
  const onRouteWire = useCallback(
    (from: Terminal, to: Terminal, bends: readonly BendPoint[]) =>
      simulation.routeWire(from, to, bends, wireColour),
    [simulation, wireColour],
  );

  const onSetWireBends = useCallback(
    (wireId: string, bends: readonly BendPoint[]) => {
      simulation.setWireBends(wireId, bends);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const onRemoveWireBend = useCallback(
    (wireId: string, index: number) => {
      simulation.removeWireBend(wireId, index);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const onInsertWireBend = useCallback(
    (wireId: string, index: number, bend: BendPoint) => {
      simulation.insertWireBend(wireId, index, bend);
      forceRender((n) => n + 1);
    },
    [simulation],
  );

  const bendIndexNear = useCallback(
    (wireId: string, x: number, y: number) => simulation.bendIndexNear(wireId, x, y),
    [simulation],
  );

  const onTogglePressed = useCallback(
    (partId: string, pressed: boolean) => simulation.setPressed(partId, pressed),
    [simulation],
  );

  /**
   * Loads an example: the sketch, and the bench it expects to find.
   *
   * Both halves or neither. A sketch that talks to a clock nobody wired reads
   * nothing and looks exactly like a broken API, so the parts go down first and
   * the sketch is loaded onto them. The bench keeps the board and the breadboard
   * and everything already wired to them, because the examples share the
   * displays and the clock that one of them reads.
   *
   * The sketch arrives wrapped as a single-file project, so any tabs the
   * operator had open are replaced rather than merged: an example is a fresh
   * starting point, not an extra file.
   */
  const loadExample = useCallback(
    (id: string) => {
      const example = EXAMPLES.find((candidate) => candidate.id === id);
      if (!example) return;
      // The previous example's parts come off first. Every example places its
      // modules at the same few coordinates, so without this a second load puts
      // a second LCD exactly on top of the first and doubles every wire -- the
      // bench fills with duplicates that all look live.
      simulation.clearExampleParts();
      example.wire(simulation);
      const next = toSingleFileProject(example.sketch, boardOption(boardId).language);
      setProject(next);
      setExampleId(example.id);
      simulation.loadFirmware(next);
      forceRender((n) => n + 1);
    },
    [simulation, EXAMPLES, boardOption, boardId],
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
  };

  /*
   * Run loads the whole project, then opens the tab the error names: the bar
   * shows the message verbatim and the editor shows the file it came from, so
   * the operator never has to guess which tab broke.
   */
  const handleRun = () => {
    simulation.loadFirmware(project);
    const message = simulation.firmwareError;
    if (message) {
      const head = message.split(':')[0]?.trim() ?? '';
      if (head !== '' && head !== project.activeName && project.files.some((file) => file.name === head)) {
        const failed = head;
        setProject((previous) => ({ ...previous, activeName: failed }));
      }
    }
    simulation.start();
    forceRender((n) => n + 1);
  };

  const onPlacePart = useCallback(
    (definition: PartDefinition, entry: CatalogueEntry) => {
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
            /*
             * Land the part's topmost, leftmost pin on a real hole rather than
             * its origin. Every part's leads sit at a different offset inside
             * its own footprint, so dropping the origin on the hole row left
             * everything but the resistor hanging in mid-air.
             */
            const [pinX, pinY] = offsetOfFirstPin(definition);
            return simulation.addPart(
              definition,
              BREADBOARD_ORIGIN_X + columnX(column) - pinX,
              stripRowY(8) - pinY,
            );
          })();
      setSelectedId(part.id);
    },
    [simulation],
  );

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
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-800 pr-3 pl-4">
        <h1 className="text-sm font-semibold tracking-tight">Noesis Lab</h1>

        {/*
         * The way back to the board list, as a link rather than a button so it
         * is a real destination: middle-click opens the picker in a new tab,
         * and the back button returns to it. It sits beside the board dropdown
         * rather than in the far-right action group because it belongs to the
         * same question -- which board is this.
         */}
        <Link to="/" className="ctl ctl-quiet" title="Back to the board list">
          <Component1Icon className="icon" aria-hidden="true" />
          Boards
        </Link>

        <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
          <span className="text-slate-500" aria-hidden="true">
            <Component1Icon className="icon" />
          </span>
          <select
            value={boardId}
            onChange={(event) => {
              const next = event.target.value;
              // Guarded rather than cast: the select is the one place a board
              // id can come from something we did not choose, and navigating
              // to a board that does not exist would leave the path lying about
              // what is on the bench.
              if (isBoardId(next)) navigate(`/bench/${next}`);
            }}
            aria-label="Board"
            title="Swap board"
          >
            {BOARDS.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (simulation.running) simulation.stop();
              else simulation.start();
              forceRender((n) => n + 1);
            }}
            className="ctl ctl-quiet"
            title={simulation.running ? 'Pause the simulation (Space)' : 'Run the simulation (Space)'}
          >
            {simulation.running ? (
              <PauseIcon className="icon" aria-hidden="true" />
            ) : (
              <PlayIcon className="icon" aria-hidden="true" />
            )}
            {simulation.running ? 'Pause' : 'Run'}
          </button>


          {/*
           * Undo and redo, beside Run because that is where an operator's
           * hands already are when something has just gone wrong.
           *
           * Both go grey when there is nothing to step to, rather than being
           * hidden: a control that appears and disappears with the history is a
           * control whose absence has to be explained, and a greyed button
           * explains itself.
           */}
          <button
            type="button"
            onClick={() => stepHistory(false)}
            disabled={!simulation.canUndo()}
            className="ctl ctl-quiet"
            title="Undo the last change to the bench (Ctrl+Z)"
            aria-label="Undo"
          >
            <ArrowLeftIcon className="icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => stepHistory(true)}
            disabled={!simulation.canRedo()}
            className="ctl ctl-quiet"
            title="Redo the change you just undid (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            <ArrowRightIcon className="icon" aria-hidden="true" />
          </button>
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
              const selected = selectedWireId !== null
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
                  className={`h-5 w-5 rounded-sm transition-transform ${
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

          <button
            type="button"
            onClick={() => setBrowserOpen(true)}
            className="ctl ctl-accent"
            title="Browse every part the bench can hold (C)"
          >
            <PlusIcon className="icon" aria-hidden="true" />
            Components
          </button>

          {exercise && (
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="ctl ctl-outline"
              title={`Open the guide for ${exercise.id} ${exercise.title}`}
            >
              <ReaderIcon className="icon" aria-hidden="true" />
              Guide {exercise.id}
            </button>
          )}
        </div>
      </header>

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
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <Cross2Icon className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/*
         * The parts rail. It used to step aside under the `lg` breakpoint, which
         * meant a laptop could reach the bench but could not reach the parts list
         * at all. A rail costs almost nothing and keeps the toggle discoverable.
         */}
        <aside
          className={`flex shrink-0 flex-col border-r border-slate-800 bg-slate-900 transition-[width] ${
            sidebarOpen ? 'w-56' : 'w-9'
          }`}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Collapse the parts sidebar' : 'Expand the parts sidebar'}
            title={`${sidebarOpen ? 'Collapse' : 'Expand'} sidebar (B)`}
            className="flex h-9 shrink-0 items-center justify-center border-b border-slate-800 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <CaretLeftIcon
              className={`icon transition-transform ${sidebarOpen ? '' : 'rotate-180'}`}
              aria-hidden="true"
            />
          </button>
          {sidebarOpen && (
            <PartSearch onPlace={onPlacePart} onBrowse={() => setBrowserOpen(true)} />
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Workbench
              bench={bench}
              renderState={renderState}
              netOfTerminal={netOfTerminal}
              selectedId={selectedId}
              selectedWireId={selectedWireId}
              onSelect={(partId) => {
                // A click anywhere that is not a wire also dismisses the
                // palette, so picking a part puts the bench back to normal
                // rather than leaving a swatch row floating over it.
                setPaletteFor(null);
                setSelectedId(partId);
              }}
              onSelectWire={setSelectedWireId}
              onWirePicked={(wireId, x, y) => setPaletteFor({ wireId, x, y })}
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
                className="fixed z-20 flex items-center gap-0.5 rounded-md border border-slate-700 bg-slate-900/95 p-1 shadow-lg"
                style={{
                  left: paletteFor.x,
                  top: paletteFor.y,
                  // Opens above and to the left of the click, which keeps it off
                  // the wire and off the cursor that summoned it. Both flips
                  // matter: a palette that opens over the header or off the
                  // left of the window is a palette that cannot be used.
                  transform: [
                    `translateX(${paletteFor.x < PALETTE_FLIP_X ? '0' : '-100%'})`,
                    paletteFor.y < PALETTE_FLIP_Y ? 'translateY(12px)' : 'translateY(calc(-100% - 12px))',
                  ].join(' '),
                }}
              >
                {WIRE_COLOURS.map((colour) => (
                  <button
                    key={colour.hex}
                    type="button"
                    onClick={() => {
                      recolourSelectedWire(colour.hex);
                      setPaletteFor(null);
                    }}
                    aria-label={`Wire colour ${colour.label}`}
                    title={colour.label}
                    className="h-5 w-5 rounded-sm transition-transform hover:scale-110"
                    style={{
                      backgroundColor: colour.hex,
                      boxShadow: `inset 0 0 0 1px ${colour.border}`,
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setPaletteFor(null)}
                  aria-label="Close the colour palette"
                  title="Close (Esc)"
                  className="ml-1 flex h-5 w-5 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                >
                  <Cross2Icon className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          {/*
           * The editor lives under the bench rather than beside it. A wide
           * text area does not need a tall column, and a landscape bench on a
           * landscape canvas frames the whole board without zooming out.
           */}
          <section
            className={`flex shrink-0 flex-col border-t border-slate-800 bg-slate-900 ${
              firmwareOpen ? 'h-[42%]' : ''
            }`}
          >
            <FirmwareEditor
              project={project}
              onProjectChange={setProject}
              error={simulation.firmwareError}
              expanded={firmwareOpen}
              onToggle={() => setFirmwareOpen((open) => !open)}
              language={project.language}
              onChangeLanguage={handleLanguageChange}
              onRun={handleRun}
              onReset={() => {
                simulation.reset();
                forceRender((n) => n + 1);
              }}
              running={simulation.running}
              examples={EXAMPLES}
              activeExampleId={exampleId}
              onLoadExample={loadExample}
            />
          </section>
        </main>

        <aside
          className={`shrink-0 flex-col border-l border-slate-800 bg-slate-900 ${
            instrumentsOpen ? 'hidden w-60 lg:flex' : 'hidden'
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
              controls={simulation.controls}
              onDelete={() => {
                if (selected) simulation.removePart(selected.id);
                setSelectedId(null);
              }}
              onSetPressed={(pressed) => {
                if (selected) simulation.setPressed(selected.id, pressed);
              }}
              onSetKnob={(spec, value) => {
                if (selected) simulation.setKnob(selected.id, spec, value);
              }}
              onRotate={() => {
                // Physical, not electronic: this turns the part on the bench.
                // A colour panel has a second rotation of its own, the one a
                // sketch asks for through `tft.setRotation`, and the two are
                // independent -- turning the panel does not tell the sketch.
                if (selected) simulation.rotatePart(selected.id);
              }}
              panelSize={selected ? simulation.displaySize(selected.id) : undefined}
              rotation={selected ? simulation.partRotation(selected.id) : 0}
            />
          </div>

          <div className="h-40 shrink-0 border-t border-slate-800">
            <SerialMonitor lines={simulation.serialLines()} />
          </div>
        </aside>

        <aside
          className={`shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900 ${
            instrumentsOpen ? 'hidden w-72 xl:block' : 'hidden'
          }`}
        >
          <ScopePanel
            pins={probePins}
            baud={baud}
            probePinId={simulation.probePinId}
            samples={simulation.probeTrace()}
            logicVolts={simulation.mcu.board.logicVolts}
            onProbe={(pinId: string | null) => simulation.setProbePin(pinId)}
            onBaud={setBaud}
          />
          <LogicAnalyser
            pins={probePins}
            traces={simulation.analyserTraces()}
            logicVolts={simulation.mcu.board.logicVolts}
            onTogglePin={(pinId) => simulation.toggleAnalysedPin(pinId)}
            isCapturing={(pinId) => simulation.isPinAnalysed(pinId)}
          />
          <BusMonitor entries={simulation.busLines()} onClear={() => simulation.clearBusLog()} />
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
        </aside>

      {browserOpen && (
        <ComponentBrowser
          onPlace={(definition, entry) => {
            onPlacePart(definition, entry);
            setBrowserOpen(false);
          }}
          onClose={() => setBrowserOpen(false)}
        />
      )}

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
        timeMs={simulation.engine.timeMs}
        running={simulation.running}
        netCount={simulation.engine.currentNetlist.nodeCount}
      />
    </div>
  );
}