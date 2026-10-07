/**
 * Renders a Wokwi element as one part of the bench.
 *
 * A custom element cannot live inside an `<svg>`, so each part gets a
 * `<foreignObject>`. Inside one, CSS pixels map one-to-one onto the view box's
 * user units, which means the element's own millimetre size drops straight into
 * the bench's coordinate system with no conversion at all -- the board is drawn
 * the size it really is, next to a breadboard whose holes are 2.54 mm apart.
 *
 * State is pushed onto the element by property rather than attribute, because
 * several of them are booleans where the attribute string `"false"` is truthy.
 */

import { useEffect, useRef } from 'react';
import type { PartInstance } from '@/features/simulation';

import type { FootprintState } from './footprints';
import { artworkBox, pushWokwiState, type WokwiPart } from './wokwi';

export function WokwiFootprint({
  part,
  state,
  entry,
  onTogglePressed,
}: {
  part: PartInstance;
  state: FootprintState;
  entry: WokwiPart;
  onTogglePressed?: (partId: string, pressed: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { definition } = part;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Created imperatively: React would set a custom element's reactive
    // properties as attributes, which is the wrong channel for this API.
    const element = document.createElement(entry.tag);
    element.style.display = 'block';
    /*
     * An element states its width in millimetres -- `"28.2mm"` -- or in bare
     * pixels for the smaller parts. Either way the browser lays it out at
     * 96 per inch, so it arrives three and a half times larger than the bench's
     * millimetres: 28.2 mm of CSS is 106.6 px, not 28.2.
     *
     * Scaling by the inverse of 96dpi is what puts it back on the bench's grid,
     * and it is the same number whether the attribute was in millimetres or in
     * pixels, because `sizeMm` is derived from whichever it was.
     */
    element.style.transformOrigin = 'top left';
    element.style.transform = `scale(${25.4 / 96})`;
    /*
     * The element itself is inert, but its container is not.
     *
     * Several elements handle their own pointer input -- the potentiometer knob
     * drags, the pushbutton presses, the ESP32's reset button -- and all of that
     * would swallow the bench's own drag and wire handling. Letting events pass
     * through the artwork and land on the container means the pointerdown still
     * bubbles to the part's group, so the bench moves and wires it normally.
     */
    element.style.pointerEvents = 'none';
    parent.replaceChildren(element);
    return () => {
      parent.replaceChildren();
    };
  }, [entry.tag]);

  // Pin voltages and button presses change every frame, so state is pushed in a
  // layout effect on every render rather than behind a dependency list.
  useEffect(() => {
    const element = host.current?.firstElementChild;
    if (element instanceof HTMLElement) pushWokwiState(element, definition, part, state);
  });

  /*
   * The pushbutton element already knows what a press is -- it dispatches these
   * as non-bubbling events -- so the bench listens for them rather than
   * re-implementing the hit test. Everything else on the element stays inert.
   */
  useEffect(() => {
    const element = host.current?.firstElementChild;
    if (!onTogglePressed || !(element instanceof HTMLElement)) return;
    const press = () => onTogglePressed(part.id, true);
    const release = () => onTogglePressed(part.id, false);
    element.addEventListener('button-press', press);
    element.addEventListener('button-release', release);
    return () => {
      element.removeEventListener('button-press', press);
      element.removeEventListener('button-release', release);
    };
  }, [onTogglePressed, part.id]);

  /*
   * Centred on the definition box (see `artworkBox`), so the artwork turns
   * about its own centre and the selection below follows it there.
   */
  const art = artworkBox(definition, 0);

  return (
    <foreignObject x={art.dx} y={art.dy} width={entry.sizeMm.w} height={entry.sizeMm.h} overflow="visible">
      <div
        ref={host}
        className="cursor-inherit"
        style={{ width: `${entry.sizeMm.w}px`, height: `${entry.sizeMm.h}px` }}
      />
    </foreignObject>
  );
}
