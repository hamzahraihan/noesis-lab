import { parseCircuit } from '@/features/simulation';
import type { CircuitDocument } from '@/features/simulation';

import circuit_01 from '../circuits/0.1.json';
import circuit_11 from '../circuits/1.1.json';
import circuit_12 from '../circuits/1.2.json';
import circuit_21 from '../circuits/2.1.json';
import circuit_22 from '../circuits/2.2.json';
import circuit_31 from '../circuits/3.1.json';
import circuit_32 from '../circuits/3.2.json';
import circuit_41 from '../circuits/4.1.json';
import circuit_42 from '../circuits/4.2.json';
import circuit_51 from '../circuits/5.1.json';
import circuit_52 from '../circuits/5.2.json';
import circuitA4988 from '../circuits/a4988.json';
import circuitAdxl335 from '../circuits/adxl335.json';
import circuitAht20 from '../circuits/aht20.json';
import circuitAlarmClock from '../circuits/alarm-clock.json';
import circuitApds9960 from '../circuits/apds9960.json';
import circuitBme280 from '../circuits/bme280.json';
import circuitBme680 from '../circuits/bme680.json';
import circuitBmp280 from '../circuits/bmp280.json';
import circuitBno055 from '../circuits/bno055.json';
import circuitDashboard from '../circuits/dashboard.json';
import circuitDht22 from '../circuits/dht22.json';
import circuitDs3231 from '../circuits/ds3231.json';
import circuitEeprom24lc256 from '../circuits/eeprom24lc256.json';
import circuitEnvironmentBench from '../circuits/environment-bench.json';
import circuitEsp32Tft from '../circuits/esp32-tft.json';
import circuitExpanderInterrupt from '../circuits/expander-interrupt.json';
import circuitInstrumentBench from '../circuits/instrument-bench.json';
import circuitLm35 from '../circuits/lm35.json';
import circuitMax30102 from '../circuits/max30102.json';
import circuitMax6675 from '../circuits/max6675.json';
import circuitMax7219 from '../circuits/max7219.json';
import circuitMcp23017 from '../circuits/mcp23017.json';
import circuitMcp4725 from '../circuits/mcp4725.json';
import circuitMfrc522 from '../circuits/mfrc522.json';
import circuitMlx90614 from '../circuits/mlx90614.json';
import circuitMq2 from '../circuits/mq2.json';
import circuitNokia5110 from '../circuits/nokia-5110.json';
import circuitParking from '../circuits/parking.json';
import circuitPca9685 from '../circuits/pca9685.json';
import circuitPcf8574 from '../circuits/pcf8574.json';
import circuitReaction from '../circuits/reaction.json';
import circuitSafe from '../circuits/safe.json';
import circuitScd40 from '../circuits/scd40.json';
import circuitShiftRegister from '../circuits/shift-register.json';
import circuitSoilMoisture from '../circuits/soil-moisture.json';
import circuitSoilProbe from '../circuits/soil-probe.json';
import circuitTm1637 from '../circuits/tm1637.json';
import circuitVl53l0x from '../circuits/vl53l0x.json';
import circuitWeather from '../circuits/weather.json';

export const CIRCUITS: Readonly<Record<string, CircuitDocument>> = {
  "0.1": parseCircuit(circuit_01, "0.1"),
  "1.1": parseCircuit(circuit_11, "1.1"),
  "1.2": parseCircuit(circuit_12, "1.2"),
  "2.1": parseCircuit(circuit_21, "2.1"),
  "2.2": parseCircuit(circuit_22, "2.2"),
  "3.1": parseCircuit(circuit_31, "3.1"),
  "3.2": parseCircuit(circuit_32, "3.2"),
  "4.1": parseCircuit(circuit_41, "4.1"),
  "4.2": parseCircuit(circuit_42, "4.2"),
  "5.1": parseCircuit(circuit_51, "5.1"),
  "5.2": parseCircuit(circuit_52, "5.2"),
  "a4988": parseCircuit(circuitA4988, "a4988"),
  "adxl335": parseCircuit(circuitAdxl335, "adxl335"),
  "aht20": parseCircuit(circuitAht20, "aht20"),
  "alarm-clock": parseCircuit(circuitAlarmClock, "alarm-clock"),
  "apds9960": parseCircuit(circuitApds9960, "apds9960"),
  "bme280": parseCircuit(circuitBme280, "bme280"),
  "bme680": parseCircuit(circuitBme680, "bme680"),
  "bmp280": parseCircuit(circuitBmp280, "bmp280"),
  "bno055": parseCircuit(circuitBno055, "bno055"),
  "dashboard": parseCircuit(circuitDashboard, "dashboard"),
  "dht22": parseCircuit(circuitDht22, "dht22"),
  "ds3231": parseCircuit(circuitDs3231, "ds3231"),
  "eeprom24lc256": parseCircuit(circuitEeprom24lc256, "eeprom24lc256"),
  "environment-bench": parseCircuit(circuitEnvironmentBench, "environment-bench"),
  "esp32-tft": parseCircuit(circuitEsp32Tft, "esp32-tft"),
  "expander-interrupt": parseCircuit(circuitExpanderInterrupt, "expander-interrupt"),
  "instrument-bench": parseCircuit(circuitInstrumentBench, "instrument-bench"),
  "lm35": parseCircuit(circuitLm35, "lm35"),
  "max30102": parseCircuit(circuitMax30102, "max30102"),
  "max6675": parseCircuit(circuitMax6675, "max6675"),
  "max7219": parseCircuit(circuitMax7219, "max7219"),
  "mcp23017": parseCircuit(circuitMcp23017, "mcp23017"),
  "mcp4725": parseCircuit(circuitMcp4725, "mcp4725"),
  "mfrc522": parseCircuit(circuitMfrc522, "mfrc522"),
  "mlx90614": parseCircuit(circuitMlx90614, "mlx90614"),
  "mq2": parseCircuit(circuitMq2, "mq2"),
  "nokia-5110": parseCircuit(circuitNokia5110, "nokia-5110"),
  "parking": parseCircuit(circuitParking, "parking"),
  "pca9685": parseCircuit(circuitPca9685, "pca9685"),
  "pcf8574": parseCircuit(circuitPcf8574, "pcf8574"),
  "reaction": parseCircuit(circuitReaction, "reaction"),
  "safe": parseCircuit(circuitSafe, "safe"),
  "scd40": parseCircuit(circuitScd40, "scd40"),
  "shift-register": parseCircuit(circuitShiftRegister, "shift-register"),
  "soil-moisture": parseCircuit(circuitSoilMoisture, "soil-moisture"),
  "soil-probe": parseCircuit(circuitSoilProbe, "soil-probe"),
  "tm1637": parseCircuit(circuitTm1637, "tm1637"),
  "vl53l0x": parseCircuit(circuitVl53l0x, "vl53l0x"),
  "weather": parseCircuit(circuitWeather, "weather"),
};
