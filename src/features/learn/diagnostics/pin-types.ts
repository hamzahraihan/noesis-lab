// Branded pin ID types for compile-time pin validation
// Usage: PinId<'led-red'> ensures only valid pins for 'led-red' can be used

export type PinId<PartDef extends string> = string & { readonly __pinId: PartDef };

export function definePinIds<const PartDef extends string>(
  partDef: PartDef,
  pins: readonly string[]
): Record<string, PinId<PartDef>> {
  const result = {} as Record<string, PinId<PartDef>>;
  for (const pin of pins) {
    result[pin] = pin as PinId<PartDef>;
  }
  return result;
}