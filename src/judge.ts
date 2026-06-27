import Anthropic from '@anthropic-ai/sdk';
import { createRequire } from 'node:module';
import { MODELS } from './config';
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

export type JudgeProvider = 'gemini' | 'anthropic' | 'openai';

interface JudgeOptions {
  googleApiKey?: string;
  anthropicApiKey?: string;
  openAIApiKey?: string;
  judgeModel?: string;
  judgeProvider?: JudgeProvider;
  runnerModel?: string;
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
  ? MODELS.runner.dev
  : MODELS.runner.default;
const JUDGE_MODEL = MODELS.judge.default;
const MAX_ATTEMPTS = 3;

export async function judgeResults(
  skill: ParsedSkill,
  results: ABResult[],
  options: JudgeOptions = {},
): Promise<EvalReport> {
  const provider = options.judgeProvider ?? 'gemini';
  const judgeModel = options.judgeModel ?? (provider === 'anthropic' ? MODELS.judge.fallback : JUDGE_MODEL);
  const generate = createJudgeGenerator(provider, judgeModel, options);
  const judged: JudgeResult[] = [];
  const usage: UsageTotals = { judgeInputTokens: 0, judgeOutputTokens: 0 };

  for (const result of results) {
    const swapped = Math.random() < 0.5;
    const outputA = swapped ? result.withSkill.output : result.withoutSkill.output;
    const outputB = swapped ? result.withoutSkill.output : result.withSkill.output;
    const prompt = buildJudgePrompt(result.prompt, result.context ?? '', outputA, outputB);

    const judgement = await judgeOneTask(generate, result.taskId, prompt, usage);
    if (!judgement) continue;

    const winnerIsWithSkill = swapped ? judgement.winner === 'A' : judgement.winner === 'B';
    const { withSkillScore, withoutSkillScore } = scoresForJudgement(judgement.score, winnerIsWithSkill);
    const diff = round1(withSkillScore - withoutSkillScore);

    judged.push({
      taskId: result.taskId,
      withSkillScore,
      withoutSkillScore,
      diff,
      confidence: judgement.confidence,
      reasoning: judgement.reason,
    });
  }

  const report = buildReport(skill.name, results, judged, usage, { ...options, judgeModel });
  if (options.print ?? true) printEvalReport(report);
  return report;
}


function loadGoogleGenerativeAI(): { GoogleGenerativeAI: GoogleGenerativeAIConstructor } {
  const require = createRequire(__filename);
  return require('@google/generative-ai') as { GoogleGenerativeAI: GoogleGenerativeAIConstructor };
}

type JudgeGenerator = (prompt: string, usage: UsageTotals) => Promise<string>;

function createJudgeGenerator(provider: JudgeProvider, judgeModel: string, options: JudgeOptions): JudgeGenerator {
  if (provider === 'gemini') {
    const apiKey = options.googleApiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GOOGLE_API_KEY.');
    }

    const { GoogleGenerativeAI } = loadGoogleGenerativeAI();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: judgeModel,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.1,
      },
    });

    return async (prompt, usage) => {
      const response = await model.generateContent(prompt);
      const metadata = response.response.usageMetadata;
      const text = response.response.text().trim();
      usage.judgeInputTokens += metadata?.promptTokenCount ?? estimateTokens(prompt);
      usage.judgeOutputTokens += metadata?.candidatesTokenCount ?? estimateTokens(text);
      return text;
    };
  }

  if (provider === 'anthropic') {
    const apiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY.');
    }
    const client = new Anthropic({ apiKey });

    return async (prompt, usage) => {
      const message = await client.messages.create({
        model: judgeModel,
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = extractAnthropicText(message.content).trim();
      usage.judgeInputTokens += message.usage.input_tokens;
      usage.judgeOutputTokens += message.usage.output_tokens;
      return text;
    };
  }

  return async (prompt, usage) => {
    const apiKey = options.openAIApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY.');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: judgeModel,
        temperature: 0.1,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const body = await response.json() as OpenAIChatResponse;
    if (!response.ok) {
      throw new Error(`OpenAI judge request failed: ${JSON.stringify(body)}`);
    }
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    usage.judgeInputTokens += body.usage?.prompt_tokens ?? estimateTokens(prompt);
    usage.judgeOutputTokens += body.usage?.completion_tokens ?? estimateTokens(text);
    return text;
  };
}

function buildJudgePrompt(taskPrompt: string, taskContext: string, outputA: string, outputB: string): string {
  return `You are an expert evaluator comparing two code review responses.

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

function scoresForJudgement(score: number, winnerIsWithSkill: boolean): { withSkillScore: number; withoutSkillScore: number } {
  const clamped = Math.max(0, Math.min(3, score));
  const winnerScore = round1((3 + clamped) / 2);
  const loserScore = round1((3 - clamped) / 2);

  return winnerIsWithSkill
    ? { withSkillScore: winnerScore, withoutSkillScore: loserScore }
    : { withSkillScore: loserScore, withoutSkillScore: winnerScore };
}

async function judgeOneTask(
  generate: JudgeGenerator,
  taskId: string,
  prompt: string,
  usage: UsageTotals,
): Promise<GeminiJudgement | undefined> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const text = await generate(prompt, usage);
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
    model: options.runnerModel ?? RUNNER_MODEL,
    judgeModel: options.judgeModel ?? JUDGE_MODEL,
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

function extractAnthropicText(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
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
