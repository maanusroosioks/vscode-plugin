import { describe, expect, it } from 'vitest';
import { buildTestRunRequest, InvalidPayloadError } from '../../../src/core/payload';
import type { NormalizedTestRun } from '../../../src/core/types';
import type { SubmissionMetadata } from '../../../src/core/submissionMetadata';
import type { DeclaredSource, TestEvidencePayload } from '../../../src/capture/evidence';
import type { DeclaredSourceRequest, TestRunRequest } from '../../../src/services/httpTypes';

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
        { testSuite: 'test_calculator', testName: 'test_adds', status: 'PASSED', durationMs: 5, message: undefined },
        {
          testSuite: 'test_calculator',
          testName: 'test_divides_by_zero',
          status: 'FAILED',
          durationMs: 3,
          message: 'boom',
        },
      ],
    });
  });

  it('never includes the raw stack trace in the payload', () => {
    const request = buildTestRunRequest(sampleRun(), metadata);
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('Traceback');
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

/** sampleEvidence()'s first source is always the TEST arm, and these tests read and edit it as one. */
function declared(payload: TestEvidencePayload): DeclaredSource {
  return payload.sources[0] as DeclaredSource;
}

function declaredRequest(request: TestRunRequest): DeclaredSourceRequest {
  return request.results[0].source as DeclaredSourceRequest;
}

function sampleEvidence(overrides: Partial<TestEvidencePayload> = {}): TestEvidencePayload {
  return {
    sources: [
      {
        kind: 'TEST',
        filePath: 'tests/test_calculator.py',
        startLine: 4,
        endLine: 5,
        code: 'def test_adds():\n    assert add(2, 3) == 5',
        normalizedCodeHash: 'b'.repeat(64),
      },
      { kind: 'NONE' },
    ],
    files: [
      {
        path: 'tests/test_calculator.py',
        sha256: 'c'.repeat(64),
        content: 'import pytest\n\ndef test_adds():\n    assert add(2, 3) == 5\n',
      },
    ],
    ...overrides,
  };
}

describe('buildTestRunRequest — captured source', () => {
  it('omits source entirely when no evidence was collected', () => {
    const request = buildTestRunRequest(sampleRun(), metadata);

    expect(request.results[0].source).toBeUndefined();
  });

  it('attaches source index-aligned with the results', () => {
    const request = buildTestRunRequest(sampleRun(), metadata, sampleEvidence());

    expect(request.results[0].source).toMatchObject({
      kind: 'TEST',
      filePath: 'tests/test_calculator.py',
      startLine: 4,
      endLine: 5,
    });
    expect(request.results[1].source).toMatchObject({ kind: 'NONE' });
  });

  it('submits no integrity signals — they exist only to drive the local warning', () => {
    const request = buildTestRunRequest(sampleRun(), metadata, sampleEvidence());

    expect(request).not.toHaveProperty('integrity');
    for (const result of request.results) {
      expect(result).not.toHaveProperty('integrity');
    }
    expect(JSON.stringify(request)).not.toContain('assertionCount');
  });

  it('ships each test file once, with its hash and content', () => {
    const request = buildTestRunRequest(sampleRun(), metadata, sampleEvidence());

    expect(request.testFiles).toEqual([
      {
        path: 'tests/test_calculator.py',
        sha256: 'c'.repeat(64),
        content: 'import pytest\n\ndef test_adds():\n    assert add(2, 3) == 5\n',
        truncated: undefined,
      },
    ]);
  });

  it('omits testFiles when no evidence was collected', () => {
    expect(buildTestRunRequest(sampleRun(), metadata).testFiles).toBeUndefined();
  });

  it('carries neither flag on an ordinary run', () => {
    const serialized = JSON.stringify(buildTestRunRequest(sampleRun(), metadata, sampleEvidence()));

    expect(serialized).not.toContain('captureDisabled');
    expect(serialized).not.toContain('warningAcknowledged');
  });

  it('reports at the top level that the student switched source capture off', () => {
    const request = buildTestRunRequest(sampleRun(), metadata, {
      ...sampleEvidence(),
      captureDisabled: true,
    });

    expect(request.captureDisabled).toBe(true);
  });

  it('reports at the top level that the student clicked through the warning', () => {
    const request = buildTestRunRequest(sampleRun(), metadata, {
      ...sampleEvidence(),
      warningAcknowledged: true,
    });

    expect(request.warningAcknowledged).toBe(true);
  });

  it('keeps angle brackets in captured source — PARAM_TEXT stripping must not touch code', () => {
    const evidence = sampleEvidence();
    declared(evidence).code =
      'public void t() {\n    Assert.Throws<DivideByZeroException>(() -> divide(1, 0));\n}';

    const request = buildTestRunRequest(sampleRun(), metadata, evidence);

    expect(declaredRequest(request).code).toContain('Assert.Throws<DivideByZeroException>');
  });

  it('truncates the file path', () => {
    const evidence = sampleEvidence();
    declared(evidence).filePath = `${'p'.repeat(300)}.py`;

    const request = buildTestRunRequest(sampleRun(), metadata, evidence);

    expect(declaredRequest(request).filePath).toHaveLength(255);
  });

  it('passes the hash through untouched when the code was truncated', () => {
    const evidence = sampleEvidence();
    declared(evidence).code = 'def test_adds():\n… [truncated by moodle-test-submit: 12 more characters]';
    declared(evidence).truncated = true;

    const request = buildTestRunRequest(sampleRun(), metadata, evidence);

    expect(declaredRequest(request).normalizedCodeHash).toBe('b'.repeat(64));
    expect(declaredRequest(request).truncated).toBe(true);
  });
});
