import { describe, expect, it } from 'vitest';
import { estimateJudgeTokens, estimateRunnerTokens, estimateTokens } from './token-estimator';
import type { Task } from './runner';

describe('estimateTokens', () => {
  it('estimates tokens from characters', () => {
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('returns at least one token', () => {
    expect(estimateTokens('')).toBe(1);
  });

  it('uses four characters per token', () => {
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });
});

describe('estimateRunnerTokens', () => {
  it('estimates higher input for longer skill bodies', () => {
    const tasks = [task('Design an endpoint')];
    const shortEstimate = estimateRunnerTokens('short', tasks);
    const longEstimate = estimateRunnerTokens('long '.repeat(200), tasks);

    expect(longEstimate.inputTokens).toBeGreaterThan(shortEstimate.inputTokens);
  });

  it('scales with more tasks', () => {
    const oneTask = [task('Design an endpoint')];
    const twoTasks = [task('Design an endpoint'), task('Design an endpoint')];

    expect(estimateRunnerTokens('skill', twoTasks)).toEqual({
      inputTokens: estimateRunnerTokens('skill', oneTask).inputTokens * 2,
      outputTokens: estimateRunnerTokens('skill', oneTask).outputTokens * 2,
    });
  });
});

describe('estimateJudgeTokens', () => {
  it('estimates higher input for longer prompts', () => {
    const shortEstimate = estimateJudgeTokens([task('Short prompt')], 'skill');
    const longEstimate = estimateJudgeTokens([task('Long prompt '.repeat(200))], 'skill');

    expect(longEstimate.inputTokens).toBeGreaterThan(shortEstimate.inputTokens);
  });

  it('returns positive integers', () => {
    const runnerEstimate = estimateRunnerTokens('skill instructions', [task('Prompt')], 3);
    const judgeEstimate = estimateJudgeTokens([task('Prompt')], 'skill instructions', 3);

    for (const value of [
      runnerEstimate.inputTokens,
      runnerEstimate.outputTokens,
      judgeEstimate.inputTokens,
      judgeEstimate.outputTokens,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});

function task(prompt: string): Task {
  return {
    id: 'task-001',
    prompt,
    context: 'Context',
  };
}
