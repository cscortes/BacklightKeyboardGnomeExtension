import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.es2021,
                ARGV: 'readonly',
                imports: 'readonly',
                printerr: 'readonly',
                print: 'readonly',
            },
        },
        rules: {
            'no-redeclare': 'error',
            'no-dupe-class-members': 'error',
            'no-unreachable': 'error',
            'no-const-assign': 'error',
            'no-undef': 'off',
            'no-unused-vars': ['warn', {argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
            'no-empty': ['error', {allowEmptyCatch: true}],
        },
    },
    {
        ignores: ['node_modules/**', 'build/**', 'dist/**', 'extension/schemas/gschemas.compiled'],
    },
];
