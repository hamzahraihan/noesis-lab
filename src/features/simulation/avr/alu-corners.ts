export function sub8(a: number, b: number): { result: number; halfCarry: boolean; carry: boolean } {
  const aa = a & 0xff;
  const bb = b & 0xff;
  const result = (aa - bb) & 0xff;
  const halfCarry = (aa & 0x0f) < (bb & 0x0f);
  const carry = aa < bb;
  return { result, halfCarry, carry };
}
