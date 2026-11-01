import { parseCircuit } from '@/features/simulation';
import type { CircuitDocument } from '@/features/simulation';

import circuitA4988 from '../circuits/a4988.json';
import circuitAlarmClock from '../circuits/alarm-clock.json';
import circuitDashboard from '../circuits/dashboard.json';
import circuitDs3231 from '../circuits/ds3231.json';
import circuitEeprom24lc256 from '../circuits/eeprom24lc256.json';
import circuitEnvironmentBench from '../circuits/environment-bench.json';
import circuitEsp32Tft from '../circuits/esp32-tft.json';
import circuitExpanderInterrupt from '../circuits/expander-interrupt.json';
import circuitInstrumentBench from '../circuits/instrument-bench.json';
import circuitMax6675 from '../circuits/max6675.json';
import circuitMax7219 from '../circuits/max7219.json';
import circuitMcp23017 from '../circuits/mcp23017.json';
import circuitMcp4725 from '../circuits/mcp4725.json';
import circuitMfrc522 from '../circuits/mfrc522.json';
import circuitNokia5110 from '../circuits/nokia-5110.json';
import circuitParking from '../circuits/parking.json';
import circuitPca9685 from '../circuits/pca9685.json';
import circuitPcf8574 from '../circuits/pcf8574.json';
import circuitReaction from '../circuits/reaction.json';
import circuitSafe from '../circuits/safe.json';
import circuitShiftRegister from '../circuits/shift-register.json';
import circuitSoilProbe from '../circuits/soil-probe.json';
import circuitTm1637 from '../circuits/tm1637.json';
import circuitWeather from '../circuits/weather.json';

export const CIRCUITS: Readonly<Record<string, CircuitDocument>> = {
  "a4988": parseCircuit(circuitA4988, "a4988"),
  "alarm-clock": parseCircuit(circuitAlarmClock, "alarm-clock"),
  "dashboard": parseCircuit(circuitDashboard, "dashboard"),
  "ds3231": parseCircuit(circuitDs3231, "ds3231"),
  "eeprom24lc256": parseCircuit(circuitEeprom24lc256, "eeprom24lc256"),
  "environment-bench": parseCircuit(circuitEnvironmentBench, "environment-bench"),
  "esp32-tft": parseCircuit(circuitEsp32Tft, "esp32-tft"),
  "expander-interrupt": parseCircuit(circuitExpanderInterrupt, "expander-interrupt"),
  "instrument-bench": parseCircuit(circuitInstrumentBench, "instrument-bench"),
  "max6675": parseCircuit(circuitMax6675, "max6675"),
  "max7219": parseCircuit(circuitMax7219, "max7219"),
  "mcp23017": parseCircuit(circuitMcp23017, "mcp23017"),
  "mcp4725": parseCircuit(circuitMcp4725, "mcp4725"),
  "mfrc522": parseCircuit(circuitMfrc522, "mfrc522"),
  "nokia-5110": parseCircuit(circuitNokia5110, "nokia-5110"),
  "parking": parseCircuit(circuitParking, "parking"),
  "pca9685": parseCircuit(circuitPca9685, "pca9685"),
  "pcf8574": parseCircuit(circuitPcf8574, "pcf8574"),
  "reaction": parseCircuit(circuitReaction, "reaction"),
  "safe": parseCircuit(circuitSafe, "safe"),
  "shift-register": parseCircuit(circuitShiftRegister, "shift-register"),
  "soil-probe": parseCircuit(circuitSoilProbe, "soil-probe"),
  "tm1637": parseCircuit(circuitTm1637, "tm1637"),
  "weather": parseCircuit(circuitWeather, "weather"),
};
