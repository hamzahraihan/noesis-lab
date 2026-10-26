/**
 * The bench's debugger: the stops a person sets, the stepping they ask for,
 * and the frame the program stopped on.
 *
 * The state lives here rather than in the interpreter because it belongs to
 * the person watching rather than to the program running: the same sketch can
 * be stopped at different lines as many times as they like, and a run that
 * finishes leaves the stops where they were.
 *
 * The interpreter asks one question at every statement -- should I stop
 * here? -- and the answer is what this file knows: a stop on this line of
 * this file, or a step that has been asked for and not spent yet.
 */

/** How the next stop is chosen. */
export type StepMode = 'off' | 'over' | 'into';

/** A stop: a line in a file. */
export interface Breakpoint {
  readonly file: string;
  readonly line: number;
}

/**
 * One name the program can see, and what it holds.
 *
 * The scope says where the name came from: a local of the function that is
 * running, a field of the object it works on, or a global.
 */
export interface DebugVariable {
  readonly name: string;
  readonly value: string;
  readonly scope: 'local' | 'field' | 'global';
}

/** One register as the compiled debugger reads it. */
export interface DebugRegister {
  readonly name: string;
  readonly value: string;
}

/** Where the program stopped, and what it could see from there. */
export interface DebugFrame {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /**
   * How many calls deep the program is.
   *
   * A step that stays at this level stops at the next statement that is not
   * deeper than this, which is what stepping over a call means.
   */
  readonly depth: number;
  readonly variables: readonly DebugVariable[];
  /**
   * Byte address of the program counter, for a compiled frame.
   *
   * DWARF and GDB name AVR instructions by byte address; avr8js names them by
   * word index, so the backend converts once when it builds the frame.
   */
  readonly pc?: number;
  /** Register file plus SREG/SP/PC, for a compiled frame. */
  readonly registers?: readonly DebugRegister[];
  /** True when the frame came from compiled firmware rather than a script. */
  readonly compiled?: boolean;
}

export class FirmwareDebugger {
  /** The stops, by file and then by line. */
  private readonly stops = new Map<string, Set<number>>();
  private mode: StepMode = 'off';
  /** The depth a step stays at, for a step that does not go deeper. */
  private modeDepth = 0;
  /** The line the program last reached, so a stop fires once per visit. */
  private lastLine: string | null = null;

  /** Whether a stop is set on this line of this file. */
  hasBreakpoint(file: string, line: number): boolean {
    return this.stops.get(file)?.has(line) ?? false;
  }

  /**
   * Turns the stop on this line on or off, and says which it now is.
   *
   * A stop that is already there comes off, so the same click that set it
   * takes it away.
   */
  toggleBreakpoint(file: string, line: number): boolean {
    const lines = this.stops.get(file);
    if (lines?.has(line)) {
      lines.delete(line);
      if (lines.size === 0) this.stops.delete(file);
      return false;
    }
    if (lines) lines.add(line);
    else this.stops.set(file, new Set([line]));
    return true;
  }

  /** Every stop, file by file, in the order the files were named. */
  breakpoints(): readonly Breakpoint[] {
    const out: Breakpoint[] = [];
    for (const [file, lines] of this.stops) {
      for (const line of [...lines].sort((a, b) => a - b)) out.push({ file, line });
    }
    return out;
  }

  /** Forgets every stop, and any step that was waiting to be spent. */
  clear(): void {
    this.stops.clear();
    this.mode = 'off';
    this.lastLine = null;
  }

  /** Whether any stop is set at all. */
  get armed(): boolean {
    return this.stops.size > 0;
  }

  /**
   * Whether the program should stop at this statement.
   *
   * A step answers first, and a stop on the line answers second. A step is
   * spent by the first statement that fits it, so asking to step twice does
   * not stop twice at the same place.
   *
   * A stop is on a line rather than on a statement, and a line can hold
   * more than one: `int a = 1; int b = 2;` is two statements on one line.
   * So a stop fires when the program reaches the line, and not again while
   * it is still on it.
   */
  shouldStop(file: string, line: number, depth: number): boolean {
    const at = `${file}:${line}`;
    const moved = this.lastLine !== at;
    this.lastLine = at;
    if (this.mode === 'into') {
      this.mode = 'off';
      return true;
    }
    if (this.mode === 'over') {
      /*
       * A step over waits for the call the statement made to finish, so it
       * lands on the next statement at this level or above. At the top level
       * there is nothing above to wait for, so the step lands on whatever
       * the program runs next.
       */
      if (depth <= this.modeDepth || this.modeDepth === 0) {
        this.mode = 'off';
        return true;
      }
    }
    return moved && this.stops.get(file)?.has(line) === true;
  }

  /** Runs to the next statement at this depth or above it. */
  stepOver(depth: number): void {
    this.mode = 'over';
    this.modeDepth = depth;
  }

  /** Runs to the very next statement, whatever depth it is at. */
  stepInto(): void {
    this.mode = 'into';
  }

  /** Runs to the next stop. */
  resume(): void {
    this.mode = 'off';
  }

  /** Whether a step is waiting to be spent. */
  get stepping(): boolean {
    return this.mode !== 'off';
  }
}
