import { z } from "zod";

import type { AsyncResult } from "../../result";
import { err, ok } from "../../result";
import { CLOUDFLARE_API_BASE_URL } from "./cloudflare-byok";

/** ADR 0040 §7: the lazy, idempotent AI Gateway Custom Provider provisioning seam. */
export interface CustomProviderRoute {
  readonly slug: string;
  readonly upstreamBaseUrl: string;
}

export interface CustomProviderProvisionError {
  readonly kind:
    | "custom_provider_provisioning_failed"
    | "custom_provider_provisioning_unverified";
  readonly message: string;
  readonly status: number;
}

export interface CustomProviderProvisioner {
  /** Ensure this account has the route, re-asserting its public upstream when it already exists. */
  readonly ensureProvider: (
    route: CustomProviderRoute
  ) => AsyncResult<undefined, CustomProviderProvisionError>;
}

export type CustomProviderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CloudflareCustomProviderConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly fetch?: CustomProviderFetch;
  readonly baseUrl?: string;
}

const listEnvelopeSchema = z.object({
  result: z
    .array(z.object({ id: z.string().min(1), slug: z.string() }))
    .optional(),
  result_info: z
    .object({
      page: z.number().int().positive(),
      per_page: z.number().int().positive(),
      total_count: z.number().int().nonnegative(),
    })
    .optional(),
});

/** Outcome of the paginated provider-list walk: found on some page, absent, or a failed read. */
type ProviderLookup =
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly status: number }
  | { readonly existing: { id: string; slug: string }; readonly kind: "found" };

const failure = (status: number): CustomProviderProvisionError => ({
  kind: "custom_provider_provisioning_failed",
  message:
    status === 0
      ? "network error"
      : `Cloudflare Custom Provider API returned HTTP ${status}`,
  status,
});

/**
 * Build the verified Cloudflare management-API adapter. It lists by account, creates an absent
 * slug, and PATCHes an existing id so registration re-asserts the same route. The adapter sees no
 * provider key material and returns fixed response-body-free errors.
 */
export const createCloudflareCustomProviderProvisioner = (
  config: CloudflareCustomProviderConfig
): CustomProviderProvisioner => {
  const fetchImpl = config.fetch ?? (globalThis.fetch as CustomProviderFetch);
  const baseUrl = config.baseUrl ?? CLOUDFLARE_API_BASE_URL;
  const providersUrl = `${baseUrl}/accounts/${config.accountId}/ai-gateway/custom-providers`;
  const authHeaders = { authorization: `Bearer ${config.apiToken}` };

  return {
    ensureProvider: async (route) => {
      const body = {
        base_url: route.upstreamBaseUrl,
        enable: true,
        name: route.slug,
        slug: route.slug,
      };
      try {
        const findProvider = async (
          pageUrl: string
        ): Promise<ProviderLookup> => {
          const listed = await fetchImpl(pageUrl, {
            headers: authHeaders,
            method: "GET",
          });
          if (!listed.ok) {
            return { kind: "error", status: listed.status };
          }
          const parsed = listEnvelopeSchema.safeParse(await listed.json());
          if (!parsed.success) {
            return { kind: "error", status: listed.status };
          }
          const existing = (parsed.data.result ?? []).find(
            (provider) => provider.slug === route.slug
          );
          if (existing !== undefined) {
            return { existing, kind: "found" };
          }
          const resultInfo = parsed.data.result_info;
          if (
            resultInfo === undefined ||
            resultInfo.page * resultInfo.per_page >= resultInfo.total_count
          ) {
            return { kind: "absent" };
          }
          const nextPage = resultInfo.page + 1;
          return findProvider(
            `${providersUrl}?page=${nextPage}&per_page=${resultInfo.per_page}`
          );
        };

        const listed = await findProvider(providersUrl);
        if (listed.kind === "error") {
          return err(failure(listed.status));
        }
        const response = await fetchImpl(
          listed.kind === "absent"
            ? providersUrl
            : `${providersUrl}/${encodeURIComponent(listed.existing.id)}`,
          {
            body: JSON.stringify(body),
            headers: { ...authHeaders, "content-type": "application/json" },
            method: listed.kind === "absent" ? "POST" : "PATCH",
          }
        );
        return response.ok ? ok() : err(failure(response.status));
      } catch {
        return err(failure(0));
      }
    },
  };
};

/** Retained for callers that explicitly need the former first-run-confirms stub. */
export const createUnverifiedCustomProviderProvisioner =
  (): CustomProviderProvisioner => ({
    ensureProvider: () =>
      Promise.resolve(
        err({
          kind: "custom_provider_provisioning_unverified",
          message: "Custom Provider provisioning was not attempted.",
          status: 0,
        })
      ),
  });

/** Native gateway routes need no account-level Custom Provider configuration. */
export const createNoopCustomProviderProvisioner =
  (): CustomProviderProvisioner => ({
    ensureProvider: () => Promise.resolve(ok()),
  });
