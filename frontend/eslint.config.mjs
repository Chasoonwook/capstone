import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// TypeScript ESLint 플러그인 & 파서 추가
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // ban-types 규칙은 오류를 일으키므로 off 처리 (원하면 수정 가능)
      "@typescript-eslint/ban-types": "off",
      // 필요하다면 여기에서 규칙을 추가/변경 가능
    },
  },

  // Next.js 기본 설정 불러오기
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
