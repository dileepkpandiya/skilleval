import { describe, expect, it } from 'vitest';
import { buildEvalReportForTest, confidenceForStddev, scoresForJudgement } from './judge';

describe('scoresForJudgement', () => {
  it('scores a max-margin with-skill win', () => {
    expect(scoresForJudgement(3, true)).toEqual({ withSkillScore: 3, withoutSkillScore: 0 });
  });

  it('scores a zero-margin with-skill win as even', () => {
    expect(scoresForJudgement(0, true)).toEqual({ withSkillScore: 1.5, withoutSkillScore: 1.5 });
  });

  it('scores a max-margin without-skill win', () => {
    expect(scoresForJudgement(3, false)).toEqual({ withSkillScore: 0, withoutSkillScore: 3 });
  });

  it('rounds a medium-margin with-skill win to one decimal', () => {
    expect(scoresForJudgement(1.5, true)).toEqual({ withSkillScore: 2.3, withoutSkillScore: 0.8 });
  });

  it('scores ties evenly regardless of margin', () => {
    expect(scoresForJudgement(3, undefined)).toEqual({ withSkillScore: 1.5, withoutSkillScore: 1.5 });
  });

  it('clamps margins outside the valid range', () => {
    expect(scoresForJudgement(-1, true)).toEqual({ withSkillScore: 1.5, withoutSkillScore: 1.5 });
    expect(scoresForJudgement(5, true)).toEqual({ withSkillScore: 3, withoutSkillScore: 0 });
  });
});

describe('confidenceForStddev', () => {
  it('marks zero stddev as unrated', () => {
    expect(confidenceForStddev(0)).toBe('UNRATED');
  });

  it('maps low non-zero stddev to high confidence', () => {
    expect(confidenceForStddev(0.3)).toBe('HIGH');
  });

  it('maps boundary and medium stddev to medium confidence', () => {
    expect(confidenceForStddev(0.5)).toBe('MEDIUM');
    expect(confidenceForStddev(0.8)).toBe('MEDIUM');
    expect(confidenceForStddev(1.0)).toBe('MEDIUM');
  });

  it('maps high stddev to low confidence', () => {
    expect(confidenceForStddev(1.1)).toBe('LOW');
  });
});

describe('buildEvalReportForTest', () => {
  it('summarizes all improved tasks', () => {
    const report = buildEvalReportForTest('api-design', {
      'task-001': [1.5],
      'task-002': [1.5],
      'task-003': [1.5],
    }, 1);

    expect(report.avgDiff).toBe(1.5);
    expect(report.tasksImproved).toBe(3);
    expect(report.tasksHurt).toBe(0);
  });

  it('summarizes improved, hurt, and neutral tasks', () => {
    const report = buildEvalReportForTest('api-design', {
      'task-001': [2],
      'task-002': [0],
      'task-003': [-2],
    }, 1);

    expect(report.avgDiff).toBe(0);
    expect(report.tasksImproved).toBe(1);
    expect(report.tasksHurt).toBe(1);
    expect(report.tasksNeutral).toBe(1);
  });

  it('counts diff >= 0.5 as improved', () => {
    const report = buildEvalReportForTest('api-design', { 'task-001': [0.5] }, 1);
    expect(report.tasksImproved).toBe(1);
  });

  it('counts diff <= -0.5 as hurt', () => {
    const report = buildEvalReportForTest('api-design', { 'task-001': [-0.5] }, 1);
    expect(report.tasksHurt).toBe(1);
  });

  it('counts diffs between -0.4 and 0.4 as neutral', () => {
    const report = buildEvalReportForTest('api-design', {
      'task-001': [-0.4],
      'task-002': [0],
      'task-003': [0.4],
    }, 1);

    expect(report.tasksNeutral).toBe(3);
    expect(report.tasksImproved).toBe(0);
    expect(report.tasksHurt).toBe(0);
  });
});
