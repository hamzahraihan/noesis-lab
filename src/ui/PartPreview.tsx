/**
 * A single part, drawn by the very renderer the bench uses.
 *
 * Showing the real footprint rather than an icon is the whole point: what you
 * pick out of the catalogue is what lands on the bench, down to the pin pitch,
 * so the preview doubles as a check that a part is wired the way it looks.
 */

import { useMemo } from 'react';
import type { PartInstance } from '@/features/simulation';
import type { PartDefinition } from '../sim/catalog';
import { DynamicState } from '../sim/catalog';
import { PartFootprint, type FootprintState } from './footprints';
import { HardwareDefs } from './hardware';
import { renderedSizeMm } from './wokwi';

/**
 * The state a part is shown in when it is only being looked at.
 *
 * Supply rails sit live and an LED sits forward biased, so a catalogue entry
 * shows what the part will actually look like on the bench rather than a dead
 * grey silhouette.
 */
function previewState(definition: PartDefinition, partId: string): FootprintState {
  const pinVolts = new Map<string, number>();
  for (const pin of definition.pins) {
    if (pin.net === 'GND') pinVolts.set(`${partId}:${pin.id}`, 0);
    else if (pin.net === '3V3') pinVolts.set(`${partId}:${pin.id}`, 3.3);
    else if (pin.net === '5V') pinVolts.set(`${partId}:${pin.id}`, 5);
  }
  if (definition.component.kind === 'led') {
    pinVolts.set(`${partId}:anode`, 3.3);
    pinVolts.set(`${partId}:cathode`, 0);
  }
  return { pinVolts, controls: new DynamicState() };
}

export function PartPreview({
  definition,
  className,
}: {
  definition: PartDefinition;
  className?: string;
}) {
  const part = useMemo<PartInstance>(
    () => ({ id: `preview-${definition.id}`, definition, x: 0, y: 0, rotation: 0, terminals: {} }),
    [definition],
  );
  const state = useMemo(() => previewState(definition, part.id), [definition, part.id]);

  /*
   * Frame what is drawn, not what the definition declares. For a part Wokwi
   * covers the two differ, and framing the smaller box would crop the artwork
   * -- the preview then shows a different thing from the bench.
   */
  const drawn = renderedSizeMm(definition);
  const pad = Math.max(drawn.widthMm, drawn.heightMm) * 0.06 + 1.2;

  return (
    <svg
      className={className}
      viewBox={`${-pad} ${-pad} ${drawn.widthMm + pad * 2} ${drawn.heightMm + pad * 2}`}
      role="img"
      aria-label={definition.name}
    >
      <HardwareDefs />
      <PartFootprint part={part} state={state} />
    </svg>
  );
}
