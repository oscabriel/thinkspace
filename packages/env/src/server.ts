/// <reference types="@cloudflare/workers-types" />
// oxlint-disable-next-line typescript/triple-slash-reference -- pulls the ambient Env augmentation into every consumer's program; an import cannot load a global .d.ts
/// <reference path="../env.d.ts" />
// For Cloudflare Workers, env is accessed via cloudflare:workers module
// Types are defined in env.d.ts based on your alchemy.run.ts bindings
export { env } from "cloudflare:workers";
