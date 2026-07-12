# skilleval

![skilleval demo](./demo.gif)

Know if your Claude SKILL.md files actually improve outputs before your users find out they do not.

```bash
npx @dileeppandiya/skilleval ./my-skill --tasks ./tasks.yaml
```

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  skilleval results - api-design - 2 tasks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Skill effectiveness:   +0.3 / 3
  Tasks improved:        1 / 2  (50%)
  Tasks hurt:            1 / 2  (50%)
  Confidence:            UNRATED (use --runs 3+ for confidence)

  task-003  +2.5  UNRATED (use --runs 3+ for confidence)  Output A provides a more robust and production-ready API design, featuring critical real-world details like idempotency keys, index-based correlation to handle duplicate request items, and a detailed audit logging schema.
  task-004  -2.0  UNRATED (use --runs 3+ for confidence)  Output A is more comprehensive and tailored to a public API, offering highly actionable long-term compatibility advice such as a phased migration strategy with Sunset headers and idempotency keys for safe retries.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Runner: claude-sonnet-4-6 | Judge: gemini-3.5-flash
  Estimated API cost this run: $0.101
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

This is a real, unedited run against one of the sample skills in this repo. Note the mixed signal — the skill helped on task-003 but hurt on task-004. skilleval doesn't inflate scores to make skills look good; it reports what the judge actually found, including when a skill only helps some of the time.

## Why

You install a community SKILL.md. Claude's responses feel better, but is it the skill or just the prompt?

You cannot eyeball 50 outputs and call it a benchmark. Skills that trigger inconsistently burn tokens without improving anything. When Anthropic updates a model, your skill may silently stop working.

skilleval gives you a repeatable score for any SKILL.md file in under 2 minutes.

## How it works

```text
1. Parse      -> reads your SKILL.md frontmatter + instruction body
2. A/B Run    -> sends each test task to Claude twice:
                 (a) with your skill injected into the system prompt
                 (b) without your skill
3. Assert     -> optional deterministic task assertions check the skill output
4. Judge      -> a blind LLM judge compares the two outputs
5. Report     -> diff score, per-task breakdown, confidence rating
```

The judge is blind. It does not know which output used the skill, and output order is randomized to reduce position bias.

Default models:
- Runner: `claude-sonnet-4-6`
- Judge: `gemini-3.5-flash`

## Quickstart

Install globally:

```bash
npm install -g @dileeppandiya/skilleval
```

Or run without installing:

```bash
npx @dileeppandiya/skilleval ./my-skill --tasks ./tasks.yaml
```

Run against a sample skill included in this repo:

```bash
skilleval ./samples/api-design --tasks ./tasks/sample-tasks.yaml
```

## CI Usage

Add to any GitHub Actions workflow:

```yaml
- uses: dileepkpandiya/skilleval@main
  with:
    skill-path: ./my-skill
    tasks: ./tasks/sample-tasks.yaml
    fail-below: '0.3'
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

Full example in `.github/workflows/skilleval-example.yml`.

## Setup

skilleval needs a Claude runner key and one judge key:

Runner (required - must be Claude, skills are written for Claude):

```bash
export ANTHROPIC_API_KEY=your-anthropic-key
```

Default judge (`gemini-flash`):

```bash
export GEMINI_API_KEY=your-gemini-key
```

Get a free key at: https://aistudio.google.com

Supported judge providers:
- `gemini-flash` uses `GEMINI_API_KEY` and is the default low-cost judge. Gemini Flash reliability can vary by model/version; skilleval requests native JSON output, but skipped judge results are still reported explicitly if parsing fails after retries.
- `claude` uses `ANTHROPIC_API_KEY` and is available as a more consistent, though pricier, fallback judge.
- `openai` uses `OPENAI_API_KEY`.

Using Claude as judge:

```bash
skilleval ./my-skill --judge-provider claude
```

To verify Gemini reliability on your account before trusting it in CI, run the documented 10-run check:

```bash
./scripts/gemini-reliability-test.sh
```

It runs the same two-task eval against Gemini 10 times and fails if the skipped-task rate is 10% or higher.

## Writing test tasks

Create a `tasks.yaml` file in your skill directory:

```yaml
tasks:
  - id: task-001
    prompt: "Design a REST endpoint for paginating user records"
    context: "Node.js API, PostgreSQL backend, existing auth middleware"

  - id: task-002
    prompt: "What HTTP status code should I return when a resource is not found but the parent exists?"
    context: "We follow RFC 9110 strictly."

  - id: task-003
    prompt: "How should I version a breaking API change without deprecating v1 immediately?"
    context: ""
```

Add optional deterministic assertions when a task has concrete requirements that should be checked before interpreting the LLM judge:

```yaml
tasks:
  - id: api-design-001
    prompt: "Design a REST endpoint for user login"
    context: "Building a Node.js API"
    assertions:
      must_contain:
        - "POST"
        - "401"
      must_not_contain:
        - "GET /login"
      regex_match:
        - "POST\\s+/.*login"
      min_length: 100
      max_length: 2000
```

Assertions run only against the skill-assisted output. If an assertion fails, skilleval still runs the LLM judge, reports the assertion failure in terminal and JSON output, and caps the final task diff to `<= -0.5` so the task counts as hurt. Tasks without assertions work unchanged.

Tips for writing good tasks:
- Match prompts to your skill's stated domain. Generic prompts that any LLM answers equally well produce noisy scores.
- Include context to simulate realistic usage conditions.
- Use assertions for hard requirements such as required status codes, forbidden endpoints, output length, or regex-shaped content.
- Aim for 5-10 tasks for a reliable signal. 3 is minimum, 15+ is thorough.
- Mix easy and hard prompts. If every task scores +3, your rubric may be too coarse.

## Options

```text
Usage: skilleval <skill-path> [options]

Arguments:
  skill-path              Path to directory containing SKILL.md

Options:
  -t, --tasks <path>      Path to tasks YAML file
                          (default: tasks.yaml inside skill directory)
  -m, --model <model>     Claude model for A/B runner
                          (default: claude-sonnet-4-6)
  --judge-model <model>   Model for the LLM judge
                          (default: gemini-3.5-flash)
  --judge-provider <p>    Judge provider: gemini-flash | claude | openai
                          (default: gemini-flash)
  --runs <n>              Number of independent A/B runs per task
                          (default: 1)
  --seed <number>         Numeric seed for reproducible judge output ordering
  --verbose               Print debug details to stderr
  --no-history            Do not save eval result history
  --fail-below <n>        Exit 1 if overall effectiveness is below threshold
  --fail-if-hurt-pct <n>  Exit 1 if percentage of hurt tasks exceeds threshold
  --cost                  Estimate API cost before running, ask confirmation
  --json                  Output results as JSON to stdout
  --init                  Scaffold a new skill directory with templates
  -h, --help              Show help
```

Scaffold a new skill:

```bash
skilleval --init ./my-new-skill
```

Get JSON output for CI pipelines:

```bash
skilleval ./my-skill --tasks ./tasks.yaml --json > results.json
```

Estimate cost before running:

```bash
skilleval ./my-skill --cost
```

Compare two skill versions directly:

```bash
skilleval compare ./skill-v1 ./skill-v2 --tasks ./tasks.yaml
```

## Multi-run averaging

By default, skilleval runs each task once and marks confidence as `UNRATED` because stability cannot be inferred from a single sample. Use `--runs N` when judge scores are noisy, a skill is near the pass/fail line, or before trusting a score in CI.

When `N > 1`, skilleval reruns the full skill-on and skill-off eval loop sequentially, judges each paired run, and reports mean, median, and standard deviation across the collected diffs. JSON output keeps each individual run under `runs` and adds an `aggregate` object. Pair it with `--seed <number>` when you need reproducible output ordering while debugging. Add `--verbose` to log which side received the skill-assisted output for each judged pair.

## Compare Skill Versions

Use `compare` when you want to test whether an edited skill is better than the previous version without manually diffing separate eval runs:

```bash
skilleval compare ./skill-v1 ./skill-v2 --tasks ./tasks.yaml
```

The report is scored as `skill-v2 - skill-v1`, so a positive average diff means the second skill path performed better. Use `--json` for machine-readable output or `--runs 3` for repeated-run confidence.

## History & Diff

skilleval auto-saves results to `.skilleval/history/` after each run.

View what changed since your last run:

```bash
skilleval diff ./my-skill
```

Use `--no-history` to skip saving, for example in CI:

```bash
skilleval ./my-skill --tasks ./tasks.yaml --no-history
```

## CI Usage

Use threshold flags to turn skilleval into a PR check. `--fail-below` fails when the overall effectiveness score is too low, and `--fail-if-hurt-pct` fails when too many tasks regress. Threshold failures exit with code 1; runtime or configuration errors exit with code 2.

```yaml
name: skilleval

on:
  pull_request:
    paths:
      - '**/SKILL.md'

jobs:
  skilleval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx @dileeppandiya/skilleval ./skill --tasks ./tasks.yaml --fail-below 0.3 --runs 3
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

You can also store thresholds in `skilleval.config.json` and keep the workflow command shorter:

```json
{
  "failBelow": 0.3,
  "failIfHurtPct": 50
}
```

Command-line flags override values from `skilleval.config.json`.

## Scoring

The LLM judge compares the skill and non-skill outputs on correctness, depth, and adherence to task context. It chooses a winner and a margin from 0.0 to 3.0.

```text
diff = withSkillScore - withoutSkillScore
```

Confidence ratings:
- UNRATED - only one run was collected; use `--runs 3+` for confidence
- HIGH - repeated runs were stable
- MEDIUM - useful signal, but review task details
- LOW - noisy signal; the skill may be task-dependent

## Development

Run the offline unit test suite:

```bash
npm test
```

Run TypeScript compilation:

```bash
npm run build
```

## Contributing

Issues and PRs welcome. Please include a SKILL.md + tasks.yaml that reproduces the issue.

MIT License - Built by @dileepkpandiya
