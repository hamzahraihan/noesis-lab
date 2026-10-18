/**
 * The colour TFT as the sketch's `tft` library reaches it.
 *
 * The layer draws by part, and a part is only reachable through its wires:
 * the same four signals the raw-byte path in `engine.deliverSpi` requires.
 * That rule lives here, once, because both backends -- the in-page
 * `Simulation` and the simulation worker -- hand their sketches this port, and
 * a second copy of a fidelity rule is a second fidelity.
 */

import { Ili9341, type PanelRotation } from '@/features/parts';
import type { DisplayController } from '@/features/parts';
import type { Engine } from '../engine';
import type { TftPort } from '../firmware/interpreter';

/** The first colour panel on the bench, with the part id a bus check needs. */
export function colorPanel(
  controllers: ReadonlyMap<string, DisplayController>,
): { readonly partId: string; readonly panel: Ili9341 } | undefined {
  for (const [partId, controller] of controllers) {
    if (controller instanceof Ili9341) return { partId, panel: controller };
  }
  return undefined;
}

/** The panel a command can reach: the colour panel, wired to the SPI bus. */
export function panelOnBus(
  engine: Engine,
  controllers: ReadonlyMap<string, DisplayController>,
): Ili9341 | undefined {
  const target = colorPanel(controllers);
  return target && engine.isOnSpiBus(target.partId) ? target.panel : undefined;
}

/**
 * The colour panel as a sketch's `tft` library talks to it.
 *
 * One rule, and it is the difference between a library and a second way to
 * draw: a command needs the bus, a query does not. `begin`, `setRotation`,
 * `clear`, `fillRect` and `print` act on the panel only while its four SPI
 * signals are wired, exactly as the raw register path requires, so a pulled
 * jumper freezes the glass on its last picture rather than blinding the twin;
 * `width`, `height`, `textWidth` and `textHeight` answer from the panel as it
 * is, because a library knows its own size with or without a jumper. Byte
 * timing is deliberately not modelled here -- this layer is the library, not
 * the wire, and the map lesson's frames are budgeted against that.
 */
export function createTftPort(
  engine: Engine,
  controllers: () => ReadonlyMap<string, DisplayController>,
): TftPort {
  return {
    begin: () => {
      panelOnBus(engine, controllers())?.setDisplayOn(true);
      return 0;
    },
    setRotation: (rotation) => {
      const found = colorPanel(controllers());
      if (!found) return 0;
      const target = Math.max(0, Math.min(3, Math.round(rotation))) as PanelRotation;
      panelOnBus(engine, controllers())?.setRotation(target);
      // The panel's own answer, as always: a command that never arrived left
      // the orientation it is still in.
      return found.panel.rotation;
    },
    width: () => colorPanel(controllers())?.panel.width ?? 0,
    height: () => colorPanel(controllers())?.panel.height ?? 0,
    clear: () => {
      panelOnBus(engine, controllers())?.clear();
      return 0;
    },
    fillRect: (x, y, width, height, colour) => {
      panelOnBus(engine, controllers())?.fill(x, y, width, height, colour);
      return 0;
    },
    print: (text, x, y, colour) => {
      panelOnBus(engine, controllers())?.print(text, x, y, colour);
      return 0;
    },
    textWidth: (text) => colorPanel(controllers())?.panel.textWidth(text) ?? 0,
    textHeight: () => colorPanel(controllers())?.panel.textHeight() ?? 0,
  };
}
