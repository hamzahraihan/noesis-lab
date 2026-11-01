// Generated from native/abi/part-state.schema.json — DO NOT EDIT

export interface PartStateSnapshotHeader {
  version: number;
  partCount: number;
}

export interface Shift595Snapshot {
  outputRegister: number;
  shiftRegister: number;
}

export interface PCF8574Snapshot {
  outputLatch: number;
  inputPort: number;
}

export interface MCP23017Snapshot {
  iodirA: number;
  iodirB: number;
  gpioA: number;
  gpioB: number;
  olatA: number;
  olatB: number;
  intcapA: number;
  intcapB: number;
  intfA: number;
  intfB: number;
  intconA: number;
  intconB: number;
  gppuA: number;
  gppuB: number;
}

export interface ADS1115Snapshot {
  config: number;
  conversion: number;
}

export interface Max7219Snapshot {
  digitRegisters: [number[], number[], number[], number[], number[], number[], number[], number[]];
  decodeMode: number;
  intensity: number;
  scanLimit: number;
  shutdown: boolean;
  displayTest: boolean;
}

export interface PCD8544Snapshot {
  displayMemory: [number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[]];
  cursorX: number;
  cursorY: number;
  functionSet: number;
  displayControl: number;
  tempCoeff: number;
  bias: number;
  vop: number;
}

export interface TM1637Snapshot {
  segments: [number[], number[], number[], number[]];
  brightness: number;
  colon: boolean;
}

export interface StepperSnapshot {
  position: number;
  targetPosition: number;
  speed: number;
  acceleration: number;
  enabled: boolean;
  direction: number;
  microstep: number;
}

export interface Max6675Snapshot {
  temperatureQuarterDeg: number;
}

export interface MCP4725Snapshot {
  value: number;
}

export interface EEPROM24LC256Snapshot {
  memory: number[];
}

export interface DS3231Snapshot {
  timeRegisters: [number[], number[], number[], number[], number[], number[], number[]];
  statusRegister: number;
  nvram: [number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[]];
  temperatureQuarterDeg: number;
}

export interface BMP180Snapshot {
  calibration: number;
  temperatureCounts: number;
  pressureCounts: number;
}

export interface INA219Snapshot {
  calibration: number;
  shuntVoltage: number;
  busVoltage: number;
  current: number;
  power: number;
}

export interface BH1750Snapshot {
  mode: number;
  lux: number;
}

export interface TMP102Snapshot {
  temperatureCounts: number;
}

export interface SHT31Snapshot {
  temperatureCounts: number;
  humidityCounts: number;
  crcValid: boolean;
}

export interface RC522Snapshot {
  registers: [number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[]];
  fifo: number[];
  cardPresent: boolean;
  cardUid: [number[], number[], number[], number[]];
}

export interface PCA9685Snapshot {
  mode1: number;
  mode2: number;
  prescale: number;
  leds: [number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[], number[]];
}

export interface A4988Snapshot {
  position: number;
  targetPosition: number;
  speed: number;
  acceleration: number;
  enabled: boolean;
  direction: number;
  microstep: number;
}

export interface ScriptedSnapshot {
  scriptId: string;
  state: number;
}


export type PartDataSnapshot =
  | { kind: 'shift595'; data: Shift595Snapshot }
  | { kind: 'pcf8574'; data: PCF8574Snapshot }
  | { kind: 'mcp23017'; data: MCP23017Snapshot }
  | { kind: 'ads1115'; data: ADS1115Snapshot }
  | { kind: 'max7219'; data: Max7219Snapshot }
  | { kind: 'pcd8544'; data: PCD8544Snapshot }
  | { kind: 'tm1637'; data: TM1637Snapshot }
  | { kind: 'stepper'; data: StepperSnapshot }
  | { kind: 'max6675'; data: Max6675Snapshot }
  | { kind: 'mcp4725'; data: MCP4725Snapshot }
  | { kind: 'eeprom24lc256'; data: EEPROM24LC256Snapshot }
  | { kind: 'ds3231'; data: DS3231Snapshot }
  | { kind: 'bmp180'; data: BMP180Snapshot }
  | { kind: 'ina219'; data: INA219Snapshot }
  | { kind: 'bh1750'; data: BH1750Snapshot }
  | { kind: 'tmp102'; data: TMP102Snapshot }
  | { kind: 'sht31'; data: SHT31Snapshot }
  | { kind: 'rc522'; data: RC522Snapshot }
  | { kind: 'pca9685'; data: PCA9685Snapshot }
  | { kind: 'a4988'; data: A4988Snapshot }
  | { kind: 'scripted'; data: ScriptedSnapshot };

export interface PartStateSnapshot {
  partId: string;
  kind: string;
  data: PartDataSnapshot;
}

export interface PartStateSnapshotResponse {
  header: PartStateSnapshotHeader;
  parts: PartStateSnapshot[];
}
