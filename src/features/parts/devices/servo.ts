/**
 * The hobby servo: three pins, an angle, and a horn that points where the
 * sketch told it to.
 *
 * The angle is the whole of the model, and the reason it is not simply 0 to 180
 * is the interesting part. A servo is sold as a 180-degree part and is driven
 * over a wider pulse range than its horn can actually travel: past its
 * mechanical stops the output is hard against the stop and stays there, so a
 * sketch asking for 180 gets 170 and one asking for -10 gets 10. That clamp is
 * the whole difference between a servo and a knob -- there is a place past
 * which asking for more changes nothing, which is what a stop is for.
 *
 * Electrically it is a load on its own supply rather than a device on a bus, so
 * unlike the I2C parts this one contributes circuit: `loadOhms` is what stands
 * in for the motor.
 */

import type { PartDefinition } from '../catalog';

/**
 * Where the horn's mechanical stops are.
 *
 * The figures an 180-degree hobby servo is normally described with: about ten
 * degrees short of each end of its nominal travel. A datasheet gives the pulse
 * range the drive electronics accept and the travel the horn has; the gap
 * between the two is what these numbers are for, so they stand in for the
 * mechanical limit rather than being measured off one part.
 */
const STOP_LOW_DEGREES = 10;
const STOP_HIGH_DEGREES = 170;

/**
 * Where the horn points before a sketch tells it otherwise.
 *
 * Mid travel, which is also where the Arduino library parks an attached servo,
 * so a sketch that attaches and never writes still reads a sane angle.
 */
const REST_ANGLE_DEGREES = 90;

/** The supply these figures are quoted at: the 4.8 to 6 V a servo is rated for. */
const SUPPLY_VOLTS = 5;

/**
 * What the motor draws while it is being driven to an angle, and what the drive
 * electronics draw with nothing to do.
 *
 * The first is the ~100 mA an SG90-class 9 g servo is quoted at with no load on
 * the horn, the second its ~14 mA quiescent current. Both are the figures these
 * parts are normally published with, not measurements taken here.
 */
const DRIVEN_AMPS = 0.1;
const PARKED_AMPS = 0.014;

/**
 * One servo, as a sketch drives it.
 *
 * There is no time here, deliberately: nothing in the model has a rate, so a
 * `write` moves the horn at once. What a real part adds -- the time the horn
 * takes over its travel, and the difference between running and holding current
 * -- needs a time base that is the engine's to keep, not the part's.
 *
 * The angle and the load are read-only because they are the clamp's output:
 * there is no way to set either of them except by driving the servo.
 */
export class Servo {
  private commanded = REST_ANGLE_DEGREES;
  private driving = false;

  /**
   * Where the horn points, in degrees.
   *
   * This is the `angle` the Wokwi element draws the horn at, so it is already
   * the number the artwork wants.
   */
  get angle(): number {
    return this.commanded;
  }

  /**
   * What the servo draws from its supply: a resistance to stamp from `V+` to
   * `GND`.
   *
   * A servo is an inductive load and this solver is a DC one, so nothing here
   * carries inrush, back-EMF or stall current -- a sketch that stalls a real
   * servo against its stop browns out its supply in a way this cannot show.
   * What stands in for the motor is a resistor of the figures above over the
   * supply the servo is rated at, which is why the driven figure is the running
   * current and not the several hundred milliamps a stall would draw.
   *
   * Driven means the sketch has asked for an angle and the servo has it. With no
   * time base a commanded servo keeps drawing the running figure rather than
   * dropping to the holding current once it arrives.
   */
  get loadOhms(): number {
    return SUPPLY_VOLTS / (this.driving ? DRIVEN_AMPS : PARKED_AMPS);
  }

  /**
   * Points the horn at `degrees`, as far as the stops allow.
   *
   * Rounded to whole degrees because that is what the pulse scale resolves for
   * a servo of this kind -- about a microsecond of pulse per degree -- and
   * because `read` hands a sketch an integer.
   */
  write(degrees: number): void {
    const wanted = Math.round(degrees);
    this.commanded = Math.min(STOP_HIGH_DEGREES, Math.max(STOP_LOW_DEGREES, wanted));
    this.driving = true;
  }

  /**
   * Stops the pulses arriving, which is all detaching does to a real servo.
   *
   * The horn stays where it is -- nothing springs it back -- so the angle is
   * left alone and only the driving stops.
   */
  detach(): void {
    this.driving = false;
  }
}

/**
 * The part: a 45 x 31.63 mm case with a three-hole header down its left edge.
 *
 * The element's `pinInfo` puts those holes at x 0 and 13.23, 15.74 and 18.26 mm
 * down, which is the 96 dpi the rest of the library is converted out of. They
 * are 2.51 mm apart there, so the row is snapped to the breadboard's grid the
 * way the modules are: the first hole at 12.7 mm, the nearest hole the board can
 * actually carry, and the other two a full pitch along. 0.53 mm of artwork is
 * given up to do it, which is what makes the part wireable.
 *
 * `V+` is deliberately left with no internal net. It is the supply the operator
 * chooses -- these are 4.8 to 6 V parts, often a battery rather than the board's
 * rail -- so tying it to anything here would decide the wiring for them.
 */
export function servoDefinition(): PartDefinition {
  return {
    id: 'servo',
    name: 'Hobby Servo',
    category: 'output',
    widthMm: 45,
    heightMm: 31.63,
    component: { kind: 'servo' },
    pins: [
      { id: 'GND', label: 'GND', x: 0, y: 12.7, net: 'GND' },
      { id: 'V+', label: 'V+', x: 0, y: 15.24 },
      { id: 'PWM', label: 'PWM', x: 0, y: 17.78 },
    ],
    // The case and the horn, as the element draws them: a grey box with a grey
    // arm on it, and pin legends read against the box.
    bodyColour: '#666666',
    legendColour: '#ffffff',
  };
}
