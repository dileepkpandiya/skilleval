import type { TaskAssertion } from './tasks-loader';

export interface AssertionResult {
  passed: boolean;
  failures: string[];
}

export function runAssertions(output: string, assertions: TaskAssertion | undefined): AssertionResult {
  if (assertions === undefined) {
    return { passed: true, failures: [] };
  }

  const failures: string[] = [];
  const normalizedOutput = output.toLowerCase();

  for (const expected of assertions.must_contain ?? []) {
    if (!normalizedOutput.includes(expected.toLowerCase())) {
      failures.push(`Output must contain: ${expected}`);
    }
  }

  for (const forbidden of assertions.must_not_contain ?? []) {
    if (normalizedOutput.includes(forbidden.toLowerCase())) {
      failures.push(`Output must not contain: ${forbidden}`);
    }
  }

  for (const pattern of assertions.regex_match ?? []) {
    if (!new RegExp(pattern).test(output)) {
      failures.push(`Output must match regex: ${pattern}`);
    }
  }

  if (assertions.min_length !== undefined && output.length < assertions.min_length) {
    failures.push(`Output length must be at least ${assertions.min_length} characters`);
  }

  if (assertions.max_length !== undefined && output.length > assertions.max_length) {
    failures.push(`Output length must be at most ${assertions.max_length} characters`);
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
