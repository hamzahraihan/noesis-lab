import type { PackedLine } from '../packager';

/** A source row the compiled program can stop on. */
export interface DebugLine {
  /** Flash word address (avr8js `cpu.pc`). */
  readonly pc: number;
  readonly file: string;
  readonly line: number;
}

/** One compiler unit and how its lines map back to sketch tabs. */
export interface DebugUnitMap {
  readonly unit: string;
  readonly lineMap: readonly PackedLine[];
}

export type DebugTypeKind =
  | 'base'
  | 'pointer'
  | 'reference'
  | 'array'
  | 'struct'
  | 'union'
  | 'enum'
  | 'typedef'
  | 'const'
  | 'volatile'
  | 'void'
  | 'unknown';

export interface DebugTypeMember {
  readonly name: string;
  readonly offset: number;
  readonly type: number;
}

export interface DebugTypeEnumerator {
  readonly name: string;
  readonly value: number;
}

export interface DebugType {
  readonly kind: DebugTypeKind;
  readonly name?: string;
  readonly byteSize?: number;
  /** DW_ATE_* for base types. */
  readonly encoding?: number;
  /** Element, pointee, underlying type or typedef target. */
  readonly target?: number;
  /** Array length. */
  readonly count?: number;
  readonly members?: readonly DebugTypeMember[];
  readonly enumerators?: readonly DebugTypeEnumerator[];
}

export interface DebugRange {
  readonly begin: number;
  readonly end: number;
  readonly bytes: readonly number[];
}

export type DebugLocation =
  | { readonly kind: 'expr'; readonly bytes: readonly number[] }
  | { readonly kind: 'loclist'; readonly ranges: readonly DebugRange[] };

export interface DebugVariableSpec {
  readonly name: string;
  readonly type: number;
  readonly scope: 'local' | 'global';
  readonly location?: DebugLocation;
  readonly constValue?: number;
  readonly declLine?: number;
}

export interface DebugFunction {
  /** Byte address, as DWARF records it. */
  readonly lowPc: number;
  /** Exclusive byte address. */
  readonly highPc: number;
  readonly frameBase?: DebugLocation;
  readonly variables: readonly DebugVariableSpec[];
}

/** Everything the backend needs to debug a compiled sketch. */
export interface CompiledDebugInfo {
  /**
   * PC-sorted source rows. Several rows may share a PC: one instruction can
   * sit on the boundary between two statements (a function's opening brace
   * and its first statement, for example), and each must stay a valid
   * breakpoint target.
   */
  readonly lines: readonly DebugLine[];
  readonly functions: readonly DebugFunction[];
  readonly globals: readonly DebugVariableSpec[];
  readonly types: readonly DebugType[];
}
