import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Lean, bug-catching ESLint config (no stylistic churn). Focuses on real
// correctness issues: React Hooks rules, unused code, and unsafe TS patterns.
export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Allow intentionally-unused args/vars when prefixed with _.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // The codebase deliberately uses `any` at a few API/error boundaries.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Test + tooling files run under Node and use jsdom globals.
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**", "**/*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
);
