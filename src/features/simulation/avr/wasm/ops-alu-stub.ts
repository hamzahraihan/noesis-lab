export function alu_add(a: number, b: number, carryIn: number): number {
  const aa = a & 0xff;
  const bb = b & 0xff;
  const cc = carryIn & 0x01;
  const r = aa + bb + cc;
  const result = r & 0xff;
  // Mirror of the avr8js-parity H in ops-alu.ts (carry into bit 1).
  const h = ((aa & 1 & (bb & 1)) | (cc & ((aa ^ bb) & 1))) !== 0;
  const c = r > 0xff;
  const v = (~(aa ^ bb) & (aa ^ result) & 0x80) !== 0;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  let sreg = 0;
  if (h) sreg |= 0x20;
  if (s) sreg |= 0x10;
  if (v) sreg |= 0x08;
  if (n) sreg |= 0x04;
  if (z) sreg |= 0x02;
  if (c) sreg |= 0x01;
  return result | (sreg << 8);
}

export function alu_sub(a: number, b: number, carryIn: number): number {
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
  let sreg = 0;
  if (h) sreg |= 0x20;
  if (s) sreg |= 0x10;
  if (v) sreg |= 0x08;
  if (n) sreg |= 0x04;
  if (z) sreg |= 0x02;
  if (c) sreg |= 0x01;
  return result | (sreg << 8);
}

export function alu_and(a: number, b: number): number {
  const result = a & b & 0xff;
  const v = false;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  let sreg = 0;
  if (s) sreg |= 0x10;
  if (v) sreg |= 0x08;
  if (n) sreg |= 0x04;
  if (z) sreg |= 0x02;
  return result | (sreg << 8);
}

export function alu_or(a: number, b: number): number {
  const result = (a | b) & 0xff;
  const v = false;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  let sreg = 0;
  if (s) sreg |= 0x10;
  if (v) sreg |= 0x08;
  if (n) sreg |= 0x04;
  if (z) sreg |= 0x02;
  return result | (sreg << 8);
}

export function alu_eor(a: number, b: number): number {
  const result = (a ^ b) & 0xff;
  const v = false;
  const n = (result & 0x80) !== 0;
  const z = result === 0;
  const s = n !== v;
  let sreg = 0;
  if (s) sreg |= 0x10;
  if (v) sreg |= 0x08;
  if (n) sreg |= 0x04;
  if (z) sreg |= 0x02;
  return result | (sreg << 8);
}
