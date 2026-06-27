# skilleval

Know if your Claude SKILL.md files actually improve outputs before your users find out they do not.

```bash
npx skilleval ./my-skill --tasks ./tasks.yaml
```

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  skilleval results - api-design - 5 tasks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Skill effectiveness:   +2.4 / 3
  Tasks improved:        4 / 5  (80%)
  Tasks hurt:            0 / 5  (0%)
  Confidence:            HIGH

  task-001  +3.0  HIGH  Added versioning guidance missing without skill
  task-002  +1.8  HIGH  Improved precision on error response format
  task-003  +2.9  HIGH  Surfaced idempotency pattern not mentioned otherwise
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Runner: claude-sonnet-4-6 | Judge: gemini-3.5-flash
  Estimated API cost this run: $0.018
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

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
npm install -g skilleval
```

Or run without installing:

```bash
npx skilleval ./my-skill --tasks ./tasks.yaml
```

Run against a sample skill included in this repo:

```bash
skilleval ./samples/api-design --tasks ./tasks/sample-tasks.yaml
```

## Setup

skilleval needs two API keys:

Runner (required - must be Claude, skills are written for Claude):

```bash
export ANTHROPIC_API_KEY=your-anthropic-key
```

Judge (default - 10x cheaper than Claude for structured scoring):

```bash
export GOOGLE_API_KEY=your-google-key
```

Get a free key at: https://aistudio.google.com

Using Claude as judge instead (no Google key needed):

```bash
skilleval ./my-skill --judge-provider anthropic --judge-model claude-haiku-4-5
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
  --judge-provider <p>    Judge provider: gemini | anthropic | openai
                          (default: gemini)
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

## Use in CI

```yaml
name: Evaluate Skills
on:
  pull_request:
    paths:
      - '**/SKILL.md'
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g skilleval
      - run: skilleval ./my-skill --tasks ./tasks.yaml --json > results.json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
      - name: Fail if skill score is negative
        run: node -e "const r=require('./results.json'); if(r.avgDiff < 0) process.exit(1)"
```

## Scoring

The LLM judge compares the skill and non-skill outputs on correctness, depth, and adherence to task context. It chooses a winner and a margin from 0.0 to 3.0.

```text
diff = withSkillScore - withoutSkillScore
```

Confidence ratings:
- HIGH - the judge is confident in the winner
- MED - useful signal, but review task details
- LOW - weak signal; the skill may be task-dependent

## Contributing

Issues and PRs welcome. Please include a SKILL.md + tasks.yaml that reproduces the issue.

MIT License - Built by @dileepkpandiya
