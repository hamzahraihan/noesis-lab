import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { breadboardDefinition } from '@/features/parts';
import { resistorDefinition, ledDefinition, buttonDefinition } from '@/features/parts';
import { arduinoUnoR3 } from '@/features/parts';
import { ili9341Definition } from '@/features/parts';
import { DIODE_PROFILES } from '@/features/parts';
import {
  rotatedPartAt,
  pressHitsOwnPin,
  hoverPinLabel,
  wireClickAction,
  type BenchForHit,
} from './hit-test';

/**
 * Picking a part out from under a wire, and off its own artwork.
 *
 * Two bugs, one shape. The bench asked the DOM "what did the press land on?"
 * and a jumper's hit path -- drawn above every part, so wires stay grabbable --
 * resolved to the `<svg>` and no part at all. A resistor is 3.2 mm tall and
 * that path is 3.2 mm wide, so the wire covered the part completely the moment
 * anything was wired to it.
 *
 * And the box tested must be the one the part is drawn in. Where the renderer
 * is not our own the two differ, so testing the definition's box misses most
 * of the visible body: unpickable, while plainly on screen.
 *
 * These assert the question that was being asked wrongly: not which element is
 * on top, but which part is actually under the pointer.
 */
function bench(): BenchForHit {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), 230, 0);
  builder.addPart(resistorDefinition(220), 285, 39);
  return { parts: builder.build().parts };
}

describe('finding the part under a point', () => {
  it('finds a part pressed anywhere on its body', () => {
    const subject = bench();
    const part = subject.parts[1];
    const found = rotatedPartAt(subject, { x: 291.35, y: 40.6 });

    expect(found?.id, 'the middle of the resistor').toBe(part.id);
  });

  it('finds a part even where a wire runs along it', () => {
    // The whole point. A wire leaves the resistor at the same height as its
    // body, so the hit path sits exactly on top of it for the part's length.
    const subject = bench();
    const part = subject.parts[1];

    // Press at the lead, which is where the wire starts.
    const atLead = rotatedPartAt(subject, { x: 285, y: 40.6 });
    expect(atLead?.id, 'the resistor is under its own lead').toBe(part.id);
  });

  it('finds the breadboard itself on its bare surface', () => {
    // The board is a part like any other: pressing its empty surface grabs
    // the board for dragging instead of falling through to panning, while a
    // smaller part sitting on it still wins by being the smaller box.
    const subject = bench();
    const board = subject.parts[0];
    expect(rotatedPartAt(subject, { x: 250, y: 20 })?.id, 'the bare board').toBe(board.id);
  });

  it('finds nothing well away from any part', () => {
    const subject = bench();
    expect(rotatedPartAt(subject, { x: 0, y: 0 })).toBeNull();
  });

  it('prefers the smaller part where two overlap', () => {
    // A small part dropped on top of a large one has to be the one picked up.
    // Both boxes contain the point, so "nearest" does not decide it, and
    // picking the larger would mean a resistor sitting on a display could never
    // be grabbed -- the same complaint, one size up.
    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), 230, 0);
    const panel = builder.addPart(ili9341Definition(), 250, 20);
    const small = builder.addPart(resistorDefinition(220), 285, 39);
    const subject = { parts: builder.build().parts };

    expect(rotatedPartAt(subject, { x: 291.35, y: 40.6 })?.id).toBe(small.id);
    // Away from the small part, the press belongs to the panel.
    expect(rotatedPartAt(subject, { x: 270, y: 30 })?.id).toBe(panel.id);
  });

  it('finds a part drawn at its definition size', () => {
    // The LED draws the Wokwi dome at its declared 10.6 x 13.2 mm: testing
    // the drawn box finds the visible body, and a press outside it finds
    // nothing.
    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), 230, 0);
    const led = builder.addPart(ledDefinition(DIODE_PROFILES.red, 'Red'), 300, 60);
    const subject = { parts: builder.build().parts };

    // Well inside the lamp body.
    expect(rotatedPartAt(subject, { x: 305, y: 68 })?.id, 'the visible body').toBe(led.id);
    // Outside the body is not the LED.
    expect(rotatedPartAt(subject, { x: 312, y: 68 })).toBeNull();
  });

  it('still finds a turned part, using the box it is drawn in', () => {
    const subject = bench();
    const board = subject.parts[0].id;
    const part = subject.parts[1] as { rotation: number };
    part.rotation = 90;

    // 12.7 x 3.2 turned is 3.2 x 12.7: tall and narrow rather than wide.
    const found = rotatedPartAt(subject, { x: 286.6, y: 45.35 });
    expect(found, 'the part is found in its turned box').not.toBeNull();

    // The far end of where it *was* is board surface again, not the part.
    expect(rotatedPartAt(subject, { x: 297, y: 40.6 })?.id).toBe(board);
  });

  it('finds a part whose artwork is wider than its box, at every rotation', () => {
    // The tactile button draws 7.413 mm wide in a 6 mm box: the artwork is
    // centred, so a press on the painted overhang must find it turned or not.
    // A box nailed to the origin misses the overhang and catches the board
    // past the far edge instead of the button.
    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), 230, 0);
    const board = builder.build().parts[0].id;
    const button = builder.addPart(buttonDefinition(), 285, 39);

    // [rotation, point on paint (old box misses), point off paint (old box hits)]
    const cases = [
      [0, [284.5, 42], [292, 42]],
      [90, [287, 38.5], [287, 46]],
      [180, [284.5, 42], [292, 42]],
      [270, [287, 38.5], [287, 46]],
    ] as const;
    for (const [rotation, onPaint, offPaint] of cases) {
      builder.rotatePart(button.id, rotation);
      const subject = { parts: builder.build().parts };
      const at = (point: readonly [number, number]) =>
        rotatedPartAt(subject, { x: point[0], y: point[1] })?.id ?? null;

      expect(at(onPaint), `rotation ${rotation}: painted overhang`).toBe(button.id);
      // Past the painted edge the press belongs to the board underneath.
      expect(at(offPaint), `rotation ${rotation}: past the painted edge`).toBe(board);
    }
  });

  it('splits a wire on first click and opens the palette on the next', () => {
    // Wokwi-style segment splitting: the first click on a wire drops a
    // waypoint where it landed (and selects the wire); clicking the already
    // selected wire opens its colour palette instead of piling on bends.
    // A part underneath still wins outright, clicks on existing handles
    // keep the old palette behaviour, and a press inside a pin's own core
    // defers to wiring from that pin rather than splitting under it.
    const split = (
      part: string | null,
      wire: string | null,
      sel: string | null,
      handle: boolean,
      core: boolean,
    ) => wireClickAction(part, wire, sel, handle, core);
    expect(split(null, 'w1', null, false, false)).toBe('split');
    expect(split(null, 'w1', 'w1', false, false)).toBe('palette');
    expect(split(null, 'w1', 'w2', false, false)).toBe('split');
    expect(split(null, 'w1', null, true, false)).toBe('palette');
    expect(split('p1', 'w1', null, false, false)).toBe('select-part');
    expect(split(null, null, null, false, false)).toBe('clear');
    expect(split(null, 'w1', null, false, true)).toBe('pin');
    expect(split('p1', null, null, false, true)).toBe('pin');
    expect(split('p1', 'w1', null, false, true)).toBe('pin');
    expect(split(null, 'w1', 'w1', false, true)).toBe('pin');
  });

  it('tells a press on a part’s own pin from a press near some other hole', () => {
    // Clicking a component body near an unrelated breadboard hole must select
    // the component, not start a wire from a hole nobody aimed at -- while
    // clicking the component's own lead must still start the wire there.
    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), 230, 0);
    const part = builder.addPart(resistorDefinition(220), 285, 39);
    const built = builder.build();

    // On pin a's lead, and on pin b's lead: a wire starts here.
    expect(pressHitsOwnPin(part, built.terminals, { x: 285, y: 41.54 }, 2)).toBe(true);
    expect(pressHitsOwnPin(part, built.terminals, { x: 295.16, y: 41.54 }, 2)).toBe(true);
    // Off the leads but still on the part: selection, not wiring.
    expect(pressHitsOwnPin(part, built.terminals, { x: 290, y: 45 }, 2)).toBe(false);
    // No part under the pointer: nothing to be its pin.
    expect(pressHitsOwnPin(null, built.terminals, { x: 285, y: 41.54 }, 2)).toBe(false);
  });

  it('names the socket under the cursor', () => {
    const builder = new BenchBuilder();
    builder.addPart(arduinoUnoR3(), 0, 0);
    builder.addPart(breadboardDefinition(), 230, 0);
    builder.addPart(resistorDefinition(220), 285, 39);
    const built = builder.build();
    const subject = { parts: built.parts };
    const terminalOf = (partId: string, pinId: string) =>
      built.parts.find((part) => part.id === partId)!.terminals[pinId];

    const uno = built.parts.find((part) => part.definition.component.kind === 'mcu')!;
    const aref = uno.definition.pins.find((pin) => pin.label === 'AREF')!;
    expect(hoverPinLabel(terminalOf(uno.id, aref.id), subject)).toBe('uno:AREF');

    const board = built.parts.find((part) => part.definition.component.kind === 'breadboard')!;
    expect(hoverPinLabel(terminalOf(board.id, 's19e'), subject)).toBe('E20');
    expect(hoverPinLabel(terminalOf(board.id, 'r0_11'), subject)).toBe('+12');
    expect(hoverPinLabel(terminalOf(board.id, 'r2_4'), subject)).toBe('-5');

    const resistor = built.parts.find((part) => part.definition.id === 'resistor-220')!;
    expect(hoverPinLabel(terminalOf(resistor.id, 'a'), subject)).toBe('resistor-220:a');

    expect(hoverPinLabel(99999, subject)).toBeNull();
  });
});
