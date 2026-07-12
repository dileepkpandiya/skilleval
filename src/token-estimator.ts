import type { Task } from './runner';

export const CHARS_PER_TOKEN = 4;

export interface RunnerTokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeTokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function estimateRunnerTokens(
  skillInstructionBody: string,
  tasks: Task[],
  runs = 1,
): RunnerTokenEstimate {
  const totals = tasks.reduce((estimate, task) => {
    const context = task.context ?? '';
    const promptText = taskText(task);
    const withSkillInput = estimateTokens(skillInstructionBody + context + promptText);
    const withoutSkillInput = estimateTokens(context + promptText);
    const outputTokens = estimateTokens(promptText) * 3 * 2;
    return {
      inputTokens: estimate.inputTokens + withSkillInput + withoutSkillInput,
      outputTokens: estimate.outputTokens + outputTokens,
    };
  }, { inputTokens: 0, outputTokens: 0 });

  return {
    inputTokens: totals.inputTokens * runs,
    outputTokens: totals.outputTokens * runs,
  };
}

export function estimateJudgeTokens(
  tasks: Task[],
  _skillInstructionBody: string,
  runs = 1,
): JudgeTokenEstimate {
  const totals = tasks.reduce((estimate, task) => {
    const context = task.context ?? '';
    return {
      inputTokens: estimate.inputTokens + estimateTokens(taskText(task) + context) + 1200,
      outputTokens: estimate.outputTokens + 80,
    };
  }, { inputTokens: 0, outputTokens: 0 });

  return {
    inputTokens: totals.inputTokens * runs,
    outputTokens: totals.outputTokens * runs,
  };
}

function taskText(task: Task): string {
  if (task.prompt !== undefined) return task.prompt;
  return (task.turns ?? []).map((turn) => turn.content).join('\n');
}
