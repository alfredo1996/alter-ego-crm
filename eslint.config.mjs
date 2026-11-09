import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      next: { rootDir: "apps/web" },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    "**/playwright-report/**",
    "**/test-results/**",
    // fumadocs-mdx output, regenerated on every docs build and gitignored.
    "**/.source/**",
    "**/coverage/**",
    "docs-site/.next/**",
    "docs-site/out/**",
    "docs-site/.source/**",
    // Other checkouts (Claude Code worktrees) live here; each lints itself.
    ".claude/**",
  ]),
  {
    rules: {
      // Value imports of zod go through @/lib/zod, which sets jitless (CSP, no eval).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "zod",
              allowTypeImports: true,
              message: 'Import { z } from "@/lib/zod": it turns off zod\'s eval-based JIT.',
            },
          ],
          patterns: [
            {
              group: ["zod/*"],
              allowTypeImports: true,
              message: 'Import { z } from "@/lib/zod": it turns off zod\'s eval-based JIT.',
            },
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // A leading underscore marks a parameter an interface makes us accept but
      // this implementation ignores (the mock and stub adapters).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
            "type",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },
  // The workspace packages know nothing of the app (boundary.test.ts in each also checks the files).
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/*", "@alter-ego/web", "@alter-ego/web/*"], message: "A workspace package never imports the app." }] },
      ],
    },
  },
  { files: ["apps/web/src/lib/zod.ts"], rules: { "no-restricted-imports": "off" } },
]);

export default eslintConfig;
