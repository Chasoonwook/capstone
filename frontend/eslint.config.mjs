// eslint.config.mjs

import js from '@eslint/js';
// ✅ [수정] next/core-web-vitals를 직접 import 합니다.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
// ❌ import next from 'eslint-config-next' 라인을 삭제했습니다.

export default [
  js.configs.recommended,

  // ✅ [수정] Next.js의 추천 규칙과 웹 바이탈 규칙을 별도로 적용합니다.
  {
    // core-web-vitals 규칙을 모든 관련 파일에 적용
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    ...coreWebVitals,
  },
  
  // 무시 경로
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**']
  },

  // TypeScript 파일 전용 설정 (기존과 동일)
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
];