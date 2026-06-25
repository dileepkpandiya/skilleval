import { join } from 'node:path';
import { parseSkillFile } from './parser';

const samplePaths = [
  'samples/code-review/SKILL.md',
  'samples/api-design/SKILL.md',
  'samples/test-writer/SKILL.md',
];

const parsedSkills = samplePaths.map((samplePath) => parseSkillFile(join(process.cwd(), samplePath)));

console.log(JSON.stringify(parsedSkills, null, 2));
