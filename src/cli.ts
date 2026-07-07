import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { MODELS } from './config';
import { judgeResults } from './judge';
import { createJudgeProvider, isJudgeProviderName, type JudgeProviderName } from './judges';
import { parseSkillFile } from './parser';
import { runAB } from './runner';
import { loadTasksForSkill } from './tasks-loader';

interface CliOptions {
  tasks?: string;
  model?: string;
  judgeModel?: string;
  judgeProvider: JudgeProviderName;
  cost?: boolean;
  json?: boolean;
  init?: boolean;
  fast?: boolean;
  runs?: number;
  seed?: number;
  verbose?: boolean;
  failBelow?: number;
  failIfHurtPct?: number;
}

interface SkillevalConfig {
  failBelow?: number;
  failIfHurtPct?: number;
}

interface GateThresholds {
  failBelow?: number;
  failIfHurtPct?: number;
}

const COSTS_PER_MILLION = {
  runner: {
    input: 3.00,
    output: 15.00,
  },
  judge: {
    'gemini-flash': {
      input: 0.10,
      output: 0.40,
    },
    claude: {
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
    .option('--judge-provider <p>', 'Judge provider: gemini-flash | claude | openai', parseJudgeProvider, 'gemini-flash')
    .option('--cost', 'Estimate API cost before running, ask confirmation')
    .option('--json', 'Output results as JSON to stdout (no terminal UI)')
    .option('--init', 'Scaffold a new skill directory with templates')
    .option('--runs <n>', 'Number of independent A/B runs per task', parseRuns, 1)
    .option('--seed <number>', 'Numeric seed for reproducible judge output ordering', parseSeed)
    .option('--verbose', 'Print debug details to stderr')
    .option('--fail-below <threshold>', 'Exit 1 if overall effectiveness is below threshold', parseFloatOption)
    .option('--fail-if-hurt-pct <threshold>', 'Exit 1 if percentage of hurt tasks exceeds threshold', parsePercentOption)
    .addOption(new Option('--fast').hideHelp().default(false))
    .exitOverride()
    .showHelpAfterError();

  try {
    program.parse(argv);

    const skillPath = program.args[0];
    const options = program.opts<CliOptions>();

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
    const config = loadConfig();
    const thresholds = resolveGateThresholds(options, config);
    const fast = options.fast === true;
    const runnerModel = fast ? MODELS.runner.dev : options.model ?? MODELS.runner.default;
    const runs = options.runs ?? 1;
    const judgeProviderName = options.judgeProvider;
    const judgeModelSource = program.getOptionValueSource('judgeModel');
    const judgeModel = fast
      ? MODELS.judge.default
      : defaultJudgeModel(judgeProviderName, judgeModelSource === 'default', options.judgeModel);

    if (fast) {
      console.error('[fast mode] using haiku + gemini-flash - results are indicative only');
    }

    const skill = parseSkillFile(skillFile);
    const tasks = loadTasksForSkill(tasksFile, skill.name);

    if (options.cost) {
      const shouldProceed = await confirmCost(tasks.length, runs, runnerModel, judgeModel, judgeProviderName);
      if (!shouldProceed) return;
    }

    const judge = createJudgeProvider(judgeProviderName);
    validateRunnerApiKey();

    const results = await runAB(skill, tasks, process.env.ANTHROPIC_API_KEY as string, {
      model: runnerModel,
      runs,
    });
    const report = await judgeResults(skill, results, {
      judgeProvider: judgeProviderName,
      judge,
      judgeModel,
      runnerModel,
      print: !options.json,
      runs,
      seed: options.seed,
      verbose: options.verbose,
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    }

    const gateResult = evaluateGate(report.avgDiff, report.tasksHurt, report.totalTasks, thresholds);
    if (gateResult) {
      if (gateResult.passed) {
        console.log(gateResult.message);
      } else {
        console.error(gateResult.message);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    if (isCommanderCleanExit(error)) return;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${detail}`);
    process.exitCode = 2;
  }
}

function isCommanderCleanExit(error: unknown): boolean {
  return (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && 'exitCode' in error
    && (error as { code?: unknown }).code === 'commander.helpDisplayed'
    && (error as { exitCode?: unknown }).exitCode === 0
  );
}

function parseJudgeProvider(value: string): JudgeProviderName {
  if (isJudgeProviderName(value)) {
    return value;
  }
  throw new Error('judge-provider must be one of: gemini-flash, claude, openai');
}

function parseRuns(value: string): number {
  const runs = Number.parseInt(value, 10);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('runs must be a positive integer');
  }
  return runs;
}

function parseSeed(value: string): number {
  const seed = Number.parseInt(value, 10);
  if (!Number.isInteger(seed)) {
    throw new Error('seed must be an integer');
  }
  return seed;
}

function parseFloatOption(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('threshold must be a number');
  }
  return parsed;
}

function parsePercentOption(value: string): number {
  const parsed = parseFloatOption(value);
  if (parsed < 0 || parsed > 100) {
    throw new Error('hurt percentage threshold must be between 0 and 100');
  }
  return parsed;
}

function loadConfig(): SkillevalConfig {
  const configPath = resolve('skilleval.config.json');
  if (!existsSync(configPath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid skilleval.config.json: ${detail}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid skilleval.config.json: expected a JSON object');
  }

  const config = parsed as Record<string, unknown>;
  return {
    failBelow: optionalNumber(config.failBelow, 'failBelow'),
    failIfHurtPct: optionalPercent(config.failIfHurtPct, 'failIfHurtPct'),
  };
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid skilleval.config.json: ${field} must be a number`);
  }
  return value;
}

function optionalPercent(value: unknown, field: string): number | undefined {
  const parsed = optionalNumber(value, field);
  if (parsed === undefined) return undefined;
  if (parsed < 0 || parsed > 100) {
    throw new Error(`Invalid skilleval.config.json: ${field} must be between 0 and 100`);
  }
  return parsed;
}

function resolveGateThresholds(options: CliOptions, config: SkillevalConfig): GateThresholds {
  return {
    failBelow: options.failBelow ?? config.failBelow,
    failIfHurtPct: options.failIfHurtPct ?? config.failIfHurtPct,
  };
}

function evaluateGate(
  avgDiff: number,
  tasksHurt: number,
  totalTasks: number,
  thresholds: GateThresholds,
): { passed: boolean; message: string } | undefined {
  if (thresholds.failBelow === undefined && thresholds.failIfHurtPct === undefined) {
    return undefined;
  }

  const hurtPct = totalTasks === 0 ? 0 : (tasksHurt / totalTasks) * 100;
  const failures: string[] = [];
  if (thresholds.failBelow !== undefined && avgDiff < thresholds.failBelow) {
    failures.push(`effectiveness ${formatGateDiff(avgDiff)} below threshold ${formatNumber(thresholds.failBelow)}`);
  }
  if (thresholds.failIfHurtPct !== undefined && hurtPct > thresholds.failIfHurtPct) {
    failures.push(`hurt rate ${formatNumber(hurtPct)}% above threshold ${formatNumber(thresholds.failIfHurtPct)}%`);
  }

  const hurtSummary = `(${tasksHurt}/${totalTasks} tasks hurt)`;
  if (failures.length > 0) {
    return {
      passed: false,
      message: `skilleval FAILED: ${failures.join('; ')} ${hurtSummary}`,
    };
  }

  return {
    passed: true,
    message: `skilleval PASSED: effectiveness ${formatGateDiff(avgDiff)} ${hurtSummary}`,
  };
}

function formatGateDiff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function validateRunnerApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY. Export ANTHROPIC_API_KEY=your-key before running skilleval.');
  }
}

function defaultJudgeModel(judgeProvider: JudgeProviderName, usedDefault: boolean, model: string | undefined): string {
  if (usedDefault) {
    if (judgeProvider === 'claude') return MODELS.judge.fallback;
    if (judgeProvider === 'openai') return 'gpt-4.1-mini';
    return MODELS.judge.default;
  }
  return model ?? judgeProvider;
}

async function confirmCost(taskCount: number, runs: number, runnerModel: string, judgeModel: string, judgeProvider: JudgeProviderName): Promise<boolean> {
  const estimate = estimateCost(taskCount, runs, judgeProvider);
  console.log(`Estimated cost for ${taskCount} tasks${runs > 1 ? ` x ${runs} runs` : ''}:`);
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

function estimateCost(taskCount: number, runs: number, judgeProvider: JudgeProviderName): { runner: number; judge: number; total: number } {
  const runnerInputTokens = taskCount * runs * 800 * 2;
  const runnerOutputTokens = taskCount * runs * 600 * 2;
  const judgeInputTokens = taskCount * runs * 1200;
  const judgeOutputTokens = taskCount * runs * 80;
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
