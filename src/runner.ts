import Anthropic from '@anthropic-ai/sdk';
import type { ParsedSkill } from './parser';

export interface Task {
  id: string;
  prompt: string;
  context?: string;
}

export interface ABResult {
  taskId: string;
  prompt: string;
  withSkill: {
    output: string;
    tokensUsed: number;
    latencyMs: number;
  };
  withoutSkill: {
    output: string;
    tokensUsed: number;
    latencyMs: number;
  };
}

type RunOutput = ABResult['withSkill'];

const MODEL = 'claude-opus-4-5';
const MAX_TOKENS = 1024;

export async function runAB(skill: ParsedSkill, tasks: Task[], apiKey: string): Promise<ABResult[]> {
  const client = new Anthropic({ apiKey });
  const results: ABResult[] = [];

  for (const task of tasks) {
    const context = task.context ?? '';
    const withSkillSystem = `[SKILL: ${skill.name}]\n\n${skill.instructionBody}\n\n---\n\n${context}`;

    const [withSkill, withoutSkill] = await Promise.all([
      runClaudeCall(client, task, withSkillSystem, 'with skill'),
      runClaudeCall(client, task, context, 'without skill'),
    ]);

    results.push({
      taskId: task.id,
      prompt: task.prompt,
      withSkill,
      withoutSkill,
    });
  }

  return results;
}

async function runClaudeCall(
  client: Anthropic,
  task: Task,
  system: string,
  label: 'with skill' | 'without skill',
): Promise<RunOutput> {
  const start = Date.now();

  try {
    const message = await client.messages.create({
      model: MODEL,
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
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Claude API call failed for task ${task.id} (${label}): ${detail}`);
    return {
      output: `[ERROR: ${detail}]`,
      tokensUsed: 0,
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
