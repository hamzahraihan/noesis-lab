import type { CPU } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import { UNO_GPIO_MAP } from './backend';

// ATmega328P Timer1 (16-bit) datasheet addresses.
const TCCRA = 0x80;
const TCCRB = 0x81;
const TCCRC = 0x82;
const TCNTL = 0x84;
const ICRL = 0x86;
const OCRAL = 0x88;
const OCRBL = 0x8a;
const TIMSK = 0x6f;
const TIFR = 0x36;

// Writable-bit masks: reserved bits read back as zero.
const TCCRA_MASK = 0xf3; // COM1A1:0, COM1B1:0, WGM11:0
const TCCRB_MASK = 0xdf; // ICNC1, ICES1, WGM13:2, CS12:0
const TCCRC_MASK = 0xc0; // FOC1A, FOC1B (strobes)
const INT_MASK = 0x27; // ICIE1/ICF1, OCIE1B/OCF1B, OCIE1A/OCF1A, TOIE1/TOV1

const TOV1 = 0x01;
const OCF1A = 0x02;
const OCF1B = 0x04;

const MAX = 0xffff;

// Timer kinds (Table 16-4 update semantics, mirroring avr8js timer.js).
const KIND_NORMAL = 0;
const KIND_PHASE_CORRECT = 1;
const KIND_CTC = 2;
const KIND_FAST_PWM = 3;
const KIND_PHASE_FREQ_CORRECT = 4;

// OCR double-buffer latch points.
const OCR_IMMEDIATE = 0;
const OCR_AT_TOP = 1;
const OCR_AT_BOTTOM = 2;

// TOV1 set points.
const TOV_AT_MAX = 0;
const TOV_AT_TOP = 1;
const TOV_AT_BOTTOM = 2;

// TOP selectors (negative) vs fixed TOP values (non-negative).
const TOP_OCRA = -1;
const TOP_ICR = -2;

// [kind, top, ocrUpdate, tovUpdate] per WGM13:0. WGM 13 is reserved and
// decodes as Normal.
const WGM_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [KIND_NORMAL, MAX, OCR_IMMEDIATE, TOV_AT_MAX],
  [KIND_PHASE_CORRECT, 0x00ff, OCR_AT_TOP, TOV_AT_BOTTOM],
  [KIND_PHASE_CORRECT, 0x01ff, OCR_AT_TOP, TOV_AT_BOTTOM],
  [KIND_PHASE_CORRECT, 0x03ff, OCR_AT_TOP, TOV_AT_BOTTOM],
  [KIND_CTC, TOP_OCRA, OCR_IMMEDIATE, TOV_AT_MAX],
  [KIND_FAST_PWM, 0x00ff, OCR_AT_BOTTOM, TOV_AT_TOP],
  [KIND_FAST_PWM, 0x01ff, OCR_AT_BOTTOM, TOV_AT_TOP],
  [KIND_FAST_PWM, 0x03ff, OCR_AT_BOTTOM, TOV_AT_TOP],
  [KIND_PHASE_FREQ_CORRECT, TOP_ICR, OCR_AT_BOTTOM, TOV_AT_BOTTOM],
  [KIND_PHASE_FREQ_CORRECT, TOP_OCRA, OCR_AT_BOTTOM, TOV_AT_BOTTOM],
  [KIND_PHASE_CORRECT, TOP_ICR, OCR_AT_TOP, TOV_AT_BOTTOM],
  [KIND_PHASE_CORRECT, TOP_OCRA, OCR_AT_TOP, TOV_AT_BOTTOM],
  [KIND_CTC, TOP_ICR, OCR_IMMEDIATE, TOV_AT_MAX],
  [KIND_NORMAL, MAX, OCR_IMMEDIATE, TOV_AT_MAX],
  [KIND_FAST_PWM, TOP_ICR, OCR_AT_BOTTOM, TOV_AT_TOP],
  [KIND_FAST_PWM, TOP_OCRA, OCR_AT_BOTTOM, TOV_AT_TOP],
];

const PRESCALERS: Readonly<Record<number, number>> = {
  0: 0, // stopped
  1: 1,
  2: 8,
  3: 64,
  4: 256,
  5: 1024,
  // 6/7: external T1 edge counting (handled separately).
};

// T1 is PD5 on the Uno, i.e. gpio 5 via the board map.
const T1_GPIO = UNO_GPIO_MAP.find((entry) => entry.port === 'D' && entry.bit === 5)?.gpio ?? 5;

/**
 * Faithful Timer1 core: 16-bit counting, WGM modes 0-15, both compare
 * channels with flags/interrupts, overflow, and FOC strobes. No OC pin
 * driving and no capture edges yet (later tasks).
 */
export function attachTimer1(
  cpu: CPU,
  mcu: McuRuntime,
  nowMs: () => number,
  readPin: (gpio: number) => boolean,
): void {
  void mcu;
  void nowMs;

  const OVF = {
    address: 0x1a,
    flagRegister: TIFR,
    flagMask: TOV1,
    enableRegister: TIMSK,
    enableMask: TOV1,
  };
  const OCFA = {
    address: 0x16,
    flagRegister: TIFR,
    flagMask: OCF1A,
    enableRegister: TIMSK,
    enableMask: OCF1A,
  };
  const OCFB = {
    address: 0x18,
    flagRegister: TIFR,
    flagMask: OCF1B,
    enableRegister: TIMSK,
    enableMask: OCF1B,
  };

  let tcnt = 0;
  let ocrA = 0;
  let nextOcrA = 0;
  let ocrB = 0;
  let nextOcrB = 0;
  let icr = 0;
  let countingUp = true;
  let highByteTemp = 0;
  let prescaleCounter = 0;
  let kind = KIND_NORMAL;
  let topSel = MAX;
  let ocrUpdate = OCR_IMMEDIATE;
  let tovUpdate = TOV_AT_MAX;
  let extLevel: boolean | null = null;

  const top = (): number => {
    if (topSel === TOP_OCRA) return ocrA;
    if (topSel === TOP_ICR) return icr;
    return topSel;
  };

  /** OCR high-byte write mask: fixed TOPs limit the range, OCR/ICR TOPs do not. */
  const ocrHighMask = (): number => {
    if (topSel === TOP_OCRA || topSel === TOP_ICR) return 0xff;
    return (topSel >> 8) & 0xff;
  };

  const latchOcr = (): void => {
    ocrA = nextOcrA;
    ocrB = nextOcrB;
  };

  const updateWgm = (): void => {
    const wgm = (((cpu.data[TCCRB] & 0x18) >> 1) | (cpu.data[TCCRA] & 0x03)) & 0x0f;
    const mode = WGM_TABLE[wgm] ?? WGM_TABLE[13]!;
    kind = mode[0];
    topSel = mode[1];
    ocrUpdate = mode[2];
    tovUpdate = mode[3];
  };

  // Range-crossing compare detection for up-counting modes (timer.js
  // timerUpdated): catches matches across TOP wraps.
  const checkCompareUp = (value: number, prevValue: number): void => {
    const overflow = prevValue > value;
    if (((prevValue < ocrA || overflow) && value >= ocrA) || (prevValue < ocrA && overflow)) {
      cpu.setInterruptFlag(OCFA);
    }
    if (((prevValue < ocrB || overflow) && value >= ocrB) || (prevValue < ocrB && overflow)) {
      cpu.setInterruptFlag(OCFB);
    }
  };

  const stepUp = (): void => {
    const TOP = top();
    const prev = tcnt;
    const value = (tcnt + 1) % (TOP + 1);
    const overflow = tcnt + 1 > TOP;
    tcnt = value;
    checkCompareUp(value, prev);
    if (ocrUpdate === OCR_AT_BOTTOM && overflow) latchOcr();
    if (overflow && (tovUpdate === TOV_AT_TOP || TOP === MAX)) cpu.setInterruptFlag(OVF);
  };

  // Single phase-correct / phase-and-frequency-correct step (timer.js
  // phasePwmCount with delta 1).
  const stepPhase = (): void => {
    const TOP = top();
    if (tcnt === 0 && TOP === 0) {
      if (ocrUpdate === OCR_AT_TOP) latchOcr();
      return;
    }
    if (countingUp) {
      tcnt++;
      if (tcnt === TOP) {
        countingUp = false;
        if (ocrUpdate === OCR_AT_TOP) latchOcr();
      }
    } else {
      tcnt = (tcnt - 1) & MAX;
      if (tcnt === 0) {
        countingUp = true;
        cpu.setInterruptFlag(OVF);
        if (ocrUpdate === OCR_AT_BOTTOM) latchOcr();
      }
    }
    if (tcnt === ocrA) cpu.setInterruptFlag(OCFA);
    if (tcnt === ocrB) cpu.setInterruptFlag(OCFB);
  };

  const stepCounter = (): void => {
    if (kind === KIND_PHASE_CORRECT || kind === KIND_PHASE_FREQ_CORRECT) stepPhase();
    else stepUp();
  };

  const tickTimer = (): void => {
    const cs = cpu.data[TCCRB] & 0x07;
    if (cs === 0) return; // stopped
    if (cs === 6 || cs === 7) {
      const level = readPin(T1_GPIO);
      const edge = extLevel !== null && (cs === 7 ? !extLevel && level : extLevel && !level);
      extLevel = level;
      if (edge) stepCounter();
      return;
    }
    prescaleCounter++;
    if (prescaleCounter >= (PRESCALERS[cs] ?? 0)) {
      prescaleCounter = 0;
      stepCounter();
    }
  };

  // FOC1A/FOC1B strobes: inactive in PWM modes, and per the datasheet they
  // never set flags, queue interrupts, or clear the counter. Pin forcing
  // arrives with OC routing (later task), so this is a mode-checked no-op.
  const forceCompare = (value: number): void => {
    void (value & TCCRC_MASK);
    if (kind === KIND_FAST_PWM || kind === KIND_PHASE_CORRECT || kind === KIND_PHASE_FREQ_CORRECT) {
      return;
    }
  };

  updateWgm();

  cpu.writeHooks[TCCRA] = (value) => {
    cpu.data[TCCRA] = value & TCCRA_MASK;
    updateWgm();
    return true;
  };
  cpu.writeHooks[TCCRB] = (value) => {
    cpu.data[TCCRB] = value & TCCRB_MASK;
    prescaleCounter = 0;
    const cs = value & 0x07;
    extLevel = cs === 6 || cs === 7 ? readPin(T1_GPIO) : null;
    updateWgm();
    return true;
  };
  cpu.writeHooks[TCCRC] = (value) => {
    forceCompare(value);
    cpu.data[TCCRC] = 0; // strobes always read as zero
    return true;
  };

  cpu.readHooks[TCNTL] = () => {
    cpu.data[TCNTL] = tcnt & 0xff;
    cpu.data[TCNTL + 1] = (tcnt >> 8) & 0xff;
    return cpu.data[TCNTL];
  };
  cpu.writeHooks[TCNTL] = (value) => {
    tcnt = ((highByteTemp << 8) | value) & MAX;
    countingUp = true;
    if ((tcnt === 0 && ocrUpdate === OCR_AT_BOTTOM) || (tcnt === top() && ocrUpdate === OCR_AT_TOP)) {
      latchOcr();
    }
  };
  cpu.writeHooks[TCNTL + 1] = (value) => {
    highByteTemp = value & 0xff;
  };

  cpu.writeHooks[OCRAL] = (value) => {
    nextOcrA = ((highByteTemp << 8) | value) & MAX;
    if (ocrUpdate === OCR_IMMEDIATE) ocrA = nextOcrA;
  };
  cpu.writeHooks[OCRAL + 1] = (value) => {
    highByteTemp = value & ocrHighMask();
    cpu.data[OCRAL + 1] = highByteTemp;
    return true;
  };
  cpu.writeHooks[OCRBL] = (value) => {
    nextOcrB = ((highByteTemp << 8) | value) & MAX;
    if (ocrUpdate === OCR_IMMEDIATE) ocrB = nextOcrB;
  };
  cpu.writeHooks[OCRBL + 1] = (value) => {
    highByteTemp = value & ocrHighMask();
    cpu.data[OCRBL + 1] = highByteTemp;
    return true;
  };

  cpu.writeHooks[ICRL] = (value) => {
    icr = ((highByteTemp << 8) | value) & MAX;
  };
  cpu.writeHooks[ICRL + 1] = (value) => {
    highByteTemp = value & 0xff;
  };

  cpu.writeHooks[TIMSK] = (value) => {
    const masked = value & INT_MASK;
    cpu.data[TIMSK] = masked;
    cpu.updateInterruptEnable(OVF, masked);
    cpu.updateInterruptEnable(OCFA, masked);
    cpu.updateInterruptEnable(OCFB, masked);
    return true;
  };
  cpu.writeHooks[TIFR] = (value) => {
    // Write-one-to-clear: only bits written as 1 clear, the rest are untouched.
    cpu.data[TIFR] &= ~(value & INT_MASK);
    cpu.clearInterruptByFlag(OVF, value);
    cpu.clearInterruptByFlag(OCFA, value);
    cpu.clearInterruptByFlag(OCFB, value);
    return true;
  };

  // One timer source cycle per cpu.tick(): the harness only advances
  // cpu.cycles inside avrInstruction, while the brief's tests drive the
  // timer with bare tick() calls, so the prescaler counts tick invocations.
  // This matches backend pacing, which ticks once per executed cycle.
  const baseTick = cpu.tick.bind(cpu);
  cpu.tick = () => {
    tickTimer();
    baseTick();
  };
}

// OC1A is PB1 (Uno D9); OC1B is PB2 (Uno D10), via the board map.
const OC1A_GPIO = UNO_GPIO_MAP.find((entry) => entry.port === 'B' && entry.bit === 1)?.gpio ?? 9;
const OC1B_GPIO = UNO_GPIO_MAP.find((entry) => entry.port === 'B' && entry.bit === 2)?.gpio ?? 10;

// AVR data addresses (decimal) for port B, mirroring gpio.ts.
const PINB = 35;
const DDRB = 36;
const PORTB = 37;

/**
 * OC-to-PWM bridge: stamps Timer1 compare outputs as McuRuntime PWM intent.
 *
 * When the mode is a PWM mode and the COM1x1:0 bits select non-inverting (2)
 * or inverting (3) output and the DDR bit makes the pin an output, this calls
 * `mcu.writeAnalog` with `Math.round(255 * ocr / top)` (inverting: `255 -`
 * that value); when COM is disconnected or the pin is an input it calls
 * `mcu.writeDigital` with the PORT bit so the pin falls back to plain GPIO.
 * A later digitalWrite overrides duty outright through the existing
 * McuRuntime behavior. 8-bit quantization of 16-bit duties is accepted: the
 * solver consumes McuRuntime duty at 0..255 resolution, so wider timer ranges
 * necessarily collapse at this stamp.
 */
export function bindTimer1Outputs(cpu: CPU, mcu: McuRuntime, nowMs: () => number): void {
  // Wiring choice: chain onto the same cpu.writeHooks the GPIO bridge's
  // AVRIOPort instances own for DDRB/PORTB/PINB (so call this after
  // attachGpioBridge) and onto attachTimer1's TCCR/OCR/ICR hooks. When a
  // chained hook declines the CPU default write (returns falsy), the wrapper
  // replicates `cpu.data[addr] = value` itself before refreshing, so the OC
  // rule always reads post-write register state.
  const wgm = (): number =>
    (((cpu.data[TCCRB] & 0x18) >> 1) | (cpu.data[TCCRA] & 0x03)) & 0x0f;

  const isPwmMode = (): boolean => {
    const mode = WGM_TABLE[wgm()] ?? WGM_TABLE[13]!;
    return mode[0] === KIND_PHASE_CORRECT || mode[0] === KIND_FAST_PWM || mode[0] === KIND_PHASE_FREQ_CORRECT;
  };

  const readWord = (lo: number): number => (cpu.data[lo] | (cpu.data[lo + 1] << 8)) & MAX;

  const top = (): number => {
    const mode = WGM_TABLE[wgm()] ?? WGM_TABLE[13]!;
    if (mode[1] === TOP_OCRA) return readWord(OCRAL);
    if (mode[1] === TOP_ICR) return readWord(ICRL);
    return mode[1];
  };

  const route = (channelA: boolean): void => {
    const com = channelA ? (cpu.data[TCCRA] >> 6) & 0x03 : (cpu.data[TCCRA] >> 4) & 0x03;
    const gpio = channelA ? OC1A_GPIO : OC1B_GPIO;
    const bit = channelA ? 1 : 2;
    const output = ((cpu.data[DDRB] >> bit) & 1) === 1;
    if ((com === 2 || com === 3) && output && isPwmMode()) {
      const ocr = channelA ? readWord(OCRAL) : readWord(OCRBL);
      const range = top();
      const base = range > 0 ? Math.round((255 * ocr) / range) : 0;
      mcu.writeAnalog(gpio, com === 3 ? 255 - base : base, nowMs());
    } else {
      mcu.writeDigital(gpio, ((cpu.data[PORTB] >> bit) & 1) === 1, nowMs());
    }
  };

  const refresh = (): void => {
    route(true);
    route(false);
  };

  const wrap = (addr: number): void => {
    const prev = cpu.writeHooks[addr];
    cpu.writeHooks[addr] = (value, oldValue, hookAddr, mask) => {
      if (prev !== undefined && prev(value, oldValue, hookAddr, mask)) {
        refresh();
        return true;
      }
      // No previous hook, or one that declined the default write: perform it
      // here (the CPU default ignores the mask) so refresh sees fresh state.
      cpu.data[addr] = value;
      refresh();
      return true;
    };
  };

  for (const addr of [TCCRA, TCCRB, OCRAL, OCRAL + 1, OCRBL, OCRBL + 1, ICRL, ICRL + 1, DDRB, PORTB, PINB]) {
    wrap(addr);
  }
}
