# skilleval

![skilleval demo](./demo.gif)

Measure whether Claude SKILL.md files improve outputs with blind A/B testing, deterministic assertions, multi-turn tasks, run history, skill comparison, and CI gating.

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

This is a real, unedited run against one of the sample skills in this repo. Note the mixed signal: the skill helped on task-003 but hurt on task-004. skilleval does not inflate scores to make skills look good; it reports what the judge found, including when a skill only helps some of the time.

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

## Features

- Blind A/B testing with randomized side assignment
- LLM judge: Gemini Flash default, Claude, and OpenAI supported
- Deterministic assertions: `must_contain`, `must_not_contain`, `regex_match`, `min_length`, `max_length`
- Multi-turn conversation task support
- Accurate cost estimation from actual task content
- Multi-run averaging with real statistical confidence: `UNRATED` at `--runs 1`, `HIGH`/`MEDIUM`/`LOW` at `--runs 3+`
- Skill-vs-skill comparison mode with `--compare`
- Run history auto-saved to `.skilleval/history/`
- `skilleval diff` to see what changed since the last run
- CI/CD gating via `--fail-below` and `--fail-if-hurt-pct`
- GitHub Action: `uses: dileepkpandiya/skilleval@main`
- Shared task libraries via the `skillTarget` field
- JSON output mode with `--json` for pipeline integration
- Cost estimation before running with `--cost`
- Scaffold new skills with `--init`

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

Use `turns` for multi-turn tasks:

```yaml
tasks:
  - id: followup-001
    context: "Debugging session"
    turns:
      - role: user
        content: "My API returns 401"
      - role: assistant
        content: "Are you sending the Authorization header?"
      - role: user
        content: "Yes, still getting 401"
```

Tips for writing good tasks:
- Match prompts to your skill's stated domain. Generic prompts that any LLM answers equally well produce noisy scores.
- Include context to simulate realistic usage conditions.
- Use assertions for hard requirements such as required status codes, forbidden endpoints, output length, or regex-shaped content.
- Use multi-turn tasks for follow-up behavior, clarification loops, debugging sessions, and skills that depend on conversation state.
- Aim for 5-10 tasks for a reliable signal. 3 is minimum, 15+ is thorough.
- Mix easy and hard prompts. If every task scores +3, your rubric may be too coarse.

## Assertions

Add deterministic assertions when a task has concrete requirements that should be checked before interpreting the LLM judge:

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

## Shared Task Libraries

Tag tasks with `skillTarget` to share a single `tasks.yaml` across multiple skills:

```yaml
tasks:
  - id: task-001
    prompt: "Design a REST endpoint"
    skillTarget: api-design
  - id: task-002
    prompt: "Write a GraphQL query"
    skillTarget: graphql-design
```

Run only tasks for a specific skill:

```bash
skilleval ./my-skill --tasks ./shared-tasks.yaml
```

Override the skill target filter from the CLI:

```bash
skilleval ./my-skill --tasks ./shared-tasks.yaml \
  --skill-target api-design
```

## Multi-Turn Tasks

Test skills across conversation turns, not just single prompts:

```yaml
tasks:
  - id: followup-001
    context: "Debugging session"
    turns:
      - role: user
        content: "My API returns 401"
      - role: assistant
        content: "Are you sending the Authorization header?"
      - role: user
        content: "Yes, still getting 401"
```

The skill is injected into the system prompt for all turns. The judge sees the full conversation context when scoring.

## CLI Options

```text
Usage: skilleval <skill-path> [options]

Arguments:
  [skill-path]            Path to SKILL.md directory

Options:
  -t, --tasks <path>      Path to tasks YAML file
  -m, --model <model>     Claude model for runner
  --judge-model <model>   Model for LLM judge
  --judge-provider <p>    gemini-flash | claude | openai
  --skill-target <name>   Filter tasks by skillTarget field
  --compare <path>        Compare against a second skill directory
  --runs <n>              Independent A/B runs per task
  --seed <n>              Seed for reproducible judge ordering
  --cost                  Estimate API cost before running
  --json                  Output results as JSON
  --no-history            Skip saving run history
  --verbose               Print debug details to stderr
  --fail-below <n>        Exit 1 if effectiveness below threshold
  --fail-if-hurt-pct <n>  Exit 1 if hurt % exceeds threshold
  --init                  Scaffold a new skill directory
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

Compare two skill versions:

```bash
skilleval compare ./skill-v1 ./skill-v2 --tasks ./tasks.yaml
```

The compare report is scored as `skill-v2 - skill-v1`, so a positive average diff means the second skill path performed better. Use `--json` for machine-readable output or `--runs 3` for repeated-run confidence.

By default, skilleval runs each task once and marks confidence as `UNRATED` because stability cannot be inferred from a single sample. Use `--runs N` when judge scores are noisy, a skill is near the pass/fail line, or before trusting a score in CI.

When `N > 1`, skilleval reruns the full skill-on and skill-off eval loop sequentially, judges each paired run, and reports mean, median, and standard deviation across the collected diffs. JSON output keeps each individual run under `runs` and adds an `aggregate` object. Pair it with `--seed <number>` when you need reproducible output ordering while debugging.

## CI Usage / GitHub Action

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

## Configuration

skilleval needs a Claude runner key and one judge key.

Runner (required because skills are written for Claude):

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

You can store CI thresholds in `skilleval.config.json` and keep workflow commands shorter:

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
