import { randomInt } from 'node:crypto';
import { runAssertions } from './assertions';
import { MODELS } from './config';
import { createJudgeProvider, type JudgeProvider, type JudgeProviderName, type JudgeResult as ProviderJudgeResult } from './judges';
import type { ParsedSkill } from './parser';
import type { ABResult, CompareResult } from './runner';

export interface EvalTaskResult {
  taskId: string;
  status: 'scored' | 'skipped';
  withSkillScore?: number;
  withoutSkillScore?: number;
  diff?: number;
  confidence?: ResultConfidence;
  reasoning: string;
  skipReason?: string;
  assertionsPassed?: boolean;
  assertionFailures?: string[];
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
  tasksSkipped: number;
  overallConfidence: ResultConfidence;
  warning?: string;
  results: EvalTaskResult[];
  estimatedCost: number;
  runs: number;
  avgStddev?: number;
  minDiff?: number;
  maxDiff?: number;
}

export interface EvalDiffStats {
  avgDiff: number;
  meanDiff: number;
  medianDiff: number;
  stddevDiff: number;
}

export interface EvalTaskAggregate extends EvalDiffStats {
  taskId: string;
  runs: number;
  skippedRuns: number;
}

export interface EvalAggregate extends EvalDiffStats {
  totalRuns: number;
  totalSamples: number;
  tasks: EvalTaskAggregate[];
}

export interface EvalRunReport {
  run: number;
  report: EvalReport;
}

export interface MultiRunEvalReport {
  skillName: string;
  model: string;
  judgeModel: string;
  totalTasks: number;
  avgDiff: number;
  tasksImproved: number;
  tasksHurt: number;
  tasksNeutral: number;
  tasksSkipped: number;
  overallConfidence: ResultConfidence;
  warning?: string;
  aggregate: EvalAggregate;
  results: EvalTaskResult[];
  runs: EvalRunReport[];
  estimatedCost: number;
}

export interface CompareTaskResult {
  taskId: string;
  skillAScore: number;
  skillBScore: number;
  diff: number;
  confidence: ResultConfidence;
  reasoning: string;
}

export interface CompareReport {
  skillAName: string;
  skillBName: string;
  model: string;
  judgeModel: string;
  totalTasks: number;
  avgDiff: number;
  tasksAWon: number;
  tasksBWon: number;
  tasksNeutral: number;
  overallWinner: 'A' | 'B' | 'tie';
  results: CompareTaskResult[];
  estimatedCost: number;
}

export type ResultConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRATED' | 'NONE';

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
      assertionsPassed?: boolean;
      assertionFailures?: string[];
    }> = [];
    let skipReason: string | undefined;

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
      let judgement: ProviderJudgeResult;
      try {
        judgement = await judgeOneTask(judge, result.taskId, prompt, outputA, outputB);
      } catch (error) {
        skipReason = error instanceof Error ? error.message : String(error);
        break;
      }

      const winnerIsWithSkill = judgement.winner === 'tie'
        ? undefined
        : (swapped ? judgement.winner === 'A' : judgement.winner === 'B');
      const { withSkillScore, withoutSkillScore } = scoresForJudgement(judgement.margin, winnerIsWithSkill);
      const actualDiff = round1(withSkillScore - withoutSkillScore);
      const assertionResult = result.assertions === undefined
        ? undefined
        : runAssertions(result.withSkill.output, result.assertions);
      const diff = assertionResult?.passed === false
        ? Math.min(-0.5, actualDiff)
        : actualDiff;
      samples.push({
        withSkillScore,
        withoutSkillScore,
        diff,
        reasoning: judgement.rationale,
        ...(assertionResult ? {
          assertionsPassed: assertionResult.passed,
          assertionFailures: assertionResult.failures,
        } : {}),
      });
    }

    if (skipReason) {
      judged.push(buildSkippedResult(taskResults[0].taskId, skipReason));
      continue;
    }
    if (samples.length === 0) continue;
    judged.push(buildJudgeResult(taskResults[0].taskId, samples));
  }

  const report = buildReport(skill.name, results, judged, usage, { ...options, judgeModel });
  if (options.print ?? true) printEvalReport(report);
  return report;
}

export async function judgeCompare(
  skillA: ParsedSkill,
  skillB: ParsedSkill,
  results: CompareResult[],
  options: JudgeOptions = {},
): Promise<CompareReport> {
  const providerName = options.judgeProvider ?? 'gemini-flash';
  const judge = options.judge ?? createJudgeProvider(providerName);
  const judgeModel = options.judgeModel ?? providerName;
  const rng = createRng(options.seed);
  const judged: CompareTaskResult[] = [];

  for (const taskResults of groupCompareResultsByTask(results)) {
    const samples: Array<{
      skillAScore: number;
      skillBScore: number;
      diff: number;
      reasoning: string;
    }> = [];

    for (const result of taskResults) {
      const swapped = rng() < 0.5;
      const outputA = swapped ? result.skillB.output : result.skillA.output;
      const outputB = swapped ? result.skillA.output : result.skillB.output;
      const prompt = buildJudgePrompt(result.prompt, result.context ?? '');
      const judgement = await judgeOneTask(judge, result.taskId, prompt, outputA, outputB);
      const winnerIsSkillB = judgement.winner === 'tie'
        ? undefined
        : (swapped ? judgement.winner === 'A' : judgement.winner === 'B');
      const { withSkillScore: skillBScore, withoutSkillScore: skillAScore } = scoresForJudgement(judgement.margin, winnerIsSkillB);
      samples.push({
        skillAScore,
        skillBScore,
        diff: round1(skillBScore - skillAScore),
        reasoning: judgement.rationale,
      });
    }

    judged.push(buildCompareTaskResult(taskResults[0].taskId, samples));
  }

  const report = buildCompareReport(skillA, skillB, results, judged, { ...options, judgeModel });
  if (options.print ?? true) printCompareReport(report);
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

export function scoresForJudgement(score: number, winnerIsWithSkill: boolean | undefined): { withSkillScore: number; withoutSkillScore: number } {
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
  const scored = judged.filter((result) => result.status === 'scored');
  const avgDiff = round1(mean(scored.map((result) => result.diff ?? 0)));
  const overallScores = scored.flatMap((result) => result.scores ?? [result.diff ?? 0]);
  const overallStats = summarize(overallScores);
  const tasksImproved = scored.filter((result) => (result.diff ?? 0) >= 0.5).length;
  const tasksHurt = scored.filter((result) => (result.diff ?? 0) <= -0.5).length;
  const tasksSkipped = judged.filter((result) => result.status === 'skipped').length;
  const totalTasks = scored.length;
  const tasksNeutral = totalTasks - tasksImproved - tasksHurt;
  const warning = totalTasks === 0 && tasksSkipped > 0
    ? 'All tasks were skipped due to judge errors; no valid results.'
    : undefined;
  const runnerInputTokens = options.runnerInputTokens ?? sumTokenField(allResults, 'inputTokens');
  const runnerOutputTokens = options.runnerOutputTokens ?? sumTokenField(allResults, 'outputTokens');
  const runnerCost = (runnerInputTokens * 3.00 + runnerOutputTokens * 15.00) / 1_000_000;
  const judgeCost = (usage.judgeInputTokens * 0.10 + usage.judgeOutputTokens * 0.40) / 1_000_000;

  return {
    skillName,
    model: options.runnerModel ?? RUNNER_MODEL,
    judgeModel: options.judgeModel ?? JUDGE_MODEL,
    totalTasks,
    avgDiff,
    tasksImproved,
    tasksHurt,
    tasksNeutral,
    tasksSkipped,
    overallConfidence: totalTasks === 0 ? 'NONE' : overallConfidenceForReport(options.runs, overallStats.stddev),
    ...(warning ? { warning } : {}),
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

function sumCompareTokenField(results: CompareResult[], field: 'inputTokens' | 'outputTokens'): number {
  return results.reduce((sum, result) => sum + (result.skillA[field] ?? 0) + (result.skillB[field] ?? 0), 0);
}

export function printEvalReport(report: EvalReport): void {
  const line = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const improvedPct = percent(report.tasksImproved, report.totalTasks);
  const hurtPct = percent(report.tasksHurt, report.totalTasks);
  console.log(line);
  console.log(`  skilleval results - ${report.skillName} - ${report.totalTasks} tasks`);
  console.log(line);
  const multiRun = report.runs > 1;
  if (report.warning) {
    console.log(`  Warning:              ${report.warning}`);
  }
  console.log(`  Skill effectiveness:   ${report.totalTasks === 0 ? 'no valid results' : (multiRun ? formatStats(report.avgDiff, report.avgStddev ?? 0, report.minDiff ?? report.avgDiff, report.maxDiff ?? report.avgDiff) : `${formatDiff(report.avgDiff)} / 3`)}`);
  console.log(`  Tasks improved:        ${report.tasksImproved} / ${report.totalTasks}  (${improvedPct}%)`);
  console.log(`  Tasks hurt:            ${report.tasksHurt} / ${report.totalTasks}  (${hurtPct}%)`);
  if (report.tasksSkipped > 0) {
    const attemptedTasks = report.totalTasks + report.tasksSkipped;
    console.log(`  Tasks skipped:         ${report.tasksSkipped} / ${attemptedTasks}  (judge error)`);
  }
  console.log(`  Confidence:            ${formatConfidence(report.overallConfidence)}`);
  console.log('');
  for (const result of report.results) {
    if (result.status === 'skipped') {
      console.log(`  ${result.taskId}  SKIPPED  ${result.skipReason ?? result.reasoning}`);
      continue;
    }
    if (multiRun) {
      console.log(`  ${result.taskId}  ${formatStats(result.mean ?? result.diff ?? 0, result.stddev ?? 0, result.min ?? result.diff ?? 0, result.max ?? result.diff ?? 0)}  ${formatConfidence(result.confidence ?? 'LOW')}  ${result.reasoning}`);
    } else {
      console.log(`  ${result.taskId}  ${formatDiff(result.diff ?? 0)}  ${formatConfidence(result.confidence ?? 'LOW')}  ${result.reasoning}`);
    }
    printAssertionFailures(result);
  }
  console.log(line);
  console.log(`  Runner: ${report.model} | Judge: ${report.judgeModel}`);
  console.log(`  Estimated API cost this run: $${report.estimatedCost.toFixed(3)}`);
  console.log(line);
}

export function buildMultiRunReport(reports: EvalReport[]): MultiRunEvalReport {
  if (reports.length === 0) {
    throw new Error('Cannot build a multi-run report with zero runs.');
  }

  const [first] = reports;
  const taskDiffs = new Map<string, number[]>();
  const taskSkipped = new Map<string, number>();
  for (const report of reports) {
    for (const result of report.results) {
      if (result.status === 'scored' && result.diff !== undefined) {
        const diffs = taskDiffs.get(result.taskId) ?? [];
        diffs.push(result.diff);
        taskDiffs.set(result.taskId, diffs);
      } else if (result.status === 'skipped') {
        taskSkipped.set(result.taskId, (taskSkipped.get(result.taskId) ?? 0) + 1);
      }
    }
  }

  const taskIds = Array.from(new Set([...taskDiffs.keys(), ...taskSkipped.keys()])).sort();
  const tasks = taskIds
    .map((taskId) => {
      const diffs = taskDiffs.get(taskId) ?? [];
      if (diffs.length === 0) return undefined;
      return {
        taskId,
        ...diffStats(diffs),
        runs: diffs.length,
        skippedRuns: taskSkipped.get(taskId) ?? 0,
      };
    })
    .filter((task): task is EvalTaskAggregate => task !== undefined);
  const allDiffs = tasks.flatMap((task) => taskDiffs.get(task.taskId) ?? []);
  const aggregateStats = diffStats(allDiffs);
  const tasksImproved = tasks.filter((task) => task.avgDiff >= 0.5).length;
  const tasksHurt = tasks.filter((task) => task.avgDiff <= -0.5).length;
  const totalTasks = tasks.length;
  const tasksSkipped = reports.reduce((sum, report) => sum + report.tasksSkipped, 0);
  const warning = totalTasks === 0 && tasksSkipped > 0
    ? 'All tasks were skipped due to judge errors; no valid results.'
    : undefined;

  return {
    skillName: first.skillName,
    model: first.model,
    judgeModel: first.judgeModel,
    totalTasks,
    avgDiff: aggregateStats.avgDiff,
    tasksImproved,
    tasksHurt,
    tasksNeutral: totalTasks - tasksImproved - tasksHurt,
    tasksSkipped,
    overallConfidence: totalTasks === 0 ? 'NONE' : confidenceForRepeatedStddev(aggregateStats.stddevDiff),
    ...(warning ? { warning } : {}),
    aggregate: {
      ...aggregateStats,
      totalRuns: reports.length,
      totalSamples: allDiffs.length,
      tasks,
    },
    results: tasks.map((task) => ({
      taskId: task.taskId,
      status: 'scored',
      diff: task.avgDiff,
      confidence: confidenceForRepeatedStddev(task.stddevDiff),
      reasoning: `Aggregated across ${task.runs} runs.`,
      scores: taskDiffs.get(task.taskId) ?? [],
      mean: task.meanDiff,
      stddev: task.stddevDiff,
      runs: task.runs,
    })),
    runs: reports.map((report, index) => ({ run: index + 1, report })),
    estimatedCost: reports.reduce((sum, report) => sum + report.estimatedCost, 0),
  };
}

export function printMultiRunEvalReport(report: MultiRunEvalReport): void {
  const line = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const improvedPct = percent(report.tasksImproved, report.totalTasks);
  const hurtPct = percent(report.tasksHurt, report.totalTasks);
  console.log(line);
  console.log(`  skilleval results - ${report.skillName} - ${report.totalTasks} tasks x ${report.aggregate.totalRuns} runs`);
  console.log(line);
  if (report.warning) {
    console.log(`  Warning:              ${report.warning}`);
  }
  console.log(`  Skill effectiveness:   ${report.totalTasks === 0 ? 'no valid results' : formatAggregateStats(report.aggregate)}`);
  console.log(`  Tasks improved:        ${report.tasksImproved} / ${report.totalTasks}  (${improvedPct}%)`);
  console.log(`  Tasks hurt:            ${report.tasksHurt} / ${report.totalTasks}  (${hurtPct}%)`);
  if (report.tasksSkipped > 0) {
    const attempted = report.aggregate.totalSamples + report.tasksSkipped;
    console.log(`  Judgements skipped:    ${report.tasksSkipped} / ${attempted}  (judge error)`);
  }
  console.log(`  Confidence:            ${report.overallConfidence}`);
  console.log('');
  for (const task of report.aggregate.tasks) {
    console.log(`  ${task.taskId}  ${formatAggregateStats(task)}  ${task.runs}/${report.aggregate.totalRuns} runs`);
  }
  console.log(line);
  console.log(`  Runner: ${report.model} | Judge: ${report.judgeModel}`);
  console.log(`  Estimated API cost this run: $${report.estimatedCost.toFixed(3)}`);
  console.log(line);
}

export function printCompareReport(report: CompareReport): void {
  const line = '──────────────────────────────────────────────────';
  console.log('── skilleval compare ─────────────────────────────');
  console.log(` ${report.skillAName}  vs  ${report.skillBName}  |  ${report.totalTasks} tasks`);
  console.log(line);
  const winner = report.overallWinner === 'A'
    ? report.skillAName
    : report.overallWinner === 'B'
      ? report.skillBName
      : 'tie';
  console.log(` Overall winner: ${winner}  (${formatDiff(report.avgDiff)} avg diff)`);
  console.log(` Tasks where ${report.skillBName} better: ${report.tasksBWon} / ${report.totalTasks}`);
  console.log(` Tasks where ${report.skillAName} better: ${report.tasksAWon} / ${report.totalTasks}`);
  console.log('');
  for (const result of report.results) {
    console.log(` ${result.taskId}  ${report.skillAName}: ${formatDiff(result.skillAScore)}  ${report.skillBName}: ${formatDiff(result.skillBScore)}  diff ${formatDiff(result.diff)}  ${formatConfidence(result.confidence)}  ${result.reasoning}`);
  }
  console.log(line);
  console.log(` Runner: ${report.model} | Judge: ${report.judgeModel}`);
  console.log(` Estimated API cost this run: $${report.estimatedCost.toFixed(3)}`);
  console.log(line);
}

function printAssertionFailures(result: EvalTaskResult): void {
  if (result.assertionsPassed !== false) return;
  for (const failure of result.assertionFailures ?? []) {
    console.log(`    ✗ ${failure}`);
  }
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function buildJudgeResult(
  taskId: string,
  samples: Array<{
    withSkillScore: number;
    withoutSkillScore: number;
    diff: number;
    reasoning: string;
    assertionsPassed?: boolean;
    assertionFailures?: string[];
  }>,
): EvalTaskResult {
  const diffs = samples.map((sample) => sample.diff);
  const stats = summarize(diffs);
  const assertionFailures = samples.flatMap((sample) => sample.assertionFailures ?? []);
  const hasAssertionResult = samples.some((sample) => sample.assertionsPassed !== undefined);
  const assertionsPassed = hasAssertionResult
    ? samples.every((sample) => sample.assertionsPassed !== false)
    : undefined;
  return {
    taskId,
    status: 'scored',
    withSkillScore: round1(mean(samples.map((sample) => sample.withSkillScore))),
    withoutSkillScore: round1(mean(samples.map((sample) => sample.withoutSkillScore))),
    diff: stats.mean,
    confidence: samples.length === 1 ? 'UNRATED' : confidenceForRepeatedStddev(stats.stddev),
    reasoning: samples[samples.length - 1].reasoning,
    scores: diffs,
    mean: stats.mean,
    stddev: stats.stddev,
    min: stats.min,
    max: stats.max,
    runs: samples.length,
    ...(hasAssertionResult ? {
      assertionsPassed,
      assertionFailures,
    } : {}),
  };
}

function buildSkippedResult(taskId: string, reason: string): EvalTaskResult {
  return {
    taskId,
    status: 'skipped',
    reasoning: reason,
    skipReason: reason,
  };
}

function buildCompareTaskResult(
  taskId: string,
  samples: Array<{
    skillAScore: number;
    skillBScore: number;
    diff: number;
    reasoning: string;
  }>,
): CompareTaskResult {
  const diffs = samples.map((sample) => sample.diff);
  const stats = summarize(diffs);
  return {
    taskId,
    skillAScore: round1(mean(samples.map((sample) => sample.skillAScore))),
    skillBScore: round1(mean(samples.map((sample) => sample.skillBScore))),
    diff: stats.mean,
    confidence: samples.length === 1 ? 'UNRATED' : confidenceForRepeatedStddev(stats.stddev),
    reasoning: samples[samples.length - 1].reasoning,
  };
}

function buildCompareReport(
  skillA: ParsedSkill,
  skillB: ParsedSkill,
  allResults: CompareResult[],
  judged: CompareTaskResult[],
  options: JudgeOptions,
): CompareReport {
  const avgDiff = round1(mean(judged.map((result) => result.diff)));
  const tasksBWon = judged.filter((result) => result.diff >= 0.5).length;
  const tasksAWon = judged.filter((result) => result.diff <= -0.5).length;
  const runnerInputTokens = options.runnerInputTokens ?? sumCompareTokenField(allResults, 'inputTokens');
  const runnerOutputTokens = options.runnerOutputTokens ?? sumCompareTokenField(allResults, 'outputTokens');
  const runnerCost = (runnerInputTokens * 3.00 + runnerOutputTokens * 15.00) / 1_000_000;

  return {
    skillAName: skillA.name,
    skillBName: skillB.name,
    model: options.runnerModel ?? RUNNER_MODEL,
    judgeModel: options.judgeModel ?? JUDGE_MODEL,
    totalTasks: judged.length,
    avgDiff,
    tasksAWon,
    tasksBWon,
    tasksNeutral: judged.length - tasksAWon - tasksBWon,
    overallWinner: avgDiff >= 0.5 ? 'B' : avgDiff <= -0.5 ? 'A' : 'tie',
    results: judged,
    estimatedCost: runnerCost,
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

function groupCompareResultsByTask(results: CompareResult[]): CompareResult[][] {
  const groups = new Map<string, CompareResult[]>();
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

function diffStats(values: number[]): EvalDiffStats {
  return {
    avgDiff: round1(mean(values)),
    meanDiff: round1(mean(values)),
    medianDiff: round1(median(values)),
    stddevDiff: round1(stddev(values)),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function overallConfidenceForReport(runs: number | undefined, stddev: number): ResultConfidence {
  if (runs === undefined || runs <= 1) return 'UNRATED';
  return confidenceForRepeatedStddev(stddev);
}

export function confidenceForStddev(stddev: number): ResultConfidence {
  if (stddev === 0) return 'UNRATED';
  return confidenceForRepeatedStddev(stddev);
}

function confidenceForRepeatedStddev(stddev: number): ResultConfidence {
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

function formatAggregateStats(stats: EvalDiffStats): string {
  return `mean ${formatDiff(stats.meanDiff)}, median ${formatDiff(stats.medianDiff)}, stddev ${stats.stddevDiff.toFixed(1)}`;
}

function formatConfidence(confidence: ResultConfidence): string {
  return confidence === 'UNRATED'
    ? 'UNRATED (use --runs 3+ for confidence)'
    : confidence;
}

function formatDiff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
