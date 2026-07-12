# Changelog

## [0.3.0] - 2026-07-12

### Added
- Multi-turn task support — test skills across conversation
  turns using the `turns:` field in tasks.yaml
- Accurate cost estimation — `--cost` now estimates tokens
  from actual task content instead of hardcoded assumptions
- `--skill-target` CLI flag — filter tasks from a shared
  task library by target skill name
- Shared task library documentation and example

## [0.2.0] - 2026-07-12

### Added
- GitHub Action (`uses: dileepkpandiya/skilleval@main`)
  for one-line CI integration
- Run history auto-saved to `.skilleval/history/` after
  each eval
- `skilleval diff` command — compare current run against
  previous run to catch skill regressions
- `--compare <path>` flag — compare two skill versions
  head-to-head
- `--no-history` flag — skip history saving in ephemeral
  CI environments

## [0.1.0] - 2026-06-28

### Added
- Initial release — blind A/B testing of SKILL.md files
- LLM judge with Gemini Flash, Claude, OpenAI support
- Deterministic assertions (must_contain, must_not_contain,
  regex_match, min/max length)
- UNRATED confidence label for single runs
- Multi-run averaging with stddev-based confidence
- CI gating via --fail-below and --fail-if-hurt-pct
- JSON output mode
- Vitest unit test suite (38 tests)
