//! ESP32-S2 peripherals. The IP shared with other chips lives in `esp-periph`; here are the
//! S2 blocks (interrupt matrix, PCNT, GP-SPI, EXTMEM) and the `Peripherals` set whose one table
//! drives dispatch, sources, ticks and deadlines.
//!
//! S2 address map: registers are modelled at the PeriBus2 bases (0x6000_0000); the PeriBus1
//! window (0x3F40_0000) holds the same layout and the bus aliases it before it gets here, except
//! SYSTEM/PMS/INTERRUPT/DMA_COPY, which the TRM restricts to PeriBus1 — they are modelled at the
//! S3-compatible 0x600C_0000 offsets. MMU lives at 0x6180_0000 (EXTMEM), handled by the bus.
use emu_core::{ClockDomain, ClockTree};
use esp_periph::{GpSpi, Ledc, LedcLayout};
use esp_periph::{device_set, mmio, Device, DeviceSet, Dispatch, Misc, WriteEffect};
pub use esp_periph::rmt::RmtDma as Rmt;
pub use esp_periph::{read_desc, reset_cause_name, Aes, DirtyMem, DmaDesc, Efuse, Gpio, I2s, RegRam, RmtTxCh, Rsa, RtcCntl, Sha, SpiMem, SystemRegs, Systimer, Timer, TimerGroup, Uart, UartLayout,
                    APB_HZ, RMT_MEM_WORDS, RST_POWERON, RST_RTCWDT_CPU, RST_RTCWDT_RTC, RST_RTCWDT_SYS, RST_SW_CPU, RST_SW_SYS, RTC_SLOW_HZ, SYSTIMER_HZ, XTAL_HZ};
use std::collections::HashMap;

pub const PERIPH_BASE: u32 = 0x6000_0000;
pub const PERIPH_END: u32 = 0x6180_4000;

// interrupt sources (soc/interrupts.c, release/v5.1; 95 usable sources)
pub const SRC_GPIO: usize = 23;
pub const SRC_UART0: usize = 37;
pub const SRC_UART1: usize = 38;
pub const SRC_SPI2: usize = 33;
pub const SRC_SPI3: usize = 34;
pub const SRC_I2S0: usize = 35;
pub const SRC_LEDC: usize = 45;
pub const SRC_RMT: usize = 50;
pub const SRC_PCNT: usize = 51;
pub const SRC_AES: usize = 56;
pub const SRC_RSA: usize = 54;
pub const SRC_SHA: usize = 55;
pub const SRC_I2C0: usize = 52;
pub const SRC_I2C1: usize = 53;
pub const SRC_TG0_T0: usize = 15;
pub const SRC_TG0_T1: usize = 16;
pub const SRC_TG0_WDT: usize = 17;
pub const SRC_TG1_T0: usize = 19;
pub const SRC_TG1_T1: usize = 20;
pub const SRC_TG1_WDT: usize = 21;
pub const SRC_SYSTIMER_T0: usize = 71;
pub const SRC_SYSTIMER_T1: usize = 72;
pub const SRC_SYSTIMER_T2: usize = 73;
pub const SRC_FROM_CPU0: usize = 28;
pub const SRC_USB: usize = 48;
pub const NUM_SOURCES: usize = 95;

pub const CPU_HZ: u64 = 240_000_000;

// ------------------------------------------------------------------ Interrupt matrix
/// The S2 has a single (PRO) matrix: 95 sources in, 26 map registers out at offsets
/// 0x000..0x17b, live source status at 0x17c/0x180/0x184 and a constant DATE register at 0xffc.
/// `status` is the live source state, refreshed by `Peripherals::pre_access` before a read.
pub struct IntMatrix { pub map: [[u32; NUM_SOURCES]; 1], ram: RegRam, pub status: [u32; 3] }
impl Default for IntMatrix { fn default() -> Self { Self::new() } }

impl IntMatrix {
    pub fn new() -> Self { IntMatrix { map: [[6; NUM_SOURCES]; 1], ram: RegRam::new(), status: [0; 3] } }
    pub fn read(&self, off: u32) -> u32 {
        let o = off & !3;
        let idx = (o >> 2) as usize;
        if idx < NUM_SOURCES { return self.map[0][idx]; }
        match o { 0x17c => self.status[0], 0x180 => self.status[1], 0x184 => self.status[2], 0x188 => 1, 0xffc => 0x1904180, _ => self.ram.read(off) }
    }
    pub fn write(&mut self, off: u32, v: u32) {
        let o = off & !3;
        let idx = (o >> 2) as usize;
        if idx < NUM_SOURCES { self.map[0][idx] = v & 0x1f; } else { self.ram.write(off, v); }
    }
}
// ------------------------------------------------------------------ PCNT (pulse counter)
/// Four units, two channels each: a signal input counts on rising/falling edges (mode 0 ignore,
/// 1 increment, 2 decrement) and a control input modifies that (hctrl/lctrl mode 0 keep, 1 invert,
/// 2 disable). Inputs arrive through the GPIO matrix (signals 33 + 4*unit .. 36 + 4*unit).
/// Counters are 16-bit signed; high/low limits, thresholds and zero crossings raise the unit's interrupt.
pub struct Pcnt { pub conf: [[u32; 3]; 4], pub cnt: [i16; 4], pub status: [u32; 4], pub int_raw: u32, pub int_ena: u32, pub ctrl: u32, ram: RegRam, pub events: u64 }
impl Default for Pcnt { fn default() -> Self { Self::new() } }

impl Pcnt {
    pub fn new() -> Self { Pcnt { conf: [[0; 3]; 4], cnt: [0; 4], status: [0; 4], int_raw: 0, int_ena: 0, ctrl: 0, ram: RegRam::new(), events: 0 } }
    pub fn irq(&self) -> bool { self.int_raw & self.int_ena != 0 }
    pub fn read(&self, off: u32) -> u32 {
        match off {
            0x00..=0x2c => { let u = (off / 12) as usize; self.conf[u][((off % 12) / 4) as usize] }
            0x30..=0x3c => self.cnt[((off - 0x30) / 4) as usize] as u16 as u32,
            0x40 => self.int_raw, 0x44 => self.int_raw & self.int_ena, 0x48 => self.int_ena,
            0x50..=0x5c => self.status[((off - 0x50) / 4) as usize],
            0x60 => self.ctrl, 0xfc => 0x1912_0400,
            _ => self.ram.read(off),
        }
    }
    pub fn write(&mut self, off: u32, v: u32) {
        match off {
            0x00..=0x2c => { let u = (off / 12) as usize; self.conf[u][((off % 12) / 4) as usize] = v; }
            0x48 => self.int_ena = v, 0x4c => self.int_raw &= !v,
            0x60 => { self.ctrl = v; for u in 0..4 { if v & (1 << (2 * u)) != 0 { self.cnt[u] = 0; } } }
            _ => self.ram.write(off, v),
        }
    }
    /// A GPIO input changed: `sig(idx)` gives the level of matrix input signal `idx` (None = not routed).
    pub fn gpio_edge(&mut self, pin: u8, level: bool, sig: &dyn Fn(u32) -> Option<(u8, bool)>) {
        for u in 0..4 {
            if self.ctrl & (1 << (2 * u)) != 0 || self.ctrl & (1 << (2 * u + 1)) != 0 { continue; }   // reset held / paused
            let conf0 = self.conf[u][0];
            for ch in 0..2u32 {
                let Some((sp, _)) = sig(33 + 4 * u as u32 + ch) else { continue };
                if sp != pin { continue; }
                let sh = 16 + 8 * ch;
                let mode = if level { (conf0 >> (sh + 2)) & 3 } else { (conf0 >> sh) & 3 };          // pos_mode / neg_mode
                let mut delta: i32 = match mode { 1 => 1, 2 => -1, _ => 0 };
                if delta != 0 {
                    let ctrl_level = sig(35 + 4 * u as u32 + ch).is_none_or(|(_, l)| l);
                    let cm = if ctrl_level { (conf0 >> (sh + 4)) & 3 } else { (conf0 >> (sh + 6)) & 3 };   // hctrl / lctrl
                    match cm { 1 => delta = -delta, 2 => delta = 0, _ => {} }
                }
                if delta != 0 { self.count(u, delta); }
            }
        }
    }
    fn count(&mut self, u: usize, delta: i32) {
        let conf0 = self.conf[u][0]; let conf1 = self.conf[u][1]; let conf2 = self.conf[u][2];
        let old = self.cnt[u] as i32; let mut new = old + delta;
        let mut ev = 0u32;
        if conf0 & (1 << 12) != 0 && new >= (conf2 & 0xffff) as i16 as i32 { ev |= 1 << 5; new = 0; }         // h_lim
        if conf0 & (1 << 13) != 0 && new <= (conf2 >> 16) as i16 as i32 { ev |= 1 << 4; new = 0; }             // l_lim
        if conf0 & (1 << 14) != 0 && new == (conf1 & 0xffff) as i16 as i32 { ev |= 1 << 3; }                   // thres0
        if conf0 & (1 << 15) != 0 && new == (conf1 >> 16) as i16 as i32 { ev |= 1 << 2; }                      // thres1
        if conf0 & (1 << 11) != 0 && new == 0 && old != 0 { ev |= if delta > 0 { 1 } else { 2 }; }             // zero (mode: 1 from negative, 2 from positive)
        self.cnt[u] = new as i16; self.events += 1;
        if ev != 0 { self.status[u] = ev; self.int_raw |= 1 << u; }
    }
}

// ------------------------------------------------------------------ WDEV block: only the hardware RNG matters to us
/// The S2 keeps the WiFi baseband "WDEV" block; its one software-visible register is the
/// hardware RNG at +0x110 (`WDEV_RND_REG`, IDF `esp32s2/include/soc/wdev_reg.h`). The boot
/// ROM polls it until it reads nonzero, so a zero-returning model hangs the boot. Everything
/// else in the block is register RAM.
pub struct Wdev { state: u64, ram: RegRam }
impl Default for Wdev { fn default() -> Self { Self::new() } }

impl Wdev {
    pub fn new() -> Self { Wdev { state: 0x9E37_79B9_7F4A_7C15, ram: RegRam::new() } }
    pub fn read(&mut self, off: u32) -> u32 {
        match off {
            0x110 => { let mut x = self.state; x ^= x << 13; x ^= x >> 7; x ^= x << 17; self.state = x; (x >> 16) as u32 }   // WDEV_RND_REG (xorshift64)
            _ => self.ram.read(off),
        }
    }
    pub fn write(&mut self, off: u32, v: u32) { self.ram.write(off, v); }
}

// ------------------------------------------------------------------ EXTMEM (cache controller; MMU table lives in the bus)
pub struct Extmem { pub ram: RegRam }
impl Default for Extmem { fn default() -> Self { Self::new() } }

impl Extmem {
    pub fn new() -> Self { Extmem { ram: RegRam::new() } }
    pub fn read(&self, off: u32) -> u32 {
        let v = self.ram.read(off);
        // The boot ROM polls the CTRL registers for the DONE bits after issuing an
        // invalidate; report every operation as complete (the S2 cache is fully modelled
        // by the MMU walk, there is no separate tag state to drain).
        match off {
            0x000 => v | (1 << 25) | (1 << 23) | (1 << 21) | (1 << 19) | (1 << 13) | (1 << 9),   // DCACHE_CTRL: LOCK/UNLOCK/PRELOAD/AUTOLOAD/CLEAN/INVALIDATE DONE
            0x040 => v | (1 << 25) | (1 << 23) | (1 << 21) | (1 << 19) | (1 << 9),               // ICACHE_CTRL: LOCK/UNLOCK/PRELOAD/AUTOLOAD/INVALIDATE DONE
            0x11c => 0x0000_1001,                 // CACHE_STATE: icache FSM idle (bits 11:0) and dcache FSM idle (bits 23:12)
            0x130 => 0x1001,                      // CACHE_SYNC_INT_CTRL: nothing pending
            _ => v,
        }
    }
    pub fn write(&mut self, off: u32, v: u32) { self.ram.write(off, v); }
}

// ------------------------------------------------------------------ S2-only devices as `Device`
impl Device for IntMatrix {
    fn read(&mut self, off: u32) -> u32 { IntMatrix::read(self, off) }
    fn write(&mut self, off: u32, v: u32) -> WriteEffect { IntMatrix::write(self, off, v); WriteEffect::INTMAP }
}
impl Device for Pcnt {
    fn read(&mut self, off: u32) -> u32 { Pcnt::read(self, off) }
    fn write(&mut self, off: u32, v: u32) -> WriteEffect { Pcnt::write(self, off, v); WriteEffect::NONE }
    fn irq_sources(&self) -> u64 { self.irq() as u64 }
}
impl Device for Wdev {
    fn read(&mut self, off: u32) -> u32 { Wdev::read(self, off) }
    fn write(&mut self, off: u32, v: u32) -> WriteEffect { Wdev::write(self, off, v); WriteEffect::NONE }
}
impl Device for Extmem {
    fn read(&mut self, off: u32) -> u32 { Extmem::read(self, off) }
    fn write(&mut self, off: u32, v: u32) -> WriteEffect { Extmem::write(self, off, v); WriteEffect::NONE }
}
// ------------------------------------------------------------------ all together
pub struct Peripherals {
    pub uart: [Uart; 2],
    pub systimer: Systimer,
    pub timg: [TimerGroup; 2],
    pub intmatrix: IntMatrix,
    pub gpio: Gpio,
    pub rtc: RtcCntl,
    pub efuse: Efuse,
    pub system: SystemRegs,
    pub extmem: Extmem,
    pub spi0: SpiMem,
    pub spi1: SpiMem,
    pub i2c: [crate::i2c::I2c; 2],
    pub spi2: GpSpi,
    pub spi3: GpSpi,
    pub pcnt: Pcnt,
    pub aes: Aes,
    pub rsa: Rsa,
    pub sha: Sha,
    pub i2s0: I2s,
    pub rmt: Rmt,
    pub wdev: Wdev,
    pub io_mux: RegRam,
    /// register RAM behind unmodelled blocks, first-touch logging, pc attribution
    pub misc: Misc,
    /// experiment hook: ESP_EMU_FAKE_READ=addr:or[:and],... applied to register reads
    pub fake_reads: HashMap<u32, (u32, u32)>,
    clock: ClockTree<4>,
    pub spi_exec: bool,       // SPI1 command pending execution against the flash array
    last_status: [u32; 4],
    pub intmatrix_dirty: bool,
    pub ledc: Ledc,
}

// Every peripheral, where it sits, and its interrupt source numbers. Entries for one block are
// tried in order: a range-limited entry goes before the full-block one behind it.
device_set! { Peripherals; clock: (clock) CPU_HZ, [(ClockDomain::Systimer, 15), (ClockDomain::Apb, 3), (ClockDomain::RtcSlow, 1600), (ClockDomain::Cpu, 1)];
    0x00 "UART0" (uart[0]) => [SRC_UART0];
    0x10 "UART1" (uart[1]) => [SRC_UART1];
    0x23 "SYSTIMER" (systimer) => [SRC_SYSTIMER_T0, SRC_SYSTIMER_T1, SRC_SYSTIMER_T2];
    0x1f "TIMG0" (timg[0]) => [SRC_TG0_T0, SRC_TG0_T1];
    0x20 "TIMG1" (timg[1]) => [SRC_TG1_T0, SRC_TG1_T1];
    0x19 "LEDC" optional (ledc) => [SRC_LEDC];
    0xc2 "INTERRUPT" (intmatrix) => [];
    0x04 "GPIO" (gpio) => [SRC_GPIO];
    0x08 "RTC" (rtc) => [];
    0x07 "EFUSE" (efuse) => [];
    0xc0 "SYSTEM" (system) => [SRC_FROM_CPU0, SRC_FROM_CPU0 + 1, SRC_FROM_CPU0 + 2, SRC_FROM_CPU0 + 3];
    0xc4 "EXTMEM" (extmem) => [];
    0x09 "IO_MUX" (io_mux) => [];
    0x02 "SPI1" (spi1) => [];
    0x03 "SPI0" (spi0) => [];
    0x24 "SPI2" (spi2) => [SRC_SPI2];
    0x25 "SPI3" (spi3) => [SRC_SPI3];
    0x0f "I2S0" (i2s0) => [SRC_I2S0];
    0x16 "RMT" (rmt) => [SRC_RMT];
    0x35 "WDEV" (wdev) => [];
    0x13 "I2C0" optional (i2c[0]) => [SRC_I2C0];
    0x27 "I2C1" optional (i2c[1]) => [SRC_I2C1];
    0x17 "PCNT" (pcnt) => [SRC_PCNT];
    0x3a "AES" (aes) => [SRC_AES];
    0x3b "SHA" (sha) => [SRC_SHA];
    0x3c "RSA" (rsa) => [SRC_RSA];
}

impl DeviceSet for Peripherals {
    const BASE: u32 = PERIPH_BASE;
    fn block_name(block: u32) -> &'static str { Peripherals::block_name(block) }
    fn misc(&self) -> &Misc { &self.misc }
    fn misc_mut(&mut self) -> &mut Misc { &mut self.misc }
    /// The three registers whose value depends on another device.
    fn pre_access(&mut self, block: u32, _off: u32, write: bool) {
        match block {
            0xc2 if !write => { let st = self.source_status(); self.intmatrix.status = [st[0], st[1], st[2]]; }   // INTERRUPT_PRO_INTR_STATUS reads the live sources
            0x08 => self.rtc.now_cycles = self.clock.cycles(),                // SENS ADC samples analog sources at this time
            _ => {}
        }
    }
}

impl Peripherals {
    /// CPU cycles since this peripheral set was built.
    pub(crate) fn clock_cycles(&self) -> u64 { self.clock.cycles() }
    pub fn new(mac: [u8; 6]) -> Self {
        Peripherals {
            // The S2's UART and LEDC register maps are the S3-generation maps (the IDF UART layout
            // matches the S3's); the S2 has UART0/1 only and no MCPWM/LCD_CAM/GDMA.
            uart: [Uart::new(UartLayout::S3), Uart::new(UartLayout::S3)], systimer: Systimer::new(),
            timg: [TimerGroup::new(), TimerGroup::new()], intmatrix: IntMatrix::new(), gpio: Gpio::new(), ledc: Ledc::new(LedcLayout::S3), rtc: RtcCntl::new(),
            efuse: Efuse::new(mac), system: SystemRegs::new(0x30), extmem: Extmem::new(), spi0: SpiMem::new(false), spi1: SpiMem::new(true),
            i2c: [crate::i2c::I2c::new(), crate::i2c::I2c::new()], spi2: GpSpi::new(), spi3: GpSpi::new(), pcnt: Pcnt::new(),
            aes: Aes::new(), rsa: Rsa::new(), sha: Sha::new(), i2s0: I2s::new(CPU_HZ), rmt: Rmt::new(CPU_HZ), wdev: Wdev::new(),
            io_mux: RegRam::new(), misc: Misc::new(), fake_reads: std::env::var("ESP_EMU_FAKE_READ").ok().map(|v| v.split(',').filter_map(|e| { let mut p = e.split(':'); let a = u32::from_str_radix(p.next()?.trim_start_matches("0x"), 16).ok()?; let o = u32::from_str_radix(p.next().unwrap_or("0").trim_start_matches("0x"), 16).ok()?; let m = u32::from_str_radix(p.next().unwrap_or("ffffffff").trim_start_matches("0x"), 16).ok()?; Some((a, (o, m))) }).collect()).unwrap_or_default(),
            clock: Self::new_clock(),
            spi_exec: false, last_status: [0; 4], intmatrix_dirty: false,
        }
    }

    pub fn block_name_pub(block: u32) -> String { Self::block_name(block).to_string() }
    fn block_name(block: u32) -> &'static str {
        match block {
            0x00 => "UART0", 0x02 => "SPI1", 0x03 => "SPI0", 0x04 => "GPIO", 0x07 => "EFUSE", 0x08 => "RTC", 0x09 => "IO_MUX",
            0x0c => "UHCI1", 0x0f => "I2S0", 0x10 => "UART1", 0x13 => "I2C0", 0x14 => "UHCI0", 0x16 => "RMT", 0x17 => "PCNT",
            0x19 => "LEDC", 0x1f => "TIMG0", 0x20 => "TIMG1", 0x21 => "RTC_SLOWMEM", 0x23 => "SYSTIMER",
            0x24 => "SPI2", 0x25 => "SPI3", 0x26 => "SYSCON", 0x27 => "I2C1", 0x2b => "TWAI",
            0x35 => "WDEV", 0x39 => "USB_WRAP", 0x3a => "AES", 0x3b => "SHA", 0x3c => "RSA", 0x3d => "DS", 0x3e => "HMAC", 0x3f => "CRYPTO_DMA", 0x40 => "APB_SARADC",
            0xc0 => "SYSTEM", 0xc1 => "PMS", 0xc2 => "INTERRUPT", 0xc4 => "EXTMEM", 0xce => "ASSIST_DEBUG", 0xcf => "ASSIST_DEBUG2", 0xd0 => "DEDIC_GPIO",
            _ => "?",
        }
    }

    pub fn uart_route(&self, port: usize) -> esp_soc::uart::UartRoute {
        // ESP-IDF v5.5.4 components/soc/esp32s2/include/soc/clk_tree_defs.h:
        // UART_SCLK_RTC = SOC_MOD_CLK_RC_FAST, SOC_CLK_RC_FAST_FREQ_APPROX = 17.5 MHz.
        // IDF 4.4 used 20 MHz (RTC_CLK_FREQ).
        let clock = self.uart[port].clock_config();
        esp_soc::uart::UartPins::S2.route(port, &self.gpio, &self.io_mux,
            self.uart[port].baud(clock, 17_500_000))
    }

    pub fn uart_pin_input(&mut self, input: &esp_soc::uart::UartInput) {
        let routes: [_; 2] = std::array::from_fn(|port| self.uart_route(port));
        esp_soc::uart::uart_pin_input(&mut self.uart, input, &routes);
    }

    pub fn read32(&mut self, addr: u32) -> u32 {
        let mut v = mmio::read32(self, addr);
        if !self.fake_reads.is_empty() { if let Some(&(o, m)) = self.fake_reads.get(&addr) { v = (v & m) | o; } }
        v
    }

    pub fn write32(&mut self, addr: u32, v: u32) {
        // IDF v5.5.4 components/soc/esp32s2/register/soc/io_mux_reg.h:42-50 (FUN_PD/PU).
        if (0x60009004..=0x600090c4).contains(&addr) {
            self.gpio.set_pad(((addr - 0x60009004) / 4) as u8, v);
        }
        if matches!(addr, 0x6001_3004 | 0x6002_7004) && v & (1 << 5) != 0 {
            let bus = usize::from(addr == 0x6002_7004);
            if self.i2c[bus].has_pinned_devices() {
                let sda = if bus == 0 { 90 } else { 92 };
                let pins = self.i2c_pin(sda).zip(self.i2c_pin(sda - 1));
                self.i2c[bus].set_pins(pins);
            }
        }
        let fx = mmio::write32(self, addr, v);
        if fx.contains(WriteEffect::SPI_EXEC) { self.spi_exec = true; }
        if fx.contains(WriteEffect::INTMAP) { self.intmatrix_dirty = true; }
    }

    /// Returns the number of words applied.
    pub fn init_regs(&mut self, addr: u32, v: u32) -> bool {
        if !(PERIPH_BASE..PERIPH_END).contains(&addr) { return false; }
        let block = (addr - PERIPH_BASE) >> 12; let off = addr & 0xfff;
        match block {
            0x08 => self.rtc.ram.write(off, v),
            0xc0 => { if (0x30..=0x3c).contains(&off) { return false; } self.system.ram.write(off, v) }
            0xc4 => self.extmem.ram.write(off, v),
            0x09 => self.io_mux.write(off, v),
            0x02 => { if off == 0 || (0x58..=0x94).contains(&off) { return false; } self.spi1.regs.write(off, v) }
            0x03 => { if off == 0 { return false; } self.spi0.regs.write(off, v) }
            0x26 | 0xc1 => self.misc.generic.entry(block).or_default().write(off, v),
            _ => return false,
        }
        true
    }

    /// Advance device time by `cycles` CPU cycles (every clocked device gets its own clock's
    /// ticks), then route GPIO input edges to the pulse counters.
    pub fn tick(&mut self, cycles: u64) -> bool {
        let mut irq_changed = Dispatch::tick(self, cycles);
        if !self.gpio.input_changes.is_empty() {
            let before = self.pcnt.irq();
            let gpio = &mut self.gpio;
            let input = gpio.input;
            let selections = &gpio.func_in_sel;
            let sig = |idx: u32| -> Option<(u8, bool)> {
                let sel = *selections.get(idx as usize)?;
                if sel & 0x80 == 0 { return None; }                       // not routed through the matrix
                let pin = (sel & 0x3f) as u8; if pin > 46 || (22..=25).contains(&pin) { return None; }
                let lvl = (input >> pin) & 1 != 0; Some((pin, lvl ^ (sel & 0x40 != 0)))
            };
            for (pin, level) in gpio.input_changes.drain(..) { self.pcnt.gpio_edge(pin, level, &sig); }
            irq_changed |= before != self.pcnt.irq();
        }
        irq_changed
    }

    /// Raw per-source interrupt status (4 × 32 bits).
    pub fn source_status(&self) -> [u32; 4] { Dispatch::source_status(self) }

    /// The I2S0 controller, the S2's only I2S port.
    pub fn audio(&self) -> &I2s { &self.i2s0 }

    /// Cycles until the next systimer or timer-group alarm can fire — the only device events
    /// firmware times precisely. Slightly conservative (one device tick early), never late.
    pub fn cycles_until_timer(&self) -> u32 { Dispatch::cycles_until_deadline(self) }
    pub fn lines_dirty(&mut self) -> bool { let st = self.source_status(); if st != self.last_status { self.last_status = st; true } else { false } }

    /// CPU interrupt lines for `core` (bit n = Xtensa interrupt n) after the interrupt matrix.
    pub fn cpu_lines(&self, core: usize) -> u32 {
        let st = self.source_status();
        let mut lines = 0u32;
        for src in 0..NUM_SOURCES {
            if st[src / 32] & (1 << (src % 32)) != 0 { let n = self.intmatrix.map[core][src]; if n < 32 { lines |= 1 << n; } }
        }
        lines
    }
}
