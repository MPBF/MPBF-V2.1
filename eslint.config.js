import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  /**
   * =========================
   * ✅ Ignored paths
   * =========================
   */
  {
    ignores: [
      "dist/**",
      "build/**",
      "node_modules/**",
      "**/node_modules/**",
      ".local/**",
      ".agents/**",
      ".cache/**",
      ".config/**",
      ".canvas/**",
      ".playwright-mcp/**",
      ".serena/**",
      ".superpowers/**",
      "coverage/**",
    ],
  },

  /**
   * =========================
   * ✅ Base configs
   * =========================
   */
  js.configs.recommended,
  ...tseslint.configs.recommended,

  /**
   * =========================
   * ✅ App source files
   * =========================
   */
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      import: importPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      /* -------------------------
         🔴 CRITICAL – لا تُخفف
      ------------------------- */
      "react-hooks/rules-of-hooks": "error",
      "no-debugger": "error",

      /* -------------------------
         🟠 IMPORTANT – تحذير مرحلي
      ------------------------- */
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",

      "no-console": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
      "no-useless-catch": "warn",

      /* -------------------------
         🧹 Unused vars
      ------------------------- */
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      /* -------------------------
         📦 Imports
      ------------------------- */
      "import/no-unresolved": "off",
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "type",
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      /* -------------------------
         ⚛️ React
      ------------------------- */
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },

  /**
   * =========================
   * ✅ Scripts & config files
   * =========================
   */
  {
    files: ["scripts/**/*.{js,mjs,cjs,ts}", "*.config.{js,mjs,cjs,ts}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true }],
    },
  },

  // CommonJS scripts use Node's require/module globals and module semantics.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      // A module-local import may share a name with a Node/browser global.
      "no-redeclare": ["error", { builtinGlobals: false }],
    },
  },

  // Express extends its Request type through an ambient namespace declaration.
  {
    files: ["server/auth.ts"],
    rules: {
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },

  /**
   * =========================
   * ✅ New / clean code (اختياري للمستقبل)
   * =========================
   */
  {
    files: ["src/new/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
    },
  },
];
