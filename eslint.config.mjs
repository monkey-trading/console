import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".next/**", "out/**", "coverage/**", "next-env.d.ts", "agents/.processes/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.strict,
  {
    rules: {
      // Every source file, tests included, stays under 300 lines; split rather than exempt.
      "max-lines": ["error", 300],
      // Narrow instead; an absence our own code cannot produce throws an Error.
      "@typescript-eslint/no-non-null-assertion": "error",
      // As strict, except that a scrolling `log` may take focus, so the keyboard can scroll it in
      // browsers that do not make scroll containers focusable (WCAG 2.1.1).
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["log"], allowExpressionValues: false }],
    },
  },
]);
