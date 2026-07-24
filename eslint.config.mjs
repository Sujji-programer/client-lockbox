import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // Never lint generated/build artifacts or vendor directories. The flat
    // config format does not read `.gitignore` automatically, so we declare
    // these ignores explicitly to keep `eslint .` focused on source files.
    ignores: [
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
