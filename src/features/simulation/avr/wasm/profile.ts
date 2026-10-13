import { writeFileSync } from 'node:fs';
import { CPU, avrInstruction } from 'avr8js';

export interface OpCount {
  opcode: string;
  count: number;
}

function mnemonicOf(pc: number): string {
  return `pc:${pc.toString(16)}`;
}

export function rankOpcodes(program: Uint16Array, steps: number): OpCount[] {
  const cpu = new CPU(new Uint16Array(program));
  const counts = new Map<string, number>();
  for (let i = 0; i < steps; i++) {
    const key = mnemonicOf(cpu.pc);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    try {
      avrInstruction(cpu);
      cpu.tick();
    } catch {
      break;
    }
  }
  return [...counts.entries()]
    .map(([opcode, count]) => ({ opcode, count }))
    .sort((a, b) => b.count - a.count);
}

export function writeOpRank(path: string, rank: OpCount[]): void {
  writeFileSync(path, JSON.stringify(rank, null, 2));
}
