import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import type { Task } from './runner';

export interface TaskDefinition extends Task {
  skillTarget?: string;
}

export interface TaskAssertion {
  must_contain?: string[];
  must_not_contain?: string[];
  regex_match?: string[];
  min_length?: number;
  max_length?: number;
}

interface TasksFile {
  tasks?: unknown;
}

export function loadTasks(filePath: string): Task[] {
  return loadTaskDefinitions(filePath).map(({ id, prompt, context, assertions }) => ({ id, prompt, context, assertions }));
}

export function loadTasksForSkill(filePath: string, skillName: string): Task[] {
  return loadTaskDefinitions(filePath)
    .filter((task) => task.skillTarget === undefined || task.skillTarget === skillName)
    .map(({ id, prompt, context, assertions }) => ({ id, prompt, context, assertions }));
}

export function loadTaskDefinitions(filePath: string): TaskDefinition[] {
  const rawPath = resolve(filePath);
  const contents = readFileSync(rawPath, 'utf8');
  const parsed = loadYaml(contents) as TasksFile;

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
    throw new Error(`Invalid tasks file ${rawPath}: expected a top-level 'tasks' array`);
  }

  return parsed.tasks.map((task, index) => parseTask(task, rawPath, index));
}

function parseTask(value: unknown, rawPath: string, index: number): TaskDefinition {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid task in ${rawPath} at index ${index}: expected a mapping`);
  }

  const candidate = value as Record<string, unknown>;
  return {
    id: requireString(candidate.id, 'id', rawPath, index),
    skillTarget: optionalString(candidate.skillTarget, 'skillTarget', rawPath, index),
    prompt: requireString(candidate.prompt, 'prompt', rawPath, index),
    context: optionalString(candidate.context, 'context', rawPath, index),
    assertions: parseAssertions(candidate.assertions, rawPath, index),
  };
}

function requireString(value: unknown, field: string, rawPath: string, index: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid task in ${rawPath} at index ${index}: '${field}' must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string, rawPath: string, index: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid task in ${rawPath} at index ${index}: '${field}' must be a string when provided`);
  }
  return value;
}

function parseAssertions(value: unknown, rawPath: string, index: number): TaskAssertion | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid task in ${rawPath} at index ${index}: 'assertions' must be a mapping when provided`);
  }

  const assertions = value as Record<string, unknown>;
  const parsed: TaskAssertion = {};
  const mustContain = optionalStringArray(assertions.must_contain, 'assertions.must_contain', rawPath, index);
  const mustNotContain = optionalStringArray(assertions.must_not_contain, 'assertions.must_not_contain', rawPath, index);
  const regexMatch = optionalStringArray(assertions.regex_match, 'assertions.regex_match', rawPath, index);
  const minLength = optionalNonNegativeNumber(assertions.min_length, 'assertions.min_length', rawPath, index);
  const maxLength = optionalNonNegativeNumber(assertions.max_length, 'assertions.max_length', rawPath, index);

  if (mustContain !== undefined) parsed.must_contain = mustContain;
  if (mustNotContain !== undefined) parsed.must_not_contain = mustNotContain;
  if (regexMatch !== undefined) parsed.regex_match = regexMatch;
  if (minLength !== undefined) parsed.min_length = minLength;
  if (maxLength !== undefined) parsed.max_length = maxLength;

  return parsed;
}

function optionalStringArray(value: unknown, field: string, rawPath: string, index: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid task in ${rawPath} at index ${index}: '${field}' must be an array of strings when provided`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, field: string, rawPath: string, index: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid task in ${rawPath} at index ${index}: '${field}' must be a non-negative number when provided`);
  }
  return value;
}
