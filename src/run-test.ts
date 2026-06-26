import { join } from 'node:path';
import { parseSkillFile } from './parser';
import { runAB } from './runner';
import { loadTasksForSkill } from './tasks-loader';

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY. Run with ANTHROPIC_API_KEY=xxx npm run run-test');
  }

  const skill = parseSkillFile(join(process.cwd(), 'samples/code-review/SKILL.md'));
  const tasks = loadTasksForSkill(join(process.cwd(), 'tasks/sample-tasks.yaml'), skill.name);

  const results = await runAB(skill, tasks, apiKey);
  const table = results.map((result) => ({
    taskId: result.taskId,
    withSkill: summarize(result.withSkill.output),
    withTokens: result.withSkill.tokensUsed,
    withoutSkill: summarize(result.withoutSkill.output),
    withoutTokens: result.withoutSkill.tokensUsed,
  }));

  console.table(table);
}

function summarize(output: string): string {
  return output.replace(/\s+/g, ' ').trim().slice(0, 80);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exitCode = 1;
});
