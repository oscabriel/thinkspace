/**
 * AES-256-GCM envelope for BYOK provider keys (ADR 0040). The raw key is sealed with the
 * account-wide `BYOK_MASTER_KEY` (a base64 32-byte value) and only the ciphertext + IV ever land
 * in D1; decryption happens transiently on the turn hot path. WebCrypto only — the same subtle API
 * runs in Workers, the DO isolate, Node, and Bun, so both the production and memory adapters share
 * this one implementation.
 *
 * Redaction by construction: the sealed string is `v1:<ivBase64>:<ctBase64>` and NEVER embeds the
 * plaintext; every thrown error carries a fixed message (a stringified crypto error could echo
 * nothing key-bearing, but we never risk it) so a decrypt failure can never leak key material.
 */

const KEY_VERSION = "v1";
const IV_BYTES = 12;
const MASTER_KEY_BYTES = 32;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/** Import the base64 master key into a non-extractable AES-GCM CryptoKey; wrong length fails fast. */
const importMasterKey = async (masterKeyBase64: string): Promise<CryptoKey> => {
  const raw = fromBase64(masterKeyBase64);
  if (raw.byteLength !== MASTER_KEY_BYTES) {
    throw new Error("BYOK master key must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "decrypt",
    "encrypt",
  ]);
};

/**
 * Seal a raw provider key: fresh 96-bit IV per call, GCM auth tag appended to the ciphertext by
 * WebCrypto. Returns the versioned `v1:<iv>:<ct>` column value. Two seals of the same key differ
 * (random IV), so ciphertext-at-rest can never equal — nor be correlated to — the plaintext.
 */
export const sealProviderKey = async (
  masterKeyBase64: string,
  rawKey: string
): Promise<string> => {
  const key = await importMasterKey(masterKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { iv, name: "AES-GCM" },
      key,
      new TextEncoder().encode(rawKey)
    )
  );
  return `${KEY_VERSION}:${toBase64(iv)}:${toBase64(ciphertext)}`;
};

/**
 * Open a sealed key. Throws — always with a fixed, key-free message — on any tampering: a wrong
 * master key, a corrupt IV/ciphertext, a failed GCM tag check, or an unknown version. Callers map
 * the throw to a typed fail-closed domain error; the plaintext return is redaction-sensitive and
 * lives only transiently in the caller between here and header injection.
 */
export const openProviderKey = async (
  masterKeyBase64: string,
  sealed: string
): Promise<string> => {
  const parts = sealed.split(":");
  const [version, ivBase64, ciphertextBase64] = parts;
  if (
    version !== KEY_VERSION ||
    ivBase64 === undefined ||
    ivBase64.length === 0 ||
    ciphertextBase64 === undefined ||
    ciphertextBase64.length === 0
  ) {
    throw new Error("sealed provider key is malformed");
  }
  const key = await importMasterKey(masterKeyBase64);
  const plaintext = await crypto.subtle.decrypt(
    { iv: fromBase64(ivBase64), name: "AES-GCM" },
    key,
    fromBase64(ciphertextBase64)
  );
  return new TextDecoder().decode(plaintext);
};
