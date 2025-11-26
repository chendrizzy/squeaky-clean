import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...(js.configs.recommended.languageOptions?.globals || {}),
        ...globals.browser,
      },
    },
    rules: {
      ...(js.configs.recommended.rules || {}),
    },
    ignores: ["dist/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "no-case-declarations": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["src/__tests__/**/*", "src/test/**/*"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "prefer-const": "off",
    },
  },
];
