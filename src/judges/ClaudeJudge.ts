import Anthropic from '@anthropic-ai/sdk';
import { buildScorePrompt, parseJudgeResult, type JudgeProvider, type JudgeResult } from './types';

type AnthropicClient = Pick<Anthropic, 'messages'>;

interface ClaudeJudgeOptions {
  apiKey?: string;
  client?: AnthropicClient;
}

export class ClaudeJudge implements JudgeProvider {
  private readonly client: AnthropicClient;

  constructor(options: ClaudeJudgeOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !options.client) {
      throw new Error('Missing ANTHROPIC_API_KEY for claude judge provider.');
    }
    this.client = options.client ?? new Anthropic({ apiKey });
  }

  async score(taskPrompt: string, outputA: string, outputB: string): Promise<JudgeResult> {
    const prompt = buildScorePrompt(taskPrompt, outputA, outputB);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = parseJudgeResult(extractAnthropicText(message.content));
      if (parsed) return parsed;
    }
    throw new Error('ClaudeJudge returned malformed judge JSON after 2 attempts.');
  }
}

function extractAnthropicText(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
