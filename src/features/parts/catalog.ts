/**
 * Part catalogue types.
 *
 * Every part is described declaratively: where its holes are, which of them are
 * internally wired together, and what device it behaves as. Nothing here knows
 * about rendering or the solver -- those read the same definitions.
 *
 * The single mechanism worth understanding is `PinSpec.net`. Pins on one part
 * that share a net name are electrically joined inside that part. That one
 * field covers a microcontroller's ground plane, a breadboard's five-hole
 * strips, and the split down the middle of its power rails, which means
 * netlist extraction never needs a special case per component.
 */

import type { DiodeProfile } from '@/features/simulation/elements';

export type Rotation = 0 | 90 | 180 | 270;

/** A single hole on a part, positioned in millimetres from the part's origin. */
export interface PinSpec {
  readonly id: string;
  /** Silkscreen text drawn beside the hole. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** Pins sharing this name within one part are wired together internally. */
  readonly net?: string;
}

/** What a microcontroller pin can do, which decides the firmware API it maps to. */
export type PinRole = 'power' | 'ground' | 'gpio' | 'adc' | 'dac';

export interface BoardPin {
  readonly id: string;
  readonly label: string;
  /** Firmware-visible pin number, as passed to pinMode/digitalWrite. */
  readonly gpio?: number;
  /** ADC channel, for analogRead. */
  readonly adc?: number;
  readonly role: PinRole;
  /**
   * True when the pin is strapped during reset and must be held at a given
   * level for the board to boot. ESP32 GPIO12 and GPIO15 are the classic
   * "my board won't start" trap.
   */
  readonly strapLevel?: 'low' | 'high';
  /** False for the input-only pins: GPIO34-39 on the ESP32. */
  readonly canDrive?: boolean;
}

/**
 * The pin numbers an Arduino sketch names, and the GPIO each one means.
 *
 * Most boards number their holes the way the chip does, so the map is empty
 * and the identity is the answer. The Nano RP2040 Connect does not: its
 * header is an Arduino silkscreen wrapped around an RP2040, so `pinMode(2)`
 * means the hole labelled D2 -- GPIO25 -- while MicroPython's `Pin(25)` means
 * that same hole. Both languages name the same wire; the board says which
 * number that wire answers to.
 */
export interface ArduinoPins {
  /** The GPIO each Arduino pin index names. A missing index is the identity. */
  readonly map?: Readonly<Record<number, number>>;
  /**
   * The value of the `A0`..`A5` constants, which is not the same everywhere:
   * an Uno numbers them 14 to 19, a Mega 54 to 59, and an ESP32 names the GPIO
   * behind each one. A sketch writes `analogRead(A0)` and means the hole the
   * board's own core would.
   */
  readonly aliases?: Readonly<Record<string, number>>;
}

export interface BoardSpec {
  readonly id: string;
  readonly name: string;
  /** Supply rail voltage in volts. */
  readonly logicVolts: number;
  /** Board identifier accepted by the serial monitor and the firmware target. */
  readonly serialPrefix: string;
  /** Output impedance driving a pin high, ohms. */
  readonly sourceOhms: number;
  /** Output impedance driving a pin low, ohms. */
  readonly sinkOhms: number;
  /** Default PWM frequency from analogWrite, hertz. */
  readonly pwmHz: number;
  /** ADC resolution in bits, which sets the range analogRead returns. */
  readonly adcBits: number;
  /**
   * The pin numbers a C++ sketch names on this board, when they are not the
   * chip's own GPIO numbers. Absent means the two are the same.
   */
  readonly arduinoPins?: ArduinoPins;
}

export type ComponentSpec =
  | { readonly kind: 'resistor'; readonly ohms: number }
  | { readonly kind: 'led'; readonly profile: DiodeProfile }
  | { readonly kind: 'capacitor'; readonly farads: number }
  | { readonly kind: 'button' }
  | { readonly kind: 'potentiometer'; readonly ohms: number }
  | { readonly kind: 'mcu'; readonly board: BoardSpec }
  | { readonly kind: 'breadboard' }
  | {
      readonly kind: 'display';
      readonly controller: 'ssd1306' | 'ssd1306-spi' | 'ili9341' | 'max7219' | 'pcd8544';
      readonly address: number;
    }
  | { readonly kind: 'photoresistor' }
  | { readonly kind: 'thermistor' }
  | { readonly kind: 'tilt-switch' }
  | { readonly kind: 'slide-switch' }
  | { readonly kind: 'relay' }
  | { readonly kind: 'rotary-encoder' }
  | { readonly kind: 'sonar' }
  | { readonly kind: 'stepper' }
  | { readonly kind: 'biaxial-stepper' }
  | { readonly kind: 'dht' }
  | { readonly kind: 'ds18b20' }
  | { readonly kind: 'rc522' }
  | { readonly kind: 'tm1637' }
  | { readonly kind: 'a4988' }
  | { readonly kind: 'neopixel' }
  | { readonly kind: 'neopixel-matrix' }
  | { readonly kind: 'led-ring' }
  | { readonly kind: 'ir-remote' }
  | { readonly kind: 'rotary-dialer' }
  | { readonly kind: 'microsd' }
  | { readonly kind: 'joystick' }
  | { readonly kind: 'rgb-led' }
  | { readonly kind: 'buzzer' }
  | { readonly kind: 'sensor-module'; readonly variant: SensorVariant }
  | { readonly kind: 'dip-switch'; readonly ways: number }
  | { readonly kind: 'slide-potentiometer'; readonly ohms: number }
  | { readonly kind: 'led-bar-graph' }
  | { readonly kind: 'ir-receiver' }
  | { readonly kind: 'keypad' }
  | { readonly kind: 'i2c-sensor'; readonly device: I2cSensorVariant }
  /*
   * An I/O expander: the sketch writes one byte and eight pins follow it, so
   * a project that has run out of board pins has somewhere to go.
   */
  | { readonly kind: 'i2c-expander' }
  /*
   * A sixteen-pin expander: two ports, each with its own direction register,
   * so the sketch decides which pins drive and which listen.
   */
  | { readonly kind: 'mcp23017' }
  /*
   * A PWM driver: sixteen channels on two wires, each with its own ON and
   * OFF count, so a sketch can dim a light or place a servo pulse without
   * spending a board pin on it.
   */
  | { readonly kind: 'pca9685' }
  /*
   * A thermocouple amplifier: the chip reads a probe and hands the reading
   * out over the SPI bus, so this is a sensor that answers rather than one
   * the sketch polls.
   */
  | { readonly kind: 'thermocouple' }
  /*
   * A converter: the sketch writes a code and the chip holds a voltage, so
   * the bench can make an analog level as well as measure one.
   */
  | { readonly kind: 'dac' }
  /*
   * A bench supply: a rail the operator sets. The board's own five volts
   * are enough for a sketch and not enough for a motor.
   */
  | { readonly kind: 'power-supply' }
  /*
   * A memory chip: the sketch writes an address and then the bytes at it,
   * which is a different shape of device from a register file.
   */
  | { readonly kind: 'eeprom' }
  /*
   * A shift register on the SPI bus: the clock and the data in are the bus's
   * own pins, and the latch is a plain output the sketch drives, because on
   * the chip the two are separate wires.
   */
  | {
      readonly kind: 'shift-register';
      readonly spi: { readonly clock: string; readonly dataIn: string };
      readonly latch: string;
      /** The enable line, active low: pulling it down floats the outputs. */
      readonly enable: string;
    }
  | { readonly kind: 'lcd'; readonly variant: LcdVariant }
  | { readonly kind: 'servo' }
  /*
   * A part whose behaviour is a script (`simulation/scripted/`): the host has no
   * model for it, so the answer comes from the part's own source. The bus is
   * what the script must provide -- an analog fraction or a digital level.
   */
  | { readonly kind: 'scripted'; readonly bus: 'analog' | 'digital' }
  /*
   * An I2C part needs an address as well as a script: the bus finds a slave by
   * address, and the script answers whatever that address is asked.
   */
  | { readonly kind: 'scripted'; readonly bus: 'i2c'; readonly address: number }
  | { readonly kind: '7segment'; readonly digits: 1 | 2 | 3 | 4 };

/**
 * The comparator sensor boards, which are the same circuit however many times
 * it is drawn: a sensor, a comparator with a trimmer, and a pull-up.
 *
 * One kind rather than one per board because they are one circuit -- the
 * variant picks the artwork and the label, nothing else.
 */
export type SensorVariant = 'pir' | 'sound' | 'soundSmall' | 'heartbeat' | 'gas' | 'flame';

/**
 * A four-wire I2C module that is not a display.
 *
 * One kind for the three of them, as with the comparator sensor family: they
 * contribute no circuit of their own, they answer at an address, and what a
 * device does with a read is the device's business.
 */
export type I2cSensorVariant =
  | 'ds1307'
  | 'ds3231'
  | 'mpu6050'
  | 'hx711'
  | 'bmp180'
  | 'ina219'
  | 'ads1115'
  | 'bh1750'
  | 'tmp102'
  | 'mcp9808'
  | 'lm75'
  | 'tcs34725'
  | 'pcf8591'
  | 'sht31';

/** The character LCDs, which differ only in how much glass they have. */
export type LcdVariant = '1602' | '2004';

export interface PartDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: 'board' | 'breadboard' | 'passive' | 'input' | 'output';
  readonly widthMm: number;
  readonly heightMm: number;
  readonly component: ComponentSpec;
  readonly pins: readonly PinSpec[];
  readonly boardPins?: readonly BoardPin[];
  /**
   * Controls this part exposes to the operator.
   *
   * Declared here rather than in the inspector so that the part is the only
   * thing that has to know what it can be turned to: the netlist reads a knob to
   * work out its resistance, the artwork reads the same knob to move, and the
   * inspector reads the specs to know what to draw.
   */
  readonly knobs?: readonly KnobSpec[];
  /**
   * The source of a `scripted` part's behaviour.
   *
   * Only `scripted` reads it, and it is data like everything else here: the
   * runtime is what judges it (`simulation/scripted/runtime.ts`), and a script
   * that will not load is a dead part with a diagnostic, never an import that
   * silently does nothing.
   */
  readonly script?: string;
  /**
   * True for a part with a momentary contact the operator presses and holds.
   *
   * Momentary contacts are held in state rather than described by a knob,
   * because they return to open on their own and are never left at a value.
   */
  readonly momentary?: boolean;
  /** Body colour for the SVG renderer, as a hex string. */
  readonly bodyColour: string;
  /** Panel resolution, for a display part. The pixels live in the controller. */
  readonly displayPixels?: { readonly width: number; readonly height: number };
  /**
   * The panel's own memory, for a display part, when it is not the same
   * rectangle as `displayPixels`.
   *
   * A colour TFT reads its RAM out at whatever orientation it is held, so the
   * two are the same shape twice over for a panel that only comes one way up
   * and different for one that turns -- which is the only way the renderer can
   * size a canvas correctly without assuming every panel is landscape.
   */
  readonly ramPixels?: { readonly width: number; readonly height: number };
  /**
   * The glass itself in millimetres, for a display part.
   *
   * Distinct from the carrier the part is drawn on: the active area is smaller
   * than the board behind it, and it is the glass that has to be the right
   * shape or the picture drawn on it comes out stretched. Both a colour panel
   * that turns and a mono one at a fixed size need this to be stated rather
   * than guessed from a pixel count.
   */
  readonly glassMm?: { readonly width: number; readonly height: number };
  /** Silkscreen / legend colour for the SVG renderer. */
  readonly legendColour: string;
  /**
   * True for a part the bench lays out as a large one.
   *
   * Only custom parts set it (`custom-store.ts`): the shipped large parts are
   * named in `catalogue.ts`, and a part that arrives as data has to be able to
   * say the same thing about itself.
   */
  readonly large?: boolean;
}

/**
 * One control the operator turns on a part.
 *
 * The value is in whatever unit the part actually works in -- degrees, per cent
 * of travel, lux -- so the readout says what the part is doing rather than a
 * bare fraction, and the model reads it in the unit its own formula uses.
 */
export interface KnobSpec {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Set on a two-position control, which reads better as a switch. */
  readonly toggle?: boolean;
  /** Set when the value means something in the world; shown in the readout. */
  readonly unit?: string;
  /** Where the part sits until it is touched. */
  readonly defaultValue: number;
}

/**
 * What the operator is doing to the parts right now.
 *
 * The netlist and the renderers read one of these rather than each keeping its
 * own idea of what is pressed or turned, so a part cannot be solved at one knob
 * position and drawn at another.
 */
export class DynamicState {
  private readonly pressed: Set<string>;
  private readonly values: Map<string, number>;

  constructor(pressed: Iterable<string> = [], values: ReadonlyMap<string, number> = new Map()) {
    this.pressed = new Set(pressed);
    this.values = new Map(values);
  }

  /** Whether a momentary contact is being held down. */
  isPressed(partId: string): boolean {
    return this.pressed.has(partId);
  }

  /**
   * A knob's current value, held inside the range its part declares.
   *
   * The clamp is here rather than at the setter because it is the only place
   * the model's own arithmetic depends on the bound being true.
   */
  knob(partId: string, spec: KnobSpec): number {
    const value = this.values.get(`${partId}:${spec.id}`) ?? spec.defaultValue;
    return Math.min(spec.max, Math.max(spec.min, value));
  }

  /** Holds a momentary contact down or lets it spring back. */
  setPressed(partId: string, pressed: boolean): void {
    if (pressed) this.pressed.add(partId);
    else this.pressed.delete(partId);
  }

  /** Moves a knob. Out-of-range values are clamped on the way in. */
  setKnob(partId: string, spec: KnobSpec, value: number): void {
    this.values.set(`${partId}:${spec.id}`, Math.min(spec.max, Math.max(spec.min, value)));
  }

  entries(): ReadonlyMap<string, number> {
    return new Map(this.values);
  }

  copyValuesFrom(other: DynamicState): void {
    this.values.clear();
    for (const [key, value] of other.entries()) {
      this.values.set(key, value);
    }
  }
}

export const NO_DYNAMIC_STATE = new DynamicState();

/**
 * Rotates a pin's offset from the part's origin, clockwise.
 *
 * `width` and `height` are the part's own dimensions, and they are the whole
 * reason this function needs them: the pivot is the part's centre, not its top
 * left corner. Pivoting on the corner is the usual shortcut and it is wrong --
 * it swings the part out to the left of where it was, so a resistor turned a
 * quarter turn lands in the wrong half of the breadboard and its pins claim
 * holes that are not under it.
 *
 * Rotating about the centre leaves that centre where it was, which is what
 * makes a rotated part sit in the same place as an unrotated one -- the pin
 * ends up where the eye expects it, and the renderer can use a plain
 * `rotate(deg, cx, cy)` transform to match exactly.
 */
export function rotateOffset(
  x: number,
  y: number,
  rotation: Rotation,
  width: number,
  height: number,
): { x: number; y: number } {
  if (rotation === 0) return { x, y };

  /*
   * Quarter turns land inside the *turned* bounding box, and that is the whole
   * subtlety. The shape is turned about its own centre, but a quarter turn of
   * a 10x4 part is a 4x10 part -- so the centre it lands on is the middle of
   * that new box, not the middle of the old one. Measuring from the old centre
   * leaves every pin outside the part, which is how a rotated resistor ends up
   * claiming holes several millimetres away from its own leads.
   */
  const swapped = rotation === 90 || rotation === 270;
  const drawnWidth = swapped ? height : width;
  const drawnHeight = swapped ? width : height;

  // Origin of the old box relative to the new one, once turned about the middle.
  const fromX = width / 2;
  const fromY = height / 2;
  const toX = drawnWidth / 2;
  const toY = drawnHeight / 2;

  switch (rotation) {
    case 90:
      // Clockwise on a screen whose y axis points down.
      return { x: toX - (y - fromY), y: toY + (x - fromX) };
    case 180:
      return { x: toX - (x - fromX), y: toY - (y - fromY) };
    case 270:
      return { x: toX + (y - fromY), y: toY - (x - fromX) };
    default:
      return { x, y };
  }
}
