# Changelog

## Unreleased
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
