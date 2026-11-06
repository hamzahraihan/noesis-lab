/**
 * Adapter registry for the differential harness.
 *
 * Maps part kind strings to their adapters. Import this to get the ADAPTERS map.
 */
import { pcf8574Adapter } from './pcf8574';
import { mcp23017Adapter } from './mcp23017';
import { ads1115Adapter } from './ads1115';
import { shift595Adapter } from './shift595';
import { pcd8544Adapter } from './pcd8544';
import { servoAdapter } from './servo';
import { stepperAdapter } from './stepper';
import { a4988Adapter } from './a4988';
import { ssd1306Adapter } from './ssd1306';
import { ili9341Adapter } from './ili9341';
import { max7219Adapter } from './max7219';
import { hd44780Adapter } from './hd44780';
import { bh1750Adapter } from './bh1750';
import { bmp180Adapter } from './bmp180';
import { sht31Adapter } from './sht31';
import { eeprom24lc256Adapter } from './eeprom24lc256';
import { pca9685Adapter } from './pca9685';
import { mcp4725Adapter } from './mcp4725';
import { max6675Adapter } from './max6675';
import { sonarAdapter } from './sonar';
import { dhtAdapter } from './dht';
import { ds18b20Adapter } from './ds18b20';
import { neopixelAdapter } from './neopixel';
import { scriptedAdapter } from './scripted';
import { dialerAdapter } from './dialer';
import { remoteAdapter } from './remote';
import { sdcardAdapter } from './sdcard';
import type { PartAdapter } from '../probe';

export const ADAPTERS: Record<string, PartAdapter> = {
  pcf8574: pcf8574Adapter,
  mcp23017: mcp23017Adapter,
  ads1115: ads1115Adapter,
  shift595: shift595Adapter,
  pcd8544: pcd8544Adapter,
  servo: servoAdapter,
  stepper: stepperAdapter,
  a4988: a4988Adapter,
  ssd1306: ssd1306Adapter,
  ili9341: ili9341Adapter,
  max7219: max7219Adapter,
  hd44780: hd44780Adapter,
  bh1750: bh1750Adapter,
  bmp180: bmp180Adapter,
  sht31: sht31Adapter,
  eeprom24lc256: eeprom24lc256Adapter,
  pca9685: pca9685Adapter,
  mcp4725: mcp4725Adapter,
  max6675: max6675Adapter,
  sonar: sonarAdapter,
  dht: dhtAdapter,
  ds18b20: ds18b20Adapter,
  neopixel: neopixelAdapter,
  scripted: scriptedAdapter,
  dialer: dialerAdapter,
  remote: remoteAdapter,
  sdcard: sdcardAdapter,
};

export * from './pcf8574';
export * from './mcp23017';
export * from './ads1115';
export * from './shift595';
export * from './pcd8544';
export * from './servo';
export * from './stepper';
export * from './a4988';
export * from './ssd1306';
export * from './ili9341';
export * from './max7219';
export * from './hd44780';
export * from './pca9685';
export * from './mcp4725';
export * from './max6675';
export * from './sonar';
export * from './dht';
export * from './ds18b20';
export * from './neopixel';
export * from './scripted';
export * from './dialer';
export * from './remote';
export * from './sdcard';