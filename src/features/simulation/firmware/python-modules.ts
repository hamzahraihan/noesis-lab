/**
 * The Python modules a board's runtime has.
 *
 * Two vocabularies, two runtimes: MicroPython boards speak `machine` and the
 * Raspberry Pi speaks `gpiozero`, because that is what Raspberry Pi OS
 * ships. A sketch that imports the other one is asking for a library the
 * board does not have, and the board -- not the sketch -- knows which is
 * which.
 *
 * The key is the board's own id, the same one the engine's bus tables use.
 */
export type PythonModule = 'machine' | 'gpiozero';

const PYTHON_MODULES: Readonly<Record<string, readonly PythonModule[]>> = {
  // The RP2040 boards boot the pinned MicroPython, and so does the ESP32 in
  // the firmware it really runs.
  esp32: ['machine'],
  pico: ['machine'],
  rp2040: ['machine'],
  // A Raspberry Pi runs Linux, where the library is gpiozero.
  'raspberry-pi-4': ['gpiozero'],
};

/** The Python modules a board's runtime has. Empty for a board with none. */
export function pythonModulesFor(boardId: string): readonly PythonModule[] {
  return PYTHON_MODULES[boardId] ?? [];
}
