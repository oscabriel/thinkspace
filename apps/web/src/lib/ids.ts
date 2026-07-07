/**
 * Client-minted ids for the gesture surface (ADR 0033/0034: the edge — here, the browser —
 * mints ids per gesture so a replay converges). Thread/comment/channel ids are branded but
 * shape-free (`nonEmptyIdSchema`), so any uuid serves. The **gestureId** wire schema is strict
 * `z.uuidv7()` (apps/server gestures.ts), so `crypto.randomUUID()` (a v4 uuid) would be
 * rejected — dispatch and create-and-ask must carry a real UUIDv7. This mints one: 48-bit
 * millisecond timestamp, version 7, variant 2, the rest CSPRNG bytes.
 */
export const uuidv7 = (): string => {
  const ts = Date.now();
  const bytes = new Uint8Array(16);
  bytes[0] = Math.floor(ts / 2 ** 40) % 256;
  bytes[1] = Math.floor(ts / 2 ** 32) % 256;
  bytes[2] = Math.floor(ts / 2 ** 24) % 256;
  bytes[3] = Math.floor(ts / 2 ** 16) % 256;
  bytes[4] = Math.floor(ts / 2 ** 8) % 256;
  bytes[5] = ts % 256;
  crypto.getRandomValues(bytes.subarray(6));
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
