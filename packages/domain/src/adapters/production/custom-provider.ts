import type { AsyncResult } from "../../result";
import { err, ok } from "../../result";

/**
 * ADR 0040 §7 (E11.9): the AI Gateway Custom Provider provisioning seam.
 *
 * A non-native OpenAI-compatible provider (the long tail — models.dev id → `routing:
 * "custom-provider"`) routes through an AI Gateway Custom Provider whose upstream `base_url` is the
 * models.dev `api`. That Custom Provider must be configured on the account (a CF API write) before a
 * turn can reach the upstream. This is the narrow seam for that write, invoked LAZILY at
 * key-registration time (the edge write path already holds the account-scoped `BYOK_CF_*` creds) and
 * IDEMPOTENTLY (re-registering a keyed provider re-asserts the same route).
 *
 * HONESTY (head constraint + ADR 0040 §7): the exact CF Custom Provider API surface is
 * underdocumented and UNVERIFIED. Rather than ship a pretend implementation, the default adapter is
 * `createUnverifiedCustomProviderProvisioner` — it performs no network write and returns the typed
 * `custom_provider_provisioning_unverified` result. The write route treats provisioning as
 * BEST-EFFORT: it never fails key registration on this result (the key is already sealed), so a
 * non-native provider is honestly Tier-B "first run confirms" — the first real turn either succeeds
 * (the route already existed / the gateway resolved it) or settles as a visible `run_failure` (ADR
 * 0028), never a hung run and never a false "provisioned" claim. The real CF-API adapter lands when
 * the Custom Provider write surface is verified (follow-up).
 */

/** The Custom Provider route to ensure: a stable slug + the models.dev upstream base URL. */
export interface CustomProviderRoute {
  readonly slug: string;
  readonly upstreamBaseUrl: string;
}

/**
 * A provisioning outcome that did not confirm a live Custom Provider route. `unverified` is the
 * default stub's honest result (no write attempted); `failed` is a real adapter's CF-API fault.
 * Redaction-safe by construction — `message` never carries a key (provisioning sees no key material,
 * only the public upstream base URL).
 */
export interface CustomProviderProvisionError {
  readonly kind:
    | "custom_provider_provisioning_failed"
    | "custom_provider_provisioning_unverified";
  readonly message: string;
  /** HTTP status of the failing CF call, or `0` for a stub / transport failure. */
  readonly status: number;
}

export interface CustomProviderProvisioner {
  /**
   * Ensure the account has a Custom Provider for `route`. Idempotent: an existing route of the same
   * slug is a no-op success. Provisioning holds NO key material — the key is stored separately by
   * the KeyStore; a Custom Provider config carries only the public upstream `base_url`.
   */
  readonly ensureProvider: (
    route: CustomProviderRoute
  ) => AsyncResult<undefined, CustomProviderProvisionError>;
}

/**
 * The default (production) provisioner: an honest no-op stub. It attempts no network write and
 * returns the typed `unverified` result so the write route can log it and proceed best-effort. Swap
 * for the real CF-API adapter once the Custom Provider write surface is verified.
 */
export const createUnverifiedCustomProviderProvisioner =
  (): CustomProviderProvisioner => ({
    ensureProvider: (_route) =>
      Promise.resolve(
        err<CustomProviderProvisionError>({
          kind: "custom_provider_provisioning_unverified",
          message:
            "AI Gateway Custom Provider provisioning is not yet verified; first run confirms the route.",
          status: 0,
        })
      ),
  });

/**
 * A trivially-satisfied provisioner for native-routed providers (openai/anthropic and the documented
 * native slugs): the gateway already knows the route, so there is nothing to provision.
 */
export const createNoopCustomProviderProvisioner =
  (): CustomProviderProvisioner => ({
    ensureProvider: () => Promise.resolve(ok()),
  });
