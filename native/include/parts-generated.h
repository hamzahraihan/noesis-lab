// Generated from native/abi/part-state.schema.json — DO NOT EDIT
#pragma once
#include <cstdint>
#include <cstddef>

#pragma pack(push, 1)

// Part state snapshot header
struct PartStateSnapshotHeader {
    uint32_t version;
    uint32_t partCount;
};

// Per-part data structures
struct Shift595Snapshot {
    uint32_t outputRegister;
    uint32_t shiftRegister;
};

struct PCF8574Snapshot {
    uint32_t outputLatch;
    uint32_t inputPort;
};

struct MCP23017Snapshot {
    uint32_t iodirA;
    uint32_t iodirB;
    uint32_t gpioA;
    uint32_t gpioB;
    uint32_t olatA;
    uint32_t olatB;
    uint32_t intcapA;
    uint32_t intcapB;
    uint32_t intfA;
    uint32_t intfB;
    uint32_t intconA;
    uint32_t intconB;
    uint32_t gppuA;
    uint32_t gppuB;
};

struct ADS1115Snapshot {
    uint32_t config;
    uint32_t conversion;
};

struct Max7219Snapshot {
    uint32_t digitRegisters[8];
    uint32_t decodeMode;
    uint32_t intensity;
    uint32_t scanLimit;
    bool shutdown;
    bool displayTest;
};

struct PCD8544Snapshot {
    uint32_t displayMemory[504];
    uint32_t cursorX;
    uint32_t cursorY;
    uint32_t functionSet;
    uint32_t displayControl;
    uint32_t tempCoeff;
    uint32_t bias;
    uint32_t vop;
};

struct TM1637Snapshot {
    uint32_t segments[4];
    uint32_t brightness;
    bool colon;
};

struct StepperSnapshot {
    double position;
    double targetPosition;
    double speed;
    double acceleration;
    bool enabled;
    uint32_t direction;
    uint32_t microstep;
};

struct Max6675Snapshot {
    uint32_t temperatureQuarterDeg;
};

struct MCP4725Snapshot {
    uint32_t value;
};

struct EEPROM24LC256Snapshot {
    uint32_t* memory;
};

struct DS3231Snapshot {
    uint32_t timeRegisters[7];
    uint32_t statusRegister;
    uint32_t nvram[56];
    uint32_t temperatureQuarterDeg;
};

struct BMP180Snapshot {
    uint32_t calibration;
    uint32_t temperatureCounts;
    uint32_t pressureCounts;
};

struct INA219Snapshot {
    uint32_t calibration;
    uint32_t shuntVoltage;
    uint32_t busVoltage;
    uint32_t current;
    uint32_t power;
};

struct BH1750Snapshot {
    uint32_t mode;
    double lux;
};

struct TMP102Snapshot {
    uint32_t temperatureCounts;
};

struct SHT31Snapshot {
    uint32_t temperatureCounts;
    uint32_t humidityCounts;
    bool crcValid;
};

struct RC522Snapshot {
    uint32_t registers[64];
    uint32_t* fifo;
    bool cardPresent;
    uint32_t cardUid[4];
};

struct PCA9685Snapshot {
    uint32_t mode1;
    uint32_t mode2;
    uint32_t prescale;
    uint32_t leds[16];
};

struct A4988Snapshot {
    double position;
    double targetPosition;
    double speed;
    double acceleration;
    bool enabled;
    uint32_t direction;
    uint32_t microstep;
};

struct ScriptedSnapshot {
    char* scriptId;
    uint32_t state;
};

// Union for variable part data
union PartDataSnapshot {
    Shift595Snapshot shift595;
    PCF8574Snapshot pcf8574;
    MCP23017Snapshot mcp23017;
    ADS1115Snapshot ads1115;
    Max7219Snapshot max7219;
    PCD8544Snapshot pcd8544;
    TM1637Snapshot tm1637;
    StepperSnapshot stepper;
    Max6675Snapshot max6675;
    MCP4725Snapshot mcp4725;
    EEPROM24LC256Snapshot eeprom24lc256;
    DS3231Snapshot ds3231;
    BMP180Snapshot bmp180;
    INA219Snapshot ina219;
    BH1750Snapshot bh1750;
    TMP102Snapshot tmp102;
    SHT31Snapshot sht31;
    RC522Snapshot rc522;
    PCA9685Snapshot pca9685;
    A4988Snapshot a4988;
    ScriptedSnapshot scripted;
};

struct PartStateSnapshot {
    char partId[64];
    char kind[32];
    PartDataSnapshot data;
};

#pragma pack(pop)

// Static assertions for struct sizes
static_assert(sizeof(Shift595Snapshot) > 0, "Shift595Snapshot must have size > 0");
static_assert(sizeof(PCF8574Snapshot) > 0, "PCF8574Snapshot must have size > 0");
static_assert(sizeof(MCP23017Snapshot) > 0, "MCP23017Snapshot must have size > 0");
static_assert(sizeof(ADS1115Snapshot) > 0, "ADS1115Snapshot must have size > 0");
static_assert(sizeof(Max7219Snapshot) > 0, "Max7219Snapshot must have size > 0");
static_assert(sizeof(PCD8544Snapshot) > 0, "PCD8544Snapshot must have size > 0");
static_assert(sizeof(TM1637Snapshot) > 0, "TM1637Snapshot must have size > 0");
static_assert(sizeof(StepperSnapshot) > 0, "StepperSnapshot must have size > 0");
static_assert(sizeof(Max6675Snapshot) > 0, "Max6675Snapshot must have size > 0");
static_assert(sizeof(MCP4725Snapshot) > 0, "MCP4725Snapshot must have size > 0");
static_assert(sizeof(EEPROM24LC256Snapshot) > 0, "EEPROM24LC256Snapshot must have size > 0");
static_assert(sizeof(DS3231Snapshot) > 0, "DS3231Snapshot must have size > 0");
static_assert(sizeof(BMP180Snapshot) > 0, "BMP180Snapshot must have size > 0");
static_assert(sizeof(INA219Snapshot) > 0, "INA219Snapshot must have size > 0");
static_assert(sizeof(BH1750Snapshot) > 0, "BH1750Snapshot must have size > 0");
static_assert(sizeof(TMP102Snapshot) > 0, "TMP102Snapshot must have size > 0");
static_assert(sizeof(SHT31Snapshot) > 0, "SHT31Snapshot must have size > 0");
static_assert(sizeof(RC522Snapshot) > 0, "RC522Snapshot must have size > 0");
static_assert(sizeof(PCA9685Snapshot) > 0, "PCA9685Snapshot must have size > 0");
static_assert(sizeof(A4988Snapshot) > 0, "A4988Snapshot must have size > 0");
static_assert(sizeof(ScriptedSnapshot) > 0, "ScriptedSnapshot must have size > 0");
static_assert(sizeof(PartStateSnapshot) > 0, "PartStateSnapshot must have size > 0");
