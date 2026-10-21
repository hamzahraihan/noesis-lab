/**
 * A capture as a VCD file.
 *
 * A VCD is what PulseView reads, so a capture taken on this bench can be
 * opened there and read with the tools a hardware engineer already has. The
 * format is a header that names the signals and a body of value changes with
 * timestamps, which is exactly what a capture is -- so the writer here is
 * the format, not an export of something else.
 *
 * The timestamps are the bench's own simulated milliseconds, and the
 * timescale says so, so a file read elsewhere keeps the shape the capture
 * had here.
 */

/** One captured signal: a name and the samples taken of it. */
export interface VcdTrace {
  readonly label: string;
  /** The samples, each with the time it was taken and the level it read. */
  readonly samples: ReadonlyArray<{ readonly t: number; readonly v: number }>;
}

/**
 * The identifier codes a VCD names its signals with.
 *
 * The format's own alphabet is the printable ASCII from `!` to `~`, and a
 * signal beyond that gets a longer code -- which the format allows, so the
 * capture does not run out of names at ninety-four signals.
 */
function identifier(index: number): string {
  let code = '';
  let rest = index;
  do {
    code = String.fromCharCode(33 + (rest % 94)) + code;
    rest = Math.floor(rest / 94);
  } while (rest > 0);
  return code;
}

/** A name a VCD can carry: no spaces, and nothing that would end a line. */
function signalName(label: string, index: number): string {
  const cleaned = label.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  return cleaned === '' ? `signal_${index + 1}` : cleaned;
}

/**
 * The capture as a VCD.
 *
 * The levels are the bench's own: a capture is of a digital signal, so the
 * value is the level and not a voltage.
 */
export function toVcd(traces: readonly VcdTrace[]): string {
  const out: string[] = [];
  out.push('$comment Noesis bench capture $end');
  out.push('$version Noesis $end');
  out.push('$timescale 1 ms $end');
  out.push('$scope module logic $end');
  traces.forEach((trace, index) => {
    out.push(`$var wire 1 ${identifier(index)} ${signalName(trace.label, index)} $end`);
  });
  out.push('$upscope $end');
  out.push('$enddefinitions $end');
  /*
   * The body: every change, in time order, with the timestamp that carries
   * it. A signal that holds its level is not repeated -- a capture of a slow
   * clock would otherwise be a file of a thousand identical lines.
   */
  const events: { t: number; code: string; value: string }[] = [];
  traces.forEach((trace, index) => {
    const code = identifier(index);
    let last: string | null = null;
    for (const sample of trace.samples) {
      const value = sample.v > 0 ? '1' : '0';
      if (value === last) continue;
      last = value;
      events.push({ t: sample.t, code, value });
    }
  });
  events.sort((a, b) => a.t - b.t);
  let time = -1;
  for (const event of events) {
    if (event.t !== time) {
      time = event.t;
      out.push(`#${time}`);
    }
    out.push(`${event.value}${event.code}`);
  }
  return `${out.join('\n')}\n`;
}
