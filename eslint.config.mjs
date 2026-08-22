import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Cloudflare build output: 41MB of generated bundle. Linting it does
    // not crash so much as exhaust V8's heap, which surfaces as a stack trace
    // with no mention of why.
    ".open-next/**",
    ".wrangler/**",
    // Vendored Claude Design prototypes. They ship their own React runtime and
    // are read as a spec, never built — linting them only reports on code we
    // do not own and cannot fix.
    //
    // Globbed rather than listed one directory at a time: the POS v2 bundle
    // arrived as a second folder and broke the build until it was added, which
    // will happen again with the next handoff.
    "design-handoff*/**",
    // Agent worktrees. Each is a full copy of the repo — including its own
    // .next and design handoffs — so without these, lint reports the same
    // files three or four times over and drowns real findings in ~31k
    // problems that belong to nobody's working tree.
    ".worktrees/**",
    ".superpowers/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
