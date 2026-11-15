/**
 * The analyser's decode configuration, shared between the panel (which edits
 * it) and the bench (which owns it, so it survives bottom-tab switches).
 * Kept out of the component file so fast refresh stays happy.
 */

/** Which bus the analyser is decoding, or none. */
export type DecodeMode = 'none' | 'spi' | 'i2c';

export interface BusDecodeState {
  readonly mode: DecodeMode;
  readonly spiSck: string;
  readonly spiMosi: string;
  readonly spiMiso: string;
  readonly spiCs: string;
  readonly i2cSda: string;
  readonly i2cScl: string;
}

export const DEFAULT_BUS_DECODE: BusDecodeState = {
  mode: 'none',
  spiSck: '',
  spiMosi: '',
  spiMiso: '',
  spiCs: '',
  i2cSda: '',
  i2cScl: '',
};
