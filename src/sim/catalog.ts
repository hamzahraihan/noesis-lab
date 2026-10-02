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

import type { DiodeProfile } from './elements';

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
      readonly controller: 'ssd1306' | 'ili9341';
      readonly address: number;
    };

export interface PartDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: 'board' | 'breadboard' | 'passive' | 'input' | 'output';
  readonly widthMm: number;
  readonly heightMm: number;
  readonly component: ComponentSpec;
  readonly pins: readonly PinSpec[];
  readonly boardPins?: readonly BoardPin[];
  /** Body colour for the SVG renderer, as a hex string. */
  readonly bodyColour: string;
  /** Panel resolution, for a display part. The pixels live in the controller. */
  readonly displayPixels?: { readonly width: number; readonly height: number };
  /** Silkscreen / legend colour for the SVG renderer. */
  readonly legendColour: string;
}

/** Knobs a part exposes that change what it does electrically, not just how it looks. */
export interface DynamicState {
  /** Part ids of currently pressed buttons. */
  readonly pressedButtons: ReadonlySet<string>;
  /** Part id to wiper position in 0..1 for each potentiometer. */
  readonly potPositions: ReadonlyMap<string, number>;
}

export const NO_DYNAMIC_STATE: DynamicState = {
  pressedButtons: new Set(),
  potPositions: new Map(),
};

/** Rotates a pin offset by `rotation` quarters of a turn, clockwise. */
export function rotateOffset(
  x: number,
  y: number,
  rotation: Rotation,
): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: -y, y: x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: y, y: -x };
  }
}