import { randomInt } from 'node:crypto';
import { MODELS } from './config';
import { createJudgeProvider, type JudgeProvider, type JudgeProviderName, type JudgeResult as ProviderJudgeResult } from './judges';
import type { ParsedSkill } from './parser';
import type { ABResult } from './runner';

export interface EvalTaskResult {
  taskId: string;
  withSkillScore: number;
  withoutSkillScore: number;
  diff: number;
  confidence: ResultConfidence;
  reasoning: string;
  scores?: number[];
  mean?: number;
  stddev?: number;
  min?: number;
  max?: number;
  runs?: number;
}

export interface EvalReport {
  skillName: string;
  model: string;
  judgeModel: string;
  totalTasks: number;
  avgDiff: number;
  tasksImproved: number;
  tasksHurt: number;
  tasksNeutral: number;
  overallConfidence: ResultConfidence;
  results: EvalTaskResult[];
  estimatedCost: number;
  runs: number;
  avgStddev?: number;
  minDiff?: number;
  maxDiff?: number;
}

export type ResultConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface JudgeOptions {
  judgeModel?: string;
  judgeProvider?: JudgeProviderName;
  judge?: JudgeProvider;
  runnerModel?: string;
  runnerInputTokens?: number;
  runnerOutputTokens?: number;
  print?: boolean;
  runs?: number;
  seed?: number;
  verbose?: boolean;
  onPositionAssignment?: (assignment: PositionAssignment) => void;
}

export interface PositionAssignment {
  taskId: string;
  runIndex: number;
  skillOnPosition: 'A' | 'B';
  skillOffPosition: 'A' | 'B';
}

export interface UsageTotals {
  judgeInputTokens: number;
  judgeOutputTokens: number;
}

const RUNNER_MODEL = process.env.SKILLEVAL_DEV === 'true'
  ? MODELS.runner.dev
  : MODELS.runner.default;
const JUDGE_MODEL = MODELS.judge.default;

export async function judgeResults(
  skill: ParsedSkill,
  results: ABResult[],
  options: JudgeOptions = {},
): Promise<EvalReport> {
  const providerName = options.judgeProvider ?? 'gemini-flash';
  const judge = options.judge ?? createJudgeProvider(providerName);
  const judgeModel = options.judgeModel ?? providerName;
  const judged: EvalTaskResult[] = [];
  const usage: UsageTotals = { judgeInputTokens: 0, judgeOutputTokens: 0 };
  const rng = createRng(options.seed);

  for (const taskResults of groupResultsByTask(results)) {
    const samples: Array<{
      withSkillScore: number;
      withoutSkillScore: number;
      diff: number;
      reasoning: string;
    }> = [];

    for (const result of taskResults) {
      const swapped = rng() < 0.5;
      const assignment: PositionAssignment = {
        taskId: result.taskId,
        runIndex: result.runIndex ?? 0,
        skillOnPosition: swapped ? 'A' : 'B',
        skillOffPosition: swapped ? 'B' : 'A',
      };
      logPositionAssignment(assignment, options);
      const outputA = swapped ? result.withSkill.output : result.withoutSkill.output;
      const outputB = swapped ? result.withoutSkill.output : result.withSkill.output;
      const prompt = buildJudgePrompt(result.prompt, result.context ?? '');
      const judgement = await judgeOneTask(judge, result.taskId, prompt, outputA, outputB);

      const winnerIsWithSkill = judgement.winner === 'tie'
        ? undefined
        : (swapped ? judgement.winner === 'A' : judgement.winner === 'B');
      const { withSkillScore, withoutSkillScore } = scoresForJudgement(judgement.margin, winnerIsWithSkill);
      const diff = round1(withSkillScore - withoutSkillScore);
      samples.push({
        withSkillScore,
        withoutSkillScore,
        diff,
        reasoning: judgement.rationale,
      });
    }

    if (samples.length === 0) continue;
    judged.push(buildJudgeResult(taskResults[0].taskId, samples));
  }

  const report = buildReport(skill.name, results, judged, usage, { ...options, judgeModel });
  if (options.print ?? true) printEvalReport(report);
  return report;
}

export function buildJudgePrompt(taskPrompt: string, taskContext: string, outputA?: string, outputB?: string): string {
  const basePrompt = `Task prompt: ${taskPrompt}
Task context: ${taskContext}`;
  if (outputA === undefined || outputB === undefined) return basePrompt;
  return `${basePrompt}

Output A:
${outputA}

Output B:
${outputB}`;
}

function scoresForJudgement(score: number, winnerIsWithSkill: boolean | undefined): { withSkillScore: number; withoutSkillScore: number } {
  const clamped = Math.max(0, Math.min(3, score));
  if (winnerIsWithSkill === undefined) {
    return { withSkillScore: 1.5, withoutSkillScore: 1.5 };
  }
  const winnerScore = round1((3 + clamped) / 2);
  const loserScore = round1((3 - clamped) / 2);

  return winnerIsWithSkill
    ? { withSkillScore: winnerScore, withoutSkillScore: loserScore }
    : { withSkillScore: loserScore, withoutSkillScore: winnerScore };
}

export async function judgeOneTask(
  judge: JudgeProvider,
  taskId: string,
  taskPrompt: string,
  outputA: string,
  outputB: string,
): Promise<ProviderJudgeResult> {
  try {
    return await judge.score(taskPrompt, outputA, outputB);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Judge failed for task ${taskId}: ${detail}`);
  }
}

function buildReport(
  skillName: string,
  allResults: ABResult[],
  judged: EvalTaskResult[],
  usage: UsageTotals,
  options: JudgeOptions,
): EvalReport {
  const avgDiff = round1(mean(judged.map((result) => result.diff)));
  const overallScores = judged.flatMap((result) => result.scores ?? [result.diff]);
  const overallStats = summarize(overallScores);
  const tasksImproved = judged.filter((result) => result.diff >= 0.5).length;
  const tasksHurt = judged.filter((result) => result.diff <= -0.5).length;
  const tasksNeutral = judged.length - tasksImproved - tasksHurt;
  const runnerInputTokens = options.runnerInputTokens ?? sumTokenField(allResults, 'inputTokens');
  const runnerOutputTokens = options.runnerOutputTokens ?? sumTokenField(allResults, 'outputTokens');
  const runnerCost = (runnerInputTokens * 3.00 + runnerOutputTokens * 15.00) / 1_000_000;
  const judgeCost = (usage.judgeInputTokens * 0.10 + usage.judgeOutputTokens * 0.40) / 1_000_000;

  return {
    skillName,
    model: options.runnerModel ?? RUNNER_MODEL,
    judgeModel: options.judgeModel ?? JUDGE_MODEL,
    totalTasks: judged.length,
    avgDiff,
    tasksImproved,
    tasksHurt,
    tasksNeutral,
    overallConfidence: confidenceForStddev(overallStats.stddev),
    results: judged,
    estimatedCost: runnerCost + judgeCost,
    runs: options.runs ?? Math.max(1, ...judged.map((result) => result.runs ?? 1)),
    avgStddev: overallStats.stddev,
    minDiff: overallStats.min,
    maxDiff: overallStats.max,
  };
}

function sumTokenField(results: ABResult[], field: 'inputTokens' | 'outputTokens'): number {
  return results.reduce((sum, result) => sum + (result.withSkill[field] ?? 0) + (result.withoutSkill[field] ?? 0), 0);
}

export function printEvalReport(report: EvalReport): void {
  const line = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const improvedPct = percent(report.tasksImproved, report.totalTasks);
  const hurtPct = percent(report.tasksHurt, report.totalTasks);
  console.log(line);
  console.log(`  skilleval results - ${report.skillName} - ${report.totalTasks} tasks`);
  console.log(line);
  const multiRun = report.runs > 1;
  console.log(`  Skill effectiveness:   ${multiRun ? formatStats(report.avgDiff, report.avgStddev ?? 0, report.minDiff ?? report.avgDiff, report.maxDiff ?? report.avgDiff) : `${formatDiff(report.avgDiff)} / 3`}`);
  console.log(`  Tasks improved:        ${report.tasksImproved} / ${report.totalTasks}  (${improvedPct}%)`);
  console.log(`  Tasks hurt:            ${report.tasksHurt} / ${report.totalTasks}  (${hurtPct}%)`);
  console.log(`  Confidence:            ${report.overallConfidence}`);
  console.log('');
  for (const result of report.results) {
    if (multiRun) {
      console.log(`  ${result.taskId}  ${formatStats(result.mean ?? result.diff, result.stddev ?? 0, result.min ?? result.diff, result.max ?? result.diff)}  ${result.confidence.padEnd(6)}  ${result.reasoning}`);
    } else {
      console.log(`  ${result.taskId}  ${formatDiff(result.diff)}  ${result.confidence.padEnd(4)}  ${result.reasoning}`);
    }
  }
  console.log(line);
  console.log(`  Runner: ${report.model} | Judge: ${report.judgeModel}`);
  console.log(`  Estimated API cost this run: $${report.estimatedCost.toFixed(3)}`);
  console.log(line);
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function buildJudgeResult(
  taskId: string,
  samples: Array<{ withSkillScore: number; withoutSkillScore: number; diff: number; reasoning: string }>,
): EvalTaskResult {
  const diffs = samples.map((sample) => sample.diff);
  const stats = summarize(diffs);
  return {
    taskId,
    withSkillScore: round1(mean(samples.map((sample) => sample.withSkillScore))),
    withoutSkillScore: round1(mean(samples.map((sample) => sample.withoutSkillScore))),
    diff: stats.mean,
    confidence: confidenceForStddev(stats.stddev),
    reasoning: samples[samples.length - 1].reasoning,
    scores: diffs,
    mean: stats.mean,
    stddev: stats.stddev,
    min: stats.min,
    max: stats.max,
    runs: samples.length,
  };
}

export function buildEvalReportForTest(skillName: string, scoresByTask: Record<string, number[]>, runs: number): EvalReport {
  const judged = Object.entries(scoresByTask).map(([taskId, scores]) => buildJudgeResult(
    taskId,
    scores.map((score) => ({
      withSkillScore: 0,
      withoutSkillScore: 0,
      diff: score,
      reasoning: 'mock reasoning',
    })),
  ));
  return buildReport(skillName, [], judged, { judgeInputTokens: 0, judgeOutputTokens: 0 }, { runs });
}

function groupResultsByTask(results: ABResult[]): ABResult[][] {
  const groups = new Map<string, ABResult[]>();
  for (const result of results) {
    const group = groups.get(result.taskId);
    if (group) {
      group.push(result);
    } else {
      groups.set(result.taskId, [result]);
    }
  }
  return Array.from(groups.values());
}

function logPositionAssignment(assignment: PositionAssignment, options: JudgeOptions): void {
  options.onPositionAssignment?.(assignment);
  if (!options.verbose) return;
  console.error(
    `[skilleval debug] judge positions task=${assignment.taskId} run=${assignment.runIndex + 1}: `
    + `skill-on=${assignment.skillOnPosition} skill-off=${assignment.skillOffPosition}`,
  );
}

function summarize(values: number[]): { mean: number; stddev: number; min: number; max: number } {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0 };
  }
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return {
    mean: round1(average),
    stddev: round1(Math.sqrt(variance)),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function confidenceForStddev(stddev: number): ResultConfidence {
  if (stddev < 0.5) return 'HIGH';
  if (stddev <= 1.0) return 'MEDIUM';
  return 'LOW';
}

function createRng(seed: number | undefined): () => number {
  if (seed === undefined) {
    return () => randomInt(0, 0x100000000) / 0x100000000;
  }
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function formatStats(meanValue: number, stddev: number, min: number, max: number): string {
  return `${formatDiff(meanValue)} ± ${stddev.toFixed(1)} (range: ${formatDiff(min)} to ${formatDiff(max)})`;
}

function formatDiff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
