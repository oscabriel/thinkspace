import { describe, expect, test } from "bun:test";

import { openProviderKey, sealProviderKey } from "../src/key-envelope";

/** A deterministic, valid 32-byte base64 master key (and a distinct foreign one) for the suite. */
const masterKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const foreignMasterKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

const RAW_KEY = "sk-live-super-secret-value-123";

describe("key-envelope — AES-256-GCM seal/open (ADR 0040)", () => {
  test("round-trips the raw key through seal then open", async () => {
    const sealed = await sealProviderKey(masterKey, RAW_KEY);
    expect(await openProviderKey(masterKey, sealed)).toBe(RAW_KEY);
  });

  test("ciphertext at rest never equals — nor contains — the plaintext", async () => {
    const sealed = await sealProviderKey(masterKey, RAW_KEY);
    expect(sealed).not.toBe(RAW_KEY);
    expect(sealed).not.toContain(RAW_KEY);
    expect(sealed.startsWith("v1:")).toBe(true);
  });

  test("a fresh IV per seal makes two seals of the same key differ", async () => {
    const first = await sealProviderKey(masterKey, RAW_KEY);
    const second = await sealProviderKey(masterKey, RAW_KEY);
    expect(first).not.toBe(second);
  });

  test("the wrong master key fails closed (throws, never decrypts to garbage)", async () => {
    const sealed = await sealProviderKey(masterKey, RAW_KEY);
    await expect(openProviderKey(foreignMasterKey, sealed)).rejects.toThrow();
  });

  test("a tampered ciphertext fails the GCM tag check", async () => {
    const sealed = await sealProviderKey(masterKey, RAW_KEY);
    const [version, iv, ct] = sealed.split(":");
    const flipped = `${ct?.slice(0, -2)}${ct?.endsWith("A") ? "B" : "A"}=`;
    await expect(
      openProviderKey(masterKey, `${version}:${iv}:${flipped}`)
    ).rejects.toThrow();
  });

  test("a malformed sealed value throws without leaking anything", async () => {
    await expect(openProviderKey(masterKey, "not-a-sealed-key")).rejects.toThrow(
      "sealed provider key is malformed"
    );
  });

  test("a wrong-length master key is rejected", async () => {
    const shortKey = btoa("too-short");
    await expect(sealProviderKey(shortKey, RAW_KEY)).rejects.toThrow(
      "BYOK master key must decode to 32 bytes"
    );
  });
});
