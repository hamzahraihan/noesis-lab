let ms: i32 = 0;
export function tickMs(): void {
  ms += 1;
}
export function getMs(): i32 {
  return ms;
}
