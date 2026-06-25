# skilleval

Know if your Claude SKILL.md files actually improve outputs - before your users find out they don't.

bash
npx skilleval ./my-skill --tasks ./tasks.yaml
text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  skilleval results · api-design · 5 tasks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Skill effectiveness:   +2.4 / 10
  Tasks improved:        4 / 5  (80%)
  Tasks hurt:            0 / 5  (0%)
  Confidence:            HIGH

  task-001  +3.1  HIGH  ✓ Added versioning guidance missing without skill
  task-002  +1.8  HIGH  ✓ Improved precision on error response format
  task-003  +2.9  HIGH  ✓ Surfaced idempotency pattern not mentioned otherwise
  task-004  +1.6  MED   ✓ Minor improvement on authentication flow
  task-005  +2.6  HIGH  ✓ Correct status code recommendations with skill
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Estimated API cost this run: $0.018
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Why
You install a community SKILL.md. Claude's responses feel better - but is it the skill, or just the prompt? You have no way to know.

You can't eyeball 50 outputs and call it a benchmark

Skills that trigger inconsistently burn tokens without improving anything

When Anthropic updates a model, your skill may silently stop working

skilleval gives you a repeatable, objective score for any SKILL.md file in under 2 minutes.

How it works
text
1. Parse      →  reads your SKILL.md frontmatter + instruction body
2. A/B Run    →  sends each test task to Claude twice:
                   (a) with your skill injected into the system prompt
                   (b) without your skill
3. Judge      →  a blind LLM judge scores both outputs on 3 dimensions:
                   Relevance · Precision · Expertise
4. Report     →  diff score, per-task breakdown, confidence rating
The judge is blind - it doesn't know which output used the skill. This eliminates order bias and position bias from the scoring.

Quickstart
Install globally:

bash
npm install -g skilleval
Or run without installing:

bash
npx skilleval ./my-skill --tasks ./tasks.yaml
Set your API key:

bash
export ANTHROPIC_API_KEY=your-key-here
Run against a sample skill (included in this repo):

bash
skilleval ./samples/api-design --tasks ./tasks/sample-tasks.yaml
Writing test tasks
Create a tasks.yaml file in your skill directory:

text
tasks:
  - id: task-001
    prompt: "Design a REST endpoint for paginating user records"
    context: "Node.js API, PostgreSQL backend, existing auth middleware"

  - id: task-002
    prompt: "What HTTP status code should I return when a resource is not found but the parent exists?"
    context: "We follow RFC 9110 strictly."

  - id: task-003
    prompt: "How should I version a breaking API change without deprecating v1 immediately?"
Tips for writing good tasks:

Match prompts to your skill's stated domain - generic prompts that any LLM answers equally well produce noisy scores

Include context to simulate realistic usage conditions

Aim for 5–10 tasks for a reliable signal (3 is minimum, 15+ is thorough)

Mix easy and hard prompts - if every task scores +3, your rubric may be too coarse

Options
text
Usage: skilleval <skill-path> [options]

Arguments:
  skill-path              Path to directory containing SKILL.md

Options:
  -t, --tasks <path>      Path to tasks YAML file
                          (default: tasks.yaml inside skill directory)
  -m, --model <model>     Claude model for A/B runs
                          (default: claude-opus-4-5)
  --judge-model <model>   Claude model for the LLM judge
                          (default: claude-haiku-4-5)
  --cost                  Show estimated API cost before running
  --json                  Output results as JSON
  --init                  Scaffold a new skill directory with templates
  -h, --help              Show help
Scaffold a new skill:

bash
skilleval --init ./my-new-skill
# Creates my-new-skill/SKILL.md and my-new-skill/tasks.yaml from templates
Get JSON output for CI pipelines:

bash
skilleval ./my-skill --tasks ./tasks.yaml --json > results.json
Cheaper runs during development (haiku for both eval and judge):

bash
skilleval ./my-skill --model claude-haiku-4-5 --judge-model claude-haiku-4-5
Use in CI (GitHub Actions)
text
# .github/workflows/skill-eval.yml
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
      - name: Fail if skill score is negative
        run: node -e "const r=require('./results.json'); if(r.diff < 0) process.exit(1)"
Scoring dimensions
The LLM judge scores each output on:

Dimension	What it measures
Relevance	How directly and completely the output addresses the task
Precision	Whether the output is specific and actionable vs vague and generic
Expertise	Whether the output demonstrates domain knowledge and nuanced understanding
Each dimension is scored 1–10. The final diff is:

text
diff = avg(withSkill scores) - avg(withoutSkill scores)
Confidence ratings:

HIGH - all 3 dimensions agree on direction

MEDIUM - 2 of 3 dimensions agree

LOW - dimensions are split (skill may be task-dependent)

Repo structure
text
skilleval/
├── src/
│   ├── parser.ts         # SKILL.md parser
│   ├── runner.ts         # Claude A/B eval runner
│   ├── judge.ts          # LLM judge scoring engine
│   ├── score-report.ts   # Terminal report formatter
│   ├── tasks-loader.ts   # tasks.yaml loader
│   └── cli.ts            # CLI entry point
├── samples/
│   ├── api-design/       # Sample skill: API design best practices
│   ├── code-review/      # Sample skill: Code review
│   └── test-writer/      # Sample skill: Unit test generation
├── tasks/
│   └── sample-tasks.yaml
├── .env.example
├── LICENSE               # MIT
└── README.md
Contributing
Issues and PRs welcome. Please include a failing task example that reproduces your bug - it helps verify any fix works correctly.

MIT License · Built by @dileepkpandiya
