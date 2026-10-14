// Linear-memory layout map (all byte addresses, --memoryBase 2048 keeps
// AS-managed statics/heap above these regions; raw load/store only — no
// `new`, so no `env.abort` import and `{}` instantiation keeps working):
//   flash [0, 1024)     cpu.ts: 512 words of program flash (u16)
//   regs  [1024, 1056)  cpu.ts: 32 AVR registers (u8)
//   pins  [1056, 1076)  here: 20 GPIO pin input levels (u8)
//   ring  [1076, 1204)  here: 64 port-event entries x 2 bytes (gpio, high)
//   head  [1204, 1208)  here: event-ring head counter (i32, monotonic)
//   tail  [1208, 1212)  here: event-ring tail counter (i32, monotonic)
const PIN_BASE: i32 = 1056;
const PIN_COUNT: i32 = 20;
const EVENT_BASE: i32 = 1076;
const EVENT_CAP: i32 = 64;
const HEAD_OFF: i32 = 1204;
const TAIL_OFF: i32 = 1208;

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
