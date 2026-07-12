import { createRequire } from 'node:module';

const { jsonrepair } = createRequire(__filename)('json-repair') as { jsonrepair: (json: string) => string };

export interface JudgeProvider {
  score(taskPrompt: string, outputA: string, outputB: string): Promise<JudgeResult>;
}

export interface JudgeResult {
  winner: 'A' | 'B' | 'tie';
  margin: number;
  rationale: string;
}

export type JudgeProviderName = 'gemini-flash' | 'claude' | 'openai';

export function buildScorePrompt(taskPrompt: string, outputA: string, outputB: string): string {
  return `You are an expert evaluator comparing two AI outputs for the same task.

${taskPrompt}

Output A:
${outputA}

Output B:
${outputB}

A strong output:
- Directly satisfies the user's task
- Uses the provided context accurately
- Gives precise, actionable, and well-scoped guidance
- Avoids hallucinated facts, unsupported claims, and irrelevant detail

Compare Output A and Output B only on task quality: correctness, completeness, context fit, and actionability.
Do not assume either position is more likely to be the skill-assisted output.

CRITICAL: Respond with ONLY a raw JSON object. No markdown. No code fences. No text before or after.
{"winner":"A","margin":1.5,"rationale":"One concise sentence explaining why."}

winner must be exactly one of: "A", "B", "tie"
margin must be a number between 0.0 and 3.0. Use 0.0 for ties.
rationale must be one concise sentence.`;
}

export function parseJudgeResult(text: string): JudgeResult | undefined {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(jsonrepair(cleaned)) as unknown;
    if (!isJudgeResult(parsed)) return undefined;
    return {
      winner: parsed.winner,
      margin: parsed.winner === 'tie' ? 0 : clampMargin(parsed.margin),
      rationale: parsed.rationale,
    };
  } catch {
    return undefined;
  }
}

function isJudgeResult(value: unknown): value is JudgeResult {
  if (value === null || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    (result.winner === 'A' || result.winner === 'B' || result.winner === 'tie')
    && typeof result.margin === 'number'
    && Number.isFinite(result.margin)
    && result.margin >= 0
    && result.margin <= 3
    && typeof result.rationale === 'string'
  );
}

function clampMargin(value: number): number {
  return Math.max(0, Math.min(3, value));
}
