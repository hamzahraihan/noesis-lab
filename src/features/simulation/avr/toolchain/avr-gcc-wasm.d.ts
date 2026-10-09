declare module '@horang-corp/avr-gcc-wasm' {
  export function setAssetsBase(base: string): void;
  export interface BuildResult {
    readonly hex: string;
  }
  export function buildFirmware(options?: { source?: string }): Promise<BuildResult>;
}
