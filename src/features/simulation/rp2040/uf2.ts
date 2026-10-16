/**
 * UF2 container decode. The format the RP2040 boot ROM accepts over USB: a
 * sequence of 512-byte blocks, each carrying an up-to-476-byte payload for
 * one flash address, so firmware can arrive in any order over a lossy
 * transport. The engine only ever reads well-formed pinned firmware, so this
 * validates the pieces that would otherwise silently mis-flash — block
 * framing, magic, payload bound — and stays surface-level everywhere else.
 */

const MAGIC_START0 = 0x0a324655;
const MAGIC_START1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;

const BLOCK_SIZE = 512;
const ADDRESS_OFFSET = 12;
const SIZE_OFFSET = 16;
const PAYLOAD_OFFSET = 32;
const MAGIC_END_OFFSET = BLOCK_SIZE - 4;
const MAX_PAYLOAD = MAGIC_END_OFFSET - PAYLOAD_OFFSET;

/** A decoded firmware image; `data` is contiguous from `baseAddress`. */
export interface Uf2Image {
  readonly baseAddress: number;
  readonly data: Uint8Array;
}

export function decodeUf2(bytes: Uint8Array): Uf2Image {
  if (bytes.length === 0 || bytes.length % BLOCK_SIZE !== 0) {
    throw new Error(
      `UF2: length ${bytes.length} is not a whole number of ${BLOCK_SIZE}-byte blocks`,
    );
  }

  // Honour the view's byteOffset: callers may hand over a subarray slice.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks: Array<{ offset: number; address: number; size: number }> = [];
  let baseAddress = Number.POSITIVE_INFINITY;
  let endAddress = 0;

  for (let offset = 0; offset < bytes.length; offset += BLOCK_SIZE) {
    if (
      view.getUint32(offset, true) !== MAGIC_START0 ||
      view.getUint32(offset + 4, true) !== MAGIC_START1
    ) {
      throw new Error(`UF2: bad block magic at byte ${offset}`);
    }
    if (view.getUint32(offset + MAGIC_END_OFFSET, true) !== MAGIC_END) {
      throw new Error(`UF2: bad end magic at byte ${offset + MAGIC_END_OFFSET}`);
    }
    const address = view.getUint32(offset + ADDRESS_OFFSET, true);
    const size = view.getUint32(offset + SIZE_OFFSET, true);
    if (size > MAX_PAYLOAD) {
      throw new Error(`UF2: payload of ${size} bytes at byte ${offset} exceeds ${MAX_PAYLOAD}`);
    }
    blocks.push({ offset, address, size });
    baseAddress = Math.min(baseAddress, address);
    endAddress = Math.max(endAddress, address + size);
  }

  // Two passes so out-of-order blocks land contiguously from the lowest
  // address; any address gap (never present in pinned firmware) stays zero.
  const data = new Uint8Array(endAddress - baseAddress);
  for (const { offset, address, size } of blocks) {
    const start = offset + PAYLOAD_OFFSET;
    data.set(bytes.subarray(start, start + size), address - baseAddress);
  }
  return { baseAddress, data };
}
