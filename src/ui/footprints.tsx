/**
 * SVG renderers for part footprints.
 *
 * Everything is drawn in millimetres at 1:1, in the part's own coordinate space,
 * so the canvas only has to apply the bench transform once. Nothing here knows
 * about zoom, selection or the simulation -- a footprint is a pure function of a
 * definition plus the live electrical state it is handed.
 *
 * The aim is that a part looks like the thing it is before you read its label:
 * a solder mask that catches the light, a header whose pins actually stand out
 * of the plastic, an LED with a dome and a flat cathode side, leads that bend
 * down into their holes. The shared paint and hardware pieces live in
 * `hardware.tsx`; each SVG document renders `HardwareDefs` once.
 */

import type { PartInstance } from '../sim/bench';
import type { PartDefinition, PinSpec } from '../sim/catalog';
import { DynamicState } from '../sim/catalog';
import { DIODE_PROFILES } from '../sim/elements';
import { WIPER_KNOB } from '../sim/passives';
import { memo, useEffect, useRef } from 'react';
import { Ili9341 } from '../sim/display/ili9341';
import { Ssd1306 } from '../sim/display/ssd1306';
import type { DisplayController } from '../sim/display/part';
import type { Servo } from '../sim/devices/servo';
import type { Lcd1602 } from '../sim/devices/lcd';
import {
  AxialLeads,
  BarrelJack,
  BoardButton,
  BoardCapacitor,
  Chip,
  CopperTrace,
  IndicatorLed,
  MicroUsb,
  MountingHole,
  PinHeader,
  RadialLeads,
  SILKSCREEN_FONT,
  SmdPassive,
  SolderPad,
  UsbB,
} from './hardware';
import { wokwiPartFor } from './wokwi';
import { WokwiFootprint } from './WokwiFootprint';

/*
 * Registers Wokwi's custom elements. They are HTML rather than SVG, so the
 * parts they draw are placed inside foreign objects, not as children of the
 * bench. Importing for the side effect is what defines the tags.
 */
import '@wokwi/elements';

/** Live electrical state a footprint needs in order to look right. */
export interface FootprintState {
  /** Live controller models for display parts, keyed by part id. */
  readonly displays?: ReadonlyMap<string, DisplayController>;
  /** Servo parts, so their horns point where the sketch told them to. */
  readonly servos?: ReadonlyMap<string, Servo>;
  /** Character LCD parts, so their glass shows what reached it. */
  readonly lcds?: ReadonlyMap<string, Lcd1602>;
  /**
   * How many parts the bench holds.
   *
   * Carried so a renderer's state object changes when a part is added, which an
   * example does without replacing the simulation. Nothing reads it.
   */
  readonly parts?: number;
  /** `${partId}:${pinId}` to volts on that pin's net. */
  readonly pinVolts: ReadonlyMap<string, number>;
  /** What the operator is doing to the parts, read live as this is drawn. */
  readonly controls: DynamicState;
}

export const PIN_RADIUS_MM = 0.9;

/**
 * Wraps a body whose whole appearance is fixed by its definition.
 *
 * The parts layer is re-rendered every frame, because pin voltages, displays
 * and pressed buttons change every frame. Without this the breadboard's nine
 * hundred holes are rebuilt sixty times a second to produce an identical
 * picture. The definition a part holds never changes identity, so memoising on
 * it lets React skip these subtrees entirely.
 */
function staticBody<P extends object>(render: (props: P) => React.ReactNode) {
  return memo(render);
}

export function PartFootprint({
  part,
  state,
  onTogglePressed,
}: {
  part: PartInstance;
  state: FootprintState;
  /** Forwarded to parts whose own element reports a press. */
  onTogglePressed?: (partId: string, pressed: boolean) => void;
}) {
  const { definition } = part;
  const kind = definition.component.kind;

  /*
   * A breadboard, a board with its headers, and a display with its header
   * strip all draw their own holes; ringing each of them again would double
   * the element count to say nothing. Everything else gets a visible hole so a
   * lead going into it reads as going in.
   */
  const showsOwnHoles = kind === 'breadboard' || kind === 'mcu' || kind === 'display';

  return (
    <g data-part-id={part.id}>
      {shapeFor(definition, part, state, onTogglePressed)}
      {!showsOwnHoles &&
        definition.pins.map((pin) => <PinMark key={pin.id} pin={pin} part={part} state={state} />)}
    </g>
  );
}

function PinMark({
  pin,
  part,
  state,
}: {
  pin: PinSpec;
  part: PartInstance;
  state: FootprintState;
}) {
  const volts = state.pinVolts.get(`${part.id}:${pin.id}`) ?? 0;
  const energised = Math.abs(volts) > 0.5;
  return (
    <g>
      <circle
        cx={pin.x}
        cy={pin.y}
        r={PIN_RADIUS_MM + 0.5}
        fill="#0f1115"
        opacity={0.5}
      />
      <circle
        cx={pin.x}
        cy={pin.y}
        r={PIN_RADIUS_MM}
        fill={energised ? '#fbbf24' : '#3f4652'}
        stroke="#111827"
        strokeWidth={0.15}
      />
    </g>
  );
}

function shapeFor(
  definition: PartDefinition,
  part: PartInstance,
  state: FootprintState,
  onTogglePressed?: (partId: string, pressed: boolean) => void,
) {
  /*
   * Wokwi's own artwork is used wherever it covers the part. Anything uncovered
   * -- the breadboard and the capacitor have no Wokwi equivalent -- falls
   * through to the renderers below, which stay as the fallback rather than
   * being deleted.
   */
  const wokwi = wokwiPartFor(definition);
  if (wokwi) {
    return (
      <WokwiFootprint part={part} state={state} entry={wokwi} onTogglePressed={onTogglePressed} />
    );
  }
  switch (definition.component.kind) {
    case 'breadboard':
      return <BreadboardBody definition={definition} />;
    case 'mcu':
      return <BoardBody definition={definition} part={part} state={state} />;
    case 'resistor':
      return <ResistorBody definition={definition} />;
    case 'led':
      return <LedBody definition={definition} state={state} part={part} />;
    case 'capacitor':
      return <CapacitorBody definition={definition} />;
    case 'button':
      return <ButtonBody definition={definition} state={state} part={part} />;
    case 'potentiometer':
      return <PotentiometerBody definition={definition} state={state} part={part} />;
    case 'display':
      return <DisplayBody definition={definition} state={state} part={part} />;
  }
}

// ---------------------------------------------------------------------------
// Breadboard

const BreadboardBody = staticBody(function BreadboardBody({
  definition,
}: {
  definition: PartDefinition;
}) {
  const stripHoles = definition.pins.filter((pin) => pin.id.startsWith('s'));
  const railHoles = definition.pins.filter((pin) => pin.id.startsWith('r'));

  // 882 holes as 882 elements would rebuild nine hundred nodes every frame, so
  // each block of holes is one path of subpaths instead. The picture is
  // identical; the DOM is two nodes.
  const socketPath = (holes: readonly PinSpec[], half: number) =>
    holes
      .map((pin) => `M ${pin.x - half} ${pin.y - half} h ${half * 2} v ${half * 2} h ${-half * 2} Z`)
      .join(' ');

  const width = definition.widthMm;
  const height = definition.heightMm;
  const split = width / 2;

  return (
    <g>
      {/* Moulded ABS shell, lit from above and rounded at the corners. */}
      <rect width={width} height={height} rx={2.4} fill="url(#nz-shell)" stroke="#b3afa6" strokeWidth={0.35} />
      <rect
        x={0.4}
        y={0.4}
        width={width - 0.8}
        height={height - 0.8}
        rx={2}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.3}
        opacity={0.55}
      />

      {/* Power rails: red along the top of each half, blue along the bottom. */}
      {[
        { y: 6.35, colour: '#d94f4f' },
        { y: 8.89, colour: '#4f7fd9' },
        { y: 45.72, colour: '#4f7fd9' },
        { y: 48.26, colour: '#d94f4f' },
      ].map((rail) => (
        <g key={rail.y}>
          <line x1={1.4} y1={rail.y} x2={split - 1.4} y2={rail.y} stroke={rail.colour} strokeWidth={0.5} opacity={0.6} />
          <line x1={split + 1.4} y1={rail.y} x2={width - 1.4} y2={rail.y} stroke={rail.colour} strokeWidth={0.5} opacity={0.6} />
        </g>
      ))}
      {[
        { x: 3.4, colour: '#d94f4f', sign: '+' },
        { x: 5.6, colour: '#4f7fd9', sign: '-' },
        { x: split + 3.4, colour: '#d94f4f', sign: '+' },
        { x: split + 5.6, colour: '#4f7fd9', sign: '-' },
      ].map((mark) => (
        <text
          key={`${mark.x}-${mark.sign}`}
          x={mark.x}
          y={5.4}
          fontSize={2.4}
          textAnchor="middle"
          fill={mark.colour}
          opacity={0.75}
          fontFamily={SILKSCREEN_FONT}
        >
          {mark.sign}
        </text>
      ))}

      {/* The channel a straddling chip sits across. */}
      <rect x={1.6} y={26.2} width={width - 3.2} height={6.6} fill="#e2dfd8" stroke="#c6c2b9" strokeWidth={0.25} />
      <line x1={1.6} y1={26.7} x2={width - 1.6} y2={26.7} stroke="#c6c2b9" strokeWidth={0.2} />
      <line x1={1.6} y1={32.3} x2={width - 1.6} y2={32.3} stroke="#c6c2b9" strokeWidth={0.2} />

      {/* Sockets. */}
      <path d={socketPath(stripHoles, 0.5)} fill="#15130f" />
      <path d={socketPath(railHoles, 0.42)} fill="#15130f" />
      <path
        d={socketPath(stripHoles, 0.5)}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.14}
        opacity={0.22}
        transform="translate(0 -0.16)"
      />
      <path
        d={socketPath(railHoles, 0.42)}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.12}
        opacity={0.18}
        transform="translate(0 -0.14)"
      />

      <BreadboardSilkscreen width={width} height={height} />
    </g>
  );
});

/** Column numbers and row letters, printed along the board's edges. */
const BreadboardSilkscreen = staticBody(function BreadboardSilkscreen({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const columns: number[] = [];
  for (let c = 0; c < 63; c += 5) columns.push(c);
  columns.push(62);

  return (
    <g fill="#8d897f" opacity={0.9} fontFamily={SILKSCREEN_FONT} fontSize={1.7}>
      {columns.map((column) => {
        const x = 5.08 + column * 2.54;
        return (
          <g key={column}>
            <text x={x} y={13.6} textAnchor="middle">
              {column + 1}
            </text>
            <text x={x} y={35.6} textAnchor="middle">
              {column + 1}
            </text>
          </g>
        );
      })}
      {letters.map((letter, row) => (
        <g key={letter}>
          <text x={2.6} y={15.24 + (row < 5 ? row : row - 0.5) * 2.54 + 0.7}>
            {letter}
          </text>
          <text x={width - 2.6} y={15.24 + (row < 5 ? row : row - 0.5) * 2.54 + 0.7} textAnchor="end">
            {letter}
          </text>
        </g>
      ))}
      <text x={width / 2} y={height - 1.4} textAnchor="middle" fontSize={1.5} opacity={0.6}>
        BREADBOARD 830 TIE-POINT
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Microcontroller boards

/**
 * The furniture that makes one board recognisable rather than a generic slab.
 *
 * Two boards is not a general renderer, so this is a lookup rather than a set
 * of rules: a board with no entry still renders as a well-made board, it just
 * does not get a USB connector drawn in the wrong place.
 */
interface BoardDressing {
  readonly usb: 'micro-b' | 'usb-b' | 'none';
  readonly barrelJack: boolean;
  readonly buttons: ReadonlyArray<{ label: string; x: number; y: number }>;
  readonly indicators: ReadonlyArray<{
    label: string;
    x: number;
    y: number;
    colour: string;
    /** Pin whose voltage decides whether this lamp is on. */
    pin: string;
  }>;
  readonly module?: { x: number; y: number; width: number; height: number; label: string };
}

const BOARD_DRESSING: Readonly<Record<string, BoardDressing>> = {
  'esp32-devkit-v1': {
    usb: 'micro-b',
    barrelJack: false,
    buttons: [
      { label: 'EN', x: 2.6, y: 6.4 },
      { label: 'BOOT', x: 2.6, y: 11.4 },
    ],
    indicators: [{ label: 'PWR', x: 22.6, y: 3.1, colour: '#e5484d', pin: 'R_3V3' }],
    module: { x: 4.6, y: 14.4, width: 18.7, height: 25.4, label: 'ESP32-D0WD' },
  },
  'arduino-uno-r3': {
    usb: 'usb-b',
    barrelJack: true,
    buttons: [
      { label: 'RESET', x: 20.6, y: 9.4 },
      { label: 'IOREF', x: 66.4, y: 9.4 },
    ],
    indicators: [
      { label: 'ON', x: 44.6, y: 5.6, colour: '#e5484d', pin: 'J1_D13' },
      { label: 'L', x: 50.6, y: 5.6, colour: '#f0b429', pin: 'J1_D13' },
      { label: 'TX', x: 56.6, y: 5.6, colour: '#3aa0e8', pin: 'J1_D13' },
      { label: 'RX', x: 62.6, y: 5.6, colour: '#f0b429', pin: 'J1_D13' },
    ],
  },
};

const BoardBody = staticBody(function BoardBody({
  definition,
  part,
  state,
}: {
  definition: PartDefinition;
  part: PartInstance;
  state: FootprintState;
}) {
  const { widthMm: width, heightMm: height } = definition;
  const dressing = BOARD_DRESSING[definition.id];
  const left = definition.pins.filter((pin) => pin.x < width / 2);
  const right = definition.pins.filter((pin) => pin.x >= width / 2);
  const silk = definition.legendColour;

  return (
    <g>
      {/* Solder mask over the FR4, with the board's own colour underneath. */}
      <rect width={width} height={height} rx={2.6} fill={definition.bodyColour} stroke="#05070a" strokeWidth={0.3} />
      <rect width={width} height={height} rx={2.6} fill="url(#nz-mask)" />

      <BoardCopper definition={definition} />

      <MountingHole x={2.6} y={2.6} />
      <MountingHole x={width - 2.6} y={2.6} />
      <MountingHole x={2.6} y={height - 2.6} />
      <MountingHole x={width - 2.6} y={height - 2.6} />

      {dressing?.usb === 'micro-b' && <MicroUsb x={(width - 7.5) / 2} y={0.6} label="USB" />}
      {dressing?.usb === 'usb-b' && <UsbB x={5} y={1.6} label="USB" />}
      {dressing?.barrelJack && <BarrelJack x={21} y={1.4} />}

      {dressing?.module && <RadioModule {...dressing.module} />}

      {dressing?.usb === 'micro-b' && (
        <>
          <Chip x={6.4} y={42.4} width={5} height={5} legs={7} text="CP2102" />
          <Chip x={13.6} y={42.8} width={3.6} height={4.2} legs={6} text="AMS" />
          <rect x={19} y={43.4} width={4.4} height={2.6} rx={0.9} fill="url(#nz-metal)" />
          <BoardCapacitor x={19} y={41.4} radius={1.3} height={2} />
          <SmdPassive x={9.6} y={48.4} />
          <SmdPassive x={12} y={48.4} />
          <SmdPassive x={14.4} y={48.4} />
        </>
      )}

      {dressing?.usb === 'usb-b' && (
        <>
          <Chip x={36} y={13.4} width={6.4} height={13.6} legs={14} text="ATMEGA328P" />
          <Chip x={48} y={14.4} width={5} height={6} legs={7} text="" />
          <BoardCapacitor x={45.6} y={24.4} radius={1.6} height={3.8} />
          <BoardCapacitor x={49.6} y={24.4} radius={1.6} height={3.8} />
          <Chip x={36} y={32.4} width={5.4} height={5.4} legs={8} text="" />
          <rect x={45} y={33} width={5.6} height={3.2} rx={1.1} fill="url(#nz-metal)" />
          <rect x={54} y={33} width={5.6} height={3.2} rx={1.1} fill="url(#nz-metal)" />
          <rect x={17.6} y={44.4} width={5.4} height={2.8} rx={1} fill="#dcdcd2" />
          <rect x={17.6} y={44.4} width={5.4} height={2.8} rx={1} fill="url(#nz-body)" />
          <SmdPassive x={26} y={40} width={2.6} height={1.1} />
          <SmdPassive x={30} y={40} width={2.6} height={1.1} />
          <SmdPassive x={34} y={40} width={2.6} height={1.1} />
          <SmdPassive x={26} y={43} width={2.6} height={1.1} />
          <SmdPassive x={30} y={43} width={2.6} height={1.1} />
          <SmdPassive x={34} y={43} width={2.6} height={1.1} />
        </>
      )}

      {dressing?.buttons.map((button) => (
        <BoardButton key={button.label} x={button.x} y={button.y} label={button.label} labelColour={silk} />
      ))}

      <PinHeader
        pins={left}
        x={left[0]?.x ?? 0}
        from={left[0]?.y ?? 0}
        to={left[left.length - 1]?.y ?? 0}
        labelColour={silk}
      />
      <PinHeader
        pins={right}
        x={right[0]?.x ?? 0}
        from={right[0]?.y ?? 0}
        to={right[right.length - 1]?.y ?? 0}
        labelColour={silk}
      />

      <HeaderSilkscreen definition={definition} left={left} right={right} />

      {dressing?.indicators.map((led) => (
        <IndicatorLed
          key={led.label}
          x={led.x}
          y={led.y}
          colour={led.colour}
          lit={Math.abs(state.pinVolts.get(`${part.id}:${led.pin}`) ?? 0) > 1}
          label={led.label}
          labelColour={silk}
        />
      ))}

      <text
        x={width / 2}
        y={height - 1.6}
        fontSize={2}
        textAnchor="middle"
        fill={silk}
        opacity={0.5}
        fontFamily={SILKSCREEN_FONT}
      >
        {definition.name.toUpperCase()}
      </text>
    </g>
  );
});

/** The ESP32-WROOM module: a metal-shielded can strapped to the board. */
function RadioModule({ x, y, width, height, label }: { x: number; y: number; width: number; height: number; label: string }) {
  return (
    <g>
      <rect x={x - 0.5} y={y + height - 2} width={width + 1} height={3.2} fill="url(#nz-metal)" opacity={0.75} />
      <rect x={x} y={y} width={width} height={height} rx={1.2} fill="url(#nz-metal)" stroke="#5d6572" strokeWidth={0.2} />
      <rect x={x} y={y} width={width} height={height * 0.45} fill="#ffffff" opacity={0.16} />
      {/* The PCB antenna is etched into the carrier under the can's overhang. */}
      <rect x={x - 1.4} y={y + height - 4.2} width={width + 2.8} height={4} fill="#1c1f24" opacity={0.9} />
      <text
        x={x + width / 2}
        y={y + height * 0.62}
        fontSize={1.7}
        textAnchor="middle"
        fill="#2c333c"
        fontFamily={SILKSCREEN_FONT}
        opacity={0.85}
      >
        {label}
      </text>
    </g>
  );
}

/** Copper traces and vias, faintly visible through the mask. */
const BoardCopper = staticBody(function BoardCopper({ definition }: { definition: PartDefinition }) {
  const { widthMm: width, heightMm: height } = definition;
  return (
    <g>
      {Array.from({ length: Math.floor(width / 6) }, (_, index) => 3 + index * 6).map((x) => (
        <CopperTrace key={`v${x}`} points={`M ${x} 4 L ${x} ${height - 4}`} width={0.28} opacity={0.07} />
      ))}
      {Array.from({ length: Math.floor(height / 6) }, (_, index) => 3 + index * 6).map((y) => (
        <CopperTrace key={`h${y}`} points={`M 4 ${y} L ${width - 4} ${y}`} width={0.28} opacity={0.07} />
      ))}
    </g>
  );
});

/** Pin labels printed alongside each header, the way they are on the board. */
const HeaderSilkscreen = staticBody(function HeaderSilkscreen({
  definition,
  left,
  right,
}: {
  definition: PartDefinition;
  left: readonly PinSpec[];
  right: readonly PinSpec[];
}) {
  const render = (pins: readonly PinSpec[], headerX: number) =>
    pins.map((pin) => {
      const onLeft = headerX < definition.widthMm / 2;
      return (
        <text
          key={pin.id}
          x={headerX + (onLeft ? 2.1 : -2.1)}
          y={pin.y + 0.65}
          fontSize={1.5}
          textAnchor={onLeft ? 'start' : 'end'}
          fill={definition.legendColour}
          opacity={0.82}
          fontFamily={SILKSCREEN_FONT}
        >
          {pin.label}
        </text>
      );
    });

  return (
    <g>
      {render(left, left[0]?.x ?? 0)}
      {render(right, right[0]?.x ?? 0)}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Passives

/** Resistor colour bands, decoded from the actual resistance value. */
const BAND_COLOURS = [
  '#0b0b0b', '#8a4b16', '#c62828', '#ef6c00', '#f9a825',
  '#2e7d32', '#0277bd', '#6a1b9a', '#9e9e9e', '#f5f5f5',
];

const MULTIPLIER_COLOURS = ['#d4af37', '#c62828', '#2e7d32', '#ef6c00'];
const TOLERANCE_COLOUR = '#6a4c93';

function bandsFor(ohms: number): string[] {
  if (ohms <= 0) {
    return [BAND_COLOURS[0], BAND_COLOURS[0], BAND_COLOURS[0], TOLERANCE_COLOUR];
  }

  const exponent = Math.floor(Math.log10(ohms));
  const normalised = ohms / Math.pow(10, exponent);
  // 100 Ohm and up folds the leading digit into the multiplier band.
  const folds = normalised >= 10;
  const first = Math.round(folds ? normalised / 10 : normalised) - 1;
  const second = folds ? Math.round((normalised / 10 - Math.round(normalised / 10)) * 10) : 0;
  const multiplierIndex = Math.min(3, Math.max(0, exponent - (folds ? 1 : 0)));

  return [
    BAND_COLOURS[Math.min(9, Math.max(0, first))],
    BAND_COLOURS[Math.min(9, Math.max(0, second))],
    MULTIPLIER_COLOURS[multiplierIndex],
    TOLERANCE_COLOUR,
  ];
}

const ResistorBody = staticBody(function ResistorBody({
  definition,
}: {
  definition: PartDefinition;
}) {
  const ohms = definition.component.kind === 'resistor' ? definition.component.ohms : 0;
  const bands = bandsFor(ohms);
  const bodyY = 0.6;
  const bodyH = 2.2;

  return (
    <g filter="url(#nz-lift)">
      <AxialLeads left={0} right={10.16} y={1.6} bendLeft={0} bendRight={10.16} />
      {/* Cermilm body: a cylinder lit along its top edge. */}
      <rect x={1.4} y={bodyY} width={7.36} height={bodyH} rx={1.1} fill={definition.bodyColour} stroke="#8d7f5c" strokeWidth={0.18} />
      <rect x={1.4} y={bodyY} width={7.36} height={bodyH * 0.5} rx={1.1} fill="#ffffff" opacity={0.28} />
      <rect x={1.4} y={bodyY + bodyH * 0.72} width={7.36} height={bodyH * 0.28} rx={1.1} fill="#000000" opacity={0.16} />
      {bands.map((colour, index) => (
        <rect key={index} x={2.2 + index * 1.32} y={bodyY + 0.08} width={0.66} height={bodyH - 0.16} fill={colour} opacity={0.92} />
      ))}
    </g>
  );
});

function LedBody({
  definition,
  state,
  part,
}: {
  definition: PartDefinition;
  state: FootprintState;
  part: PartInstance;
}) {
  const anode = state.pinVolts.get(`${part.id}:anode`) ?? 0;
  const cathode = state.pinVolts.get(`${part.id}:cathode`) ?? 0;
  const profile =
    definition.component.kind === 'led' ? definition.component.profile : DIODE_PROFILES.red;

  // Brightness follows the forward bias the solver reports, not the pin state.
  const drive = Math.max(0, Math.min(1, (anode - cathode - 1.4) / 1.1));

  const colour =
    profile === DIODE_PROFILES.blue ? '#2b4fd6'
    : profile === DIODE_PROFILES.white ? '#e8e8e2'
    : profile === DIODE_PROFILES.green ? '#2fa84f'
    : profile === DIODE_PROFILES.yellow ? '#e0b422'
    : '#d63b3b';

  const body = colour;
  const lit = drive > 0.02;

  return (
    <g>
      <RadialLeads left={0} right={2.54} y={3} bendLeft={0.55} bendRight={1.99} />
      {/*
       * Light thrown onto the board around a lit LED. Kept tight: a wide halo
       * swallows the dome, and the flat cathode side is the whole reason an
       * LED is recognisable at a glance.
       */}
      {lit && <ellipse cx={1.5} cy={2.8} rx={3.4} ry={3.2} fill={body} opacity={drive * 0.34} filter="url(#nz-bloom)" />}
      {/* Epoxy dome. The cathode side is a flat chord, as on a real 5 mm LED. */}
      <path
        d="M 0.35 0.55 A 2.35 2.35 0 0 1 0.35 5.05 Z"
        fill={body}
        opacity={0.62 + drive * 0.3}
        stroke="#1a1a1a"
        strokeWidth={0.12}
        strokeOpacity={0.35}
      />
      <ellipse cx={2.35} cy={2.8} rx={2.35} ry={2.5} fill={body} opacity={0.62 + drive * 0.3} />
      {/* The reflector cup and bond wire, visible through the clear epoxy. */}
      <path d="M 0.9 1.9 L 1.75 2.25 L 0.9 2.6 Z" fill="#d8dde5" opacity={0.75} />
      <path d="M 1.75 2.25 L 2.2 4.9" stroke="#cfd6e0" strokeWidth={0.1} opacity={0.6} fill="none" />
      <ellipse cx={1.3} cy={2.6} rx={2.3} ry={2.45} fill="url(#nz-dome)" />
      <ellipse cx={0.95} cy={1.35} rx={0.72} ry={0.5} fill="#ffffff" opacity={0.75 + drive * 0.25} transform="rotate(-28 0.95 1.35)" />
      {lit && <ellipse cx={1.3} cy={2.6} rx={2.3} ry={2.45} fill={body} opacity={drive * 0.28} />}
    </g>
  );
}

const CapacitorBody = staticBody(function CapacitorBody({
  definition,
}: {
  definition: PartDefinition;
}) {
  return (
    <g filter="url(#nz-lift)">
      <RadialLeads left={0} right={2.54} y={4} bendLeft={0.7} bendRight={1.84} />
      {/* The aluminium can, standing on end and lit down its curve. */}
      <rect x={0.7} y={1.1} width={5.6} height={5.6} rx={0.5} fill={definition.bodyColour} stroke="#151c2b" strokeWidth={0.18} />
      <rect x={0.7} y={1.1} width={1.5} height={5.6} fill="#ffffff" opacity={0.2} />
      <rect x={4.4} y={1.1} width={1.9} height={5.6} fill="#000000" opacity={0.22} />
      <ellipse cx={3.5} cy={1.1} rx={2.8} ry={0.5} fill="#39527f" />
      {/* The scored sleeve down the negative side. */}
      <rect x={0.75} y={1.15} width={1.5} height={5.5} fill="#c9d2e2" opacity={0.82} />
      {[2.2, 3.6, 5].map((y) => (
        <text
          key={y}
          x={1.5}
          y={y}
          fontSize={1.3}
          textAnchor="middle"
          fill="#2b3f6b"
          fontFamily={SILKSCREEN_FONT}
          opacity={0.9}
        >
          &ndash;
        </text>
      ))}
      {/* The scored vent on the top face. */}
      <path d="M 2.6 1.1 L 4.4 1.1 M 3.5 0.75 L 3.5 1.45" stroke="#2a3a5c" strokeWidth={0.14} opacity={0.8} />
      <text
        x={4.6}
        y={3.9}
        fontSize={1.7}
        textAnchor="middle"
        fill={definition.legendColour}
        fontFamily={SILKSCREEN_FONT}
        opacity={0.95}
      >
        +
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Inputs

function ButtonBody({
  definition,
  state,
  part,
}: {
  definition: PartDefinition;
  state: FootprintState;
  part: PartInstance;
}) {
  const pressed = state.controls.isPressed(part.id);
  const travel = pressed ? 0.42 : 0;

  return (
    <g filter="url(#nz-lift)">
      {/* Four legs, two to each side, splayed as a tactile switch's are. */}
      <RadialLeads left={0} right={5.08} y={3} bendLeft={1.1} bendRight={3.98} width={0.22} />
      <rect x={0.6} y={0.6} width={5.2} height={5.2} rx={0.5} fill={definition.bodyColour} stroke="#000" strokeWidth={0.18} />
      <rect x={0.6} y={0.6} width={5.2} height={5.2} rx={0.5} fill="url(#nz-body)" />
      {/* The actuator, which visibly sinks when the switch is held. */}
      <circle cx={3.1} cy={3.1 + travel} r={1.62 - travel * 0.28} fill="#2b2f36" stroke="#4b515c" strokeWidth={0.16} />
      <circle cx={3.1} cy={3.1 + travel} r={1.62 - travel * 0.28} fill="url(#nz-knob)" />
      <circle cx={2.7} cy={2.6 + travel} r={0.42} fill="#ffffff" opacity={0.28} />
      {pressed && <circle cx={3.1} cy={3.1} r={2.5} fill="#38bdf8" opacity={0.16} filter="url(#nz-bloom)" />}
    </g>
  );
}

function PotentiometerBody({
  definition,
  state,
  part,
}: {
  definition: PartDefinition;
  state: FootprintState;
  part: PartInstance;
}) {
  const turn = state.controls.knob(part.id, WIPER_KNOB);
  const angle = -140 + turn * 280;

  return (
    <g filter="url(#nz-lift)">
      <RadialLeads left={0} right={10.16} y={4.5} bendLeft={1.1} bendRight={9.06} width={0.24} />
      {/* Moulded body with the three terminals along its bottom edge. */}
      <rect x={0.6} y={2.4} width={10.2} height={5.4} rx={0.8} fill={definition.bodyColour} stroke="#0d1017" strokeWidth={0.2} />
      <rect x={0.6} y={2.4} width={10.2} height={5.4} rx={0.8} fill="url(#nz-body)" />
      {/* Knurled shaft collar. */}
      <circle cx={5.7} cy={3.6} r={2.6} fill="#1b1f27" stroke="#0d1017" strokeWidth={0.18} />
      {Array.from({ length: 16 }, (_, index) => {
        const theta = (index / 16) * Math.PI * 2;
        return (
          <line
            key={index}
            x1={5.7 + Math.cos(theta) * 2.15}
            y1={3.6 + Math.sin(theta) * 2.15}
            x2={5.7 + Math.cos(theta) * 2.6}
            y2={3.6 + Math.sin(theta) * 2.6}
            stroke="#454b57"
            strokeWidth={0.16}
          />
        );
      })}
      {/* The knob itself, and the pointer that shows where it is turned. */}
      <g transform={`rotate(${angle} 5.7 3.6)`}>
        <circle cx={5.7} cy={3.6} r={2.1} fill="#2f3644" stroke="#181c24" strokeWidth={0.2} />
        <circle cx={5.7} cy={3.6} r={2.1} fill="url(#nz-knob)" />
        <rect x={5.4} y={0.9} width={0.62} height={2.9} rx={0.3} fill="#e8ecf3" />
      </g>
      <circle cx={5.7} cy={3.6} r={0.42} fill="#12151b" />
      {[
        { x: 0, label: '1' },
        { x: 5.08, label: '2' },
        { x: 10.16, label: '3' },
      ].map((mark) => (
        <text
          key={mark.label}
          x={mark.x}
          y={9.4}
          fontSize={1.7}
          textAnchor="middle"
          fill={definition.legendColour}
          opacity={0.85}
          fontFamily={SILKSCREEN_FONT}
        >
          {mark.label}
        </text>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Displays

/** Scale from panel pixels to millimetres of glass. */
const PIXEL_MM = 0.19;
const PANEL_MM = 26;
/** Glass size of the 2.4" TFT, which is a very different shape from the OLED. */
const TFT_PANEL_MM = 53;

interface PixelRun {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/**
 * Merges each row of lit pixels into horizontal runs.
 *
 * A 128x64 panel is 8192 pixels. Emitting one rectangle each would dominate the
 * bench's DOM and make dragging any other part on it stutter; merging runs
 * gives the same picture from a few hundred shapes.
 */
function pixelRuns(controller: Ssd1306, width: number, height: number): PixelRun[] {
  const runs: PixelRun[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const lit = x < width && controller.isLit(x, y);
      if (lit && start < 0) start = x;
      if (!lit && start >= 0) {
        runs.push({ x: start, y, width: x - start });
        start = -1;
      }
    }
  }
  return runs;
}

function DisplayBody({
  definition,
  state,
  part,
}: {
  definition: PartDefinition;
  state: FootprintState;
  part: PartInstance;
}) {
  const controller = state.displays?.get(part.id);
  const panel = definition.displayPixels;
  const isColour = controller instanceof Ili9341;
  const headerY = definition.pins[0]?.y ?? definition.heightMm - 6;
  // The bezel is the glass on its carrier: 26 mm square on the OLED, 53 mm
  // square on the TFT. Sizing both from the TFT left the OLED's outline
  // hanging 20 mm past its own carrier, so clicks on the glass missed the part.
  const bezelMm = isColour ? TFT_PANEL_MM : PANEL_MM;

  return (
    <g filter="url(#nz-lift)">
      {/* Carrier PCB, with the header strip standing off the bottom edge. */}
      <rect
        width={definition.widthMm}
        height={definition.heightMm}
        rx={1.6}
        fill={definition.bodyColour}
        stroke="#05070a"
        strokeWidth={0.3}
      />
      <rect width={definition.widthMm} height={definition.heightMm} rx={1.6} fill="url(#nz-mask)" />
      <MountingHole x={2.4} y={2.4} radius={1.1} />
      <MountingHole x={definition.widthMm - 2.4} y={2.4} radius={1.1} />

      {/* The black bezel the glass is bonded to. */}
      <rect x={0.7} y={0.7} width={bezelMm} height={bezelMm} rx={0.8} fill="#0a0d12" />

      {isColour ? (
        <ColourPanel controller={controller} panel={panel} />
      ) : (
        <MonoPanel controller={controller} panel={panel} />
      )}

      <SolderPads definition={definition} />
      <HeaderSilkscreen definition={definition} left={definition.pins} right={definition.pins.slice(0, 0)} />

      <text
        x={definition.widthMm / 2}
        y={headerY - 2.6}
        fontSize={1.6}
        textAnchor="middle"
        fill={definition.legendColour}
        opacity={0.55}
        fontFamily={SILKSCREEN_FONT}
      >
        {definition.name.toUpperCase()}
      </text>
    </g>
  );
}

/** Plated pads along a display's header strip. */
function SolderPads({ definition }: { definition: PartDefinition }) {
  return (
    <g>
      {definition.pins.map((pin) => (
        <SolderPad key={pin.id} x={pin.x} y={pin.y} radius={0.55} />
      ))}
    </g>
  );
}

/** The 128x64 OLED: merged runs of lit pixels, a few hundred shapes at most. */
function MonoPanel({
  controller,
  panel,
}: {
  controller: DisplayController | undefined;
  panel: PartDefinition['displayPixels'];
}) {
  const oled = controller instanceof Ssd1306 ? controller : undefined;
  const runs = oled && panel ? pixelRuns(oled, panel.width, panel.height) : [];

  return (
    <g>
      {/* Glass: faintly lit green-on-black when on, flat black when off. */}
      <rect
        x={1.4}
        y={1.4}
        width={PANEL_MM - 1.4}
        height={PANEL_MM - 1.4}
        fill={oled?.lit ? '#0b1418' : '#05080b'}
      />
      {runs.map((run) => (
        <rect
          key={`${run.x}-${run.y}`}
          x={1.4 + run.x * PIXEL_MM}
          y={1.4 + run.y * PIXEL_MM}
          width={run.width * PIXEL_MM}
          height={PIXEL_MM}
          fill={oled?.mirrored ? '#38bdf8' : '#7df9c0'}
        />
      ))}
      {/* Glass over the top, which is what makes it read as a screen. */}
      <rect x={1.4} y={1.4} width={PANEL_MM - 1.4} height={PANEL_MM - 1.4} fill="url(#nz-glass)" />
      <rect x={0.7} y={0.7} width={PANEL_MM} height={PANEL_MM} rx={0.8} fill="none" stroke="#000" strokeWidth={0.5} />
    </g>
  );
}

/** The 320x240 TFT: blitted to a canvas, because 76800 rects is not a DOM. */
function ColourPanel({
  controller,
  panel,
}: {
  controller: DisplayController | undefined;
  panel: PartDefinition['displayPixels'];
}) {
  const tft = controller instanceof Ili9341 ? controller : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Deliberately no dependency list. The framebuffer is mutated in place, so
  // the controller's identity never changes and a memoised effect would run
  // once on mount and pin a black canvas for the rest of the session. The bench
  // re-renders every frame, so re-blitting after each render is the cadence we
  // actually want.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tft || !panel) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(panel.width, panel.height);
    image.data.set(tft.toRgba());
    context.putImageData(image, 0, 0);
  });

  return (
    <g>
      <rect
        x={1.4}
        y={1.4}
        width={TFT_PANEL_MM - 1.4}
        height={TFT_PANEL_MM - 1.4}
        fill={tft?.isOn() ? '#050a12' : '#020408'}
      />
      {tft && panel && (
        <foreignObject x={1.4} y={1.4} width={TFT_PANEL_MM - 1.4} height={TFT_PANEL_MM - 1.4}>
          <canvas
            ref={canvasRef}
            width={panel.width}
            height={panel.height}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </foreignObject>
      )}
      <rect x={1.4} y={1.4} width={TFT_PANEL_MM - 1.4} height={TFT_PANEL_MM - 1.4} fill="url(#nz-glass)" />
      <rect x={0.7} y={0.7} width={TFT_PANEL_MM} height={TFT_PANEL_MM} rx={0.8} fill="none" stroke="#000" strokeWidth={0.5} />
    </g>
  );
}
