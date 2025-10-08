// eslint.config.mjs

import js from "@eslint/js"
// ▶ Flat Config + ESM 환경에서는 서브패스에 확장자(.js)가 필요합니다.
import coreWebVitals from "eslint-config-next/core-web-vitals.js"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"

// core-web-vitals가 배열/객체 어느 쪽으로 오더라도 안전하게 처리
const nextCoreConfigs = Array.isArray(coreWebVitals) ? coreWebVitals : [coreWebVitals]

export default [
  // 기본 JS 추천 규칙
  js.configs.recommended,

  // Next.js 웹 바이탈 규칙
  ...nextCoreConfigs,

  // 무시 경로
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "coverage/**"],
  },

  // TypeScript 전용 설정
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json"], // project-aware rules 사용하는 경우
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-types": "off",
    },
  },

  // JS 전용 설정
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]
