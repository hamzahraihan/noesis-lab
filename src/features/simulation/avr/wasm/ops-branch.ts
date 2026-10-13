export function branch_taken(sreg: i32, cond: i32): boolean {
  if (cond == 0) return (sreg & 0x02) !== 0;
  if (cond == 1) return (sreg & 0x02) === 0;
  if (cond == 2) return (sreg & 0x01) !== 0;
  return (sreg & 0x01) === 0;
}

export function skip_width(firstWord: i32): i32 {
  const w = firstWord & 0xffff;
  if ((w & 0xfe0e) === 0x940c) return 2;
  if ((w & 0xfe0e) === 0x940e) return 2;
  if ((w & 0xfe0f) === 0x9000) return 2;
  if ((w & 0xfe0f) === 0x9200) return 2;
  return 1;
}
