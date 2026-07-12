import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EvalReport, MultiRunEvalReport } from './judge';

export interface HistoryEntry {
  timestamp: string;
  skillName: string;
  model: string;
  judgeModel: string;
  runs: number;
  avgDiff: number;
  tasksImproved: number;
  tasksHurt: number;
  tasksNeutral: number;
  totalTasks: number;
  overallConfidence: string;
  estimatedCost: number;
  taskResults: Array<{
    taskId: string;
    diff: number;
    confidence: string;
    assertionsPassed?: boolean;
  }>;
}

export interface DiffReport {
  skillName: string;
  currentTimestamp: string;
  previousTimestamp: string;
  avgDiffDelta: number;
  improvedDelta: number;
  hurtDelta: number;
  previousAvgDiff: number;
  currentAvgDiff: number;
  previousTasksImproved: number;
  currentTasksImproved: number;
  previousTasksHurt: number;
  currentTasksHurt: number;
  taskChanges: Array<{
    taskId: string;
    previousDiff: number;
    currentDiff: number;
    delta: number;
    direction: 'improved' | 'regressed' | 'unchanged';
  }>;
}

type HistorySourceReport = EvalReport | MultiRunEvalReport;

export function saveHistory(report: HistorySourceReport, historyDir: string): string {
  let filePath = '';
  try {
    const entry = toHistoryEntry(report);
    const absoluteDir = resolve(historyDir);
    mkdirSync(absoluteDir, { recursive: true });
    const filename = `${filenameTimestamp(entry.timestamp)}-${safeFilename(entry.skillName)}.json`;
    filePath = join(absoluteDir, filename);
    writeFileSync(filePath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    return filePath;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: failed to save skilleval history: ${detail}`);
    return filePath;
  }
}

export function loadHistory(historyDir: string, skillName: string): HistoryEntry[] {
  try {
    const absoluteDir = resolve(historyDir);
    if (!existsSync(absoluteDir)) return [];

    return readdirSync(absoluteDir)
      .filter((filename) => filename.endsWith('.json'))
      .map((filename) => readHistoryFile(join(absoluteDir, filename)))
      .filter((entry): entry is HistoryEntry => entry !== undefined && entry.skillName === skillName)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  } catch {
    return [];
  }
}

export function diffHistory(current: HistoryEntry, previous: HistoryEntry): DiffReport {
  const previousTasks = new Map(previous.taskResults.map((task) => [task.taskId, task]));
  const taskChanges = current.taskResults
    .map((task) => {
      const previousTask = previousTasks.get(task.taskId);
      if (!previousTask) return undefined;
      const delta = round1(task.diff - previousTask.diff);
      return {
        taskId: task.taskId,
        previousDiff: previousTask.diff,
        currentDiff: task.diff,
        delta,
        direction: directionForDelta(delta),
      };
    })
    .filter((task): task is DiffReport['taskChanges'][number] => task !== undefined);

  return {
    skillName: current.skillName,
    currentTimestamp: current.timestamp,
    previousTimestamp: previous.timestamp,
    avgDiffDelta: round1(current.avgDiff - previous.avgDiff),
    improvedDelta: current.tasksImproved - previous.tasksImproved,
    hurtDelta: current.tasksHurt - previous.tasksHurt,
    previousAvgDiff: previous.avgDiff,
    currentAvgDiff: current.avgDiff,
    previousTasksImproved: previous.tasksImproved,
    currentTasksImproved: current.tasksImproved,
    previousTasksHurt: previous.tasksHurt,
    currentTasksHurt: current.tasksHurt,
    taskChanges,
  };
}

export function printDiffReport(diff: DiffReport): void {
  const line = '─────────────────────────────────────────────';
  console.log(`── skilleval diff: ${diff.skillName} ──────────────`);
  console.log(` vs previous run: ${diff.previousTimestamp}`);
  console.log(` Effectiveness:  ${formatDiff(diff.previousAvgDiff)} → ${formatDiff(diff.currentAvgDiff)}  (${formatSigned(diff.avgDiffDelta)} ${arrow(diff.avgDiffDelta)})`);
  console.log(` Tasks improved: ${diff.previousTasksImproved} → ${diff.currentTasksImproved}        (${formatSignedInt(diff.improvedDelta)} ${arrow(diff.improvedDelta)})`);
  console.log(` Tasks hurt:     ${diff.previousTasksHurt} → ${diff.currentTasksHurt}        (${formatSignedInt(diff.hurtDelta)} ${arrow(-diff.hurtDelta)})`);
  console.log('');
  for (const task of diff.taskChanges) {
    console.log(` ${task.taskId}  ${formatDiff(task.previousDiff)} → ${formatDiff(task.currentDiff)}   (${formatSigned(task.delta)} ${task.direction})`);
  }
  console.log(line);
}

function toHistoryEntry(report: HistorySourceReport): HistoryEntry {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    skillName: report.skillName,
    model: report.model,
    judgeModel: report.judgeModel,
    runs: reportRuns(report),
    avgDiff: report.avgDiff,
    tasksImproved: report.tasksImproved,
    tasksHurt: report.tasksHurt,
    tasksNeutral: report.tasksNeutral,
    totalTasks: report.totalTasks,
    overallConfidence: report.overallConfidence,
    estimatedCost: report.estimatedCost,
    taskResults: report.results
      .filter((result) => result.status === 'scored' && result.diff !== undefined)
      .map((result) => ({
        taskId: result.taskId,
        diff: result.diff as number,
        confidence: result.confidence ?? report.overallConfidence,
        ...(result.assertionsPassed !== undefined ? { assertionsPassed: result.assertionsPassed } : {}),
      })),
  };
}

function readHistoryFile(filePath: string): HistoryEntry | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!isHistoryEntry(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.timestamp === 'string'
    && typeof entry.skillName === 'string'
    && typeof entry.avgDiff === 'number'
    && Array.isArray(entry.taskResults);
}

function reportRuns(report: HistorySourceReport): number {
  return Array.isArray(report.runs) ? report.runs.length : report.runs;
}

function filenameTimestamp(timestamp: string): string {
  return timestamp.slice(0, 19).replace(/:/g, '-');
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

function directionForDelta(delta: number): 'improved' | 'regressed' | 'unchanged' {
  if (delta > 0) return 'improved';
  if (delta < 0) return 'regressed';
  return 'unchanged';
}

function formatDiff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatSignedInt(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function arrow(value: number): string {
  if (value > 0) return '↑';
  if (value < 0) return '↓';
  return '→';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
