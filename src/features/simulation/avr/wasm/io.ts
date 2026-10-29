// Linear-memory layout map (all byte addresses, --memoryBase 35328 keeps
// AS-managed statics/heap above these regions; raw load/store only — no
// `new`, so no `env.abort` import and `{}` instantiation keeps working):
//   flash [0, 32768)      cpu.ts: 16384 words of program flash (u16)
//   regs  [32768, 32800)  cpu.ts: 32 AVR registers (u8)
//   pins  [32800, 32820)  here: 20 GPIO pin input levels (u8)
//   ring  [32820, 32948)  here: 64 port-event entries x 2 bytes (gpio, high)
//   head  [32948, 32952)  here: event-ring head counter (i32, monotonic)
//   tail  [32952, 32956)  here: event-ring tail counter (i32, monotonic)
//   stack [33024, 35328)  cpu.ts: AVR data-space stack (STACK_BASE + sp)
const PIN_BASE: i32 = 32800;
const PIN_COUNT: i32 = 20;
const EVENT_BASE: i32 = 32820;
const EVENT_CAP: i32 = 64;
const HEAD_OFF: i32 = 32948;
const TAIL_OFF: i32 = 32952;

export function pin_base(): i32 {
  return PIN_BASE;
}

export function pin_level(gpio: i32): boolean {
  if (gpio < 0 || gpio >= PIN_COUNT) return false;
  return load<u8>(PIN_BASE + gpio) !== 0;
}

export function event_base(): i32 {
  return EVENT_BASE;
}

export function event_count(): i32 {
  return load<i32>(HEAD_OFF) - load<i32>(TAIL_OFF);
}

export function event_clear(): void {
  store<i32>(HEAD_OFF, 0);
  store<i32>(TAIL_OFF, 0);
}

export function event_push(gpio: i32, high: i32): void {
  const head = load<i32>(HEAD_OFF);
  const slot = EVENT_BASE + (head % EVENT_CAP) * 2;
  store<u8>(slot, gpio);
  store<u8>(slot + 1, high);
  store<i32>(HEAD_OFF, head + 1);
  if (head + 1 - load<i32>(TAIL_OFF) > EVENT_CAP) {
    store<i32>(TAIL_OFF, head + 1 - EVENT_CAP);
  }
}
