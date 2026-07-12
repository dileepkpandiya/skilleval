import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSkillFile } from './parser';

function tempSkillPath(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'skilleval-parser-'));
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('parseSkillFile', () => {
  it('parses valid frontmatter and instruction body', () => {
    const path = tempSkillPath(`---
name: api-design
description: API design guidance
version: 1.0.0
triggers:
  - api
  - endpoint
---
Prefer stable endpoint contracts.
`);

    const skill = parseSkillFile(path);

    expect(skill.name).toBe('api-design');
    expect(skill.description).toBe('API design guidance');
    expect(skill.instructionBody).toBe('Prefer stable endpoint contracts.');
    expect(skill.rawPath).toBe(path);
  });

  it('throws when name is missing', () => {
    const path = tempSkillPath(`---
description: Missing name
triggers:
  - api
---
Instructions.
`);

    expect(() => parseSkillFile(path)).toThrow(/'name' must be a non-empty string/);
  });

  it('throws with the path when SKILL.md is missing', () => {
    const missingPath = join(tmpdir(), 'skilleval-missing-SKILL.md');

    expect(() => parseSkillFile(missingPath)).toThrow(new RegExp(`SKILL\\.md not found at ${escapeRegExp(missingPath)}`));
  });

  it('throws when frontmatter is absent', () => {
    const path = tempSkillPath('No YAML frontmatter here.');

    expect(() => parseSkillFile(path)).toThrow(/missing YAML frontmatter/);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
