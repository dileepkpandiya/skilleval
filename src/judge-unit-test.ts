import assert from 'node:assert/strict';
import { buildEvalReportForTest, buildMultiRunReport, judgeResults, printEvalReport, printMultiRunEvalReport, type PositionAssignment } from './judge';
import { GeminiFlashJudge, type JudgeProvider } from './judges';
import type { ParsedSkill } from './parser';
import type { ABResult } from './runner';
import type { TaskAssertion } from './tasks-loader';

function capturePrint(report: Parameters<typeof printEvalReport>[0]): string {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ''));
  };
  try {
    printEvalReport(report);
  } finally {
    console.log = originalLog;
  }
  return `${lines.join('\n')}\n`;
}

function captureMultiPrint(report: Parameters<typeof printMultiRunEvalReport>[0]): string {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ''));
  };
  try {
    printMultiRunEvalReport(report);
  } finally {
    console.log = originalLog;
  }
  return `${lines.join('\n')}\n`;
}

function testSingleRunOldFormat(): void {
  const report = buildEvalReportForTest('api-design', { 'task-001': [1.5] }, 1);
  const [result] = report.results;
  const output = capturePrint(report);

  assert.equal(report.overallConfidence, 'UNRATED');
  assert.equal(result.confidence, 'UNRATED');
  assert.equal(output, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  skilleval results - api-design - 1 tasks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Skill effectiveness:   +1.5 / 3
  Tasks improved:        1 / 1  (100%)
  Tasks hurt:            0 / 1  (0%)
  Confidence:            UNRATED (use --runs 3+ for confidence)

  task-001  +1.5  UNRATED (use --runs 3+ for confidence)  mock reasoning
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Runner: claude-sonnet-4-6 | Judge: gemini-3.5-flash
  Estimated API cost this run: $0.000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

function testMultiRunStats(): void {
  const report = buildEvalReportForTest('api-design', { 'task-001': [1, 2, 3] }, 3);
  const [result] = report.results;

  assert.equal(report.avgDiff, 2);
  assert.equal(report.avgStddev, 0.8);
  assert.equal(report.minDiff, 1);
  assert.equal(report.maxDiff, 3);
  assert.equal(report.overallConfidence, 'MEDIUM');
  assert.equal(result.mean, 2);
  assert.equal(result.stddev, 0.8);
  assert.equal(result.min, 1);
  assert.equal(result.max, 3);
  assert.equal(result.confidence, 'MEDIUM');

  const output = capturePrint(report);
  assert.match(output, /Skill effectiveness:   \+2\.0 ± 0\.8 \(range: \+1\.0 to \+3\.0\)/);
  assert.match(output, /task-001  \+2\.0 ± 0\.8 \(range: \+1\.0 to \+3\.0\)  MEDIUM  mock reasoning/);
}

function testMultiRunAggregateReport(): void {
  const report = buildMultiRunReport([
    buildEvalReportForTest('api-design', { 'task-001': [1], 'task-002': [-1] }, 1),
    buildEvalReportForTest('api-design', { 'task-001': [3], 'task-002': [1] }, 1),
  ]);

  assert.equal(report.avgDiff, 1);
  assert.equal(report.aggregate.meanDiff, 1);
  assert.equal(report.aggregate.medianDiff, 1);
  assert.equal(report.aggregate.stddevDiff, 1.4);
  assert.equal(report.aggregate.totalRuns, 2);
  assert.equal(report.aggregate.totalSamples, 4);
  assert.equal(report.runs.length, 2);
  assert.deepEqual(
    report.aggregate.tasks.map((task) => ({
      taskId: task.taskId,
      avgDiff: task.avgDiff,
      meanDiff: task.meanDiff,
      medianDiff: task.medianDiff,
      stddevDiff: task.stddevDiff,
    })),
    [
      { taskId: 'task-001', avgDiff: 2, meanDiff: 2, medianDiff: 2, stddevDiff: 1 },
      { taskId: 'task-002', avgDiff: 0, meanDiff: 0, medianDiff: 0, stddevDiff: 1 },
    ],
  );

  const output = captureMultiPrint(report);
  assert.match(output, /skilleval results - api-design - 2 tasks x 2 runs/);
  assert.match(output, /Skill effectiveness:\s+mean \+1\.0, median \+1\.0, stddev 1\.4/);
  assert.match(output, /task-001\s+mean \+2\.0, median \+2\.0, stddev 1\.0\s+2\/2 runs/);
}

const skill: ParsedSkill = {
  name: 'api-design',
  description: 'API design skill',
  triggers: [],
  instructionBody: 'Prefer robust API designs.',
  rawPath: 'SKILL.md',
};

const mockJudge: JudgeProvider = {
  async score() {
    return {
      winner: 'A',
      margin: 1,
      rationale: 'mock judgement',
    };
  },
};

function mockResult(taskId: string, runIndex = 0, assertions?: TaskAssertion, withSkillOutput?: string): ABResult {
  return {
    taskId,
    runIndex,
    prompt: `Prompt ${taskId}`,
    context: '',
    assertions,
    withSkill: {
      output: withSkillOutput ?? `with skill ${taskId}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    },
    withoutSkill: {
      output: `without skill ${taskId}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    },
  };
}

async function collectAssignments(seed: number, count = 1): Promise<PositionAssignment[]> {
  const assignments: PositionAssignment[] = [];
  await judgeResults(
    skill,
    Array.from({ length: count }, (_, index) => mockResult(`task-${String(index).padStart(3, '0')}`, index)),
    {
      judge: mockJudge,
      judgeProvider: 'gemini-flash',
      print: false,
      seed,
      onPositionAssignment: (assignment) => assignments.push(assignment),
    },
  );
  return assignments;
}

async function testPositionDistributionAcrossSeeds(): Promise<void> {
  let skillOnA = 0;
  const seeds = Array.from({ length: 40 }, (_, index) => index + 1);
  for (const seed of seeds) {
    const [assignment] = await collectAssignments(seed);
    if (assignment.skillOnPosition === 'A') skillOnA += 1;
  }

  const ratio = skillOnA / seeds.length;
  assert.ok(
    ratio >= 0.4 && ratio <= 0.6,
    `expected skill-on A ratio within 60/40 split, got ${skillOnA}/${seeds.length}`,
  );
}

async function testSeedReproducibility(): Promise<void> {
  const first = await collectAssignments(12345, 25);
  const second = await collectAssignments(12345, 25);
  assert.deepEqual(second, first);
  assert.deepEqual(
    new Set(first.map((assignment) => assignment.skillOnPosition)),
    new Set(['A', 'B']),
    'expected seeded assignments to vary independently across task pairs',
  );
}

async function testAssertionFailureForcesHurtDiff(): Promise<void> {
  const tieJudge: JudgeProvider = {
    async score() {
      return {
        winner: 'tie',
        margin: 0,
        rationale: 'mock tie',
      };
    },
  };
  const report = await judgeResults(
    skill,
    [mockResult('task-001', 0, { must_contain: ['INTENTIONAL_FAIL_STRING_XYZ'] })],
    {
      judge: tieJudge,
      judgeProvider: 'gemini-flash',
      print: false,
      seed: 7,
    },
  );
  const [result] = report.results;

  assert.equal(report.tasksHurt, 1);
  assert.equal(result.status, 'scored');
  assert.equal(result.diff, -0.5);
  assert.equal(result.assertionsPassed, false);
  assert.deepEqual(result.assertionFailures, ['Output must contain: INTENTIONAL_FAIL_STRING_XYZ']);

  const output = capturePrint(report);
  assert.match(output, /task-001\s+-0\.5/);
  assert.match(output, /✗ Output must contain: INTENTIONAL_FAIL_STRING_XYZ/);
}

async function testPassingAssertionsDoNotChangeJudgeDiff(): Promise<void> {
  const tieJudge: JudgeProvider = {
    async score() {
      return {
        winner: 'tie',
        margin: 0,
        rationale: 'mock tie',
      };
    },
  };
  const report = await judgeResults(
    skill,
    [mockResult('task-001', 0, { min_length: 10 }, 'with skill output long enough')],
    {
      judge: tieJudge,
      judgeProvider: 'gemini-flash',
      print: false,
      seed: 7,
    },
  );
  const [result] = report.results;

  assert.equal(result.status, 'scored');
  assert.equal(result.diff, 0);
  assert.equal(result.assertionsPassed, true);
  assert.deepEqual(result.assertionFailures, []);
}

async function testMalformedGeminiMarksTaskSkipped(): Promise<void> {
  let calls = 0;
  const originalWarn = console.warn;
  console.warn = () => {};
  const failingGemini = new GeminiFlashJudge({
    model: {
      async generateContent() {
        calls += 1;
        return {
          response: {
            text: () => '{"winner":"A","margin":2,"rationale":',
            candidates: [{ finishReason: 'MAX_TOKENS' }],
          },
        };
      },
    },
  });

  let report: Awaited<ReturnType<typeof judgeResults>>;
  try {
    report = await judgeResults(
      skill,
      [mockResult('task-001')],
      {
        judge: failingGemini,
        judgeProvider: 'gemini-flash',
        print: false,
        seed: 7,
      },
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls, 3);
  assert.equal(report.totalTasks, 0);
  assert.equal(report.tasksSkipped, 1);
  assert.equal(report.overallConfidence, 'NONE');
  assert.equal(report.warning, 'All tasks were skipped due to judge errors; no valid results.');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].taskId, 'task-001');
  assert.equal(report.results[0].status, 'skipped');
  assert.match(report.results[0].skipReason ?? '', /malformed judge JSON after 3 attempts/);
}

async function testAllTasksSkippedWarningInReportAndTerminal(): Promise<void> {
  const failingJudge: JudgeProvider = {
    async score() {
      throw new Error('mock judge outage');
    },
  };
  const report = await judgeResults(
    skill,
    [mockResult('task-001')],
    {
      judge: failingJudge,
      judgeProvider: 'gemini-flash',
      print: false,
      seed: 7,
    },
  );

  assert.equal(report.totalTasks, 0);
  assert.equal(report.tasksSkipped, 1);
  assert.equal(report.overallConfidence, 'NONE');
  assert.equal(report.warning, 'All tasks were skipped due to judge errors; no valid results.');

  const output = capturePrint(report);
  assert.match(output, /Warning:\s+All tasks were skipped due to judge errors; no valid results\./);
  assert.match(output, /Skill effectiveness:\s+no valid results/);
  assert.match(output, /Confidence:\s+NONE/);
  assert.match(output, /Tasks skipped:\s+1 \/ 1\s+\(judge error\)/);
}

async function main(): Promise<void> {
  testSingleRunOldFormat();
  testMultiRunStats();
  testMultiRunAggregateReport();
  await testPositionDistributionAcrossSeeds();
  await testSeedReproducibility();
  await testAssertionFailureForcesHurtDiff();
  await testPassingAssertionsDoNotChangeJudgeDiff();
  await testMalformedGeminiMarksTaskSkipped();
  await testAllTasksSkippedWarningInReportAndTerminal();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
