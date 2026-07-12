import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from './config';
import type { ParsedSkill } from './parser';
import type { TaskAssertion } from './tasks-loader';

export interface Task {
  id: string;
  prompt: string;
  context?: string;
  assertions?: TaskAssertion;
}

export interface ABResult {
  taskId: string;
  runIndex?: number;
  prompt: string;
  context?: string;
  assertions?: TaskAssertion;
  withSkill: {
    output: string;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
  withoutSkill: {
    output: string;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}

export interface CompareResult {
  taskId: string;
  runIndex?: number;
  prompt: string;
  context?: string;
  skillA: {
    output: string;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
  skillB: {
    output: string;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}

type RunOutput = ABResult['withSkill'];

export interface RunOptions {
  model?: string;
  runs?: number;
}

const MODEL = process.env.SKILLEVAL_DEV === 'true'
  ? MODELS.runner.dev
  : MODELS.runner.default;

const MAX_TOKENS = process.env.SKILLEVAL_DEV === 'true' ? 1024 : 2048;

if (process.env.SKILLEVAL_DEV === 'true') {
  console.log('[dev mode] using claude-haiku-4-5 - ~10x cheaper for testing');
  console.log('[dev mode] max_tokens:', MAX_TOKENS);
}

export async function runAB(skill: ParsedSkill, tasks: Task[], apiKey: string, options: RunOptions = {}): Promise<ABResult[]> {
  const client = new Anthropic({ apiKey });
  const results: ABResult[] = [];
  const model = options.model ?? MODEL;
  const runs = options.runs ?? 1;

  for (const task of tasks) {
    const context = task.context ?? '';
    const withSkillSystem = `[SKILL: ${skill.name}]\n\n${skill.instructionBody}\n\n---\n\n${context}`;

    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      const [withSkill, withoutSkill] = await Promise.all([
        runClaudeCall(client, task, withSkillSystem, 'with skill', model),
        runClaudeCall(client, task, context, 'without skill', model),
      ]);

      results.push({
        taskId: task.id,
        runIndex,
        prompt: task.prompt,
        context: task.context,
        assertions: task.assertions,
        withSkill,
        withoutSkill,
      });
    }
  }

  return results;
}

export async function runABCompare(
  skillA: ParsedSkill,
  skillB: ParsedSkill,
  tasks: Task[],
  apiKey: string,
  options: RunOptions = {},
): Promise<CompareResult[]> {
  const client = new Anthropic({ apiKey });
  const results: CompareResult[] = [];
  const model = options.model ?? MODEL;
  const runs = options.runs ?? 1;

  for (const task of tasks) {
    const context = task.context ?? '';
    const skillASystem = `[SKILL: ${skillA.name}]\n\n${skillA.instructionBody}\n\n---\n\n${context}`;
    const skillBSystem = `[SKILL: ${skillB.name}]\n\n${skillB.instructionBody}\n\n---\n\n${context}`;

    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      const [skillAOutput, skillBOutput] = await Promise.all([
        runClaudeCall(client, task, skillASystem, 'skill A', model),
        runClaudeCall(client, task, skillBSystem, 'skill B', model),
      ]);

      results.push({
        taskId: task.id,
        runIndex,
        prompt: task.prompt,
        context: task.context,
        skillA: skillAOutput,
        skillB: skillBOutput,
      });
    }
  }

  return results;
}

async function runClaudeCall(
  client: Anthropic,
  task: Task,
  system: string,
  label: 'with skill' | 'without skill' | 'skill A' | 'skill B',
  model: string,
): Promise<RunOutput> {
  const start = Date.now();

  try {
    const message = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        {
          role: 'user',
          content: task.prompt,
        },
      ],
    });

    return {
      output: extractText(message.content),
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Claude API call failed for task ${task.id} (${label}): ${detail}`);
    return {
      output: `[ERROR: ${detail}]`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - start,
    };
  }
}

function extractText(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
