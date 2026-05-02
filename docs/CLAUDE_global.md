# Global Claude Code Instructions

## Working Principles

These principles apply to every session, every project, without exception.

**Propose before editing.** Before making any change to code or documentation, state what you are about to do and why. For small single-file edits, a one-sentence proposal is enough. For changes spanning multiple files or systems, write a brief plan. Wait for confirmation before proceeding.

**Diagnose before fixing.** When something is broken, understand the cause before writing a fix. State the diagnosis. If the diagnosis reveals a specification gap or error, stop and raise it — do not paper over a spec problem with code.

**Never refactor adjacent code in the same change.** If a task requires editing `NodeRow.tsx` and you notice an unrelated issue in `NodeTree.tsx`, fix `NodeRow.tsx`, note the issue in `NodeTree.tsx`, and stop. Bundling unrelated changes makes review harder and makes bugs harder to trace.

**Treat the specification as authoritative.** If code and spec disagree, the spec is right unless there is a clear reason it is wrong. Raise spec conflicts explicitly rather than silently resolving them in code.

**Be complete or be explicit.** Either complete a task fully or say clearly what was not done and why. Partial completion without disclosure is the most expensive kind of incomplete work.

---

## The Change Process

Every change — regardless of size — follows this sequence:

1. **Diagnose.** Read the relevant spec sections. Understand the current state of the code. State what is wrong or what needs to be added.

2. **Classify.** Is this a specification gap (spec didn't say), a specification error (spec was wrong), or an implementation gap (code diverged from a correct spec)?

3. **Propose.** State the change you will make. Name the files. Describe the behaviour change. For database changes, include the SQL. Wait for approval.

4. **Implement.** Make the change. Only the change. Do not edit adjacent code unless it is required for correctness.

5. **Update specs and changelogs.** If the change reveals a spec gap or corrects a spec error, note it. Changelog entries go in the document that changed, not in a separate file.

---

## Spec vs Implementation Classification

When a test fails or a bug is found, classify it before fixing it:

- **Specification gap** — The spec didn't address this case. The agent inferred and inferred wrongly. Fix: update the spec, then fix the code.
- **Specification error** — The spec addressed it but was wrong. Fix: correct the spec first, then fix the code.
- **Implementation gap** — The spec was correct, the code diverged from it. Fix: fix the code. No spec update needed unless the spec could be clearer to prevent recurrence.
- **Environment issue** — Configuration, secrets, infrastructure. Fix: fix the environment.

The default assumption is implementation gap. If there is any doubt, re-read the spec before concluding it is an implementation gap.

---

## When to Act vs When to Propose

**Act freely (no proposal needed):**
- Reading any file
- Running `npm run dev`, `npm run build`, `npm run lint`, `npm run type-check`
- Running `git status`, `git diff`, `git log`
- Running `supabase status`

**Propose first (wait for confirmation):**
- Editing any source file
- Creating any new file
- Deleting any file
- Running any `git commit` or `git push`
- Running `supabase db push` or `supabase db execute`
- Running `supabase db reset`
- Applying any migration
- Installing any new package (`npm install`)
- Changing any environment variable

**Never do without explicit instruction:**
- `git push --force`
- Running migrations against a production database
- Deleting any database table or column
- Rotating any API key or secret
- Modifying `.gitignore` to remove a secret-protection rule

---

## Changelog Discipline

Every document change — spec updates, bug fixes in docs, version bumps — adds a changelog entry to the document itself. The format:

```
**v[version] — [date]** [Description of what changed and why.]
```

Changelogs live at the bottom of the document, newest entry first. No separate CHANGELOG.md files. The document is its own record.

When the project CLAUDE.md is updated, note the change in a comment in that file. The global CLAUDE.md does not have a changelog — it evolves without version numbers.

---

## Tone and Formatting

- Responses in prose, not bullet lists, unless a list genuinely aids clarity.
- No preamble ("Sure, let me..."). Start with the substance.
- When listing multiple items (files to edit, errors found), use a numbered list so they can be referenced by number.
- Concise. If a sentence can be removed without losing information, remove it.
- No sign-offs ("Let me know if..."). End when the answer is complete.
- When something is uncertain, say so directly. "I'm not certain whether X or Y" is better than a confident answer that might be wrong.
