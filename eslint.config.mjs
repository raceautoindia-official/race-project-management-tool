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
    // Playwright's own output. Both are gitignored, but a flat config does
    // not read .gitignore, so without this one e2e run buries `npm run lint`
    // in thousands of findings about bundled report JavaScript.
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
