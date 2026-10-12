// Composition only: no logic, no state. Mounts the learn diagnostics panel
// as a standalone route, mirroring how BenchRoute pulls learn content
// through the `@/features/learn` barrel (never deep).
import { DiagnosticsPanel } from '@/features/learn';

export function DiagnosticsRoute() {
  return <DiagnosticsPanel />;
}
