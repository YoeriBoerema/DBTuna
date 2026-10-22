import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "work/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["test/**/*.cjs"],
    // VS Code's test loader uses CommonJS entry points.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
