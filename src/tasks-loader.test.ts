import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildJudgePrompt } from './judge';
import { buildTaskMessages } from './runner';
import { loadTasks } from './tasks-loader';

describe('tasks-loader multi-turn tasks', () => {
  it('parses a valid turns array', () => {
    const tasks = loadTasks(writeTasks(`tasks:
  - id: followup-001
    context: "Debugging session"
    turns:
      - role: user
        content: "My API returns 401"
      - role: assistant
        content: "Are you sending the Authorization header?"
      - role: user
        content: "Yes, still getting 401"
`));

    expect(tasks[0]).toEqual({
      id: 'followup-001',
      context: 'Debugging session',
      assertions: undefined,
      prompt: undefined,
      turns: [
        { role: 'user', content: 'My API returns 401' },
        { role: 'assistant', content: 'Are you sending the Authorization header?' },
        { role: 'user', content: 'Yes, still getting 401' },
      ],
    });
  });

  it('throws when prompt and turns are both present', () => {
    expect(() => loadTasks(writeTasks(`tasks:
  - id: bad-task
    prompt: "Single turn"
    turns:
      - role: user
        content: "Multi turn"
`))).toThrow('Task bad-task: cannot specify both prompt and turns. Use turns for multi-turn tasks, prompt for single-turn.');
  });

  it('throws when neither prompt nor turns are present', () => {
    expect(() => loadTasks(writeTasks(`tasks:
  - id: bad-task
    context: "Missing prompt"
`))).toThrow('Task bad-task: must specify either prompt or turns.');
  });

  it('throws on invalid turn roles', () => {
    expect(() => loadTasks(writeTasks(`tasks:
  - id: bad-task
    turns:
      - role: system
        content: "Invalid"
`))).toThrow("Invalid task bad-task turn 0: role must be 'user' or 'assistant'");
  });

  it('throws when the last turn is not a user message', () => {
    const [task] = loadTasks(writeTasks(`tasks:
  - id: bad-task
    turns:
      - role: user
        content: "Question"
      - role: assistant
        content: "Answer"
`));

    expect(() => buildTaskMessages(task)).toThrow('Task bad-task: last turn must be role: user');
  });

  it('keeps single-turn prompt tasks unchanged', () => {
    const [task] = loadTasks(writeTasks(`tasks:
  - id: task-001
    prompt: "Design a REST endpoint"
    context: "API design"
`));

    expect(task).toEqual({
      id: 'task-001',
      prompt: 'Design a REST endpoint',
      context: 'API design',
      assertions: undefined,
      turns: undefined,
    });
    expect(buildTaskMessages(task)).toEqual([
      { role: 'user', content: 'Design a REST endpoint' },
    ]);
  });

  it('includes prior turns in the judge prompt', () => {
    const prompt = buildJudgePrompt('Yes, still getting 401', 'Debugging session', undefined, undefined, [
      { role: 'user', content: 'My API returns 401' },
      { role: 'assistant', content: 'Are you sending the Authorization header?' },
      { role: 'user', content: 'Yes, still getting 401' },
    ]);

    expect(prompt).toContain('Task prompt: Yes, still getting 401');
    expect(prompt).toContain('Conversation context: User: My API returns 401');
    expect(prompt).toContain('Assistant: Are you sending the Authorization header?');
    expect(prompt).toContain('Task context: Debugging session');
  });
});

function writeTasks(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'skilleval-tasks-'));
  const filePath = join(dir, 'tasks.yaml');
  writeFileSync(filePath, contents, 'utf8');
  return filePath;
}
