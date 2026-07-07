import { join } from 'node:path';
import { judgeResults } from './judge';
import { parseSkillFile } from './parser';
import { runAB } from './runner';
import { loadTasksForSkill } from './tasks-loader';

async function main(): Promise<void> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY.');
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY.');
  }

  const skill = parseSkillFile(join(process.cwd(), 'samples/test-writer/SKILL.md'));
  const tasks = loadTasksForSkill(join(process.cwd(), 'tasks/sample-tasks.yaml'), skill.name).slice(0, 3);
  const results = await runAB(skill, tasks, anthropicApiKey);
  await judgeResults(skill, results);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exitCode = 1;
});
