/**
 * RFID reader (MFRC522) adapter for the differential harness.
 *
 * C++: part_create_rfid(part_id, address) → MFRC522Context (SPI device)
 * TS:  Mfrc522 class from parts/mfrc522.ts
 *
 * Adapter parity note: the TS Mfrc522 drives each SPI byte through
 * `receive(byte)` (address byte first, then data, alternating) and ends a
 * transaction with `endTransaction()` when chip-select rises. The C++ side
 * mirrors this: `spi_mfrc522_receive` decodes address/command bytes and
 * `spi_mfrc522_latch` (called from `spi_bus_end`) resets the register pointer.
 * The `card` knob drives card presence on both sides.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Mfrc522 } from '@/features/parts/mfrc522';

let rfidWasmCsState = false;

export const rfidAdapter: PartAdapter = {
  kind: 'rfid',
  labels: ['rfid_card_present', 'rfid_version'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address] = factoryArgs as [number, number];
    if (module) {
      return module.part_create_rfid(part_id, address);
    } else {
      const dev = new Mfrc522();
      const card = { present: false };
      dev.setCardPresent(() => card.present);
      return { dev, card };
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'spi-transfer') {
        const cs = stimulus.cs;
        if (cs && !rfidWasmCsState) {
          module.spi_bus_begin();
        }
        if (cs) {
          module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, 1);
        } else if (rfidWasmCsState) {
          module.spi_bus_end();
        }
        rfidWasmCsState = cs;
      } else if (stimulus.kind === 'knob' && stimulus.name === 'card') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as { dev: Mfrc522; card: { present: boolean } };
      if (stimulus.kind === 'spi-transfer') {
        oracle.dev.receive(stimulus.byte);
        if (!stimulus.cs) {
          oracle.dev.endTransaction();
        }
      } else if (stimulus.kind === 'knob' && stimulus.name === 'card') {
        oracle.card.present = stimulus.value !== 0;
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as { dev: Mfrc522; card: { present: boolean } };
    return [
      oracle.card.present ? 1 : 0,
      0x92, // VersionReg: MFRC522 v2.0 (constant)
    ];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.rfid_card_present ? 1 : 0, snap.rfid_version];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    rfidWasmCsState = false;
    if (module) {
      module.bus_reset();
      module.spi_bus_init(0, 0, 0, 0);
    }
  },
};
