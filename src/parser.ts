import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';

export interface ParsedSkill {
  name: string;
  description: string;
  version?: string;
  triggers: string[];
  agents?: string[];
  instructionBody: string;
  rawPath: string;
}

type Frontmatter = {
  name?: unknown;
  description?: unknown;
  version?: unknown;
  triggers?: unknown;
  agents?: unknown;
};

export function parseSkillFile(filePath: string): ParsedSkill {
  const rawPath = resolve(filePath);
  let contents: string;

  try {
    contents = readFileSync(rawPath, 'utf8');
  } catch (err) {
    throw new Error(`SKILL.md not found at ${rawPath}`);
  }

  if (!contents.startsWith('---')) {
    throw new Error(`SKILL.md is missing YAML frontmatter: ${rawPath}`);
  }

  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    throw new Error(`SKILL.md is missing closing frontmatter delimiter: ${rawPath}`);
  }

  const [, frontmatterText, instructionBody] = match;
  let frontmatter: Frontmatter;

  try {
    const parsed = loadYaml(frontmatterText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('frontmatter must be a YAML mapping');
    }
    frontmatter = parsed as Frontmatter;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML frontmatter in ${rawPath}: ${detail}`);
  }

  return {
    name: requireString(frontmatter.name, 'name', rawPath),
    description: requireString(frontmatter.description, 'description', rawPath),
    version: optionalString(frontmatter.version, 'version', rawPath),
    triggers: requireStringArray(frontmatter.triggers, 'triggers', rawPath),
    agents: optionalStringArray(frontmatter.agents, 'agents', rawPath),
    instructionBody: instructionBody.trim(),
    rawPath,
  };
}

function requireString(value: unknown, field: string, rawPath: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid frontmatter in ${rawPath}: '${field}' must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string, rawPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid frontmatter in ${rawPath}: '${field}' must be a non-empty string when provided`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string, rawPath: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Invalid frontmatter in ${rawPath}: '${field}' must be a non-empty array of strings`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string, rawPath: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Invalid frontmatter in ${rawPath}: '${field}' must be an array of strings when provided`);
  }
  return value;
}

if (require.main === module) {
  parseSkillFile(process.argv[2]);
}
