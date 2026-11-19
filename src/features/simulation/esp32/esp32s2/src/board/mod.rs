//! Boards around the ESP32-S2. The SoC model emits generic events; a `BoardModel`
//! interprets them as the devices wired to the pins. The S2 ships with a bare board only:
//! nothing on the pins, any ESP32-S2 firmware, console only.
pub use esp_soc::board::{Board, BoardEdge, BoardModel, NoBoard, VirtualCycle};

/// Board by name: `none`/`bare` (the default), and `esp32s2`/`s2` (the bare S2 module).
pub fn make_board(name: &str) -> Option<Board> {
    match name {
        "none" | "bare" | "esp32s2" | "s2" => Some(Box::new(NoBoard)),
        _ => None,
    }
}
