import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        File: 'readonly',
        process: 'readonly',
        ReadableStream: 'readonly',
        Response: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
      },
    },
  },
);
