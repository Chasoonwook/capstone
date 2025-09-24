// eslint.config.mjs  (ESLint v9 + Flat Config + Next.js 15)
import js from '@eslint/js'
import next from 'eslint-config-next'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  // JS 기본 추천 규칙
  js.configs.recommended,

  // Next.js 15 권장 규칙(core-web-vitals 포함)
  ...next,

  // 무시 경로
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**']
  },

  // TypeScript 파일 전용 설정
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'] // TS Project-aware rules 사용 시
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      // 미사용 변수: _로 시작하면 허용
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 금지 타입 완화(필요 시 켜세요)
      '@typescript-eslint/ban-types': 'off'
    }
  },

  // JS 파일 전용 설정(동일한 미사용 변수 예외)
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
]
