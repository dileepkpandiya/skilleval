import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { MODELS } from './config';
import { judgeResults, type JudgeProvider } from './judge';
import { parseSkillFile } from './parser';
import { runAB } from './runner';
import { loadTasksForSkill } from './tasks-loader';

interface CliOptions {
  tasks?: string;
  model?: string;
  judgeModel?: string;
  judgeProvider: JudgeProvider;
  cost?: boolean;
  json?: boolean;
  init?: boolean;
  fast?: boolean;
}

const COSTS_PER_MILLION = {
  runner: {
    input: 3.00,
    output: 15.00,
  },
  judge: {
    gemini: {
      input: 0.10,
      output: 0.40,
    },
    anthropic: {
      input: 0.80,
      output: 4.00,
    },
    openai: {
      input: 0.15,
      output: 0.60,
    },
  },
};

export async function main(argv = process.argv): Promise<void> {
  const { Command, Option } = await import('commander');
  const program = new Command()
    .name('skilleval')
    .usage('<skill-path> [options]')
    .argument('[skill-path]', 'Path to directory containing SKILL.md')
    .option('-t, --tasks <path>', 'Path to tasks YAML file')
    .option('-m, --model <model>', 'Claude model for A/B runner', MODELS.runner.default)
    .option('--judge-model <model>', 'Model for the LLM judge', MODELS.judge.default)
    .option('--judge-provider <p>', 'Judge provider: gemini | anthropic | openai', parseJudgeProvider, 'gemini')
    .option('--cost', 'Estimate API cost before running, ask confirmation')
    .option('--json', 'Output results as JSON to stdout (no terminal UI)')
    .option('--init', 'Scaffold a new skill directory with templates')
    .addOption(new Option('--fast').hideHelp().default(false))
    .showHelpAfterError();

  program.parse(argv);

  const skillPath = program.args[0];
  const options = program.opts<CliOptions>();

  try {
    if (options.init) {
      if (!skillPath) {
        throw new Error('Missing skill-path for --init.');
      }
      scaffoldSkill(skillPath);
      return;
    }

    if (!skillPath) {
      program.help({ error: true });
    }

    const resolved = resolve(skillPath);
    const skillFile = join(resolved, 'SKILL.md');
    const tasksFile = resolve(options.tasks ?? join(resolved, 'tasks.yaml'));
    const fast = options.fast === true;
    const runnerModel = fast ? MODELS.runner.dev : options.model ?? MODELS.runner.default;
    const judgeProvider = options.judgeProvider;
    const judgeModelSource = program.getOptionValueSource('judgeModel');
    const judgeModel = fast
      ? MODELS.judge.default
      : defaultJudgeModel(judgeProvider, judgeModelSource === 'default', options.judgeModel);

    if (fast) {
      console.error('[fast mode] using haiku + gemini-flash - results are indicative only');
    }

    const skill = parseSkillFile(skillFile);
    const tasks = loadTasksForSkill(tasksFile, skill.name);

    if (options.cost) {
      const shouldProceed = await confirmCost(tasks.length, runnerModel, judgeModel, judgeProvider);
      if (!shouldProceed) return;
    }

    validateApiKeys(judgeProvider);

    const results = await runAB(skill, tasks, process.env.ANTHROPIC_API_KEY as string, {
      model: runnerModel,
    });
    const report = await judgeResults(skill, results, {
      judgeProvider,
      judgeModel,
      runnerModel,
      googleApiKey: process.env.GOOGLE_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openAIApiKey: process.env.OPENAI_API_KEY,
      print: !options.json,
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${detail}`);
    process.exitCode = 1;
  }
}

function parseJudgeProvider(value: string): JudgeProvider {
  if (value === 'gemini' || value === 'anthropic' || value === 'openai') {
    return value;
  }
  throw new Error('judge-provider must be one of: gemini, anthropic, openai');
}

function validateApiKeys(judgeProvider: JudgeProvider): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY. Export ANTHROPIC_API_KEY=your-key before running skilleval.');
  }

  if (judgeProvider === 'gemini' && !process.env.GOOGLE_API_KEY) {
    throw new Error(`Missing GOOGLE_API_KEY. Either:
  (a) export GOOGLE_API_KEY=your-key  (free tier available at aistudio.google.com)
  (b) use --judge-provider anthropic to use Claude Haiku instead (costs ~10x more)`);
  }

  if (judgeProvider === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY. Export OPENAI_API_KEY=your-key or choose --judge-provider gemini.');
  }
}

function defaultJudgeModel(judgeProvider: JudgeProvider, usedDefault: boolean, model: string | undefined): string {
  if (judgeProvider === 'anthropic' && usedDefault) {
    return MODELS.judge.fallback;
  }
  return model ?? MODELS.judge.default;
}

async function confirmCost(taskCount: number, runnerModel: string, judgeModel: string, judgeProvider: JudgeProvider): Promise<boolean> {
  const estimate = estimateCost(taskCount, judgeProvider);
  console.log(`Estimated cost for ${taskCount} tasks:`);
  console.log(`   Runner (${runnerModel}):  $${estimate.runner.toFixed(3)}`);
  console.log(`   Judge  (${judgeModel}):   $${estimate.judge.toFixed(3)}`);
  console.log(`   Total:                       $${estimate.total.toFixed(3)}`);
  console.log(' Proceed? (y/n)');

  if (!process.stdin.isTTY) {
    console.log('No interactive terminal detected; skipping run.');
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('> ');
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function estimateCost(taskCount: number, judgeProvider: JudgeProvider): { runner: number; judge: number; total: number } {
  const runnerInputTokens = taskCount * 800 * 2;
  const runnerOutputTokens = taskCount * 600 * 2;
  const judgeInputTokens = taskCount * 1200;
  const judgeOutputTokens = taskCount * 80;
  const runner = (
    runnerInputTokens * COSTS_PER_MILLION.runner.input
    + runnerOutputTokens * COSTS_PER_MILLION.runner.output
  ) / 1_000_000;
  const judgeRates = COSTS_PER_MILLION.judge[judgeProvider];
  const judge = (
    judgeInputTokens * judgeRates.input
    + judgeOutputTokens * judgeRates.output
  ) / 1_000_000;
  return { runner, judge, total: runner + judge };
}

function scaffoldSkill(targetPath: string): void {
  const resolved = resolve(targetPath);
  const skillName = basename(resolved);

  mkdirSync(resolved, { recursive: true });
  writeTemplate(join(resolved, 'SKILL.md'), skillTemplate(skillName));
  writeTemplate(join(resolved, 'tasks.yaml'), tasksTemplate());
  writeTemplate(join(resolved, 'README.md'), `# ${skillName}\n\nOne-line description of what this skill evaluates.\n`);

  console.log(`Scaffolded skill in ${resolved}`);
}

function writeTemplate(filePath: string, contents: string): void {
  if (existsSync(filePath)) return;
  writeFileSync(filePath, contents);
}

function skillTemplate(skillName: string): string {
  return `---
name: ${skillName}
description: What this skill does
version: 1.0.0
triggers:
  - keyword one
  - keyword two
---

## Instructions

Add your skill instructions here. Be specific about:
- What domain this skill covers
- What the model should do differently with this skill active
- Any constraints or rules to follow
`;
}

function tasksTemplate(): string {
  return `tasks:
  - id: task-001
    prompt: "Your first test prompt here"
    context: "Any relevant context for this task"
  - id: task-002
    prompt: "Your second test prompt here"
    context: ""
  - id: task-003
    prompt: "Your third test prompt here"
    context: ""
`;
}

if (require.main === module) {
  void main();
}
