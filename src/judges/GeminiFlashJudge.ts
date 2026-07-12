import { createRequire } from 'node:module';
import { buildScorePrompt, parseJudgeResult, type JudgeProvider, type JudgeResult } from './types';

type GeminiModel = {
  generateContent(prompt: string): Promise<{
    response: {
      text(): string;
      candidates?: Array<{
        finishReason?: string;
        safetyRatings?: unknown;
      }>;
      safetyRatings?: unknown;
    };
  }>;
};

type GoogleGenerativeAIConstructor = new (apiKey: string) => {
  getGenerativeModel(options: {
    model: string;
    generationConfig?: {
      maxOutputTokens: number;
      temperature: number;
      responseMimeType?: string;
      responseSchema?: unknown;
    };
  }): GeminiModel;
};

interface GeminiFlashJudgeOptions {
  apiKey?: string;
  model?: GeminiModel;
}

export class GeminiFlashJudge implements JudgeProvider {
  private readonly model: GeminiModel;

  constructor(options: GeminiFlashJudgeOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey && !options.model) {
      throw new Error('Missing GEMINI_API_KEY for gemini-flash judge provider.');
    }

    this.model = options.model ?? this.createModel(apiKey as string);
  }

  async score(taskPrompt: string, outputA: string, outputB: string): Promise<JudgeResult> {
    const prompt = buildScorePrompt(taskPrompt, outputA, outputB);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await this.model.generateContent(prompt);
      const rawText = response.response.text();
      const finishReason = response.response.candidates?.[0]?.finishReason ?? 'UNKNOWN';
      const safetyRatings = response.response.candidates?.[0]?.safetyRatings ?? response.response.safetyRatings;
      const parsed = parseJudgeResult(rawText);
      if (parsed) return parsed;
      const failure = formatParseFailure(attempt, finishReason, safetyRatings, rawText);
      console.warn(`Warning: ${failure}`);
    }
    throw new Error('GeminiFlashJudge returned malformed judge JSON after 3 attempts.');
  }

  private createModel(apiKey: string): GeminiModel {
    const require = createRequire(__filename);
    const { GoogleGenerativeAI } = require('@google/generative-ai') as { GoogleGenerativeAI: GoogleGenerativeAIConstructor };
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({
      model: 'gemini-3.5-flash',
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            winner: {
              type: 'STRING',
              enum: ['A', 'B', 'tie'],
            },
            margin: {
              type: 'NUMBER',
              minimum: 0,
              maximum: 3,
            },
            rationale: {
              type: 'STRING',
            },
          },
          required: ['winner', 'margin', 'rationale'],
        },
      },
    });
  }
}

function formatParseFailure(attempt: number, finishReason: string, safetyRatings: unknown, rawText: string): string {
  const cause = finishReason === 'MAX_TOKENS'
    ? 'likely truncated by Gemini maxOutputTokens'
    : 'unparseable judge JSON';
  return `Gemini judge parse failed on attempt ${attempt}; finishReason=${finishReason}; safetyRatings=${JSON.stringify(safetyRatings ?? null)}; cause=${cause}; rawResponse=${JSON.stringify(truncate(rawText, 500))}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
