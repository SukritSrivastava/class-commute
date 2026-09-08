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
    // Build output, not source: the bundled service worker is generated from
    // `app/sw.ts` by `@serwist/cli` and is minified. Lint the source instead.
    "public/sw.js",
    "public/sw.js.map",
  ]),
]);

export default eslintConfig;
