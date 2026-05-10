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
  // Round-3 audit B1.3 — H-01 guardrail scoped to lib/data/.
  //
  // Background: a broad rule firing on every .single() across the
  // codebase produces ~390 warnings, most legitimate (INSERT validation,
  // fixture-precondition lookups, auth.users single-membership selects).
  // That noise drowns the signal. The audit's H-01 hot zone is the
  // lib/data/ wrapper layer — every UPDATE/DELETE-by-id wrapper there
  // must use .maybeSingle() per H-01, because a concurrent delete
  // between the route's pre-check and the wrapper makes zero rows a
  // valid outcome. Other directories have legitimate .single() patterns
  // that aren't audit-relevant.
  //
  // Scope: lib/data/**. Severity: error. The lib/data sites that were
  // H-01 violations were fixed in B1.1 (F-144 / F-148 / F-155); INSERT
  // wrappers retain .single() with the standard ESLint disable directive
  // naming the reason (see createContextLink, createProject,
  // createNode, createContextNode). Going forward, a new bare .single()
  // in lib/data fails CI.
  {
    files: ["lib/data/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='single']",
          message:
            "H-01: lib/data/ wrappers must use .maybeSingle() — zero rows is a valid result on UPDATE/DELETE-by-id paths (concurrent delete race). If .single() is correct (INSERT validation), suppress with: // eslint-disable-next-line no-restricted-syntax -- <reason>.",
        },
      ],
    },
  },
]);

export default eslintConfig;
