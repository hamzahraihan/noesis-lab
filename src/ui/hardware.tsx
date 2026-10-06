/**
 * Shared material and hardware primitives for the footprint renderers.
 *
 * Everything here is drawn in millimetres at 1:1, like the parts themselves, so
 * a lead is 0.26 mm across because a real one is. The point of this module is
 * that a solder pad on an Uno and a solder pad on a display module are the same
 * object: one definition, one look, everywhere.
 *
 * Gradients and filters live in `HardwareDefs`, which each SVG document must
 * render exactly once. The ids are global rather than namespaced because there
 * is one document, and a stray duplicate would only be a second, identical
 * definition of the same paint.
 */

/** The paint and shading every part shares. Render once per SVG document. */
export function HardwareDefs() {
  return (
    <defs>
      <linearGradient id="nz-metal" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#79828f" />
        <stop offset="0.26" stopColor="#e9eef5" />
        <stop offset="0.5" stopColor="#a9b2bf" />
        <stop offset="0.76" stopColor="#f3f6fa" />
        <stop offset="1" stopColor="#737c89" />
      </linearGradient>
      <linearGradient id="nz-lead" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f6f8fc" />
        <stop offset="0.4" stopColor="#c6ced9" />
        <stop offset="1" stopColor="#6e7784" />
      </linearGradient>
      <linearGradient id="nz-lead-x" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#8a929e" />
        <stop offset="0.35" stopColor="#f6f8fc" />
        <stop offset="1" stopColor="#8a929e" />
      </linearGradient>
      <linearGradient id="nz-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgba(255,255,255,0.32)" />
        <stop offset="0.42" stopColor="rgba(255,255,255,0.04)" />
        <stop offset="1" stopColor="rgba(0,0,0,0.28)" />
      </linearGradient>
      <linearGradient id="nz-mask" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor="rgba(255,255,255,0.14)" />
        <stop offset="0.45" stopColor="rgba(255,255,255,0.03)" />
        <stop offset="1" stopColor="rgba(0,0,0,0.22)" />
      </linearGradient>
      <linearGradient id="nz-shell" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#fdfcfa" />
        <stop offset="0.35" stopColor="#f0eee9" />
        <stop offset="1" stopColor="#d9d6cf" />
      </linearGradient>
      <radialGradient id="nz-lens" cx="0.34" cy="0.28" r="0.9">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="0.3" stopColor="#ffffff" stopOpacity="0.18" />
        <stop offset="0.75" stopColor="#000000" stopOpacity="0.12" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.4" />
      </radialGradient>
      <radialGradient id="nz-dome" cx="0.36" cy="0.3" r="0.85">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.04" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.42" />
      </radialGradient>
      <radialGradient id="nz-knob" cx="0.38" cy="0.32" r="0.8">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
        <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.02" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.38" />
      </radialGradient>
      <linearGradient id="nz-glass" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stopColor="rgba(255,255,255,0.3)" />
        <stop offset="0.18" stopColor="rgba(255,255,255,0.1)" />
        <stop offset="0.42" stopColor="rgba(255,255,255,0.02)" />
        <stop offset="1" stopColor="rgba(0,0,0,0.34)" />
      </linearGradient>
      <linearGradient id="nz-socket" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2f2c28" />
        <stop offset="0.45" stopColor="#15130f" />
        <stop offset="1" stopColor="#3f3b33" />
      </linearGradient>
      <filter id="nz-lift" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0.25" dy="0.45" stdDeviation="0.35" floodColor="#000000" floodOpacity="0.5" />
      </filter>
      <filter id="nz-bloom" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="0.9" />
      </filter>
    </defs>
  );
}
/** Silkscreen lettering: narrow, even stroke, the way a board is printed. */
export const SILKSCREEN_FONT = "'DejaVu Sans Mono', 'Consolas', monospace";

/**
 * A pair of through-hole leads, as an axial part has them.
 *
 * `bendX` is where each lead turns down to meet the board. Real axial leads come
 * out of each end of the body and bend to the holes, which is most of what
 * makes a resistor read as a resistor rather than a bar.
 */
export function AxialLeads({
  left,
  right,
  y,
  bendLeft,
  bendRight,
  width = 0.26,
}: {
  left: number;
  right: number;
  y: number;
  bendLeft: number;
  bendRight: number;
  width?: number;
}) {
  return (
    <g>
      <path
        d={`M ${bendLeft} ${y + 0.85} L ${bendLeft} ${y} L ${left} ${y}`}
        fill="none"
        stroke="url(#nz-lead)"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M ${right} ${y} L ${bendRight} ${y} L ${bendRight} ${y + 0.85}`}
        fill="none"
        stroke="url(#nz-lead)"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/**
 * Two leads that stand a part up on the board, as a radial part has them.
 */
export function RadialLeads({
  left,
  right,
  y,
  bendLeft,
  bendRight,
  width = 0.26,
}: {
  left: number;
  right: number;
  y: number;
  bendLeft: number;
  bendRight: number;
  width?: number;
}) {
  return (
    <g>
      <path
        d={`M ${bendLeft} ${y} L ${left} ${y}`}
        fill="none"
        stroke="url(#nz-lead)"
        strokeWidth={width}
        strokeLinecap="round"
      />
      <path
        d={`M ${bendRight} ${y} L ${right} ${y}`}
        fill="none"
        stroke="url(#nz-lead)"
        strokeWidth={width}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * A black plastic pin header with the pins standing out of it.
 *
 * The plastic strip is drawn first and the pins over it, because on a real
 * board the pins pass through and stand proud of the body.
 *
 * The strip is read off the pins themselves rather than from a pair of numbers
 * the caller worked out. A header is a rectangle drawn around a run of pins,
 * and taking it from the pins is what lets one piece draw the edge headers
 * every other board here has and the 2x20 block in the middle of a Pi.
 */
export function PinHeader({
  pins,
  label,
  labelColour,
}: {
  pins: readonly { readonly x: number; readonly y: number }[];
  label?: string;
  labelColour: string;
}) {
  if (pins.length === 0) return null;

  const xs = pins.map((pin) => pin.x);
  const ys = pins.map((pin) => pin.y);
  /*
   * Padding is deliberately different on each axis: the strip is a shade wider
   * than the pin pitch across and taller along it. Taking the same number both
   * ways would quietly shrink every header on every board by a fraction of a
   * millimetre for no reason anyone asked for.
   */
  const left = Math.min(...xs) - 1.27;
  const top = Math.min(...ys) - 1.4;
  const width = Math.max(...xs) - Math.min(...xs) + 2.54;
  const height = Math.max(...ys) - Math.min(...ys) + 2.8;

  return (
    <g>
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={0.3}
        fill="#15161a"
        stroke="#000000"
        strokeWidth={0.15}
      />
      <rect x={left} y={top} width={width} height={height} rx={0.3} fill="url(#nz-body)" />
      {pins.map((pin) => (
        <rect
          key={`${pin.x}:${pin.y}`}
          x={pin.x - 0.6}
          y={pin.y - 0.6}
          width={1.2}
          height={1.2}
          rx={0.16}
          fill="url(#nz-metal)"
          stroke="#5d6572"
          strokeWidth={0.1}
        />
      ))}
      {label && (
        <text
          x={left + width / 2}
          y={top - 1.4}
          fontSize={1.5}
          textAnchor="middle"
          fill={labelColour}
          opacity={0.7}
          fontFamily={SILKSCREEN_FONT}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** A black epoxy IC with its legs showing either side. */
export function Chip({
  x,
  y,
  width,
  height,
  legs = 7,
  colour = '#16181d',
  text,
  textColour = '#8b9099',
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  legs?: number;
  colour?: string;
  text?: string;
  textColour?: string;
}) {
  const leg = Math.min(0.65, height / 7);
  const pitch = height / (legs + 1);
  return (
    <g>
      {Array.from({ length: legs }, (_, index) => {
        const py = y + pitch * (index + 1);
        return (
          <g key={index}>
            <rect x={x - leg} y={py - 0.2} width={leg} height={0.4} fill="#b7bfca" />
            <rect x={x + width} y={py - 0.2} width={leg} height={0.4} fill="#a2aab5" />
          </g>
        );
      })}
      <rect x={x} y={y} width={width} height={height} rx={0.3} fill={colour} />
      <rect x={x} y={y} width={width} height={height} rx={0.3} fill="url(#nz-body)" />
      {/* The dimple that marks pin one. */}
      <circle cx={x + 0.8} cy={y + 0.8} r={0.32} fill="#000000" opacity={0.45} />
      {text && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 0.6}
          fontSize={Math.min(1.5, width * 0.22)}
          textAnchor="middle"
          fill={textColour}
          fontFamily={SILKSCREEN_FONT}
          opacity={0.9}
        >
          {text}
        </text>
      )}
    </g>
  );
}

/** A surface-mount chip resistor or capacitor: a pale ceramic body. */
export function SmdPassive({
  x,
  y,
  width = 1.6,
  height = 0.9,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
}) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={0.15} fill="#c9b48a" stroke="#8d7f5c" strokeWidth={0.1} />
      <rect x={x} y={y} width={width} height={height} rx={0.15} fill="url(#nz-body)" />
    </g>
  );
}

/** An aluminium electrolytic standing on the board. */
export function BoardCapacitor({
  x,
  y,
  radius = 1.5,
  height = 3.6,
}: {
  x: number;
  y: number;
  radius?: number;
  height?: number;
}) {
  return (
    <g>
      <rect x={x - radius} y={y} width={radius * 2} height={height} rx={radius * 0.3} fill="#1b2a4a" />
      <rect x={x - radius} y={y} width={radius * 2} height={height} rx={radius * 0.3} fill="url(#nz-body)" />
      <rect x={x - radius} y={y} width={radius * 0.45} height={height} fill="#ffffff" opacity={0.16} />
      <ellipse cx={x} cy={y} rx={radius} ry={radius * 0.32} fill="#2c3f68" />
      <path
        d={`M ${x - radius * 0.45} ${y + height * 0.2} h ${radius * 0.5} m ${-radius * 0.25} ${-radius * 0.26} v ${radius * 0.52}`}
        stroke="#c9d2e2"
        strokeWidth={0.16}
        opacity={0.85}
      />
    </g>
  );
}

/** A tactile switch soldered to the board, rather than a part you can place. */
export function BoardButton({
  x,
  y,
  width = 3.2,
  height = 3.2,
  label,
  labelColour,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: string;
  labelColour: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={0.5} fill="#1b1d22" stroke="#000" strokeWidth={0.12} />
      <rect x={x} y={y} width={width} height={height} rx={0.5} fill="url(#nz-body)" />
      <circle cx={x + width / 2} cy={y + height / 2} r={width * 0.28} fill="#2f3238" stroke="#45484f" strokeWidth={0.12} />
      <text
        x={x + width / 2}
        y={y + height + 2}
        fontSize={1.4}
        textAnchor="middle"
        fill={labelColour}
        opacity={0.8}
        fontFamily={SILKSCREEN_FONT}
      >
        {label}
      </text>
    </g>
  );
}

/** A board-mounted indicator, which glows while its net is live. */
export function IndicatorLed({
  x,
  y,
  colour,
  lit,
  label,
  labelColour,
}: {
  x: number;
  y: number;
  colour: string;
  lit: boolean;
  label: string;
  labelColour: string;
}) {
  return (
    <g>
      {lit && <circle cx={x} cy={y} r={2} fill={colour} opacity={0.5} filter="url(#nz-bloom)" />}
      <circle cx={x} cy={y} r={0.8} fill={colour} opacity={lit ? 1 : 0.4} />
      <circle cx={x} cy={y} r={0.8} fill="url(#nz-lens)" opacity={0.75} />
      <text
        x={x}
        y={y + 2.5}
        fontSize={1.3}
        textAnchor="middle"
        fill={labelColour}
        opacity={0.8}
        fontFamily={SILKSCREEN_FONT}
      >
        {label}
      </text>
    </g>
  );
}

/** A plated mounting hole with its ring of bare board around it. */
export function MountingHole({ x, y, radius = 1.5 }: { x: number; y: number; radius?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={radius + 0.7} fill="#b9a678" opacity={0.45} />
      <circle cx={x} cy={y} r={radius} fill="#0a0b0d" />
    </g>
  );
}

/**
 * A through-hole pad.
 *
 * Breadboards draw their own holes, so this is for everything else: the ring of
 * exposed copper around a plated hole is what makes a header strip look like a
 * header strip rather than a row of dots.
 */
export function SolderPad({ x, y, radius = 0.6 }: { x: number; y: number; radius?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={radius + 0.4} fill="#c9a86a" opacity={0.85} />
      <circle cx={x} cy={y} r={radius} fill="#0d0f12" />
    </g>
  );
}

/** Micro-B receptacle, as found on an ESP32 DevKit. */
export function MicroUsb({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={7.5} height={4.4} rx={0.5} fill="url(#nz-metal)" stroke="#5b636f" strokeWidth={0.15} />
      <rect x={x + 1} y={y + 0.7} width={5.5} height={2.8} rx={0.35} fill="#101216" />
      <rect x={x + 0.4} y={y + 0.3} width={6.7} height={0.65} fill="#ffffff" opacity={0.32} />
      <text
        x={x + 3.75}
        y={y + 6.2}
        fontSize={1.4}
        textAnchor="middle"
        fill="#c8ccd4"
        opacity={0.8}
        fontFamily={SILKSCREEN_FONT}
      >
        {label}
      </text>
    </g>
  );
}

/** Full-size USB-B receptacle, as found on an Arduino Uno. */
export function UsbB({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x - 0.9} y={y + 1.6} width={1.2} height={2.2} rx={0.2} fill="url(#nz-metal)" />
      <rect x={x + 11.7} y={y + 1.6} width={1.2} height={2.2} rx={0.2} fill="url(#nz-metal)" />
      <rect x={x} y={y} width={12} height={5.4} rx={0.6} fill="url(#nz-metal)" stroke="#5b636f" strokeWidth={0.16} />
      <rect x={x + 1.4} y={y + 0.8} width={9.2} height={3.5} rx={0.4} fill="#0c0e11" />
      <rect x={x + 0.5} y={y + 0.35} width={11} height={0.75} fill="#ffffff" opacity={0.3} />
      <text
        x={x + 6}
        y={y + 7.4}
        fontSize={1.4}
        textAnchor="middle"
        fill="#c8ccd4"
        opacity={0.8}
        fontFamily={SILKSCREEN_FONT}
      >
        {label}
      </text>
    </g>
  );
}

/** Barrel jack, the other way an Uno takes its power. */
export function BarrelJack({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={9} height={5.6} rx={0.5} fill="#1c1e23" stroke="#000" strokeWidth={0.15} />
      <rect x={x} y={y} width={9} height={5.6} rx={0.5} fill="url(#nz-body)" />
      <circle cx={x + 3} cy={y + 2.8} r={2.3} fill="#0a0b0d" stroke="url(#nz-metal)" strokeWidth={0.7} />
      <circle cx={x + 3} cy={y + 2.8} r={0.85} fill="#1a1c20" />
      <rect x={x + 6.4} y={y + 0.9} width={1.6} height={3.8} rx={0.3} fill="#2a2d33" />
    </g>
  );
}

/** Copper showing through a board's mask, as a faint trace. */
export function CopperTrace({
  points,
  width = 0.3,
  opacity = 0.18,
}: {
  points: string;
  width?: number;
  opacity?: number;
}) {
  return (
    <path
      d={points}
      fill="none"
      stroke="#c9a86a"
      strokeWidth={width}
      opacity={opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}
