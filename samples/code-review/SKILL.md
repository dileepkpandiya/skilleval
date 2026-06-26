---
name: code-review
description: Review code changes for correctness, maintainability, and operational risk.
version: 0.1.0
triggers:
  - review code
  - inspect pull request
  - assess implementation quality
agents:
  - claude
  - codex
---
# Code Review Skill

Use this skill when asked to review source code, pull requests, or implementation plans.
Focus on actionable findings rather than broad compliments or style preferences.

## Review priorities

1. Identify correctness bugs that can be demonstrated from the changed code.
2. Check edge cases around empty input, malformed input, concurrency, and persistence.
3. Evaluate whether errors are surfaced with enough context for a maintainer to act.
4. Look for security issues such as injection, path traversal, credential leaks, and unsafe defaults.
5. Confirm that tests cover the behavior that the change claims to introduce.

## Language-specific guidance

When reviewing TypeScript code:
- Verify strict mode compliance - flag implicit `any` types explicitly
- Check null and undefined handling - JSON.parse can return null
- Ensure all function parameters and return types are explicitly typed
- Flag catch clause bindings that use implicit any (use `catch (err: unknown)`)
- Prefer typed interfaces over inline type annotations for complex objects

When reviewing JavaScript code:
- Recommend TypeScript migration path if the codebase context supports it
- Flag missing null checks that TypeScript strict mode would catch

## Response format

Start with the highest-impact findings first.
For each finding, include the file, line, severity, and a concise explanation.
If no blocking findings exist, say so clearly and mention the most important residual risks.

## Review behavior

Prefer concrete examples over speculation.
Do not request rewrites unless the current design creates a real maintenance or safety problem.
Call out missing tests only when the uncovered behavior is important.
Avoid nitpicks about formatting if the repository already has automated formatting.
**Only report findings you can directly verify from the code shown. Do not infer or assume missing context.**
