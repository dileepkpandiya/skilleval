import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import {
  buildJudgePrompt,
  judgeOneTask,
  type JudgeOptions,
} from './judge';
import { createJudgeProvider, type JudgeProviderName } from './judges';

type Winner = 'A' | 'B';
type Confidence = 'HIGH' | 'MED' | 'LOW';

export interface CalibrationCaseResult {
  id: string;
  expectedWinner: Winner;
  actualWinner: Winner | 'UNKNOWN';
  correct: boolean;
  confidence: Confidence;
  reasoning: string;
}

export interface CalibrationReport {
  model: string;
  totalCases: number;
  correctCases: number;
  accuracy: number;
  overallConfidence: Confidence;
  results: CalibrationCaseResult[];
}

interface CalibrationOptions extends JudgeOptions {
  judgeProvider?: JudgeProviderName;
  judgeModel?: string;
}

interface CalibrationCase {
  id: string;
  task: string;
  context: string;
  outputA: string;
  outputB: string;
  expectedWinner: Winner;
}

interface CalibrationFile {
  calibration?: unknown;
}

export async function runCalibration(filePath: string, options: CalibrationOptions = {}): Promise<CalibrationReport> {
  const cases = loadCalibrationCases(filePath);
  const provider = options.judgeProvider ?? 'gemini-flash';
  const judge = options.judge ?? createJudgeProvider(provider);
  const judgeModel = options.judgeModel ?? provider;
  const results: CalibrationCaseResult[] = [];

  for (const item of cases) {
    const prompt = buildJudgePrompt(item.task, item.context);
    const judgement = await judgeOneTask(judge, item.id, prompt, item.outputA, item.outputB);
    const actualWinner = judgement.winner === 'tie' ? 'UNKNOWN' : judgement.winner;
    const confidence = confidenceForMargin(judgement.margin);
    const reasoning = judgement.rationale;

    results.push({
      id: item.id,
      expectedWinner: item.expectedWinner,
      actualWinner,
      correct: actualWinner === item.expectedWinner,
      confidence,
      reasoning,
    });
  }

  const correctCases = results.filter((result) => result.correct).length;
  const totalCases = results.length;

  return {
    model: judgeModel,
    totalCases,
    correctCases,
    accuracy: round2(totalCases === 0 ? 0 : correctCases / totalCases),
    overallConfidence: overallConfidence(results),
    results,
  };
}

function confidenceForMargin(margin: number): Confidence {
  if (margin >= 1.5) return 'HIGH';
  if (margin >= 0.5) return 'MED';
  return 'LOW';
}

export function printCalibrationReport(report: CalibrationReport): void {
  const line = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const percent = report.totalCases === 0 ? 0 : Math.round(report.accuracy * 100);

  console.log(line);
  console.log(`  judge calibration - ${report.totalCases} cases`);
  console.log(line);
  console.log(`  Accuracy:           ${report.correctCases} / ${report.totalCases}  (${percent}%)`);
  console.log(`  Confidence:         ${report.overallConfidence}`);
  console.log('');
  for (const result of report.results) {
    const status = result.correct ? 'PASS' : 'FAIL';
    console.log(`  ${result.id}  ${status}  expected=${result.expectedWinner} actual=${result.actualWinner} ${result.confidence}`);
  }
  console.log(line);
  console.log(`  Judge: ${report.model}`);
  console.log(line);
}

function loadCalibrationCases(filePath: string): CalibrationCase[] {
  const rawPath = resolve(filePath);
  const contents = readFileSync(rawPath, 'utf8');
  const parsed = yaml.load(contents) as CalibrationFile;

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.calibration)) {
    throw new Error(`Invalid calibration file ${rawPath}: expected a top-level 'calibration' array`);
  }

  return parsed.calibration.map((item, index) => parseCalibrationCase(item, rawPath, index));
}

function parseCalibrationCase(value: unknown, rawPath: string, index: number): CalibrationCase {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid calibration case in ${rawPath} at index ${index}: expected a mapping`);
  }

  const candidate = value as Record<string, unknown>;
  const expectedWinner = requireWinner(candidate.expectedWinner, rawPath, index);
  return {
    id: requireString(candidate.id, 'id', rawPath, index),
    task: requireString(candidate.task, 'task', rawPath, index),
    context: optionalString(candidate.context, 'context', rawPath, index),
    outputA: requireString(candidate.outputA, 'outputA', rawPath, index),
    outputB: requireString(candidate.outputB, 'outputB', rawPath, index),
    expectedWinner,
  };
}

function requireString(value: unknown, field: string, rawPath: string, index: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid calibration case in ${rawPath} at index ${index}: '${field}' must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string, rawPath: string, index: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new Error(`Invalid calibration case in ${rawPath} at index ${index}: '${field}' must be a string when provided`);
  }
  return value;
}

function requireWinner(value: unknown, rawPath: string, index: number): Winner {
  if (value !== 'A' && value !== 'B') {
    throw new Error(`Invalid calibration case in ${rawPath} at index ${index}: 'expectedWinner' must be A or B`);
  }
  return value;
}

function overallConfidence(results: CalibrationCaseResult[]): Confidence {
  const high = results.filter((result) => result.confidence === 'HIGH').length;
  const med = results.filter((result) => result.confidence === 'MED').length;
  if (high >= Math.ceil(results.length / 2)) return 'HIGH';
  if (high + med >= Math.ceil(results.length / 2)) return 'MED';
  return 'LOW';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
