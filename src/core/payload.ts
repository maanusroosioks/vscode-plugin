import type { NormalizedTestRun } from './types';
import type { SubmissionMetadata } from './submissionMetadata';
import type { TestResultRequest, TestRunRequest } from '../services/httpTypes';
import { sha256Hex } from './stackTraceHash';
import { MoodleSubmitError } from './errors';

export class InvalidPayloadError extends MoodleSubmitError {
  get userMessage(): string {
    return `Invalid submission: ${this.message}`;
  }
}

const MAX_255 = 255;
const MAX_100 = 100;

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function buildTestRunRequest(run: NormalizedTestRun, metadata: SubmissionMetadata): TestRunRequest {
  if (run.results.length === 0) {
    throw new InvalidPayloadError('Test run produced no results — nothing to submit.');
  }
  if (!metadata.assignmentKey.trim()) {
    throw new InvalidPayloadError('assignmentKey must not be blank.');
  }

  const results: TestResultRequest[] = run.results.map((testCase): TestResultRequest => {
    if (!testCase.testName.trim()) {
      throw new InvalidPayloadError('Encountered a test result with a blank testName.');
    }
    return {
      testSuite: truncate(testCase.testSuite, MAX_255),
      testName: truncate(testCase.testName, MAX_255) as string,
      status: testCase.status,
      durationMs: testCase.durationMs !== undefined ? Math.max(0, testCase.durationMs) : undefined,
      message: testCase.message,
      stackTraceHash: testCase.stackTrace ? sha256Hex(testCase.stackTrace) : undefined,
    };
  });

  return {
    assignmentKey: truncate(metadata.assignmentKey, MAX_100) as string,
    ide: 'VSCODE',
    projectName: truncate(metadata.projectName, MAX_255),
    commitHash: truncate(metadata.commitHash, MAX_100),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    results,
  };
}
