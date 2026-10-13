export interface RankEntry {
  opcode: string;
  count: number;
}

export function coverage(
  rank: readonly RankEntry[],
  ported: ReadonlySet<string>,
): { covered: number; total: number; rate: number } {
  let total = 0;
  let covered = 0;
  for (const entry of rank) {
    total += entry.count;
    if (ported.has(entry.opcode)) covered += entry.count;
  }
  return { covered, total, rate: total === 0 ? 0 : covered / total };
}
