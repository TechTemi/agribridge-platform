import react from 'eslint-plugin-react';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        URLSearchParams: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Without this, base no-unused-vars cannot see that a component imported
      // and used only inside JSX is in fact used, and reports every one of them.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      semi: ['error', 'always'],
    },
  },
];
