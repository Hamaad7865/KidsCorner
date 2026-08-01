import { defineConfig } from "vitest/config"

/**
 * Unit tests for the money core.
 *
 * Deliberately narrow. These cover the pure logic that decides prices,
 * discounts, refunds and barcodes — the code where a wrong answer is money
 * rather than a layout glitch, and where a mistake stays invisible until a
 * customer is standing at the counter.
 *
 * Still no jsdom and no React plugin. The report panels under `components/` are
 * covered, but only through `renderToStaticMarkup`, which needs neither: it
 * answers "does this crash, and is the right figure in the output" for the
 * awkward shapes — an empty period, a month ladder with no rows — and stops
 * there. Anything that needs a click or a layout is a different kind of test
 * and would need a different runner.
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
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    // `next build` already type-checks, so the suite stays fast enough to run
    // on every save.
    typecheck: { enabled: false },
  },
})
