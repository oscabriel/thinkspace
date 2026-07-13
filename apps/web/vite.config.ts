import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { defineConfig, loadEnv } from "vite";

const alchemyConfigPath = fileURLToPath(
  new URL(".alchemy/local/wrangler.jsonc", import.meta.url)
);
const shouldUseAlchemy = existsSync(alchemyConfigPath);
const cloudflareWorkersShimPath = fileURLToPath(
  new URL("../../packages/env/src/cloudflare-local.ts", import.meta.url)
);
const cloudflareWorkersAlias: Record<string, string> = shouldUseAlchemy
  ? {}
  : {
      "cloudflare:workers": cloudflareWorkersShimPath,
    };

const webAppRoot = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const caddyDevHost =
    process.env.CADDY_DEV_HOST ||
    loadEnv(mode, webAppRoot, "").CADDY_DEV_HOST ||
    undefined;

  // An explicitly-provided VITE_SERVER_URL always wins: the prod deploy passes the stage origin
  // (ADR 0039), and a lingering dev CADDY_DEV_HOST in .env must not bake a dev origin into it.
  if (caddyDevHost && !process.env.VITE_SERVER_URL) {
    process.env.VITE_SERVER_URL = `https://${caddyDevHost}`;
  }

  return {
    plugins: [
      tailwindcss(),
      tanstackStart(),
      viteReact(),
      ...(shouldUseAlchemy ? [alchemy({ configPath: alchemyConfigPath })] : []),
    ],
    resolve: {
      alias: cloudflareWorkersAlias,
      tsconfigPaths: true,
    },
    server: {
      allowedHosts: caddyDevHost
        ? ["localhost", "127.0.0.1", caddyDevHost]
        : undefined,
      hmr: caddyDevHost
        ? { clientPort: 443, host: caddyDevHost, protocol: "wss" }
        : undefined,
      host: "127.0.0.1",
      port: 3002,
      strictPort: true,
    },
  };
});
