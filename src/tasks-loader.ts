import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import type { Task } from './runner';

export interface TaskDefinition extends Task {
  skillTarget?: string;
}

interface TasksFile {
  tasks?: unknown;
}

export function loadTasks(filePath: string): Task[] {
  return loadTaskDefinitions(filePath).map(({ id, prompt, context }) => ({ id, prompt, context }));
}

export function loadTasksForSkill(filePath: string, skillName: string): Task[] {
  return loadTaskDefinitions(filePath)
    .filter((task) => task.skillTarget === undefined || task.skillTarget === skillName)
    .map(({ id, prompt, context }) => ({ id, prompt, context }));
}

export function loadTaskDefinitions(filePath: string): TaskDefinition[] {
  const rawPath = resolve(filePath);
  const contents = readFileSync(rawPath, 'utf8');
  const parsed = yaml.load(contents) as TasksFile;

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
