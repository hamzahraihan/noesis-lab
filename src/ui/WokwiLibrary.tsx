/**
 * The whole Wokwi library, browsable.
 *
 * The package ships fifty-odd elements and the bench models the ones whose
 * circuit the solver can solve. This is the other half of that answer: every
 * element, drawn by the element itself, with what it would take to put the rest
 * on the bench. A part you can see but cannot place is still more use than one
 * you cannot see.
 */

import { useEffect, useRef } from 'react';
import { WOKWI_LIBRARY, type LibraryElement } from './wokwi-library';
import { CheckCircledIcon, ClockIcon, InfoCircledIcon } from '@radix-ui/react-icons';

const STATUS_LABEL: Readonly<Record<LibraryElement['status'], string>> = {
  placed: 'On the bench',
  'needs-api': 'Needs a firmware API',
  'other-part': 'A different part',
};

/** Tallest an element card may draw, so a 91 mm keypad does not own the grid. */
const CARD_MM = 46;

export function WokwiLibrary() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-3 text-xs text-slate-500">
        Every element <code className="text-slate-400">@wokwi/elements</code> ships, drawn by
        itself. The bench adopts the ones whose circuit the solver can solve; the rest are here
        so you can see what they would take.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {WOKWI_LIBRARY.map((element) => (
          <li key={element.tag}>
            <ElementCard element={element} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ElementCard({ element }: { element: LibraryElement }) {
  const host = useRef<HTMLDivElement>(null);
  const scale = Math.min(1, CARD_MM / Math.max(element.sizeMm.w, element.sizeMm.h));

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    if (!customElements.get(element.tag)) return;

    /*
     * Created imperatively for the same reason the bench's own elements are:
     * React would set a custom element's reactive properties as attributes,
     * which is the wrong channel for this API.
     */
    const node = document.createElement(element.tag);
    node.style.display = 'block';
    node.style.transformOrigin = 'top left';
    // CSS lays millimetres out at 96 per inch, so the element arrives three and
    // a half times larger than the bench's millimetres and is scaled back.
    node.style.transform = `scale(${(scale * 25.4) / 96})`;
    node.style.pointerEvents = 'none';
    parent.replaceChildren(node);
    return () => parent.replaceChildren();
  }, [element.tag, scale]);

  return (
    <figure
      className={`flex h-full flex-col rounded-lg border p-2 ${
        element.status === 'placed' ? 'border-slate-800 bg-slate-950' : 'border-slate-800/60 bg-slate-950/50'
      }`}
      title={element.note}
    >
      <div
        className="flex h-24 items-center justify-center overflow-hidden rounded bg-slate-900/60"
        style={{ width: element.sizeMm.w * scale, maxWidth: '100%' }}
      >
        <div
          ref={host}
          style={{ width: `${element.sizeMm.w}px`, height: `${element.sizeMm.h}px` }}
        />
      </div>
      <figcaption className="mt-1.5 text-[11px] leading-snug font-medium text-slate-300">
        {element.name}
      </figcaption>
      <p className="num mt-0.5 text-[10px] text-slate-600">
        {element.sizeMm.w.toFixed(1)} × {element.sizeMm.h.toFixed(1)} mm
      </p>
      <span className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
        {element.status === 'placed' && <CheckCircledIcon className="icon-sm text-emerald-500" aria-hidden="true" />}
        {element.status === 'needs-api' && <ClockIcon className="icon-sm text-amber-400" aria-hidden="true" />}
        {element.status === 'other-part' && <InfoCircledIcon className="icon-sm text-slate-500" aria-hidden="true" />}
        {STATUS_LABEL[element.status]}
      </span>
    </figure>
  );
}