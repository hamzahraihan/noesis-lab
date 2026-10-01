/**
 * SVG renderers for part footprints.
 *
 * Everything is drawn in millimetres at 1:1, in the part's own coordinate
 * space, so the canvas only has to apply the bench transform once. Nothing here
 * knows about zoom, selection or the simulation -- a footprint is a pure
 * function of a definition plus the live electrical state it is handed.
 */

import type { PartInstance } from '../sim/bench';
import type { PartDefinition, PinSpec } from '../sim/catalog';
import { DIODE_PROFILES } from '../sim/elements';

/** Live electrical state a footprint needs in order to look right. */
export interface FootprintState {
  /** `${partId}:${pinId}` to volts on that pin's net. */
  readonly pinVolts: ReadonlyMap<string, number>;
  readonly pressedButtons: ReadonlySet<string>;
  readonly potPositions: ReadonlyMap<string, number>;
}

export const PIN_RADIUS_MM = 0.9;

export function PartFootprint({
  part,
  state,
}: {
  part: PartInstance;
  state: FootprintState;
}) {
  const { definition } = part;
  // The breadboard draws all 882 of its holes as part of its body. Adding a
  // lit marker on top of each would double the bench's element count for no
  // gain, so only parts whose holes are otherwise invisible get markers.
  const drawsOwnHoles = definition.component.kind === 'breadboard';

  return (
    <g data-part-id={part.id}>
      {shapeFor(definition, part, state)}
      {!drawsOwnHoles &&
        definition.pins.map((pin) => (
          <PinMark key={pin.id} pin={pin} part={part} state={state} />
        ))}
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
        r={PIN_RADIUS_MM + 0.55}
        fill="#0f1115"
        opacity={0.55}
      />
      <circle
        cx={pin.x}
        cy={pin.y}
        r={PIN_RADIUS_MM}
        fill={energised ? '#fbbf24' : '#4b5563'}
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
) {
  switch (definition.component.kind) {
    case 'breadboard':
      return <BreadboardBody definition={definition} />;
    case 'mcu':
      return <BoardBody definition={definition} />;
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
  }
}

// ---------------------------------------------------------------------------

function Board({ definition, children }: { definition: PartDefinition; children?: React.ReactNode }) {
  return (
    <g>
      <rect
        width={definition.widthMm}
        height={definition.heightMm}
        rx={1.5}
        fill={definition.bodyColour}
        stroke="#0b0d10"
        strokeWidth={0.3}
      />
      {children}
    </g>
  );
}

/** The pin header silkscreen: a rounded outline behind each pin's label. */
function HeaderStrip({
  definition,
  x,
  from,
  to,
}: {
  definition: PartDefinition;
  x: number;
  from: number;
  to: number;
}) {
  return (
    <g>
      <rect
        x={x - 2.2}
        y={from - 1.8}
        width={4.4}
        height={to - from + 3.6}
        rx={0.8}
        fill="#111318"
        stroke="#2a2f38"
        strokeWidth={0.2}
      />
      {definition.pins
        .filter((pin) => Math.abs(pin.x - x) < 0.01 && pin.y >= from - 0.01 && pin.y <= to + 0.01)
        .map((pin) => (
          <text
            key={pin.id}
            x={x + (x < definition.widthMm / 2 ? 1.5 : -1.5)}
            y={pin.y + 0.7}
            fontSize={1.9}
            textAnchor={x < definition.widthMm / 2 ? 'start' : 'end'}
            fill={definition.legendColour}
            opacity={0.9}
          >
            {pin.label}
          </text>
        ))}
    </g>
  );
}

function BoardBody({ definition }: { definition: PartDefinition }) {
  const left = definition.pins.filter((pin) => pin.x < definition.widthMm / 2);
  const right = definition.pins.filter((pin) => pin.x >= definition.widthMm / 2);

  return (
    <Board definition={definition}>
      {/* Antenna keep-out at the top, as silkscreened on the real board. */}
      <rect
        x={definition.widthMm / 2 - 8}
        y={0.6}
        width={16}
        height={3.2}
        rx={0.6}
        fill="#c9a227"
        opacity={0.25}
      />
      <text
        x={definition.widthMm / 2}
        y={definition.heightMm / 2 - 2}
        fontSize={2.6}
        textAnchor="middle"
        fill={definition.legendColour}
        opacity={0.55}
      >
        {definition.name}
      </text>
      <HeaderStrip
        definition={definition}
        x={left[0]?.x ?? 0}
        from={left[0]?.y ?? 0}
        to={left[left.length - 1]?.y ?? 0}

      />
      <HeaderStrip
        definition={definition}
        x={right[0]?.x ?? 0}
        from={right[0]?.y ?? 0}
        to={right[right.length - 1]?.y ?? 0}

      />
    </Board>
  );
}

function BreadboardBody({ definition }: { definition: PartDefinition }) {
  const holes = definition.pins;
  const stripHoles = holes.filter((pin) => pin.id.startsWith('s'));
  const railHoles = holes.filter((pin) => pin.id.startsWith('r'));

  return (
    <g>
      <rect width={definition.widthMm} height={definition.heightMm} rx={2} fill={definition.bodyColour} stroke="#b8b4ab" strokeWidth={0.4} />

      {/* Rail lines run to the centre notch; the two halves are not joined. */}
      {railHoles
        .filter((pin) => pin.x < 79)
        .map((pin) => (
          <line
            key={`rail-${pin.id}`}
            x1={pin.x}
            y1={pin.y}
            x2={pin.x + 75}
            y2={pin.y}
            stroke={pin.y < definition.heightMm / 2
              ? (pin.id.startsWith('r0') || pin.id.startsWith('r3') ? '#d94f4f' : '#4f7fd9')
              : (pin.id.startsWith('r2') ? '#4f7fd9' : '#d94f4f')}
            strokeWidth={0.5}
            opacity={0.55}
          />
        ))}

      {/* Centre channel. */}
      <rect
        x={2}
        y={26}
        width={definition.widthMm - 4}
        height={6.2}
        fill="#d9d6d0"
        stroke="#c2beb6"
        strokeWidth={0.3}
      />

      {stripHoles.map((pin) => (
        <rect
          key={pin.id}
          x={pin.x - 0.55}
          y={pin.y - 0.55}
          width={1.1}
          height={1.1}
          rx={0.25}
          fill="#8b8880"
        />
      ))}
      {railHoles.map((pin) => (
        <rect
          key={pin.id}
          x={pin.x - 0.5}
          y={pin.y - 0.5}
          width={1}
          height={1}
          rx={0.25}
          fill="#8b8880"
        />
      ))}
    </g>
  );
}

/** Resistor colour bands, decoded from the actual resistance value. */
const BAND_COLOURS = [
  '#0b0b0b', '#8a4b16', '#c62828', '#ef6c00', '#f9a825',
  '#2e7d32', '#0277bd', '#6a1b9a', '#9e9e9e', '#f5f5f5',
];

const MULTIPLIER_COLOURS = ['#d4af37', '#c62828', '#2e7d32', '#ef6c00'];
const TOLERANCE_COLOUR = '#6a4c93';

function bandsFor(ohms: number): string[] {
  if (ohms <= 0) return [BAND_COLOURS[0], BAND_COLOURS[0], BAND_COLOURS[0], TOLERANCE_COLOUR];

  const exponent = Math.floor(Math.log10(ohms));
  const normalised = ohms / Math.pow(10, exponent);
  let first = Math.round(normalised) - 1;
  let second = 0;
  if (first >= 10) {
    // >= 100 Ohm: fold the top decade into the multiplier band.
    first = Math.round(normalised / 10) - 1;
    second = Math.round((normalised / 10 - Math.round(normalised / 10)) * 10);
  }

  const multiplierIndex = Math.min(3, Math.max(0, exponent - (first >= 10 ? 1 : 0)));
  return [
    BAND_COLOURS[Math.min(9, Math.max(0, first))],
    BAND_COLOURS[Math.min(9, Math.max(0, second))],
    MULTIPLIER_COLOURS[multiplierIndex],
    TOLERANCE_COLOUR,
  ];
}

function ResistorBody({ definition }: { definition: PartDefinition }) {
  const ohms = definition.component.kind === 'resistor' ? definition.component.ohms : 0;
  const bands = bandsFor(ohms);

  return (
    <g>
      {/* Leads run out to the holes; the body sits between them. */}
      <line x1={0} y1={1.6} x2={10.16} y2={1.6} stroke="#b0b0b0" strokeWidth={0.5} />
      <rect x={1.4} y={0.5} width={7.4} height={2.2} rx={1.1} fill={definition.bodyColour} stroke="#8d7f5c" strokeWidth={0.2} />
      {bands.map((colour, index) => (
        <rect
          key={index}
          x={2.3 + index * 1.35}
          y={0.6}
          width={0.7}
          height={2}
          fill={colour}
        />
      ))}
    </g>
  );
}

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
  const volts = anode - cathode;
  const base = definition.component.kind === 'led' ? definition.component.profile : DIODE_PROFILES.red;
  const tint = base === DIODE_PROFILES.blue ? '#2b4fd6' : base === DIODE_PROFILES.white ? '#f5f5f0' : '#d63b3b';

  // Brightness follows the forward bias, which is what the solver reports.
  const drive = Math.max(0, Math.min(1, (volts - 1.4) / 1.1));

  return (
    <g>
      <line x1={0} y1={3} x2={2.54} y2={3} stroke="#b0b0b0" strokeWidth={0.45} />
      <circle
        cx={2.2}
        cy={3}
        r={2.1}
        fill={tint}
        opacity={0.55 + drive * 0.45}
      />
      {drive > 0.02 && (
        <circle
          cx={2.2}
          cy={3}
          r={1.3 + drive * 1.5}
          fill={tint}
          opacity={Math.min(0.55, drive * 0.55)}
        />
      )}
      {/* The cathode side is flat, as on a real 5 mm LED. */}
      <rect x={0.1} y={1.6} width={1.1} height={2.8} fill={tint} opacity={0.5 + drive * 0.5} />
    </g>
  );
}

function CapacitorBody({ definition }: { definition: PartDefinition }) {
  return (
    <g>
      <line x1={0} y1={4} x2={2.54} y2={4} stroke="#b0b0b0" strokeWidth={0.5} />
      <rect x={1.2} y={1.2} width={5.4} height={5.6} rx={1} fill={definition.bodyColour} stroke="#1b2740" strokeWidth={0.25} />
      <g stroke="#dfe6f5" strokeWidth={0.45} fill="none" opacity={0.9}>
        <path d="M 3.2 2.2 L 5.4 6.4 M 4.4 2.2 L 6.6 6.4" />
      </g>
      <text x={1.9} y={5.9} fontSize={1.5} fill="#dfe6f5" opacity={0.95}>+</text>
    </g>
  );
}

function ButtonBody({
  definition,
  state,
  part,
}: {
  definition: PartDefinition;
  state: FootprintState;
  part: PartInstance;
}) {
  const pressed = state.pressedButtons.has(part.id);
  return (
    <g>
      <line x1={0} y1={3} x2={5.08} y2={3} stroke="#b0b0b0" strokeWidth={0.5} />
      <rect x={0.4} y={0.4} width={5.2} height={5.2} rx={0.6} fill={definition.bodyColour} stroke="#3f3f46" strokeWidth={0.25} />
      <circle
        cx={3}
        cy={3}
        r={pressed ? 1.35 : 1.6}
        fill={pressed ? '#3f3f46' : '#52525b'}
        stroke="#71717a"
        strokeWidth={0.2}
      />
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
  const turn = state.potPositions.get(part.id) ?? 0.5;
  const angle = -140 + turn * 280;
  return (
    <g>
      <line x1={0} y1={4.5} x2={10.16} y2={4.5} stroke="#b0b0b0" strokeWidth={0.5} />
      <rect x={0.6} y={1.4} width={10.2} height={6.2} rx={1} fill={definition.bodyColour} stroke="#151922" strokeWidth={0.25} />
      {/* Pointer rotates across roughly 280 degrees, like a real trimmer. */}
      <g transform={`rotate(${angle} 5.7 2.6)`}>
        <rect x={5.35} y={0.2} width={0.7} height={2.6} rx={0.3} fill="#d8dde8" />
      </g>
      <text x={2} y={8.3} fontSize={1.8} fill={definition.legendColour} opacity={0.85}>1</text>
      <text x={5.1} y={8.3} fontSize={1.8} fill={definition.legendColour} opacity={0.85}>2</text>
      <text x={9.1} y={8.3} fontSize={1.8} fill={definition.legendColour} opacity={0.85}>3</text>
    </g>
  );
}