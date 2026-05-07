import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Each Claude Code session gets its own worktree under
    // .claude/worktrees/. Those worktrees contain a full project copy,
    // and without this ignore eslint double-scans them from the main
    // checkout, producing tens-of-thousands of duplicate problems.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
