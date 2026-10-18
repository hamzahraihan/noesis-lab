// H, S, V, N, Z, C packed at ATmega positions; I/T always zero here.
// H CONTRACT: matches avr8js 0.21.1 (carry into bit 1), NOT the datasheet
// (carry from bit 3). Verified against node_modules/avr8js instruction.js:
// ADD/SUB set 0x20 from bit 0 of the carry expression. Parity with the JS
// path is this port's contract, so the quirk is reproduced deliberately;
// do NOT "fix" H to the datasheet without a matching avr8js upgrade.
function packFlags(h: boolean, s: boolean, v: boolean, n: boolean, z: boolean, c: boolean): i32 {
  let sreg: i32 = 0;
  if (h) sreg |= 0x20;
  if (s) sreg |= 0x10;
  if (v) sreg |= 0x08;
  if (n) sreg |= 0x04;
  if (z) sreg |= 0x02;
  if (c) sreg |= 0x01;
  return sreg;
}

export function alu_add(a: i32, b: i32, carryIn: i32): i32 {
  const aa = a & 0xff;
  const bb = b & 0xff;
  const cc = carryIn & 0x01;
  const r = aa + bb + cc;
  const result = r & 0xff;
  // avr8js-parity H (see header): carry into bit 1, proven equal to
  // avr8js's bit-0 carry-expression test on all 8 (d0, r0, c0) inputs.
  const h = ((aa & 1 & (bb & 1)) | (cc & ((aa ^ bb) & 1))) !== 0;
  const c = r > 0xff;
  const v = (~(aa ^ bb) & (aa ^ result) & 0x80) !== 0;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  return result | (packFlags(h, s, v, n, z, c) << 8);
}

export function alu_sub(a: i32, b: i32, carryIn: i32): i32 {
  const aa = a & 0xff;
  const bb = b & 0xff;
  const cc = carryIn & 0x01;
  const r = aa - bb - cc;
  const result = r & 0xff;
  const h = (aa & 0x0f) < (bb & 0x0f) + cc;
  const c = aa < bb + cc;
  const v = ((aa ^ bb) & (aa ^ result) & 0x80) !== 0;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  return result | (packFlags(h, s, v, n, z, c) << 8);
}

export function alu_and(a: i32, b: i32): i32 {
  const result = a & b & 0xff;
  const v = false;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  return result | (packFlags(false, s, v, n, z, false) << 8);
}

export function alu_or(a: i32, b: i32): i32 {
  const result = (a | b) & 0xff;
  const v = false;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  return result | (packFlags(false, s, v, n, z, false) << 8);
}

export function alu_eor(a: i32, b: i32): i32 {
  const result = (a ^ b) & 0xff;
  const v = false;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  return result | (packFlags(false, s, v, n, z, false) << 8);
}
