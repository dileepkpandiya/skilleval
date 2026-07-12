import { ClaudeJudge } from './ClaudeJudge';
import { GeminiFlashJudge } from './GeminiFlashJudge';
import { OpenAIJudge } from './OpenAIJudge';
import type { JudgeProvider, JudgeProviderName } from './types';

export type { JudgeProvider, JudgeProviderName, JudgeResult } from './types';
export { ClaudeJudge } from './ClaudeJudge';
export { GeminiFlashJudge } from './GeminiFlashJudge';
export { OpenAIJudge } from './OpenAIJudge';

export function createJudgeProvider(name: string): JudgeProvider {
  if (name === 'gemini-flash') return new GeminiFlashJudge();
  if (name === 'claude') return new ClaudeJudge();
  if (name === 'openai') return new OpenAIJudge();
  throw new Error(`Unknown judge provider "${name}". Expected one of: gemini-flash, claude, openai`);
}

export function isJudgeProviderName(value: string): value is JudgeProviderName {
  return value === 'gemini-flash' || value === 'claude' || value === 'openai';
}
