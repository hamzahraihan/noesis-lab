/**
 * WasmEngine: TypeScript adapter over the Emscripten engine module.
 *
 * Expands the bench into the C++ netlist shape on the host (part definitions
 * live in TS) and serialises it to JSON for `engine_create`. Voltages and
 * serial output are live; part state, framebuffers and debug control are
 * honest stubs until the wiring lands.
 */
import type { Bench } from '../bench';
import type { McuRuntime } from '../mcu';
import type { DynamicState } from '@/features/parts';
import { NO_DYNAMIC_STATE } from '@/features/parts';
import { buildNetlist } from '../netlist';
import { ProbeDeck } from '../probe';
import { COMPONENT_KIND, paramsFor } from './netlist';
import { KEYPAD_KEYS, createController, type DisplayController, SevenSegment, Tm1637 } from '@/features/parts';

export interface WasmEngineOptions {
  bench: Bench;
  mcu: McuRuntime;
  dynamicState?: DynamicState;
}

interface FfiExports {
  readonly memory: WebAssembly.Memory;
  wasm_alloc(bytes: number): number;
  engine_create(circuitJson: number, sketchJson: number): number;
  engine_step(handle: number, dtMs: number): number;
  engine_set_pin(handle: number, partId: number, pin: number, level: number): number;
  engine_set_knob(handle: number, partId: number, knob: number, value: number): number;
  engine_get_state(handle: number, outCount: number): number;
  engine_get_voltages(handle: number, outCount: number): number;
  engine_get_serial(handle: number): number;
  engine_set_breakpoint(handle: number, pc: number): number;
  engine_clear_breakpoint(handle: number, id: number): void;
  engine_set_step_over(handle: number, enable: number): void;
  engine_set_step_into(handle: number, enable: number): void;
  engine_continue(handle: number): void;
  engine_get_debug_state(handle: number): number;
  engine_destroy(handle: number): void;
  netlist_node_of_terminal(): number;
  netlist_node_count(): number;
}

async function instantiateEngineModule(): Promise<FfiExports> {
  const response = await fetch(new URL('/assets/engine.wasm', import.meta.url));
  if (!response.ok) throw new Error(`engine.wasm: HTTP ${response.status}`);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const instance = await WebAssembly.instantiate(module, {
    env: {
      js_exp: Math.exp,
      js_log1p: Math.log1p,
      js_pow: Math.pow,
      emscripten_notify_memory_growth: () => {},
    },
  });
  return instance.exports as unknown as FfiExports;
}

export class WasmEngine {
  readonly mcu: McuRuntime;
  readonly probes = new ProbeDeck();

  timeMs = 0;

  private bench: Bench;
  private dynamicState: DynamicState;
  private module: FfiExports | null = null;
  private handle = 0;
  private pinNodeMap = new Map<string, number>();
  private voltages: Float64Array = new Float64Array(0);
  private serialOutput = '';
  private pressed = new Set<string>();
  private pendingSketch = '';

  private displays = new Map<string, DisplayController>();

  constructor(options: WasmEngineOptions) {
    this.bench = options.bench;
    this.mcu = options.mcu;
    this.dynamicState = options.dynamicState ?? NO_DYNAMIC_STATE;
  }

  /** Async factory that also instantiates the Wasm module. */
  static async create(options: WasmEngineOptions): Promise<WasmEngine> {
    const engine = new WasmEngine(options);
    engine.module = await instantiateEngineModule();
    return engine;
  }

  async loadSketch(src: string, _lang: 'cpp' | 'py'): Promise<void> {
    this.pendingSketch = src;
  }

  async loadCircuit(_json: unknown): Promise<void> {
    if (!this.module) {
      this.module = await instantiateEngineModule();
    }
    this.pinNodeMap.clear();
    const expanded = expandBench(this.bench, this.dynamicState);
    const mod = this.module;
    const circuitPtr = allocString(mod, JSON.stringify(expanded));
    const sketchPtr = allocString(mod, this.pendingSketch);
    this.handle = mod.engine_create(circuitPtr, sketchPtr);
    if (this.handle === 0) throw new Error('WasmEngine: engine_create failed');

    // Build pinNodeMap from C++ wasm: partId:pin -> node index.
    // netlist_node_of_terminal() returns the terminal->node array computed
    // by the C++ build_netlist during engine_create.
    const nodePtr = mod.netlist_node_of_terminal();
    const nodeCount = mod.netlist_node_count();
    if (nodePtr !== 0 && nodeCount > 0) {
      const nodeOfTerminal = new Int32Array(mod.memory.buffer, nodePtr, nodeCount);
      for (const part of this.bench.parts) {
        for (const pinId of Object.keys(part.terminals)) {
          const terminal = part.terminals[pinId];
          if (terminal !== undefined && terminal < nodeCount) {
            this.pinNodeMap.set(`${part.id}:${pinId}`, nodeOfTerminal[terminal]);
          }
        }
      }
    }

    // Display controllers for display parts.
    this.displays.clear();
    for (const part of this.bench.parts) {
      const kind = part.definition.component.kind;
      let controller: DisplayController | null = null;
      if (kind === 'tm1637') {
        controller = new Tm1637();
      } else if (kind === '7segment') {
        controller = new SevenSegment(part.definition.component.digits ?? 1);
      } else {
        controller = createController(part.definition);
      }
      if (controller) this.displays.set(part.id, controller);
    }
  }

  async step(dtMs: number): Promise<void> {
    if (!this.module) {
      this.module = await instantiateEngineModule();
    }
    if (this.handle === 0) return;
    this.timeMs += dtMs;
    const mod = this.module;
    const status = mod.engine_step(this.handle, dtMs);
    if (status !== 0) throw new Error(`WasmEngine: engine_step failed (${status})`);
    const serialPtr = mod.engine_get_serial(this.handle);
    this.serialOutput = readCString(mod, serialPtr);
    const countPtr = mod.wasm_alloc(4);
    const voltPtr = mod.engine_get_voltages(this.handle, countPtr);
    const count = new Int32Array(mod.memory.buffer, countPtr, 1)[0];
    if (voltPtr !== 0 && count > 0) {
      this.voltages = new Float64Array(mod.memory.buffer, voltPtr, count).slice();
    } else {
      this.voltages = new Float64Array(0);
    }
    this.pumpDisplays();
  }

  voltageOfNet(net: number): number {
    if (net === -1 || net < 0 || net >= this.voltages.length) return 0;
    return this.voltages[net];
  }

  private pumpDisplays(): void {
    const high = this.mcu.board.logicVolts / 2;
    if (this.pinNodeMap.size === 0) return;
    for (const [partId, controller] of this.displays) {
      if (controller instanceof SevenSegment) {
        // Simplified: pump using solved volts (no mcuOutputLevel fallback).
        const nets = this.sevenSegmentNets(partId, controller.digitCount);
        if (!nets) continue;
        const segmentLevel = (n: number) => this.voltageOfNet(n) >= high ? 1 : 0;
        const digitLevel = (n: number) => this.voltageOfNet(n) >= high ? 1 : 0;
        const com = nets.colon
          ? (this.voltageOfNet(nets.colon.com) >= high ? 1 : 0)
          : undefined;
        const cln = nets.colon
          ? (this.voltageOfNet(nets.colon.cln) >= high ? 1 : 0)
          : undefined;
        controller.update(
          nets.digits.map((n) => digitLevel(n)),
          nets.segments.map((n) => segmentLevel(n)),
          com,
          cln,
          this.timeMs,
        );
      } else {
        // LCD (HD44780) handling via createController controllers is I2C/SPI;
        // the HD44780 receive path needs rising-edge detection on enable.
        const nets = this.lcdNets(partId);
        if (!nets) continue;
        const strobe = this.voltageOfNet(nets.enable) >= high;
        if (!strobe) {
          this.lcdStrobe.set(partId, true);
          continue;
        }
        if (!this.lcdStrobe.get(partId)) continue;
        this.lcdStrobe.set(partId, false);
        const value =
          (this.voltageOfNet(nets.d4) >= high ? 0b10000 : 0) |
          (this.voltageOfNet(nets.d5) >= high ? 0b01000 : 0) |
          (this.voltageOfNet(nets.d6) >= high ? 0b00100 : 0) |
          (this.voltageOfNet(nets.d7) >= high ? 0b00010 : 0) |
          (this.voltageOfNet(nets.d0) >= high ? 0b00001 : 0);
        (controller as { receive?: (rs: boolean, value: number) => void }).receive?.(
          this.voltageOfNet(nets.rs) >= high,
          value,
        );
      }
    }
  }

  private lcdStrobe = new Map<string, boolean>();

  private lcdNets(partId: string): { rs: number; enable: number; d0: number; d4: number; d5: number; d6: number; d7: number } | null {
    const net = (pin: string): number => this.pinNodeMap.get(`${partId}:${pin}`) ?? -1;
    const data = [net('D0'), net('D4'), net('D5'), net('D6'), net('D7')];
    if (data.some((n) => n === -1)) return null;
    return { rs: net('RS'), enable: net('E'), d0: data[0], d4: data[1], d5: data[2], d6: data[3], d7: data[4] };
  }

  private sevenSegmentNets(partId: string, digitCount: number): { segments: number[]; digits: number[]; colon: { com: number; cln: number } | null } | null {
    const net = (pin: string): number => this.pinNodeMap.get(`${partId}:${pin}`) ?? -1;
    const hasPin = (pin: string): boolean => this.pinNodeMap.has(`${partId}:${pin}`);
    const segments = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map(net);
    const digitPins = digitCount > 1
      ? Array.from({ length: digitCount }, (_, i) => `DIG${i + 1}`)
      : ['COM.1'];
    const digits = digitPins.map(net);
    const hasSeg = segments.some((n) => n !== -1);
    const hasDig = digits.some((n) => n !== -1);
    if (!hasSeg || !hasDig) return null;
    const colon = digitCount === 4 && hasPin('COM') && hasPin('CLN')
      ? { com: net('COM'), cln: net('CLN') }
      : null;
    return { segments, digits, colon };
  }

  async settle(): Promise<void> {
    await this.step(1e-5 * 1000);
  }

  writeDigital(gpio: number, level: boolean): void {
    if (!this.module || this.handle === 0) return;
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (!pinId) return;
    const mcuPart = this.bench.parts.find((p) => p.definition.component.kind === 'mcu');
    if (!mcuPart) return;
    this.module.engine_set_pin(this.handle, allocString(this.module, mcuPart.id), allocString(this.module, pinId), level ? 1 : 0);
  }

  turnKnob(partId: string, knob: string, value: number): void {
    if (!this.module || this.handle === 0) return;
    this.module.engine_set_knob(this.handle, allocString(this.module, partId), allocString(this.module, knob), value);
  }
  pressButton(partId: string, pressed: boolean): void {
    if (pressed) this.pressed.add(partId);
    else this.pressed.delete(partId);
  }

  setMeterMode(_mode: unknown): void {
    // Meter loading is host-side; tracked for future wiring.
  }

  getVoltages(): Float64Array {
    return this.voltages;
  }

  getPartStates(): unknown[] {
    if (!this.module || this.handle === 0) return [];
    const mod = this.module;
    const countPtr = mod.wasm_alloc(4);
    const ptr = mod.engine_get_state(this.handle, countPtr);
    const count = new Int32Array(mod.memory.buffer, countPtr, 1)[0];
    if (ptr === 0 || count <= 0) return [];
    const SIZE = 314; // sizeof(FFIPartStateSnapshot) on wasm32
    const result: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const off = ptr + i * SIZE;
      const dv = new DataView(mod.memory.buffer, off, SIZE);
      const readStr = (base: number, len: number): string => {
        let s = '';
        for (let j = 0; j < len; j++) {
          const c = dv.getUint8(base + j);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s;
      };
      const readArr8 = (base: number, len: number): number[] => {
        const arr: number[] = [];
        for (let j = 0; j < len; j++) arr.push(dv.getUint8(base + j));
        return arr;
      };
      const readArr16 = (base: number, len: number): number[] => {
        const arr: number[] = [];
        for (let j = 0; j < len; j++) arr.push(dv.getUint16(base + j * 2, true));
        return arr;
      };
      result.push({
        partId: readStr(0, 64),
        kind: readStr(64, 32),
        framebuffer: dv.getUint32(96, true),
        framebuffer_size: dv.getUint32(100, true),
        width: dv.getUint16(104, true),
        height: dv.getUint16(106, true),
        servo_angle: dv.getUint8(108),
        stepper_angle_deci_deg: dv.getInt16(109, true),
        stepper_driver_outputs: readArr8(111, 4) as [number, number, number, number],
        seven_seg_digits: readArr8(115, 8) as [number, number, number, number, number, number, number, number],
        seven_seg_colon: dv.getUint8(123),
        lcd_chars: readArr8(124, 80),
        lcd_rows: dv.getUint8(204),
        lcd_cols: dv.getUint8(205),
        shift_register_outputs: readArr8(206, 8) as [number, number, number, number, number, number, number, number],
        relay_contacts_closed: dv.getUint8(214) !== 0,
        button_pressed: dv.getUint8(215) !== 0,
        pot_wiper: dv.getFloat64(216, true),
        rfid_card_present: dv.getUint8(224) !== 0,
        thermocouple_temp_quarter_deg: dv.getInt16(225, true),
        pcf8574_output_reg: dv.getUint8(227),
        pcf8574_input_reg: dv.getUint8(228),
        mcp23017_iodira: dv.getUint8(229),
        mcp23017_iodirb: dv.getUint8(230),
        mcp23017_gpioa: dv.getUint8(231),
        mcp23017_gpiob: dv.getUint8(232),
        mcp23017_olata: dv.getUint8(233),
        mcp23017_olatb: dv.getUint8(234),
        ads1115_config: dv.getUint16(235, true),
        ads1115_conversion: dv.getInt16(237, true),
        ads1115_conversion_ready: dv.getUint8(239) !== 0,
        shift595_shift_reg: dv.getUint8(240),
        shift595_storage_reg: dv.getUint8(241),
        shift595_outputs_enabled: dv.getUint8(242) !== 0,
        pcd8544_x: dv.getUint8(243),
        pcd8544_y: dv.getUint8(244),
        pcd8544_vertical: dv.getUint8(245) !== 0,
        pcd8544_extended: dv.getUint8(246) !== 0,
        pcd8544_powerDown: dv.getUint8(247) !== 0,
        pcd8544_blanked: dv.getUint8(248) !== 0,
        pcd8544_inverse: dv.getUint8(249) !== 0,
        pcd8544_vop: dv.getUint8(250),
        mcp4725_value: dv.getUint16(251, true),
        pca9685_duty: readArr16(253, 16),
        pca9685_prescale: dv.getUint8(285),
        rtc_seconds: dv.getUint8(286),
        rtc_minutes: dv.getUint8(287),
        rtc_hours: dv.getUint8(288),
        rtc_day: dv.getUint8(289),
        rtc_date: dv.getUint8(290),
        rtc_month: dv.getUint8(291),
        rtc_year: dv.getUint8(292),
        sensor_temp_milli_c: dv.getInt32(293, true),
        sensor_pressure_pa: dv.getInt32(297, true),
        sensor_lux: dv.getUint32(301, true),
        sensor_humidity_milli_pct: dv.getUint32(305, true),
        max7219_decode_mode: dv.getUint8(309),
        max7219_intensity: dv.getUint8(310),
        max7219_scan_limit: dv.getUint8(311),
        max7219_shutdown: dv.getUint8(312) !== 0,
        max7219_display_test: dv.getUint8(313) !== 0,
      });
    }
    return result;
  }

  getSerialOutput(): string {
    return this.serialOutput;
  }

  getDisplayFramebuffers(): Map<string, unknown> {
    return new Map();
  }

  displayController(partId: string): DisplayController | undefined {
    return this.displays.get(partId);
  }

  // --- Methods for SimCore integration (issue #58) ---

  rebuild(bench: unknown, dynamicState?: unknown): void {
    this.bench = bench as Bench;
    this.dynamicState = (dynamicState as DynamicState) ?? this.dynamicState;
    if (!this.module) return;
    this.pinNodeMap.clear();
    const expanded = expandBench(this.bench, this.dynamicState);
    const mod = this.module;
    const circuitPtr = allocString(mod, JSON.stringify(expanded));
    const sketchPtr = allocString(mod, this.pendingSketch);
    this.handle = mod.engine_create(circuitPtr, sketchPtr);
    if (this.handle === 0) {
      throw new Error('WasmEngine: engine_create failed');
    }
    // Build pinNodeMap from C++ wasm.
    const nodePtr = mod.netlist_node_of_terminal();
    const nodeCount = mod.netlist_node_count();
    if (nodePtr !== 0 && nodeCount > 0) {
      const nodeOfTerminal = new Int32Array(mod.memory.buffer, nodePtr, nodeCount);
      for (const part of this.bench.parts) {
        for (const pinId of Object.keys(part.terminals)) {
          const terminal = part.terminals[pinId];
          if (terminal !== undefined && terminal < nodeCount) {
            this.pinNodeMap.set(`${part.id}:${pinId}`, nodeOfTerminal[terminal]);
          }
        }
      }
    }
    // Display controllers.
    this.displays.clear();
    for (const part of this.bench.parts) {
      const kind = part.definition.component.kind;
      let controller: DisplayController | null = null;
      if (kind === 'tm1637') {
        controller = new Tm1637();
      } else if (kind === '7segment') {
        controller = new SevenSegment(part.definition.component.digits ?? 1);
      } else {
        controller = createController(part.definition);
      }
      if (controller) this.displays.set(part.id, controller);
    }
    this.voltages = new Float64Array(0);
  }

  get currentNetlist(): unknown {
    return null;
  }

  get currentSolution(): unknown {
    return null;
  }

  get supplyRailNet(): number {
    return -1;
  }

  get isFloating(): boolean {
    return false;
  }

  cardReader(_partId: string): unknown {
    return null;
  }

  hasI2cDevice(_address: number): boolean {
    return false;
  }

  i2cDevice(_address: number): unknown {
    return null;
  }

  isOnSpiBus(_partId: string): boolean {
    return false;
  }

  isOnSpiBusAsReader(_partId: string): boolean {
    return false;
  }

  isThermocoupleOnSpiBus(_partId: string): boolean {
    return false;
  }

  netOfTerminal(_terminal: number): number {
    return -1;
  }

  pinCurrentAmps(_partId: string, _pin: string): number {
    return 0;
  }

  pumpServoPulse(_partId: string, _pulseUs: number): void {
    // No-op: C++ engine handles servo pulse internally.
  }

  readPinDigital(_pin: number): boolean {
    return false;
  }

  sdBegin(_partId: string): void {
    // No-op.
  }

  sdBytes(_partId: string): number {
    return 0;
  }

  stepperAngle(_partId: string): number {
    return 0;
  }

  rebuildBus(): void {
    // No-op: C++ engine handles bus internally.
  }

  mapStepperDrivers(): void {
    // No-op: C++ engine handles stepper drivers internally.
  }

  touch(): void {
    // No-op: C++ engine handles state internally.
  }

  netOfMcuPin(pinId: string): number {
    const mcuPart = this.bench.parts.find((p) => p.definition.component.kind === 'mcu');
    if (!mcuPart) return -1;
    return this.pinNodeMap.get(`${mcuPart.id}:${pinId}`) ?? -1;
  }

  readDigital(gpio: number): boolean {
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (pinId === undefined) return false;
    const net = this.netOfMcuPin(pinId);
    if (net === -1) return false;
    const vcc = this.mcu.board.logicVolts / 2;
    return this.voltageOfNet(net) >= vcc;
  }

  writeI2C(_address: number, _byte: number, _isFirst: boolean): boolean {
    return true;
  }

  requestI2C(_address: number, _count: number): number[] {
    return [];
  }

  deliverSpi(_byte: number, _dataSelect: boolean, _chipSelected: boolean): number {
    return 0;
  }

  hasDynamics(): boolean {
    return false;
  }

  skip(_seconds: number): void {
    // No-op.
  }

  servo(partId: string): unknown {
    // Read servo angle from C++ part state snapshot.
    const state = this.getPartStates().find((s: any) => s.partId === partId) as any;
    return state ? { angle: state.servo_angle } : null;
  }

  stepperAngles(): number[] {
    // Read stepper angles from C++ part state snapshots.
    return this.getPartStates()
      .filter((s: any) => s.stepper_angle_deci_deg !== undefined)
      .map((s: any) => s.stepper_angle_deci_deg / 10);
  }

  pixelColors(partId: string): unknown {
    // Read framebuffer from C++ part state snapshot.
    const state = this.getPartStates().find((s: any) => s.partId === partId) as any;
    if (!state || !state.framebuffer) return new Map();
    const mod = this.module;
    if (!mod) return new Map();
    const fb = new Uint8Array(mod.memory.buffer, state.framebuffer, state.framebuffer_size);
    const colors = new Map();
    colors.set('framebuffer', fb);
    colors.set('width', state.width);
    colors.set('height', state.height);
    return colors;
  }

  lcd(partId: string): unknown {
    // Read LCD state from C++ part state snapshot.
    const state = this.getPartStates().find((s: any) => s.partId === partId) as any;
    if (!state) return null;
    return {
      chars: state.lcd_chars,
      rows: state.lcd_rows,
      cols: state.lcd_cols,
    };
  }

  readAnalog(gpio: number): number {
    const pinId = this.mcu.pinIdForGpio(gpio);
    if (pinId === undefined) return 0;
    const net = this.netOfMcuPin(pinId);
    if (net === -1) return 0;
    const volts = this.voltageOfNet(net);
    const vcc = this.mcu.board.logicVolts;
    const clamped = Math.min(vcc, Math.max(0, volts));
    return Math.round((clamped / vcc) * this.adcFullScale());
  }

  setMeter(_meter: unknown): void {
    // No-op.
  }

  get isBeingProbed(): boolean {
    return false;
  }

  recordGpioEdge(_gpio: number, _cycles: number, _high: boolean): void {
    // No-op.
  }

  resampleScripted(): void {
    // No-op.
  }

  sdExists(_path: string): boolean {
    return false;
  }

  sdRead(_path: string): string {
    return '';
  }

  sdWrite(_path: string, _content: string): void {
    // No-op.
  }

  sdRemove(_path: string): void {
    // No-op.
  }

  dialedDigit(partId: string): number {
    const state = this.getPartStates().find((s: any) => s.partId === partId) as any;
    return state?.dialer_digit ?? 0;
  }

  irCode(partId: string): number {
    const state = this.getPartStates().find((s: any) => s.partId === partId) as any;
    return state?.ir_code ?? 0;
  }

  adcFullScale(): number {
    return this.mcu.board.adcBits === 12 ? 4095 : 1023;
  }

  hasI(): boolean {
    return false;
  }

  needsFineSteps(): boolean {
    return false;
  }

  primeLcdEdges(_partId: string): void {
    // No-op.
  }

  setSonarMeasuring(_partId: string, _measuring: boolean): void {
    // No-op.
  }

  setScriptedI(_sampler: unknown): void {
    // No-op.
  }

  setScriptedSampler(_sampler: unknown): void {
    // No-op.
  }

  setPixel(_partId: string, _index: number, _color: unknown): void {
    // No-op.
  }

  endSpiTransfer(): void {
    // No-op.
  }

  setBreakpoint(pc: number): void {
    if (!this.module || this.handle === 0) return;
    this.module.engine_set_breakpoint(this.handle, pc);
  }

  continue(): void {
    if (!this.module || this.handle === 0) return;
    this.module.engine_continue(this.handle);
  }

  stepOver(): void {
    if (!this.module || this.handle === 0) return;
    this.module.engine_set_step_over(this.handle, 1);
  }

  stepInto(): void {
    if (!this.module || this.handle === 0) return;
    this.module.engine_set_step_into(this.handle, 1);
  }

  getDebugState(): unknown {
    if (!this.module || this.handle === 0) return null;
    const ptr = this.module.engine_get_debug_state(this.handle);
    if (ptr === 0) return null;
    const s = readCString(this.module, ptr);
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }

  destroy(): void {
    if (this.module && this.handle !== 0) {
      this.module.engine_destroy(this.handle);
      this.handle = 0;
    }
    this.module = null;
  }
}

function allocString(mod: FfiExports, s: string): number {
  const bytes = new TextEncoder().encode(s + '\0');
  const ptr = mod.wasm_alloc(bytes.length);
  new Uint8Array(mod.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function readCString(mod: FfiExports, ptr: number): string {
  if (ptr === 0) return '';
  const mem = new Uint8Array(mod.memory.buffer);
  let end = ptr;
  while (mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.slice(ptr, end));
}

class StringTable {
  private bytes: number[] = [0];
  private offsets = new Map<string, number>();
  intern(value: string | undefined | null): number {
    if (!value) return 0;
    const existing = this.offsets.get(value);
    if (existing !== undefined) return existing;
    const offset = this.bytes.length;
    for (const byte of new TextEncoder().encode(value)) this.bytes.push(byte);
    this.bytes.push(0);
    this.offsets.set(value, offset);
    return offset;
  }
  finish(): string {
    return String.fromCharCode(...this.bytes);
  }
}

function expandBench(bench: Bench, state: DynamicState): Record<string, unknown> {
  const strings = new StringTable();
  const pins: { terminal: number; nameOffset: number; netOffset: number }[] = [];
  const knobs: { value: number; min: number; max: number; nameOffset: number }[] = [];
  const parts: {
    kind: number;
    firstPin: number;
    pinCount: number;
    firstKnob: number;
    knobCount: number;
    flags: number;
    params: number[];
    scripted: number;
  }[] = [];
  const wires: { from: number; to: number; idOffset: number; gaugeAwg: number; lengthMm: number }[] = [];
  const ground: number[] = [];

  for (const part of bench.parts) {
    const firstPin = pins.length;
    const firstKnob = knobs.length;
    const component = part.definition.component;
    const pinSpecs = new Map<string, { net?: string }>(
      part.definition.pins.map((pin): [string, { net?: string }] => [pin.id, pin]),
    );

    for (const pinId of Object.keys(part.terminals)) {
      const terminal = part.terminals[pinId];
      const spec = pinSpecs.get(pinId);
      pins.push({
        terminal,
        nameOffset: strings.intern(pinId),
        netOffset: strings.intern(spec?.net),
      });
    }

    for (const knob of part.definition.knobs ?? []) {
      knobs.push({
        value: state.knob(part.id, knob),
        min: knob.min,
        max: knob.max,
        nameOffset: strings.intern(knob.id),
      });
    }

    let flags = 0;
    if (state.isPressed(part.id)) flags |= 1;
    parts.push({
      kind: COMPONENT_KIND[component.kind],
      firstPin,
      pinCount: pins.length - firstPin,
      firstKnob,
      knobCount: knobs.length - firstKnob,
      flags,
      params: paramsFor(component, () => 0),
      scripted: 0,
    });

    if (component.kind === 'mcu') {
      for (const pin of part.definition.boardPins ?? []) {
        if (pin.role !== 'ground') continue;
        const terminal = part.terminals[pin.id];
        if (terminal !== undefined) ground.push(terminal);
      }
    }
  }

  for (const wire of bench.wires) {
    wires.push({
      from: wire.from,
      to: wire.to,
      idOffset: strings.intern(wire.id),
      gaugeAwg: wire.gaugeAwg,
      lengthMm: wire.lengthMm,
    });
  }

  const keyLabels = KEYPAD_KEYS.map((key) => strings.intern(key));

  // pinNode: terminal -> node index (from TS buildNetlist, computed separately).
  // We don't have it here; pass an empty-ish map. The C++ engine uses pin_node
  // from the circuit JSON; if absent, pin stamping is skipped.
  const tsNetlist = buildNetlist(bench, state);
  const pinNodeArr: number[] = new Array(bench.terminals.length).fill(-1);
  for (const [key, node] of tsNetlist.pinNode) {
    // key is "partId:pinId"; resolve to terminal via bench
    const [partId, pinId] = key.split(':');
    const part = bench.parts.find((p) => p.id === partId);
    if (part && part.terminals[pinId] !== undefined) {
      pinNodeArr[part.terminals[pinId]] = node;
    }
  }

  // pinTerminals: "partId:pinId" -> terminal index
  const pinTerminals: Record<string, number> = {};
  for (const part of bench.parts) {
    for (const pinId of Object.keys(part.terminals)) {
      pinTerminals[`${part.id}:${pinId}`] = part.terminals[pinId];
    }
  }

  // knobMap: "partId:knobId" -> knob index (flat)
  const knobMap: Record<string, number> = {};
  let knobIndex = 0;
  for (const part of bench.parts) {
    for (const knob of part.definition.knobs ?? []) {
      knobMap[`${part.id}:${knob.id}`] = knobIndex++;
    }
  }

  const supplyNode = -1;

  return {
    terminals: bench.terminals.map((t) => ({ x: t.x, y: t.y })),
    parts: parts.map((p) => ({
      kind: p.kind,
      first_pin: p.firstPin,
      pin_count: p.pinCount,
      first_knob: p.firstKnob,
      knob_count: p.knobCount,
      flags: p.flags,
      params: p.params,
      scripted: p.scripted,
    })),
    pins: pins.map((p) => ({
      terminal: p.terminal,
      name_offset: p.nameOffset,
      net_offset: p.netOffset,
    })),
    knobs: knobs.map((k) => ({
      value: k.value,
      min: k.min,
      max: k.max,
      name_offset: k.nameOffset,
    })),
    wires: wires.map((w) => ({
      from: w.from,
      to: w.to,
      id_offset: w.idOffset,
      gauge_awg: w.gaugeAwg,
      length_mm: w.lengthMm,
    })),
    groundTerminals: ground,
    keyLabels: keyLabels,
    strings: strings.finish(),
    irTransmitting: 0,
    redProfile: 0,
    greenProfile: 0,
    blueProfile: 0,
    pinNode: pinNodeArr,
    pinTerminals,
    knobMap,
    supplyNode,
  };
}

export function isWasmDefault(): boolean {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const v = env?.WASM_DEFAULT;
  return v === '1' || v === 'true';
}
