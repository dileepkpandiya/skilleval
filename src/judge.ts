import { createRequire } from 'node:module';
import type { ParsedSkill } from './parser';
import type { ABResult } from './runner';

export interface JudgeResult {
  taskId: string;
  withSkillScore: number;
  withoutSkillScore: number;
  diff: number;
  confidence: 'HIGH' | 'MED' | 'LOW';
  reasoning: string;
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
  overallConfidence: 'HIGH' | 'MED' | 'LOW';
  results: JudgeResult[];
  estimatedCost: number;
}

interface JudgeOptions {
  googleApiKey?: string;
  runnerInputTokens?: number;
  runnerOutputTokens?: number;
  print?: boolean;
}

interface GeminiJudgement {
  winner: 'A' | 'B';
  score: number;
  confidence: 'HIGH' | 'MED' | 'LOW';
  reason: string;
}


type GeminiModel = {
  generateContent(prompt: string): Promise<{
    response: {
      text(): string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
  }>;
};

type GoogleGenerativeAIConstructor = new (apiKey: string) => {
  getGenerativeModel(options: { model: string; generationConfig?: { maxOutputTokens: number; temperature: number } }): GeminiModel;
};

interface UsageTotals {
  judgeInputTokens: number;
  judgeOutputTokens: number;
}

const RUNNER_MODEL = process.env.SKILLEVAL_DEV === 'true'
  ? 'claude-haiku-4-5'
  : 'claude-sonnet-4-6';
const JUDGE_MODEL = 'gemini-3.5-flash';
const MAX_ATTEMPTS = 3;

export async function judgeResults(
  skill: ParsedSkill,
  results: ABResult[],
  options: JudgeOptions = {},
): Promise<EvalReport> {
  const apiKey = options.googleApiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GOOGLE_API_KEY.');
  }

  const { GoogleGenerativeAI } = loadGoogleGenerativeAI();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: JUDGE_MODEL,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.1,
    },
  });
  const judged: JudgeResult[] = [];
  const usage: UsageTotals = { judgeInputTokens: 0, judgeOutputTokens: 0 };

  for (const result of results) {
    const prompt = buildJudgePrompt(result.prompt, result.context ?? '', result.withoutSkill.output, result.withSkill.output);

    const judgement = await judgeOneTask(model, result.taskId, prompt, usage);
    if (!judgement) continue;

    const diff = round1(judgement.winner === 'B' ? judgement.score : -judgement.score);

    judged.push({
      taskId: result.taskId,
      withSkillScore: judgement.winner === 'B' ? judgement.score : 0,
      withoutSkillScore: judgement.winner === 'A' ? judgement.score : 0,
      diff,
      confidence: judgement.confidence,
      reasoning: judgement.reason,
    });
  }

  const report = buildReport(skill.name, results, judged, usage, options);
  if (options.print ?? true) printEvalReport(report);
  return report;
}


function loadGoogleGenerativeAI(): { GoogleGenerativeAI: GoogleGenerativeAIConstructor } {
  const require = createRequire(__filename);
  return require('@google/generative-ai') as { GoogleGenerativeAI: GoogleGenerativeAIConstructor };
}

function buildJudgePrompt(taskPrompt: string, taskContext: string, outputA: string, outputB: string): string {
  return `You are an expert evaluator comparing two code review responses.

Output A was generated WITHOUT a skill/system prompt.
Output B was generated WITH a skill/system prompt.

Task prompt: ${taskPrompt}
Task context: ${taskContext}

Output A:
${outputA}

Output B:
${outputB}

A good code review:
- Identifies real bugs that can be demonstrated from the code shown
- Explains the risk clearly so a maintainer can act
- Does NOT rewrite the code unless the current design is fundamentally broken
- Only reports findings directly verifiable from the code shown

Compare only on review quality: correctness of findings, depth of analysis, and actionability.
Penalize hallucinated findings (issues not present in the code) and unnecessary rewrites.

CRITICAL: Respond with ONLY a raw JSON object. No markdown. No code fences. No text before or after.
{"winner":"A","score":1.5,"confidence":"HIGH","reason":"One sentence explaining why."}

confidence must be exactly one of: "HIGH", "MED", "LOW"
score must be between 0.0 and 3.0
winner must be "A" or "B"`;
}

async function judgeOneTask(
  model: GeminiModel,
  taskId: string,
  prompt: string,
  usage: UsageTotals,
): Promise<GeminiJudgement | undefined> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await model.generateContent(prompt);
    const metadata = response.response.usageMetadata;
    usage.judgeInputTokens += metadata?.promptTokenCount ?? estimateTokens(prompt);
    const text = response.response.text().trim();
    usage.judgeOutputTokens += metadata?.candidatesTokenCount ?? estimateTokens(text);

    const parsed = parseJudgement(text);
    if (parsed) return parsed;
  }

  console.warn(`Warning: skipping task ${taskId}; Gemini did not return valid judge JSON after ${MAX_ATTEMPTS} attempts.`);
  return undefined;
}

function parseJudgement(text: string): GeminiJudgement | undefined {
  try {
    const rawText = text;
    // Strip markdown code fences if present.
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as GeminiJudgement;
    if (!isJudgement(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isJudgement(value: unknown): value is GeminiJudgement {
  if (value === null || typeof value !== 'object') return false;
  const judgement = value as Record<string, unknown>;
  return (
    (judgement.winner === 'A' || judgement.winner === 'B')
    && typeof judgement.score === 'number'
    && Number.isFinite(judgement.score)
    && judgement.score >= 0
    && judgement.score <= 3
    && (judgement.confidence === 'HIGH' || judgement.confidence === 'MED' || judgement.confidence === 'LOW')
    && typeof judgement.reason === 'string'
  );
}

function buildReport(
  skillName: string,
  allResults: ABResult[],
  judged: JudgeResult[],
  usage: UsageTotals,
  options: JudgeOptions,
): EvalReport {
  const avgDiff = round1(judged.reduce((sum, result) => sum + result.diff, 0) / (judged.length || 1));
  const tasksImproved = judged.filter((result) => result.diff >= 0.5).length;
  const tasksHurt = judged.filter((result) => result.diff <= -0.5).length;
  const tasksNeutral = judged.length - tasksImproved - tasksHurt;
  const runnerInputTokens = options.runnerInputTokens ?? sumTokenField(allResults, 'inputTokens');
  const runnerOutputTokens = options.runnerOutputTokens ?? sumTokenField(allResults, 'outputTokens');
  const runnerCost = (runnerInputTokens * 3.00 + runnerOutputTokens * 15.00) / 1_000_000;
  const judgeCost = (usage.judgeInputTokens * 0.10 + usage.judgeOutputTokens * 0.40) / 1_000_000;

  return {
    skillName,
    model: RUNNER_MODEL,
    judgeModel: JUDGE_MODEL,
    totalTasks: judged.length,
    avgDiff,
    tasksImproved,
    tasksHurt,
    tasksNeutral,
    overallConfidence: overallConfidence(judged),
    results: judged,
    estimatedCost: runnerCost + judgeCost,
  };
}

function sumTokenField(results: ABResult[], field: 'inputTokens' | 'outputTokens'): number {
  return results.reduce((sum, result) => sum + (result.withSkill[field] ?? 0) + (result.withoutSkill[field] ?? 0), 0);
}

function overallConfidence(results: JudgeResult[]): 'HIGH' | 'MED' | 'LOW' {
  const high = results.filter((result) => result.confidence === 'HIGH').length;
  const med = results.filter((result) => result.confidence === 'MED').length;
  if (high >= Math.ceil(results.length / 2)) return 'HIGH';
  if (high + med >= Math.ceil(results.length / 2)) return 'MED';
  return 'LOW';
}

export function printEvalReport(report: EvalReport): void {
  const line = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const improvedPct = percent(report.tasksImproved, report.totalTasks);
  const hurtPct = percent(report.tasksHurt, report.totalTasks);
  console.log(line);
  console.log(`  skilleval results - ${report.skillName} - ${report.totalTasks} tasks`);
  console.log(line);
  console.log(`  Skill effectiveness:   ${formatDiff(report.avgDiff)} / 3`);
  console.log(`  Tasks improved:        ${report.tasksImproved} / ${report.totalTasks}  (${improvedPct}%)`);
  console.log(`  Tasks hurt:            ${report.tasksHurt} / ${report.totalTasks}  (${hurtPct}%)`);
  console.log(`  Confidence:            ${report.overallConfidence}`);
  console.log('');
  for (const result of report.results) {
    console.log(`  ${result.taskId}  ${formatDiff(result.diff)}  ${result.confidence.padEnd(4)}  ${result.reasoning}`);
  }
  console.log(line);
  console.log(`  Runner: ${report.model} | Judge: ${report.judgeModel}`);
  console.log(`  Estimated API cost this run: $${report.estimatedCost.toFixed(3)}`);
  console.log(line);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function formatDiff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
