export const GALLERY_PROJECT_IDS = ["alarm-clock","safe","dashboard","parking","weather","shift-register","rfid","tm1637","a4988","microstep","pcf8574","mcp23017","expander-interrupt","pca9685","ds3231","max6675","mcp4725","eeprom24lc256","max7219","nokia-5110","reaction","net-clock","sensor-feed","net-weather","live-weather","soil-probe","instrument-bench","environment-bench","bmp280","lm35","vl53l0x","bme280","soil-moisture","aht20","scd40","max30102","bme680","apds9960","bno055","adxl335","mq2","dht22","mlx90614","adxl345","hmc5883l","tsl2561","ccs811"] as const;
export type GalleryProjectId = typeof GALLERY_PROJECT_IDS[number];
export const GALLERY_BUILD_LABELS = ["alarm-clock@uno","alarm-clock@uno:library","safe@uno","dashboard@uno","parking@uno","weather@uno","shift-register@uno","rfid@uno","tm1637@uno","a4988@uno","microstep@uno","pcf8574@uno","mcp23017@uno","expander-interrupt@uno","pca9685@uno","ds3231@uno","max6675@uno","mcp4725@uno","eeprom24lc256@uno","max7219@uno","nokia-5110@uno","reaction@uno","net-clock@esp32","sensor-feed@esp32","net-weather@esp32","live-weather@esp32","soil-probe@uno","instrument-bench@uno","environment-bench@uno","bmp280@uno","lm35@uno","vl53l0x@uno","bme280@uno","soil-moisture@uno","aht20@uno","scd40@uno","max30102@uno","bme680@uno","apds9960@uno","bno055@uno","adxl335@uno","mq2@uno","dht22@uno","mlx90614@uno","adxl345@uno","hmc5883l@uno","tsl2561@uno","ccs811@uno"] as const;
export const NETWORK_PROJECT_IDS = ["net-clock","sensor-feed","net-weather","live-weather"] as const;
export const NEW_PART_PROJECT_IDS = ["ds3231","mcp23017","expander-interrupt","pca9685","microstep","environment-bench"] as const;
export const WIRE_FLOORS: Record<GalleryProjectId, number> = {
  "alarm-clock": 25,
  "safe": 14,
  "dashboard": 14,
  "parking": 15,
  "weather": 12,
  "shift-register": 1,
  "rfid": 1,
  "tm1637": 1,
  "a4988": 1,
  "microstep": 1,
  "pcf8574": 1,
  "mcp23017": 1,
  "expander-interrupt": 1,
  "pca9685": 1,
  "ds3231": 1,
  "max6675": 1,
  "mcp4725": 1,
  "eeprom24lc256": 1,
  "max7219": 1,
  "nokia-5110": 1,
  "reaction": 5,
  "net-clock": 6,
  "sensor-feed": 6,
  "net-weather": 6,
  "live-weather": 1,
  "soil-probe": 3,
  "instrument-bench": 1,
  "environment-bench": 1,
  "bmp280": 1,
  "lm35": 1,
  "vl53l0x": 1,
  "bme280": 1,
  "soil-moisture": 1,
  "aht20": 1,
  "scd40": 1,
  "max30102": 1,
  "bme680": 1,
  "apds9960": 1,
  "bno055": 1,
  "adxl335": 1,
  "mq2": 1,
  "dht22": 1,
  "mlx90614": 1,
  "adxl345": 1,
  "hmc5883l": 1,
  "tsl2561": 1,
  "ccs811": 1,
} as const;

export function wireFloorFor(projectId: GalleryProjectId): number {
  return WIRE_FLOORS[projectId] ?? 1;
}
