import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output and config files are not linted as source.
  { ignores: ["dist", "node_modules", "*.config.js", "*.config.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // The codebase uses `any` in a handful of error-catch and chart-callback
      // spots. Surface it as guidance rather than a hard failure so adopting
      // lint on the existing tree doesn't require a risky type refactor.
      "@typescript-eslint/no-explicit-any": "warn",
      // Flag unused code (tsconfig has noUnusedLocals/Parameters off), but allow
      // intentionally-unused args/vars prefixed with an underscore.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Test files run under Vitest/jsdom and use Node + browser globals.
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },
);
