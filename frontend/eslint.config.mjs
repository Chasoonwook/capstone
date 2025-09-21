// eslint.config.mjs (Flat Config, ESLint v9 기준)
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// 1) 기존 next preset을 Flat으로 변환
const nextPresets = compat.extends("next/core-web-vitals", "next/typescript");

// 2) 변환된 각 preset에 TS 파서/플러그인을 주입 (Flat은 항목별로 필요)
const nextPresetsWithTs = nextPresets.map((cfg) => ({
  ...cfg,
  languageOptions: {
    ...(cfg.languageOptions ?? {}),
    parser: tsParser,
    parserOptions: {
      project: "./tsconfig.json",
      tsconfigRootDir: __dirname,
    },
  },
  plugins: {
    ...(cfg.plugins ?? {}),
    "@typescript-eslint": tsPlugin,
  },
}));

export default [
  ...nextPresetsWithTs,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    rules: {
      // 문제가 되는 규칙은 끄거나 원하는 수준으로 조정
      "@typescript-eslint/ban-types": "off",
      // 필요 시 여기서 다른 규칙도 커스터마이징
    },
  },
];
