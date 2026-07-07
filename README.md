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
  Confidence:            HIGH

  task-003  +2.5  HIGH  Output A provides a more robust and production-ready API design, featuring critical real-world details like idempotency keys, index-based correlation to handle duplicate request items, and a detailed audit logging schema.
  task-004  -2.0  HIGH  Output A is more comprehensive and tailored to a public API, offering highly actionable long-term compatibility advice such as a phased migration strategy with Sunset headers and idempotency keys for safe retries.
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
3. Judge      -> a blind LLM judge compares the two outputs
4. Report     -> diff score, per-task breakdown, confidence rating
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
- `gemini-flash` uses `GEMINI_API_KEY` and is the default low-cost judge.
- `claude` uses `ANTHROPIC_API_KEY`.
- `openai` uses `OPENAI_API_KEY`.

Using Claude as judge:

```bash
skilleval ./my-skill --judge-provider claude
```

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

Tips for writing good tasks:
- Match prompts to your skill's stated domain. Generic prompts that any LLM answers equally well produce noisy scores.
- Include context to simulate realistic usage conditions.
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

## Multi-run averaging

Use `--runs N` when judge scores are noisy, a skill is near the pass/fail line, or before trusting a score in CI. skilleval reruns the skill-on and skill-off generations independently for each task, judges each paired run, and reports the mean, standard deviation, and range. Pair it with `--seed <number>` when you need reproducible output ordering while debugging. Add `--verbose` to log which side received the skill-assisted output for each judged pair.

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
- HIGH - the judge is confident in the winner
- MEDIUM - useful signal, but review task details
- LOW - weak signal; the skill may be task-dependent

## Contributing

Issues and PRs welcome. Please include a SKILL.md + tasks.yaml that reproduces the issue.

MIT License - Built by @dileepkpandiya
