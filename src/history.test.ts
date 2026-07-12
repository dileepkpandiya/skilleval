import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffHistory, loadHistory, saveHistory, type HistoryEntry } from './history';
import type { EvalReport } from './judge';

describe('history', () => {
  it('saves a valid history entry', () => {
    const historyDir = mkdtempSync(join(tmpdir(), 'skilleval-history-'));
    const report = mockReport({ skillName: 'api-design', avgDiff: 0.8 });

    const filePath = saveHistory(report, historyDir);

    expect(existsSync(filePath)).toBe(true);
    const entry = JSON.parse(readFileSync(filePath, 'utf8')) as HistoryEntry;
    expect(entry.skillName).toBe('api-design');
    expect(entry.avgDiff).toBe(0.8);
    expect(entry.taskResults).toEqual([
      {
        taskId: 'task-001',
        diff: 0.8,
        confidence: 'UNRATED',
        assertionsPassed: true,
      },
    ]);
  });

  it('loads matching skill history sorted by timestamp', () => {
    const historyDir = mkdtempSync(join(tmpdir(), 'skilleval-history-'));
    writeEntry(historyDir, 'new.json', historyEntry({ timestamp: '2026-07-12T12:00:00.000Z', skillName: 'api-design' }));
    writeEntry(historyDir, 'old.json', historyEntry({ timestamp: '2026-07-11T12:00:00.000Z', skillName: 'api-design' }));
    writeEntry(historyDir, 'other.json', historyEntry({ timestamp: '2026-07-10T12:00:00.000Z', skillName: 'other-skill' }));

    const entries = loadHistory(historyDir, 'api-design');

    expect(entries.map((entry) => entry.timestamp)).toEqual([
      '2026-07-11T12:00:00.000Z',
      '2026-07-12T12:00:00.000Z',
    ]);
  });

  it('diffs current history against previous history', () => {
    const previous = historyEntry({
      avgDiff: 0.3,
      tasksImproved: 1,
      tasksHurt: 1,
      taskResults: [
        { taskId: 'task-001', diff: 0.5, confidence: 'HIGH' },
        { taskId: 'task-002', diff: -2.0, confidence: 'LOW' },
      ],
    });
    const current = historyEntry({
      avgDiff: 0.8,
      tasksImproved: 2,
      tasksHurt: 0,
      taskResults: [
        { taskId: 'task-001', diff: 1.5, confidence: 'HIGH' },
        { taskId: 'task-002', diff: 0.5, confidence: 'MEDIUM' },
      ],
    });

    const diff = diffHistory(current, previous);

    expect(diff.avgDiffDelta).toBe(0.5);
    expect(diff.improvedDelta).toBe(1);
    expect(diff.hurtDelta).toBe(-1);
    expect(diff.taskChanges).toEqual([
      {
        taskId: 'task-001',
        previousDiff: 0.5,
        currentDiff: 1.5,
        delta: 1.0,
        direction: 'improved',
      },
      {
        taskId: 'task-002',
        previousDiff: -2.0,
        currentDiff: 0.5,
        delta: 2.5,
        direction: 'improved',
      },
    ]);
  });
});

function mockReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    skillName: 'api-design',
    model: 'claude-sonnet-4-6',
    judgeModel: 'gemini-3.5-flash',
    totalTasks: 1,
    avgDiff: 0.8,
    tasksImproved: 1,
    tasksHurt: 0,
    tasksNeutral: 0,
    tasksSkipped: 0,
    overallConfidence: 'UNRATED',
    results: [
      {
        taskId: 'task-001',
        status: 'scored',
        diff: 0.8,
        confidence: 'UNRATED',
        reasoning: 'mock',
        assertionsPassed: true,
      },
    ],
    estimatedCost: 0.001,
    runs: 1,
    ...overrides,
  };
}

function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: '2026-07-12T12:00:00.000Z',
    skillName: 'api-design',
    model: 'claude-sonnet-4-6',
    judgeModel: 'gemini-3.5-flash',
    runs: 1,
    avgDiff: 0.8,
    tasksImproved: 1,
    tasksHurt: 0,
    tasksNeutral: 0,
    totalTasks: 1,
    overallConfidence: 'UNRATED',
    estimatedCost: 0.001,
    taskResults: [{ taskId: 'task-001', diff: 0.8, confidence: 'UNRATED' }],
    ...overrides,
  };
}

function writeEntry(historyDir: string, filename: string, entry: HistoryEntry): void {
  writeFileSync(join(historyDir, filename), JSON.stringify(entry), 'utf8');
}
