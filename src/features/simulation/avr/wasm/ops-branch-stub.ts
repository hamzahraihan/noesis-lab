export function branch_taken(sreg: number, cond: number): boolean {
  if (cond == 0) return (sreg & 0x02) !== 0;
  if (cond == 1) return (sreg & 0x02) === 0;
  if (cond == 2) return (sreg & 0x01) !== 0;
  return (sreg & 0x01) === 0;
}

export function skip_width(firstWord: number): number {
  const w = firstWord & 0xffff;
  if ((w & 0xfe0e) === 0x940c) return 2;
  if ((w & 0xfe0e) === 0x940e) return 2;
  if ((w & 0xfe0f) === 0x9000) return 2;
  if ((w & 0xfe0f) === 0x9200) return 2;
  return 1;
}
