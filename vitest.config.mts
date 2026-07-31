import { defineConfig } from "vitest/config"

/**
 * Unit tests for the money core.
 *
 * Deliberately narrow. These cover the pure logic that decides prices,
 * discounts, refunds and barcodes — the code where a wrong answer is money
 * rather than a layout glitch, and where a mistake stays invisible until a
 * customer is standing at the counter.
 *
 * No jsdom and no React plugin: nothing here renders. Component tests would
 * need both and would be testing a different risk.
 *
 * `.mts` because the config is ESM and the package is not — the alternative,
 * `"type": "module"` in package.json, changes how every other tool in this
 * project reads it.
 */
export default defineConfig({
  // Vite resolves the `@/` alias from tsconfig natively, so the old
  // vite-tsconfig-paths plugin is not needed. This is a top-level option —
  // nested under `test` it is silently ignored and every `@/` import fails.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // `next build` already type-checks, so the suite stays fast enough to run
    // on every save.
    typecheck: { enabled: false },
  },
})
