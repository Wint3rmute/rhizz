import path from "node:path";
import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import { includeIgnoreFile } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";
import svelteConfig from "./svelte.config.js";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

export default ts.config(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  svelte.configs["flat/recommended"],
  {
    // typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
    // see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true },
    },
    rules: { "no-undef": "off" },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.mts", "src/**/*.cts"],
    extends: [
      ts.configs.strictTypeChecked,
      ts.configs.stylisticTypeChecked,
    ],
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: [".svelte"],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Override or add rule settings here, such as:
    // 'svelte/button-has-type': 'error'
    plugins: {
      "@typescript-eslint": ts.plugin,
    },
    rules: {
      // Lets `const { a, ...rest } = obj` patterns destructure a field
      // purely to exclude it from `rest`, without `a` itself being
      // flagged as unused — used throughout vfs/types.test.ts to build
      // "this object minus one required field" fixtures.
      "@typescript-eslint/no-unused-vars": ["error", {
        args: "after-used",
        ignoreRestSiblings: true,
      }],
      // Empty arrow functions are used deliberately as no-op stubs for
      // Storybook prop defaults and `vi.spyOn().mockImplementation()`;
      // empty methods/class methods are still flagged.
      "@typescript-eslint/no-empty-function": ["error", {
        allow: ["arrowFunctions"],
      }],
    },
  },
  {
    // A .ts file that imports a first-party non-`.svelte.ts` Svelte module
    // (e.g. `./ProjectState.svelte`) gets its exports typed as `any` by
    // typescript-eslint's `projectService`: ESLint's TS program can't parse
    // `.svelte`, so those imports resolve to `any`, and the `no-unsafe-*`
    // rules fire on every use of them. svelte-check (run in `just lint`)
    // types these through svelte2tsx and is clean. These are therefore
    // false positives limited to story/test/support imports of our own
    // Svelte module files; the `no-unsafe-*` rules stay fully enabled for
    // all pure-`.ts` app code. This override is scoped to exactly the
    // files that import such modules.
    files: [
      "**/explore/Explore.stories.ts",
      "**/components/Navbar.stories.ts",
      "**/vfs/compile.test.ts",
      "**/diagrams/ComponentHierarchyTree.stories.ts",
      "src/example_system.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // typescript-eslint's no-unused-vars misreads callback *parameter*
    // names in local Svelte `interface Props` declarations (e.g.
    // `onupdate: (patch) => void`) as unused bindings — they're type-only
    // signatures, never runtime variables, and svelte-check confirms they
    // are unused-in-the-template. `args: "none"` skips argument-name
    // checking only in Svelte files (variables are still checked).
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    rules: {
      // typescript-eslint's `no-unused-vars` false-positives on the
      // callback *parameter* names inside Svelte's local `interface Props`
      // type signatures (e.g. `onupdate: (patch) => void`): svelte-eslint-
      // parser surfaces them as top-level scope variables, so neither
      // `args` nor `varsIgnorePattern` can reach them. Neither TypeScript
      // nor svelte-check flags these (interface param names are never
      // "unused" in TS semantics), so the rule adds no signal here while
      // producing noise. Disabled only for Svelte files — pure `.ts`
      // files keep full unused-var checking.
      "@typescript-eslint/no-unused-vars": "off",
      // The core `no-unused-vars` rule (from js.configs.recommended) has the
      // same false positive on Svelte `interface Props`, and it also can't
      // understand Svelte's scoping at all — svelte-eslint-parser routes
      // unused-var analysis through the `@typescript-eslint` rule, so this
      // core rule is pure noise on `.svelte` files.
      "no-unused-vars": "off",
    },
  },
);
