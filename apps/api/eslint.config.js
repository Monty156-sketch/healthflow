// Minimal flat ESLint config for the API. Kept deliberately small: type
// safety is already enforced by `tsc --noEmit` in the typecheck script,
// so this only catches the things the compiler won't (unused vars, stray
// console usage, etc).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
