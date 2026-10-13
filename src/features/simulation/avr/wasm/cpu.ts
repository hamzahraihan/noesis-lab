let cycles: i32 = 0;
export function step(n: i32): i32 {
  cycles += n;
  return cycles;
}
export function get_cycles(): i32 {
  return cycles;
}
