import { buildScorePrompt, parseJudgeResult, type JudgeProvider, type JudgeResult } from './types';

type FetchFn = typeof fetch;

interface OpenAIJudgeOptions {
  apiKey?: string;
  fetchFn?: FetchFn;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAIJudge implements JudgeProvider {
  private readonly apiKey: string;
  private readonly fetchFn: FetchFn;

  constructor(options: OpenAIJudgeOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY for openai judge provider.');
    }
    this.apiKey = apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async score(taskPrompt: string, outputA: string, outputB: string): Promise<JudgeResult> {
    const prompt = buildScorePrompt(taskPrompt, outputA, outputB);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.fetchFn('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          temperature: 0.1,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const body = await response.json() as OpenAIChatResponse;
      if (!response.ok) {
        throw new Error(`OpenAIJudge request failed: ${JSON.stringify(body)}`);
      }
      const parsed = parseJudgeResult(body.choices?.[0]?.message?.content ?? '');
      if (parsed) return parsed;
    }
    throw new Error('OpenAIJudge returned malformed judge JSON after 2 attempts.');
  }
}
