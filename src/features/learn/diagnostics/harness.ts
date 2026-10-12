export type CheckStatus = 'pass' | 'fail' | 'skip' | 'timeout';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly wallMs: number;
}

export interface HarnessSim {
  tick(wallDeltaSeconds: number): void;
  glass(): { glyphs: number[][]; colon: boolean; text: string };
  pressButton(index: number, down: boolean): void;
  jumpTimeMs(ms: number): void;
  serialText(): string;
  readGpio(gpio: number): boolean;
  resetAvrCore?(): boolean;
  stageArmedAlarm?(): void;
  tryCompile?(): Promise<{ status: 'ready' } | { status: 'skip' | 'fail'; detail: string }>;
}

export interface CountingSim extends HarnessSim {
  simMs(): number;
}

function readSimMs(sim: HarnessSim): number {
  const counting = sim as Partial<CountingSim>;
  return typeof counting.simMs === 'function' ? counting.simMs() : 0;
}

export interface CheckDef {
  readonly name: string;
  run(sim: HarnessSim): Promise<CheckResult> | CheckResult;
}

export interface HarnessMetrics {
  readonly wallMs: number;
  readonly simMs: number;
  readonly ratio: number;
}

export interface HarnessReport {
  readonly projectId: string;
  readonly buildLabel: string;
  readonly results: CheckResult[];
  readonly metrics: HarnessMetrics;
}

export interface RunOptions {
  readonly onProgress?: (done: number, total: number) => void;
  readonly isCancelled?: () => boolean;
  readonly yieldEvery?: number;
  readonly wallCapMs?: number;
}

const DEFAULT_WALL_CAP_MS = 120_000;

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function withCap(result: Promise<CheckResult> | CheckResult, wallCapMs: number, name: string): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(result),
      new Promise<CheckResult>((resolve) => {
        timer = setTimeout(() => resolve({ name, status: 'timeout', detail: `exceeded ${wallCapMs} ms`, wallMs: wallCapMs }), wallCapMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runHarness(
  checks: CheckDef[],
  makeSim: () => HarnessSim,
  opts: RunOptions = {},
): Promise<HarnessReport> {
  const yieldEvery = opts.yieldEvery ?? 1;
  const wallCapMs = opts.wallCapMs ?? DEFAULT_WALL_CAP_MS;
  const started = performance.now();
  const sim = makeSim();
  const results: CheckResult[] = [];
  let done = 0;
  for (const check of checks) {
    if (opts.isCancelled?.() === true) {
      results.push({ name: check.name, status: 'skip', detail: 'cancelled', wallMs: 0 });
      continue;
    }
    const result = await withCap(check.run(sim), wallCapMs, check.name);
    results.push(result);
    done += 1;
    opts.onProgress?.(done, checks.length);
    if (done % Math.max(yieldEvery, 1) === 0) await yieldToLoop();
  }
  const wallMs = performance.now() - started;
  const simMs = readSimMs(sim);
  return { projectId: '', buildLabel: '', results, metrics: { wallMs, simMs, ratio: simMs / Math.max(wallMs, 1) } };
}

export function formatReport(report: HarnessReport): string {
  const lines = [
    `${report.projectId} (${report.buildLabel}): ${report.results.filter((r) => r.status === 'pass').length}/${report.results.length} pass`,
    `wall ${report.metrics.wallMs.toFixed(0)} ms, sim ${report.metrics.simMs.toFixed(0)} ms, ratio ${report.metrics.ratio.toFixed(2)}`,
  ];
  for (const result of report.results) {
    lines.push(`[${result.status}] ${result.name}${result.detail === '' ? '' : ` — ${result.detail}`}`);
  }
  return lines.join('\n');
}
