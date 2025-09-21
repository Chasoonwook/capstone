// eslint.config.mjs  (ESLint v9 + Flat Config 기준)
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

// Next 프리셋을 Flat으로 변환
const nextPresets = compat.extends("next/core-web-vitals", "next/typescript");

// 변환된 preset 각각에 TS 파서/플러그인 주입 (중요!)
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
  // 공통 규칙 커스터마이즈
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    rules: {
      // 문제가 되는 규칙을 비활성화(원하면 warn/설정으로 바꿔도 됨)
      "@typescript-eslint/ban-types": "off",
      // 언더스코어 변수는 미사용 허용
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
