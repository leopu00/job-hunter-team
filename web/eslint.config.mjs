import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `components/**` was dropped: web/components was folded into
    // web/app/components, so the glob matched nothing and `app/**` already
    // covers those files. Keeping it would have quietly re-applied these
    // relaxations to a web/components/ recreated by mistake.
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      // The app has not been migrated to React Compiler-safe patterns yet.
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
