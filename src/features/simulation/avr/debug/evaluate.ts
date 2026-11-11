import type { DebugVariable } from '../../firmware/debugger';
import { Reader } from './dwarf';
import { formatConstant, formatValue, resolveType } from './format';
import type {
  CompiledDebugInfo,
  DebugFunction,
  DebugLocation,
  DebugType,
  DebugVariableSpec,
} from './model';

export interface DebugEvalContext {
  /** Byte address of the stop. */
  readonly pc: number;
  /** r0..r31, one byte each. */
  readonly registers: readonly number[];
  readonly sp: number;
  readonly data: Uint8Array;
}

type Located =
  | { readonly kind: 'address'; readonly address: number }
  | { readonly kind: 'value'; readonly bytes: Uint8Array }
  | { readonly kind: 'pieces'; readonly bytes: Uint8Array };

interface StackItem {
  readonly kind: 'value' | 'address';
  readonly value: number;
  readonly size: number;
  readonly flash?: boolean;
}

const REG_PAIRS: Readonly<Record<number, number>> = { 26: 26, 28: 28, 30: 30 };
const REG_SINGLES: Readonly<Record<number, number>> = { 27: 27, 29: 29, 31: 31 };

function registerValue(
  index: number,
  ctx: DebugEvalContext,
): { value: number; size: number } | null {
  if (index >= 0 && index <= 25) {
    return { value: ctx.registers[index] ?? 0, size: 1 };
  }
  if (REG_PAIRS[index] !== undefined) {
    const low = ctx.registers[index] ?? 0;
    const high = ctx.registers[index + 1] ?? 0;
    return { value: low | (high << 8), size: 2 };
  }
  if (REG_SINGLES[index] !== undefined) {
    return { value: ctx.registers[index] ?? 0, size: 1 };
  }
  if (index === 32) return { value: ctx.sp, size: 2 };
  return null;
}

function readData(data: Uint8Array, address: number, size: number): Uint8Array | null {
  if (address < 0 || size < 0 || address + size > data.length) return null;
  return data.subarray(address, address + size);
}

function bytesOf(value: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
  }
  return bytes;
}

function locatedAddress(located: Located | null): number | null {
  if (located === null) return null;
  if (located.kind === 'address') return located.address;
  const bytes = located.bytes;
  return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
}

function evaluateLocation(
  location: DebugLocation,
  ctx: DebugEvalContext,
  frameBase: number | null,
): Located | null {
  if (location.kind === 'loclist') {
    const range = location.ranges.find(
      (candidate) => candidate.begin <= ctx.pc && ctx.pc < candidate.end,
    );
    if (range === undefined) return null;
    return evaluateExpr(range.bytes, ctx, frameBase);
  }
  return evaluateExpr(location.bytes, ctx, frameBase);
}

function evaluateExpr(
  expression: readonly number[],
  ctx: DebugEvalContext,
  frameBase: number | null,
): Located | null {
  const reader = new Reader(Uint8Array.from(expression), expression.length);
  const stack: StackItem[] = [];
  const pieces: number[] = [];
  let hasPiece = false;
  const pop = (): StackItem | undefined => stack.pop();
  const push = (kind: 'value' | 'address', value: number, size: number, flash = false): void => {
    const normalized = kind === 'address' ? value & 0xffff : value;
    stack.push({ kind, value: normalized, size, ...(flash ? { flash } : {}) });
  };
  const popValue = (): StackItem | null => {
    const item = pop();
    return item === undefined ? null : item;
  };
  try {
    while (reader.remaining > 0) {
      const opcode = reader.u8();
      if (opcode >= 0x30 && opcode <= 0x4f) {
        push('value', opcode - 0x30, 2);
      } else if (opcode >= 0x50 && opcode <= 0x6f) {
        const register = registerValue(opcode - 0x50, ctx);
        if (register === null) return null;
        push('value', register.value, register.size);
      } else if (opcode >= 0x70 && opcode <= 0x8f) {
        const register = registerValue(opcode - 0x70, ctx);
        if (register === null) return null;
        const offset = reader.sleb();
        push('address', register.value + offset, 2);
      } else {
        switch (opcode) {
          case 0x03: {
            const address = reader.u32();
            if (address >= 0x800000) push('address', address - 0x800000, 2);
            else push('address', address, 2, true);
            break;
          }
          case 0x06: {
            const address = popValue();
            if (address?.kind !== 'address' || address.flash === true) return null;
            const bytes = readData(ctx.data, address.value, 2);
            if (bytes === null) return null;
            push('value', bytes[0]! | (bytes[1]! << 8), 2);
            break;
          }
          case 0x08:
            push('value', reader.u8(), 1);
            break;
          case 0x0a:
            push('value', reader.u16(), 2);
            break;
          case 0x0c:
            push('value', reader.u32(), 4);
            break;
          case 0x09:
            push('value', reader.i8(), 1);
            break;
          case 0x0b:
            push('value', (reader.u16() << 16) >> 16, 2);
            break;
          case 0x0d:
            push('value', reader.u32() | 0, 4);
            break;
          case 0x10:
            push('value', reader.uleb(), 4);
            break;
          case 0x11:
            push('value', reader.sleb(), 4);
            break;
          case 0x12: {
            const top = stack[stack.length - 1];
            if (top !== undefined) stack.push(top);
            break;
          }
          case 0x13:
            pop();
            break;
          case 0x14:
            if (stack.length >= 2) stack.push(stack[stack.length - 2]!);
            break;
          case 0x15: {
            const index = reader.uleb();
            const item = stack[stack.length - 1 - index];
            if (item !== undefined) stack.push(item);
            break;
          }
          case 0x16: {
            const b = pop();
            const a = pop();
            if (a !== undefined && b !== undefined) {
              push(b.kind, b.value, b.size, b.flash === true);
              push(a.kind, a.value, a.size, a.flash === true);
            }
            break;
          }
          case 0x17: {
            const a = pop();
            const b = pop();
            const c = pop();
            if (a !== undefined && b !== undefined && c !== undefined) {
              push(b.kind, b.value, b.size, b.flash === true);
              push(c.kind, c.value, c.size, c.flash === true);
              push(a.kind, a.value, a.size, a.flash === true);
            }
            break;
          }
          case 0x18: {
            // DW_OP_xderef: dereference an address in a given address space.
            // Pop the address space, then the address, push the value found.
            // AVR has one address space (data memory), so the space is popped
            // and discarded; the address is dereferenced as a 16-bit read.
            const space = popValue();
            const address = popValue();
            if (space === null || address === null) return null;
            if (address.kind !== 'address' && address.kind !== 'value') return null;
            const bytes = readData(ctx.data, address.value, 2);
            if (bytes === null) return null;
            push('value', bytes[0]! | (bytes[1]! << 8), 2);
            break;
          }
          case 0x19: {
            const a = pop();
            if (a === undefined) return null;
            stack.push({ ...a, value: Math.abs(a.value) });
            break;
          }
          case 0x1a:
          case 0x1b:
          case 0x1c:
          case 0x1d:
          case 0x1e:
          case 0x21:
          case 0x22:
          case 0x24:
          case 0x25:
          case 0x26:
          case 0x27: {
            const b = pop();
            const a = pop();
            if (a === undefined || b === undefined) return null;
            let value: number;
            if (opcode === 0x1a) value = a.value & b.value;
            else if (opcode === 0x1b) {
              if (b.value === 0) return null;
              value = Math.floor(a.value / b.value);
            } else if (opcode === 0x1c) value = a.value - b.value;
            else if (opcode === 0x1d) {
              if (b.value === 0) return null;
              value = a.value % b.value;
            } else if (opcode === 0x1e) value = a.value * b.value;
            else if (opcode === 0x21) value = a.value | b.value;
            else if (opcode === 0x22) value = a.value + b.value;
            else if (opcode === 0x24) value = a.value << b.value;
            else if (opcode === 0x25) value = a.value >>> b.value;
            else if (opcode === 0x26) value = ((a.value << 16) >> 16) >> b.value;
            else value = a.value ^ b.value;
            const kind = a.kind === 'address' || b.kind === 'address' ? 'address' : 'value';
            push(kind, value, Math.max(a.size, b.size), a.flash === true || b.flash === true);
            break;
          }
          case 0x1f: {
            const a = pop();
            if (a === undefined) return null;
            push('value', -a.value, a.size);
            break;
          }
          case 0x20: {
            const a = pop();
            if (a === undefined) return null;
            push('value', ~a.value, a.size);
            break;
          }
          case 0x23: {
            const a = pop();
            if (a === undefined) return null;
            const addend = reader.uleb();
            push(a.kind, a.value + addend, a.size, a.flash === true);
            break;
          }
          case 0x90: {
            const register = registerValue(reader.uleb(), ctx);
            if (register === null) return null;
            push('value', register.value, register.size);
            break;
          }
          case 0x91: {
            if (frameBase === null) return null;
            push('address', frameBase + reader.sleb(), 2);
            break;
          }
          case 0x92: {
            const register = registerValue(reader.uleb(), ctx);
            if (register === null) return null;
            push('address', register.value + reader.sleb(), 2);
            break;
          }
          case 0x93: {
            const size = reader.uleb();
            const item = pop();
            if (item === undefined) return null;
            if (item.kind === 'address') {
              if (item.flash === true) return null;
              const bytes = readData(ctx.data, item.value, size);
              if (bytes === null) return null;
              pieces.push(...bytes);
            } else {
              pieces.push(...bytesOf(item.value, size));
            }
            hasPiece = true;
            break;
          }
          case 0x94: {
            const size = reader.u8();
            const address = pop();
            if (address?.kind !== 'address' || address.flash === true) return null;
            const bytes = readData(ctx.data, address.value, size);
            if (bytes === null) return null;
            let value = 0;
            for (let index = 0; index < bytes.length; index += 1) {
              value += bytes[index]! * 2 ** (8 * index);
            }
            push('value', value, size);
            break;
          }
          case 0x96:
            break;
          case 0x9f: {
            const top = stack[stack.length - 1];
            if (top !== undefined) stack[stack.length - 1] = { ...top, kind: 'value' };
            break;
          }
          default:
            return null;
        }
      }
    }
  } catch {
    return null;
  }
  if (hasPiece) return { kind: 'pieces', bytes: Uint8Array.from(pieces) };
  const top = stack[stack.length - 1];
  if (top === undefined) return null;
  if (top.kind === 'address') return { kind: 'address', address: top.value };
  return { kind: 'value', bytes: bytesOf(top.value, top.size) };
}

function functionAt(functions: readonly DebugFunction[], pc: number): DebugFunction | undefined {
  let best: DebugFunction | undefined;
  for (const fn of functions) {
    if (pc < fn.lowPc || pc >= fn.highPc) continue;
    if (best === undefined || fn.highPc - fn.lowPc < best.highPc - best.lowPc) best = fn;
  }
  return best;
}

function valueOf(
  spec: DebugVariableSpec,
  types: readonly DebugType[],
  ctx: DebugEvalContext,
  frameBase: number | null,
): string {
  if (spec.constValue !== undefined) return formatConstant(spec.constValue, spec.type, types);
  if (spec.location === undefined) return 'optimized out';
  const located = evaluateLocation(spec.location, ctx, frameBase);
  if (located === null) return 'optimized out';
  if (located.kind === 'address') {
    const type = resolveType(spec.type, types);
    const size = type?.byteSize ?? 1;
    const bytes = readData(ctx.data, located.address, size);
    return bytes === null ? 'optimized out' : formatValue(bytes, spec.type, types);
  }
  return formatValue(located.bytes, spec.type, types);
}

/** Reads every local of the current function and every global at a stop. */
export function readVariables(
  info: CompiledDebugInfo,
  ctx: DebugEvalContext,
): DebugVariable[] {
  const fn = functionAt(info.functions, ctx.pc);
  const frameBase =
    fn?.frameBase === undefined
      ? null
      : locatedAddress(evaluateLocation(fn.frameBase, ctx, null));
  const out: DebugVariable[] = [];
  if (fn !== undefined) {
    for (const spec of fn.variables) {
      out.push({
        name: spec.name,
        value: valueOf(spec, info.types, ctx, frameBase),
        scope: 'local',
        ...(spec.declLine === undefined ? {} : { declLine: spec.declLine }),
      });
    }
  }
  for (const spec of info.globals) {
    out.push({
      name: spec.name,
      value: valueOf(spec, info.types, ctx, null),
      scope: 'global',
      ...(spec.declLine === undefined ? {} : { declLine: spec.declLine }),
    });
  }
  return out;
}
