import { describe, expect, it } from 'vitest';
import { buildTestRunRequest, InvalidPayloadError } from '../../../src/core/payload';
import { sha256Hex } from '../../../src/core/stackTraceHash';
import type { NormalizedTestRun } from '../../../src/core/types';
import type { SubmissionMetadata } from '../../../src/core/submissionMetadata';

const metadata: SubmissionMetadata = {
  assignmentKey: 'assignment-101',
  projectName: 'my-project',
  commitHash: 'deadbeef',
};

function sampleRun(overrides: Partial<NormalizedTestRun> = {}): NormalizedTestRun {
  return {
    adapterId: 'pytest',
    language: 'python',
    startedAt: 1000,
    finishedAt: 2000,
    results: [
      { testSuite: 'test_calculator', testName: 'test_adds', status: 'PASSED', durationMs: 5 },
      {
        testSuite: 'test_calculator',
        testName: 'test_divides_by_zero',
        status: 'FAILED',
        durationMs: 3,
        message: 'boom',
        stackTrace: 'Traceback ...',
      },
    ],
    ...overrides,
  };
}

describe('buildTestRunRequest', () => {
  it('maps a normalized run + metadata onto the exact TestRunRequest/TestResultRequest shape', () => {
    const request = buildTestRunRequest(sampleRun(), metadata);

    expect(request).toEqual({
      assignmentKey: 'assignment-101',
      ide: 'VSCODE',
      projectName: 'my-project',
      commitHash: 'deadbeef',
      startedAt: 1000,
      finishedAt: 2000,
      results: [
        { testSuite: 'test_calculator', testName: 'test_adds', status: 'PASSED', durationMs: 5, message: undefined, stackTraceHash: undefined },
        {
          testSuite: 'test_calculator',
          testName: 'test_divides_by_zero',
          status: 'FAILED',
          durationMs: 3,
          message: 'boom',
          stackTraceHash: sha256Hex('Traceback ...'),
        },
      ],
    });
  });

  it('never includes the raw stack trace in the payload', () => {
    const request = buildTestRunRequest(sampleRun(), metadata);
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('Traceback');
  });

  it('produces a stackTraceHash no longer than 64 characters', () => {
    const request = buildTestRunRequest(sampleRun(), metadata);
    const failed = request.results.find((r) => r.testName === 'test_divides_by_zero');
    expect(failed?.stackTraceHash).toHaveLength(64);
  });

  it('throws InvalidPayloadError when there are no results', () => {
    expect(() => buildTestRunRequest(sampleRun({ results: [] }), metadata)).toThrow(InvalidPayloadError);
  });

  it('throws InvalidPayloadError when assignmentKey is blank', () => {
    expect(() => buildTestRunRequest(sampleRun(), { ...metadata, assignmentKey: '  ' })).toThrow(
      InvalidPayloadError,
    );
  });

  it('strips angle brackets so values survive Moodle PARAM_TEXT validation', () => {
    const request = buildTestRunRequest(
      sampleRun({
        results: [
          {
            testSuite: 'suite',
            testName: 'test_compare',
            status: 'FAILED',
            message: 'expected: <0> but was: <-1>',
          },
        ],
      }),
      metadata,
    );

    expect(request.results[0].message).toBe('expected: 0 but was: -1');
  });

  it('truncates fields exceeding the DTO @Size limits', () => {
    const longName = 'x'.repeat(300);
    const request = buildTestRunRequest(
      sampleRun({ results: [{ testSuite: longName, testName: longName, status: 'PASSED' }] }),
      { ...metadata, assignmentKey: 'y'.repeat(200) },
    );

    expect(request.assignmentKey).toHaveLength(100);
    expect(request.results[0].testSuite).toHaveLength(255);
    expect(request.results[0].testName).toHaveLength(255);
  });
});
