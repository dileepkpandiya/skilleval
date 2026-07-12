# Changelog

## Unreleased
- Added deterministic per-task assertions in `tasks.yaml` with JSON and terminal reporting.
- Added `UNRATED` confidence for single-run evals; use `--runs 3+` for HIGH/MEDIUM/LOW confidence.
- Added multi-run aggregate JSON output with per-run details.
- Added Vitest unit tests for judge scoring, assertions, and parser behavior.
- Increased Gemini judge structured-output `maxOutputTokens` to 2048 and added finish-reason diagnostics so `MAX_TOKENS` truncation is visible in retry warnings and skipped-task reasons.
- Switched the Gemini judge to native structured JSON output with a response schema while retaining a three-attempt malformed JSON retry fallback.
- Judge failures now produce explicit `status: "skipped"` task results with skip reasons and summary counts instead of silently dropping failed tasks.
- Hardened blind-judge position randomization with crypto-backed default randomness, numeric seeded reproducibility, and verbose-only assignment logging.
- Fixed a judge prompt bias that described all outputs as code reviews; the judge prompt now uses domain-neutral task-quality criteria and explicitly warns not to infer which position used the skill.

## [0.1.0] - 2026-06-26 - Initial release
- SKILL.md parser with YAML frontmatter support
- A/B eval runner using claude-sonnet-4-6
- Blind LLM judge using gemini-3.5-flash (10x cheaper than Claude Haiku)
- Terminal score report with per-task breakdown
- CLI with --init, --cost, --json, --fast flags
- GitHub Actions example in README
- 3 sample skills: api-design, code-review, test-writer
